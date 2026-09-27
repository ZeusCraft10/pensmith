// bin/lib/lock.ts — cross-process advisory lock per ARCH-06 / D-26, reworked for
// contention by RUN-22 / D-17-42.
//
// Wraps proper-lockfile@^4 (battle-tested, used by npm/yarn).
//
// CJS-shim necessity (RESEARCH §Key Finding #4 — BLOCKING):
//   `import lockfile from 'proper-lockfile'` raises ERR_REQUIRE_ESM under
//   tsx + node:test in this project's "type":"module" mode. proper-lockfile
//   ships only CommonJS; the createRequire pattern below is the ONLY way to
//   import it under our toolchain.
//
// Lock dir (D-40 — OneDrive non-negotiable):
//   Locks live in pensmithLockDir() (`%LOCALAPPDATA%\pensmith\locks` on
//   Windows; `~/Library/Application Support/pensmith/locks` on macOS;
//   `$XDG_DATA_HOME/pensmith/locks` on Linux). NEVER inside `.paper/` —
//   OneDrive / iCloud / Dropbox open-delete-recreate files mid-write,
//   which corrupts active lock files.
//
// Lock-file naming (T-01-INFO-03):
//   The lock filename is `sha256(canonical resource).slice(0,12)` so resources
//   like `'C:\\Users\\u\\OneDrive\\repo\\.paper\\sections\\03-methods'` don't
//   break Windows lock-filename rules (':' / '\\' / spaces). The hash is
//   one-way — no resource path leaks into the filesystem (owner.json below
//   records WHO holds the lock, never WHAT is locked).
//
// Acquisition — three layers (RUN-22 / D-17-42). The pre-RUN-22 version handed
// proper-lockfile a node-retry schedule; with ~20 callers contending, the
// geometric schedule let ELOCKED escape (AUD-26: N=40 → 25 ELOCKED). Now:
//   1. An in-process FIFO queue per CANONICAL resource. Callers in this process
//      wait their turn instead of hammering the lock directory, so in-process
//      contention (wave writes, library upserts) never reaches the filesystem.
//   2. One proper-lockfile attempt with `retries: 0` for the head of the queue.
//   3. On ELOCKED (another PROCESS holds it): jittered exponential backoff,
//      5 ms growing to 250 ms, until `timeoutMs` (measured from the call, queue
//      wait included). A holder whose owner.json names a dead PID on this host
//      is cleared at once instead of waiting `staleMs`.
//   On timeout it throws LockTimeoutError(resource, holderPid) — a PensmithError
//   (V1), so the CLI prints one line naming the path and the holder PID.
//
// owner.json (D-17-42):
//   proper-lockfile's lock is the directory `${stub}.lock` (atomic mkdir). The
//   holder writes `${stub}.lock/owner.json` = {pid, hostname, acquiredAt,
//   processStartedAt} INSIDE that directory, BEFORE proper-lockfile probes the
//   directory mtime (a custom `fs` whose mkdir writes the record), so the
//   holder's mtime heartbeat is never disturbed. The same `fs` removes the
//   record before every rmdir (release, stale takeover, exit cleanup), which
//   proper-lockfile needs because it removes the lock with a plain rmdir.
//
// Lock TTL (D-26):
//   Default `staleMs = 45_000` (1.5x of the 30s working-TTL). proper-lockfile
//   considers a lock stale past `stale` and lets the next caller take it.
//   Default `timeoutMs = 60_000` is the maximum wait before LockTimeoutError.
//
// Public API (D-26):
//   - withLock(resource, fn, opts?)   — acquire, run, release (try/finally)
//   - tryAcquire(resource, opts?)     — returns release(); caller manages
//   - release(resource)               — release a lock this process holds
//   - forceRelease(resource)          — best-effort orphan cleanup (Stop hook)
//   - isLocked(resource)              — non-destructive check
//   - lockOwner(resource)             — the holder record, or null

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { pensmithLockDir } from './paths.js';
import { atomicWriteFile } from './atomic-write.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

// CJS-shim — see "BLOCKING" note above. proper-lockfile is CommonJS-only.
// The `as typeof import('proper-lockfile')` cast is a type-only operation
// (TypeScript's `typeof import(...)` is the module's type signature) and
// does not introduce a runtime ESM import.
const require_ = createRequire(import.meta.url);
const lockfile = require_('proper-lockfile') as typeof import('proper-lockfile');

export interface LockOptions {
  /** Max wait before LockTimeoutError, queue wait included (ms). Default 60_000. */
  timeoutMs?: number;
  /** proper-lockfile considers locks older than this stale (ms). Default 45_000 (1.5x of D-26's 30s working TTL). */
  staleMs?: number;
  /** First backoff delay after ELOCKED (ms). Default 5. */
  retryDelayMs?: number;
  /** Backoff growth factor between attempts. Default 2. */
  retryFactor?: number;
  /** Backoff ceiling (ms). Default 250. */
  maxRetryDelayMs?: number;
}

