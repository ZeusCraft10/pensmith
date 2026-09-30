// bin/lib/hooks/post-tool-use.ts — the PostToolUse hook's work (PLUG-14,
// D-23a-15; the throttle is T-3-DOS-04, the lock CR-04).
//
// After a pensmith MCP tool call (hooks.json matches
// `^mcp__(?:plugin_pensmith_)?pensmith__.*`: the plugin's server, and the
// developer .mcp.json server Claude Code keeps instead of it at the repo root,
// PLUG-04), record a progress checkpoint for the paper: `{ts, session_id,
// tool_name, next}`, where `next` is the router's next step after the call.
//
// At most one line per minute per paper, throttled on the TRAILING edge
// (review round 3): a call less than a minute after the last line does not
// append — when the router's step is unchanged it writes nothing, and when the
// call moved the paper (`next` differs) it REPLACES that last line. So the
// file's last line always names the paper's current step: a read-only
// pensmith_status that opens the minute can no longer hide the pensmith_write
// seconds later that actually moved the paper. Consecutive lines stay at least
// a minute apart, and a burst of calls that changes nothing costs no write.
//
// Where: `pensmithDataDir()/checkpoints/<projectHash>.jsonl` — the app data
// dir, never the user's `.claude/` (the v0 hook wrote `.claude/CHECKPOINTS
// .jsonl` into whatever folder the session ran in) and never `.paper/`, which
// may sit in a sync folder and is seeded into dry runs. The project hash keys
// the paper's canonical folder (symlinks resolved, case-folded on Windows), so
// every spelling of one paper shares one file.
//
// The read-decide-append runs under the lock.ts resource lock on the
// checkpoint file (its lock files live in the data dir too), so two hook
// processes racing on the same paper append once (CR-04). A lock that stays
// busy past CHECKPOINT_LOCK_TIMEOUT_MS skips the checkpoint — a hook never
// waits long. The file keeps its last CHECKPOINT_KEEP_LINES lines once it
// passes CHECKPOINT_MAX_BYTES.

import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import { nextStepLabel } from '../handoff.js';
import { withLock, LockTimeoutError } from '../lock.js';
import { asProjectRoot, pensmithDataDir, projectHash, realpathNearest } from '../paths.js';
import { resolveNextAction, type ResolveOptions } from '../router.js';

/** At most one checkpoint per paper per minute (T-3-DOS-04). */
export const CHECKPOINT_THROTTLE_MS = 60_000;
/** How long an append waits for another hook process holding the file's lock. */
export const CHECKPOINT_LOCK_TIMEOUT_MS = 3_000;
/** Past this size the file is trimmed to its last CHECKPOINT_KEEP_LINES lines. */
export const CHECKPOINT_MAX_BYTES = 256 * 1024;
export const CHECKPOINT_KEEP_LINES = 1_000;

export interface CheckpointRecord {
  readonly ts: string;
  readonly session_id: string | null;
  readonly tool_name: string;
  /** The router's next step after the tool call (`write 2`, `compile`, `status (done)`). */
  readonly next: string;
}

/** The paper's canonical folder: resolved, `.paper` folded, symlinks resolved, case-folded on Windows. */
function canonicalRoot(root: string): string {
  const r = realpathNearest(asProjectRoot(root));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** `<pensmithDataDir>/checkpoints/<projectHash>.jsonl` for the paper at `root`. */
export function checkpointFile(root: string): string {
  return path.join(pensmithDataDir(), 'checkpoints', `${projectHash(canonicalRoot(root))}.jsonl`);
}

/** The file's last well-formed checkpoint line: its index among the non-empty lines, its time (ms) and its `next`. */
interface LastCheckpoint {
  readonly index: number;
  readonly at: number;
  readonly next: string | null;
}

function lastCheckpoint(lines: readonly string[]): LastCheckpoint | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const rec = JSON.parse(lines[i] ?? '') as { ts?: unknown; next?: unknown };
      if (rec !== null && typeof rec === 'object' && typeof rec.ts === 'string') {
        return { index: i, at: Date.parse(rec.ts) || 0, next: typeof rec.next === 'string' ? rec.next : null };
      }
    } catch {
      /* a torn line: look at the one before */
    }
  }
  return null;
}

