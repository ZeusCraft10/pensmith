// bin/lib/session-lock.ts — the per-paper session lock (RUN-23, D-17-37).
//
// One pensmith session works on a paper at a time. A session is one CLI
// invocation of a mutating verb (the dispatcher takes the lock before the verb
// runs and releases it when the process ends), or one mutating MCP tool call
// (withPaperSession). The per-file locks (lock.ts) still guard each file; this
// lock stops a second session from interleaving whole verbs on the same paper
// (two `write 1` runs drafting the same section, an MCP tool rewriting a PLAN.md
// the CLI is verifying).
//
// The owner record lives OUTSIDE the paper (pensmithLockDir(), never a sync
// folder) at `session-<projectHash>.json`:
//   { hostname, pid, sessionId, kind: 'cli'|'mcp', verb, startedAt,
//     claudeSessionId, root }
// It is created with an atomic exclusive open ('wx'), so exactly one process
// wins. Our own PID re-enters (an MCP server serving parallel tool calls, a
// bare/next/resume chain dispatching a verb in-process). A record whose PID is
// dead on this host, or that is older than STALE_SESSION_MS (the longest step
// timeout bound), is cleared with `cleared stale lock (pid N, started T)`.
// Anything else refuses with EXIT_ERROR:
//   another pensmith session (pid N, started T) is working on this paper;
//   run pensmith resume once it ends
// Read-only verbs (status, list, doctor, open, --estimate) never take it.
//
// MCP (D-17-37): withPaperSession(root, {section?}, fn) takes the session lock
// per tool call (re-entrant within the server's PID) plus a per-section
// sub-lock (withLock over the section's resource), so parallel tool calls for
// DIFFERENT sections run in parallel while two writes to the SAME section
// serialize. The Stop hook releases only an mcp-owned record whose
// claudeSessionId matches its stdin session_id and whose server process is no
// longer running — a record a live server holds is a call still in flight
// (releaseClaudeSessionLock).

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pensmithLockDir, projectHash, paperDir, asProjectRoot, realpathNearest } from './paths.js';
import { currentSessionId } from './session-log.js';
import { migratePaperConfigFile } from './config.js';
import { enforceDryRunBoundary } from './dry-run-paper.js';
import { networkMode } from './http-mock.js';
import { withLock } from './lock.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

/** A record older than this is stale regardless of its PID (D-17-37: 6 h). */
export const STALE_SESSION_MS = 6 * 60 * 60 * 1000;

/** How long a same-section MCP call waits for the call in flight on that section. */
const SECTION_WAIT_MS = 30 * 60 * 1000;

/** A record that stays unparseable this long is an abandoned partial write. */
const PARTIAL_RECORD_GRACE_MS = 2_000;

export type SessionKind = 'cli' | 'mcp';

export interface SessionOwner {
  readonly hostname: string;
  readonly pid: number;
  readonly sessionId: string;
  readonly kind: SessionKind;
  readonly verb: string;
  readonly startedAt: string;
  readonly claudeSessionId: string | null;
  readonly root: string;
}

// One id per process (D-17-26): the owner record carries the SAME session id
// COSTS.jsonl and SESSION.log records carry (session-log.ts currentSessionId),
// so `pensmith status` in another terminal can meter the running session.
export { currentSessionId };