const DEFAULT_OPTS: Required<LockOptions> = {
  timeoutMs: 60_000,
  staleMs: 45_000,
  retryDelayMs: 5,
  retryFactor: 2,
  maxRetryDelayMs: 250,
};

/** The record a holder writes to `${stub}.lock/owner.json`. */
export interface LockOwner {
  pid: number;
  hostname: string;
  /** ISO time the lock was acquired. */
  acquiredAt: string;
  /** ISO time the holder PROCESS started (PID-reuse disambiguation). */
  processStartedAt: string;
}

/**
 * The lock could not be acquired within `timeoutMs`. Extends PensmithError
 * (V1) so the dispatcher prints one line: the locked path and the holder PID.
 */
export class LockTimeoutError extends PensmithError {
  readonly code = 'ELOCKTIMEOUT' as const;
  readonly resource: string;
  readonly holderPid: number | null;
  readonly timeoutMs: number;
  constructor(resource: string, holderPid: number | null, timeoutMs: number, holder?: LockOwner | null) {
    const who =
      holderPid === null
        ? 'held by an unknown process'
        : `held by pid ${holderPid}${holder?.hostname && holder.hostname !== os.hostname() ? ` on ${holder.hostname}` : ''}` +
          `${holder?.acquiredAt ? `, locked since ${holder.acquiredAt}` : ''}`;
    super(`timed out after ${timeoutMs} ms waiting for the lock on ${resource} (${who})`, EXIT_ERROR);
    this.name = 'LockTimeoutError';
    this.resource = resource;
    this.holderPid = holderPid;
    this.timeoutMs = timeoutMs;
  }
}

const OWNER_FILE = 'owner.json';
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/**
 * Canonicalize a resource so two spellings of one file share one lock and one
 * FIFO queue. HARD-01 / BLOCKER-01/02 (macOS /var→/private/var hazard +
 * cross-convention race): path.resolve (absolute) → best-effort
 * fs.realpathSync.native (symlinks, /var→/private/var) → toLowerCase on win32
 * (case-insensitive filesystem). ENOENT from realpath falls back to the
 * resolved path — STATE.json is locked BEFORE initState creates it (Pitfall 2).
 */
function canonicalResource(resource: string): string {
  let canonical = path.resolve(resource);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // Not-yet-created file (ENOENT) or other FS error — resolved path is canonical.
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  return canonical;
}

function stubPathFor(canonical: string): string {
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  return path.join(pensmithLockDir(), hash);
}

/**
 * Resolve (and create) the lock-stub path for a given resource.
 * proper-lockfile.lock(file) requires `file` to exist on disk (it then creates
 * `${file}.lock` alongside); we touch a per-resource stub at
 * `${pensmithLockDir()}/${sha256(canonical).slice(0,12)}`. The stub itself
 * holds no content.
 */
export async function stubFor(resource: string): Promise<string> {
  const stub = stubPathFor(canonicalResource(resource));
  await fsp.mkdir(path.dirname(stub), { recursive: true });
  // 'a' = O_WRONLY|O_CREAT|O_APPEND — create-if-missing without truncating.
  const fh = await fsp.open(stub, 'a');
  await fh.close();
  return stub;
}

// ---------------------------------------------------------------------------
// owner.json — written inside the lock directory by a custom proper-lockfile fs.
// ---------------------------------------------------------------------------

/** Owner records to write, keyed by lock directory, for acquisitions in flight. */
const pendingOwners = new Map<string, LockOwner>();

type Cb = (err?: NodeJS.ErrnoException | null) => void;

function removeLockDir(lockDir: string, cb: Cb): void {
  // proper-lockfile removes its lock with a plain rmdir, which fails ENOTEMPTY
  // once owner.json is inside; remove the directory with its record instead.
  fs.rm(lockDir, { recursive: true }, (err) => cb(err ?? null));
}

/**
 * The `fs` handed to proper-lockfile. Everything is node:fs except:
 *  - mkdir: after the atomic mkdir succeeds, write owner.json BEFORE calling
 *    back, so proper-lockfile's mtime probe (utimes+stat right after the
 *    callback) records the directory mtime AFTER our write — the holder's
 *    heartbeat (which compares mtimes) is never disturbed by the record.
 *  - rmdir / rmdirSync: remove the record with the directory.
 */
