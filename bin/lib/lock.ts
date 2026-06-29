// bin/lib/lock.ts — cross-process advisory lock per ARCH-06 / D-26.
//
// Wraps proper-lockfile@^4 (battle-tested, used by npm/yarn).
//
// CJS-shim necessity (RESEARCH §Key Finding #4 — BLOCKING):
//   `import lockfile from 'proper-lockfile'` raises ERR_REQUIRE_ESM under
//   tsx + node:test in this project's "type":"module" mode. proper-lockfile
//   ships only CommonJS; the createRequire pattern below is the ONLY way to
//   import it under our toolchain (Node 20.x + tsx + node:test).
//
// Lock dir (D-40 — OneDrive non-negotiable):
//   Locks live in pensmithLockDir() (`%LOCALAPPDATA%\pensmith\locks` on
//   Windows; `~/Library/Application Support/pensmith/locks` on macOS;
//   `$XDG_DATA_HOME/pensmith/locks` on Linux). NEVER inside `.paper/` —
//   OneDrive / iCloud / Dropbox open-delete-recreate files mid-write,
//   which corrupts active lock files.
//
// Lock-file naming (T-01-INFO-03):
//   The lock filename is `sha256(resource).slice(0,12)` so resources like
//   `'C:\\Users\\u\\OneDrive\\repo\\.paper\\sections\\03-methods'` don't
//   break Windows lock-filename rules (':' / '\\' / spaces). The hash is
//   one-way — no resource path leaks into the filesystem.
//
// Lock TTL (D-26):
//   Default `staleMs = 45_000` (1.5x of the 30s working-TTL). proper-lockfile
//   considers a lock stale past `stale` and lets the next caller take it.
//   Default `timeoutMs = 60_000` is the maximum wait before we give up;
//   we translate this into a retry schedule against proper-lockfile.
//
// Public API (D-26):
//   - withLock(resource, fn, opts?)   — acquire, run, release (try/finally)
//   - tryAcquire(resource, opts?)     — returns release(); caller manages
//   - release(resource)               — unlock (recompute stub)
//   - isLocked(resource)              — non-destructive check

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { pensmithLockDir } from './paths.js';

// CJS-shim — see "BLOCKING" note above. proper-lockfile is CommonJS-only.
// The `as typeof import('proper-lockfile')` cast is a type-only operation
// (TypeScript's `typeof import(...)` is the module's type signature) and
// does not introduce a runtime ESM import.
const require_ = createRequire(import.meta.url);
const lockfile = require_('proper-lockfile') as typeof import('proper-lockfile');

export interface LockOptions {
  /** Max wait before giving up acquisition (ms). Default 60_000. */
  timeoutMs?: number;
  /** proper-lockfile considers locks older than this stale (ms). Default 45_000 (1.5x of D-26's 30s working TTL). */
  staleMs?: number;
  /** Initial retry delay (ms). Default 100. */
  retryDelayMs?: number;
  /** Exponential factor between retries. Default 1.5. */
  retryFactor?: number;
}

const DEFAULT_OPTS: Required<LockOptions> = {
  timeoutMs: 60_000,
  staleMs: 45_000,
  retryDelayMs: 100,
  retryFactor: 1.5,
};

/**
 * Resolve the lock-stub path for a given resource. proper-lockfile.lock(file)
 * requires `file` to exist on disk (it then creates `${file}.lock` alongside);
 * we touch a per-resource stub at `${pensmithLockDir()}/${sha256(canonical).slice(0,12)}`
 * to satisfy that precondition. The stub itself holds no content.
 *
 * HARD-01 / BLOCKER-01/02 (macOS /var→/private/var hazard + cross-convention race):
 * The resource is canonicalized BEFORE hashing so that two callers targeting
 * the same underlying file via different path strings always produce the same
 * stub. Canonicalization: path.resolve (makes absolute) → best-effort
 * fs.realpathSync.native (resolves symlinks, e.g. /var→/private/var on macOS)
 * → toLowerCase on win32 (case-insensitive filesystem). ENOENT from
 * realpathSync.native is caught and falls back to the resolve result —
 * STATE.json is locked BEFORE initState creates it (Pitfall 2), so a
 * not-yet-created file must not crash the lock acquisition.
 */