/** The Claude Code session id Claude Code exports to the MCP server it spawns. */
export function claudeSessionIdFromEnv(): string | null {
  const v = process.env['CLAUDE_CODE_SESSION_ID'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Canonical key for a project root: resolved, `.paper` folded to its parent
 * (asProjectRoot — the same paper whichever form a caller passes), symlink-free,
 * case-folded on Windows.
 */
function canonicalRoot(root: string): string {
  // realpathNearest: a root not created yet canonicalizes through its nearest
  // existing ancestor, so it keys the same record before and after it exists.
  const r = realpathNearest(asProjectRoot(root));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** `<pensmithLockDir>/session-<projectHash>.json` for the paper at `root`. */
export function sessionLockFile(root: string): string {
  return path.join(pensmithLockDir(), `session-${projectHash(canonicalRoot(root))}.json`);
}

/** The lock is held by another live session (EXIT_ERROR, one line). */
export class SessionLockedError extends PensmithError {
  readonly owner: SessionOwner;
  constructor(owner: SessionOwner) {
    super(
      `another pensmith session (pid ${owner.pid}, started ${owner.startedAt}) is working on this paper; ` +
        'run pensmith resume once it ends',
      EXIT_ERROR,
    );
    this.name = 'SessionLockedError';
    this.owner = owner;
  }
}

function isOwner(v: unknown): v is SessionOwner {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['hostname'] === 'string'
    && typeof o['pid'] === 'number' && Number.isInteger(o['pid'])
    && typeof o['sessionId'] === 'string'
    && (o['kind'] === 'cli' || o['kind'] === 'mcp')
    && typeof o['startedAt'] === 'string';
}

type OwnerRead = { kind: 'owner'; owner: SessionOwner } | { kind: 'gone' } | { kind: 'unreadable'; ageMs: number };

function readOwner(file: string): OwnerRead {
  let text: string;
  let ageMs = 0;
  try {
    ageMs = Date.now() - fs.statSync(file).mtimeMs;
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'gone' };
    return { kind: 'unreadable', ageMs };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isOwner(parsed) ? { kind: 'owner', owner: parsed } : { kind: 'unreadable', ageMs };
  } catch {
    return { kind: 'unreadable', ageMs };
  }
}

/** Is `pid` a live process on this host? EPERM means it exists (not ours). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Why `owner` is stale, or null when it is live. */
export function staleReason(owner: SessionOwner, now = Date.now()): string | null {
  const started = Date.parse(owner.startedAt);
  if (Number.isFinite(started) && now - started > STALE_SESSION_MS) return 'older than 6 h';
  if (owner.hostname === os.hostname() && !isPidAlive(owner.pid)) return 'process not running';
  return null;
}

/** Remove `file` only if it still holds exactly `owner` (never a newer record). */
function removeIfSame(file: string, owner: SessionOwner | null): boolean {
  const cur = readOwner(file);
  if (cur.kind === 'gone') return false;
  if (owner !== null && (cur.kind !== 'owner' || cur.owner.sessionId !== owner.sessionId || cur.owner.pid !== owner.pid)) {
    return false;
  }
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Held locks (this process) + exit-time release.
// ---------------------------------------------------------------------------

interface Held {
  depth: number;
  readonly owner: SessionOwner;
}

const HELD = new Map<string, Held>();
let exitHooksInstalled = false;

function releaseAllSync(): void {
  for (const [file, held] of HELD) {
    removeIfSame(file, held.owner);
  }
  HELD.clear();
}

function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  // process.exit() anywhere (a verb, the --yolo cost pre-flight) still releases.
  process.on('exit', releaseAllSync);
  // Ctrl-C / kill: release, then exit with the conventional signal status.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.on(signal, () => {
      releaseAllSync();
      process.exit(code);
    });
  }
}

export interface SessionLockHandle {
  readonly file: string;
  readonly owner: SessionOwner;
  /** Release one hold; the record is removed when the last hold is released. */
  release(): Promise<void>;
}

function handleFor(file: string, held: Held): SessionLockHandle {
  let released = false;
  return {
    file,
    owner: held.owner,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      held.depth -= 1;
      if (held.depth > 0) return;
      HELD.delete(file);
      removeIfSame(file, held.owner);
      await Promise.resolve();
    },
  };
}

export interface AcquireSessionOptions {
  readonly kind: SessionKind;
  readonly verb: string;
  readonly claudeSessionId?: string | null;
}

/**
 * Acquisitions in flight in THIS process, per lock file. Same-process callers
 * are single-flight: while one call is between its first check of HELD and
 * setting it (the mkdir / open('wx') / read awaits), a concurrent call (the MCP
 * server runs Claude's parallel tool calls) waits for it and then joins its
 * hold, instead of racing to the own-PID branch and replacing the hold — which
 * let the first release delete the record while the second call still ran.
 */
const PENDING = new Map<string, Promise<Held>>();

/**
 * Take the session lock for the paper at `root` (see the module header).
 * Re-entrant within this process; clears a stale record with a one-line
 * notice; otherwise throws SessionLockedError.
 */
export async function acquireSessionLock(root: string, opts: AcquireSessionOptions): Promise<SessionLockHandle> {
  const file = sessionLockFile(root);
  for (;;) {
    const mine = HELD.get(file);
    if (mine) {
      mine.depth += 1;
      return handleFor(file, mine);
    }
    const pending = PENDING.get(file);
    if (!pending) break;
    // Join the acquisition in flight: once it settles, HELD answers (or, if it
    // failed or was already released, this call acquires on its own).
    await pending.catch(() => undefined);
  }
  const attempt = acquireFresh(file, root, opts);
  PENDING.set(file, attempt);
  try {
    return handleFor(file, await attempt);
  } finally {
    if (PENDING.get(file) === attempt) PENDING.delete(file);
  }
}

/** Hold `file` for this process (never replacing an existing hold). */
function hold(file: string, owner: SessionOwner): Held {
  const existing = HELD.get(file);
  if (existing) {
    existing.depth += 1;
    return existing;
  }
  const held: Held = { depth: 1, owner };
  HELD.set(file, held);
  installExitHooks();
  return held;
}