const ownerFs: typeof fs = Object.create(fs) as typeof fs;
Object.assign(ownerFs, {
  mkdir(dir: string, ...rest: unknown[]): void {
    const cb = rest[rest.length - 1] as Cb;
    fs.mkdir(dir, (err) => {
      if (err) return cb(err);
      const owner = pendingOwners.get(dir);
      if (!owner) return cb(null);
      atomicWriteFile(path.join(dir, OWNER_FILE), JSON.stringify(owner) + '\n', { fsync: false }).then(
        () => cb(null),
        () => cb(null), // the record is diagnostic; the lock itself is the directory
      );
    });
  },
  rmdir(dir: string, ...rest: unknown[]): void {
    removeLockDir(dir, rest[rest.length - 1] as Cb);
  },
  rmdirSync(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
  },
});

async function readOwner(stub: string): Promise<LockOwner | null> {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(`${stub}.lock`, OWNER_FILE), 'utf8')) as Partial<LockOwner>;
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid)) return null;
    return {
      pid: raw.pid,
      hostname: typeof raw.hostname === 'string' ? raw.hostname : '',
      acquiredAt: typeof raw.acquiredAt === 'string' ? raw.acquiredAt : '',
      processStartedAt: typeof raw.processStartedAt === 'string' ? raw.processStartedAt : '',
    };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else — alive.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Clear a lock whose recorded holder is a dead process on THIS host, without
 * waiting for staleMs (a `kill -9`ed CLI otherwise blocks everyone for 45 s).
 * Conservative: an unreadable record, another host, a live PID (including a
 * reused one) or a lock directory whose mtime moved while we looked (a fresh
 * holder) is left alone.
 */
async function clearDeadHolder(stub: string): Promise<boolean> {
  const lockDir = `${stub}.lock`;
  let before: fs.Stats;
  try {
    before = await fsp.stat(lockDir);
  } catch {
    return false;
  }
  const owner = await readOwner(stub);
  if (!owner || owner.hostname !== os.hostname() || owner.pid === process.pid || pidAlive(owner.pid)) {
    return false;
  }
  try {
    const after = await fsp.stat(lockDir);
    if (after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) return false;
    await fsp.rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-process FIFO per canonical resource (layer 1).
// ---------------------------------------------------------------------------

const queueTails = new Map<string, Promise<void>>();

/** Held locks in this process, by canonical resource (for release(resource)). */
const held = new Map<string, () => Promise<void>>();

/**
 * Join the FIFO for `key`. Resolves with a `leave` function once every earlier
 * caller has left, or with null if `deadline` passes first (the slot is then
 * released immediately so later callers are never blocked by a timed-out one).
 */
async function enterQueue(key: string, deadline: number): Promise<(() => void) | null> {
  const prev = queueTails.get(key) ?? Promise.resolve();
  let leave!: () => void;
  const mine = new Promise<void>((resolve) => {
    leave = resolve;
  });
  const tail = prev.then(() => mine);
  queueTails.set(key, tail);
  void tail.then(() => {
    if (queueTails.get(key) === tail) queueTails.delete(key);
  });

  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    prev.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), Math.max(0, deadline - Date.now()));
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    leave();
    return null;
  }
  return leave;
}

// ---------------------------------------------------------------------------
// proper-lockfile options (layer 2).
// ---------------------------------------------------------------------------

/**
 * proper-lockfile's lock() options: exactly ONE attempt (`retries: 0`) — the
 * backoff loop in acquire() owns retrying, bounded by timeoutMs — plus the
 * owner.json-aware fs.
 */
export function buildPlfOpts(opts: LockOptions): import('proper-lockfile').LockOptions {
  const o: Required<LockOptions> = { ...DEFAULT_OPTS, ...opts };
  return {
    stale: o.staleMs,
    retries: 0,
    // The stub path is already canonical (stubPathFor over the canonical
    // resource); realpath:false keeps proper-lockfile's lock directory exactly
    // `${stub}.lock`, the path owner.json is written into and read from.
    realpath: false,
    fs: ownerFs,
  };
}

/**
 * The jittered exponential backoff delays (ms) between on-disk attempts:
 * delay_n = min(max, first * factor^n), slept as a uniform draw from
 * [delay/2, delay] (equal jitter) so contending processes de-synchronise.
 */