/** `lines` bounded: past CHECKPOINT_MAX_BYTES, its last CHECKPOINT_KEEP_LINES lines. */
function trimmed(lines: readonly string[]): readonly string[] {
  const bytes = lines.reduce((n, l) => n + Buffer.byteLength(l, 'utf8') + 1, 0);
  return bytes > CHECKPOINT_MAX_BYTES ? lines.slice(-CHECKPOINT_KEEP_LINES) : lines;
}

export interface CheckpointInput {
  readonly sessionId: string | null;
  readonly toolName: string | null;
}

export interface CheckpointOptions {
  readonly routeOptions?: ResolveOptions;
  /** Test seam: the current time. */
  readonly now?: () => number;
}

export type CheckpointOutcome =
  | { readonly kind: 'written'; readonly file: string; readonly record: CheckpointRecord }
  /** Within the minute, the call moved the paper: the last line was replaced by this record. */
  | { readonly kind: 'updated'; readonly file: string; readonly record: CheckpointRecord }
  /** Within the minute, the router's step is unchanged: nothing written. */
  | { readonly kind: 'throttled'; readonly file: string }
  | { readonly kind: 'busy'; readonly file: string }
  | { readonly kind: 'failed'; readonly file: string; readonly error: string };

/**
 * Record one checkpoint for the paper at `root` (see the module header): append
 * it when the last line is a minute old or more; within the minute, replace the
 * last line when the router's step changed, else write nothing. Never throws.
 */
export async function recordCheckpoint(root: string, input: CheckpointInput, opts: CheckpointOptions = {}): Promise<CheckpointOutcome> {
  const now = opts.now ?? Date.now;
  let file = '';
  try {
    file = checkpointFile(root);
    const target = file;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    return await withLock(
      target,
      async (): Promise<CheckpointOutcome> => {
        let text = '';
        try {
          text = await fsp.readFile(target, 'utf8');
        } catch {
          /* first checkpoint of this paper */
        }
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        const last = lastCheckpoint(lines);
        const withinMinute = last !== null && now() - last.at < CHECKPOINT_THROTTLE_MS;
        const decision = await resolveNextAction(root, opts.routeOptions ?? {});
        const record: CheckpointRecord = {
          ts: new Date(now()).toISOString(),
          session_id: input.sessionId,
          tool_name: input.toolName ?? 'unknown',
          next: nextStepLabel(decision),
        };
        if (withinMinute && last.next === record.next) return { kind: 'throttled', file: target };
        const json = JSON.stringify(record);
        if (withinMinute) {
          // Trailing edge: the minute's line now names where the call left the paper.
          const next = lines.map((l, i) => (i === last.index ? json : l));
          await atomicWriteFile(target, trimmed(next).map((l) => l + '\n').join(''));
          return { kind: 'updated', file: target, record };
        }
        if (Buffer.byteLength(text, 'utf8') > CHECKPOINT_MAX_BYTES) {
          await atomicWriteFile(target, trimmed([...lines, json]).map((l) => l + '\n').join(''));
        } else {
          // A torn last line (a process killed mid-append) is closed first, so
          // the new record never merges into it.
          await fsp.appendFile(target, (text.length > 0 && !text.endsWith('\n') ? '\n' : '') + json + '\n', 'utf8');
        }
        return { kind: 'written', file: target, record };
      },
      { timeoutMs: CHECKPOINT_LOCK_TIMEOUT_MS },
    );
  } catch (e) {
    if (e instanceof LockTimeoutError) return { kind: 'busy', file };
    return { kind: 'failed', file, error: e instanceof Error ? e.message : String(e) };
  }
}