async function acquireFresh(file: string, root: string, opts: AcquireSessionOptions): Promise<Held> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const owner: SessionOwner = {
      hostname: os.hostname(),
      pid: process.pid,
      sessionId: currentSessionId(),
      kind: opts.kind,
      verb: opts.verb,
      startedAt: new Date().toISOString(),
      claudeSessionId: opts.claudeSessionId ?? null,
      root: path.resolve(root),
    };
    try {
      const fh = await fsp.open(file, 'wx');
      try {
        await fh.write(JSON.stringify(owner, null, 2) + '\n');
      } finally {
        await fh.close();
      }
      return hold(file, owner);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }

    const cur = readOwner(file);
    if (cur.kind === 'gone') continue; // released between our open and read — retry
    if (cur.kind === 'unreadable') {
      // A competing writer between its open('wx') and write, or an abandoned
      // partial record. Give a live writer a moment; clear an old one.
      if (cur.ageMs > PARTIAL_RECORD_GRACE_MS) removeIfSame(file, null);
      else await new Promise((r) => setTimeout(r, 25));
      continue;
    }
    const holder = cur.owner;
    if (holder.pid === process.pid && holder.hostname === os.hostname()) {
      // Our own PID's record (e.g. written before this module was re-imported):
      // re-enter — joining, never replacing, a hold this process already has.
      return hold(file, holder);
    }
    const why = staleReason(holder);
    if (why !== null) {
      if (removeIfSame(file, holder)) {
        process.stderr.write(`pensmith: cleared stale lock (pid ${holder.pid}, started ${holder.startedAt}) — ${why}.\n`);
      }
      continue;
    }
    throw new SessionLockedError(holder);
  }
  const last = readOwner(file);
  if (last.kind === 'owner') throw new SessionLockedError(last.owner);
  throw new PensmithError(`could not take the pensmith session lock at ${file}; re-run`, EXIT_ERROR);
}

/** The record currently holding the lock for `root`, or null. */
export function readSessionLock(root: string): SessionOwner | null {
  const cur = readOwner(sessionLockFile(root));
  return cur.kind === 'owner' ? cur.owner : null;
}

/** Release every hold this process has on `root`'s lock (the CLI does this at exit). */
export async function releaseSessionLock(root: string): Promise<void> {
  const file = sessionLockFile(root);
  const held = HELD.get(file);
  if (!held) return;
  HELD.delete(file);
  removeIfSame(file, held.owner);
  await Promise.resolve();
}

/**
 * The Stop hook's policy (D-17-37): release the lock only when an MCP server of
 * THIS Claude Code session LEFT it behind. Every other record — a CLI session,
 * another Claude session, or none — is left alone (stale detection handles
 * crashed holders). Returns true when a record was removed.
 *
 * Left behind means the recording server process is no longer running (review
 * round 3). The server holds the record only while a tool call runs and
 * removes it when the call ends, so a record whose process is alive belongs to
 * a call still in flight: a pensmith_write the user interrupted with Esc
 * (Claude Code stops waiting; the verb keeps drafting) or a background
 * subagent's call, when the turn's Stop fires. Removing that record would let
 * a CLI verb run on the paper alongside it (RUN-23). The PID is checked
 * whatever the recorded hostname: the server Claude Code spawned runs on the
 * machine the hook runs on, even when the host name changed since (a laptop
 * changing networks), which stale detection's same-host rule cannot clear.
 */
export function releaseClaudeSessionLock(root: string, claudeSessionId: string): boolean {
  if (!claudeSessionId) return false;
  const file = sessionLockFile(root);
  const cur = readOwner(file);
  if (cur.kind !== 'owner') return false;
  if (cur.owner.kind !== 'mcp' || cur.owner.claudeSessionId !== claudeSessionId) return false;
  if (isPidAlive(cur.owner.pid)) return false; // its call is still running
  return removeIfSame(file, cur.owner);
}

// ---------------------------------------------------------------------------
// MCP: one session hold per mutating tool call, plus a per-section sub-lock.
// ---------------------------------------------------------------------------

export interface PaperSessionOptions {
  /** The section the call mutates: its sub-lock serializes same-section calls. */
  readonly section?: number;
  /** The tool or verb name recorded in the owner record. */
  readonly verb: string;
}

/** The per-section sub-lock resource (keyed by number, independent of the slug). */
export function sectionLockResource(root: string, n: number): string {
  return path.join(paperDir(asProjectRoot(root)), 'sections', `${String(n).padStart(2, '0')}.section-lock`);
}

/**
 * Run `fn` holding the paper's session lock (kind 'mcp', re-entrant within this
 * process) and, when `section` is given, that section's sub-lock. A CLI session
 * working on the paper makes this throw SessionLockedError before `fn` runs.
 */
export async function withPaperSession<T>(root: string, opts: PaperSessionOptions, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireSessionLock(root, {
    kind: 'mcp',
    verb: opts.verb,
    claudeSessionId: claudeSessionIdFromEnv(),
  });
  try {
    // RUN-27: a mutating tool never continues a paper made by --dry-run (Tier
    // parity with the CLI pre-flight).
    const dryRun = networkMode().dryRun;
    await enforceDryRunBoundary(root, dryRun);
    // CONF-01: the mutating call writes an older config.toml back (comments kept).
    if (!dryRun) await migratePaperConfigFile(root);
    if (opts.section === undefined) return await fn();
    // A same-section call waits for the one in flight (a model call can take
    // minutes), bounded by SECTION_WAIT_MS rather than the 60 s file-lock default.
    return await withLock(sectionLockResource(root, opts.section), fn, { timeoutMs: SECTION_WAIT_MS });
  } finally {
    await handle.release();
  }
}