export function backoffDelay(attempt: number, opts: LockOptions = {}, random: () => number = Math.random): number {
  const o: Required<LockOptions> = { ...DEFAULT_OPTS, ...opts };
  const base = Math.min(o.maxRetryDelayMs, o.retryDelayMs * Math.pow(Math.max(1, o.retryFactor), attempt));
  return base / 2 + random() * (base / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function acquire(resource: string, opts: LockOptions): Promise<() => Promise<void>> {
  const o: Required<LockOptions> = { ...DEFAULT_OPTS, ...opts };
  const started = Date.now();
  const deadline = started + o.timeoutMs;
  const canonical = canonicalResource(resource);

  // Layer 1: wait our turn behind earlier callers in this process.
  const leave = await enterQueue(canonical, deadline);
  if (!leave) {
    // The in-process head of the queue held (or waited for) the lock past our
    // deadline. Report the on-disk holder when one is recorded, else us.
    const owner = await readOwner(await stubFor(resource)).catch(() => null);
    throw new LockTimeoutError(resource, owner?.pid ?? process.pid, o.timeoutMs, owner);
  }

  try {
    const stub = await stubFor(resource);
    const lockDir = `${stub}.lock`;
    const plfOpts = buildPlfOpts(o);
    // Layers 2 + 3: one attempt, then jittered backoff until the deadline.
    for (let attempt = 0; ; attempt += 1) {
      pendingOwners.set(lockDir, {
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
        processStartedAt: PROCESS_STARTED_AT,
      });
      try {
        const plfRelease = await lockfile.lock(stub, plfOpts);
        pendingOwners.delete(lockDir);
        let released = false;
        const releaseFn = async (): Promise<void> => {
          if (released) return;
          released = true;
          if (held.get(canonical) === releaseFn) held.delete(canonical);
          try {
            await plfRelease();
          } finally {
            leave();
          }
        };
        held.set(canonical, releaseFn);
        return releaseFn;
      } catch (e) {
        pendingOwners.delete(lockDir);
        if ((e as NodeJS.ErrnoException).code !== 'ELOCKED') throw e;
      }
      if (Date.now() < deadline && (await clearDeadHolder(stub))) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const owner = await readOwner(stub);
        throw new LockTimeoutError(resource, owner?.pid ?? null, o.timeoutMs, owner);
      }
      await sleep(Math.min(backoffDelay(attempt, o), remaining));
    }
  } catch (e) {
    leave();
    throw e;
  }
}

/**
 * Acquire the lock for `resource` and return a release function. If the lock
 * is held (by this process or another), this waits up to `opts.timeoutMs`
 * (default 60s) and then throws LockTimeoutError.
 *
 * Caller MUST call the returned release() in a finally block. Prefer
 * `withLock(resource, fn)` which manages this automatically. Not re-entrant:
 * a nested acquisition of the same resource in the same process waits for the
 * outer one and times out.
 */
export async function tryAcquire(
  resource: string,
  opts: LockOptions = {},
): Promise<() => Promise<void>> {
  return acquire(resource, opts);
}

/**
 * Release the lock for `resource` if held by this process. Prefer the
 * per-acquisition release function returned from tryAcquire / withLock; this
 * exists for cleanup paths that only know the resource. Rejects
 * (ENOTACQUIRED) when this process does not hold it.
 */
export async function release(resource: string): Promise<void> {
  const own = held.get(canonicalResource(resource));
  if (own) return own();
  const stub = await stubFor(resource);
  await lockfile.unlock(stub, { realpath: false, fs: ownerFs });
}

/**
 * Best-effort release of an ORPHANED lock for `resource` — including one held
 * by another (now-defunct) process. proper-lockfile.unlock() only succeeds for
 * a lock held in THIS process's in-memory registry; cross-process it throws
 * ENOTACQUIRED and leaves the on-disk `${stub}.lock` directory in place. This
 * clears it. Never rejects.
 */
export async function forceRelease(resource: string): Promise<void> {
  try {
    await release(resource);
    return;
  } catch {
    // Not held by this process (ENOTACQUIRED) or already gone — fall through
    // to remove the on-disk lock directory directly.
  }
  try {
    const stub = await stubFor(resource);
    await fsp.rm(`${stub}.lock`, { recursive: true, force: true });
  } catch {
    /* nothing to remove / inaccessible — best-effort, never throw */
  }
}

/**
 * Returns true if `resource` is currently locked (by this or any process).
 * Non-destructive — does not acquire or modify state.
 */
export async function isLocked(resource: string): Promise<boolean> {
  const stub = await stubFor(resource);
  return lockfile.check(stub, { stale: DEFAULT_OPTS.staleMs });
}

/** The current holder's owner.json record, or null (unlocked / unrecorded). */
export async function lockOwner(resource: string): Promise<LockOwner | null> {
  const stub = await stubFor(resource);
  return readOwner(stub);
}

/**
 * Acquire the lock for `resource`, run `fn`, release the lock — even if
 * `fn` throws. Returns whatever `fn` returns.
 *
 * This is the primary public API. State writes (W10), library writes (W11),
 * checkpoint envelope writes (W12), and runtime config writes (W13) all
 * use `withLock(resource, async () => { ... })`.
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const releaseFn = await tryAcquire(resource, opts);
  try {
    return await fn();
  } finally {
    // Best-effort release. If proper-lockfile thinks the lock is already
    // gone (e.g. it was force-broken as stale), unlock() may throw — we
    // swallow because the caller's contract is "fn() return value", not
    // "successful unlock".
    await releaseFn().catch(() => {
      /* lock already released or compromised — nothing to do */
    });
  }
}