export async function stubFor(resource: string): Promise<string> {
  const dir = pensmithLockDir();
  await fsp.mkdir(dir, { recursive: true });

  // Canonicalize: resolve → realpath (best-effort) → case-fold on win32.
  let canonical = path.resolve(resource);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // Not-yet-created file (ENOENT) or other FS error — resolved path is canonical.
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();

  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  const stub = path.join(dir, hash);
  // 'a' = O_WRONLY|O_CREAT|O_APPEND — create-if-missing without truncating.
  // We don't actually write anything; the stub's existence is the only
  // requirement from proper-lockfile.
  const fh = await fsp.open(stub, 'a');
  await fh.close();
  return stub;
}

/**
 * Translate our LockOptions into proper-lockfile's lock() options shape.
 * proper-lockfile expects `retries` to be either a number (count) or an
 * `OperationOptions` (node-retry) object. We use the object form so we can
 * drive both the per-attempt delay and the total wait window.
 */
export function buildPlfOpts(opts: LockOptions): import('proper-lockfile').LockOptions {
  const o: Required<LockOptions> = { ...DEFAULT_OPTS, ...opts };
  // Pick a retry count large enough to span timeoutMs given the exponential
  // schedule. Audit #26: node-retry's `maxTimeout` caps EACH delay, NOT the
  // total — without `maxRetryTime` the actual wait is the SUM of the geometric
  // delays (for the defaults ≈ 131s, more than 2x the documented 60s timeoutMs).
  // We set `maxRetryTime = timeoutMs` so the TOTAL acquisition wait is genuinely
  // bounded by timeoutMs; `retries` is now only a soft upper bound (node-retry
  // gives up at whichever of retries / maxRetryTime is reached first).
  const ratio = o.timeoutMs / Math.max(1, o.retryDelayMs);
  const factor = Math.max(1.0001, o.retryFactor); // log() guard
  const retries = Math.max(1, Math.ceil(Math.log(ratio) / Math.log(factor)));
  return {
    stale: o.staleMs,
    retries: {
      retries,
      minTimeout: o.retryDelayMs,
      maxTimeout: o.timeoutMs,
      factor: o.retryFactor,
      maxRetryTime: o.timeoutMs,
    },
  };
}

/**
 * Acquire the lock for `resource` and return a release function. If the
 * lock is held elsewhere, this waits up to `opts.timeoutMs` (default 60s)
 * before throwing.
 *
 * Caller MUST call the returned release() in a finally block. Prefer
 * `withLock(resource, fn)` which manages this automatically.
 */
export async function tryAcquire(
  resource: string,
  opts: LockOptions = {},
): Promise<() => Promise<void>> {
  const stub = await stubFor(resource);
  const release = await lockfile.lock(stub, buildPlfOpts(opts));
  return release;
}

/**
 * Release the lock for `resource` if held by this process. Unlike the
 * release() returned from tryAcquire(), this recomputes the stub path and
 * calls proper-lockfile.unlock() — it should ONLY be used for cleanup of
 * orphaned locks held by the current process. Prefer the per-acquisition
 * release function returned from tryAcquire / withLock.
 */
export async function release(resource: string): Promise<void> {
  const stub = await stubFor(resource);
  await lockfile.unlock(stub);
}

/**
 * Best-effort release of an ORPHANED lock for `resource` — including one held
 * by another (now-defunct) process. proper-lockfile.unlock() only succeeds for
 * a lock held in THIS process's in-memory registry; cross-process it throws
 * ENOTACQUIRED and leaves the on-disk `${stub}.lock` directory in place. The
 * Stop hook fires when the session is halting, so any pensmith lock is by
 * definition orphaned — this clears it.
 *
 * Strategy: try the proper-lockfile unlock first (clean path for an
 * in-process holder); if that rejects, remove the `${stub}.lock` directory
 * directly. Both steps swallow their own errors — this never rejects, so the
 * caller (Stop hook, inside Promise.allSettled) cannot be tripped by it.
 */
export async function forceRelease(resource: string): Promise<void> {
  const stub = await stubFor(resource);
  try {
    await lockfile.unlock(stub);
    return;
  } catch {
    // Not held by this process (ENOTACQUIRED) or already gone — fall through
    // to remove the on-disk lock directory directly.
  }
  try {
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
  const o: Required<LockOptions> = { ...DEFAULT_OPTS };
  return lockfile.check(stub, { stale: o.staleMs });
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
