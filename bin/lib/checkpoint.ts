// bin/lib/checkpoint.ts — append-only checkpoint envelope (D-60 foundation slice).
//
// W10 sibling C — same architectural shape as bin/lib/state.ts (W10 sibling A)
// and bin/lib/library.ts (W10 sibling B), with one deliberate divergence
// (the read-path forward-skip carve-out — see below). This is the W10
// chokepoint integration that composes the four lower-level chokepoints into
// a one-import API for paper checkpoint operations:
//
//   atomicAppendFile (W2 / D-04)   — O_APPEND single-syscall append (≤ PIPE_BUF
//                                    bytes is atomic on POSIX; lock provides
//                                    cross-process guarantee for any size)
//   withLock         (W3 / D-26)   — cross-process advisory lock
//   CheckpointSchema (W7 / D-37)   — version envelope + zod validation
//   openSessionLog   (W9 / D-49)   — JSONL structured log, kind:'event' / kind:'warn'
//
// Per D-60 the foundation-slice schema is intentionally minimal: an envelope
// {$schemaVersion, label, tookAt, refs} where refs is a string→string map of
// content-addressed pointers. Domain refs (state-snapshot, library-snapshot,
// draft-fingerprint) land in later phases by extending the schema (post-Phase-1
// the value type may broaden via versioned migration; the foundation slice
// stays string→string for content-addressing reasons).
//
// Append-only contract:
//   recordCheckpoint never rewrites — it appends ONE line under withLock via
//   atomicAppendFile. The disk file CHECKPOINTS.jsonl is therefore a tamper-
//   evident-by-position audit log. No update / delete / replace semantics.
//
// Concurrency contract (T-01-01 mitigation):
//   The append happens INSIDE withLock so two concurrent recordCheckpoint
//   callers serialize at the proper-lockfile boundary. atomicAppendFile uses
//   O_APPEND so each write syscall is atomic for ≤ PIPE_BUF bytes (4 KB on
//   Linux); for larger lines the lock is the cross-process guarantee. Test
//   "20 concurrent recordCheckpoint calls all persist" is the regression gate.
//
// Forward-compat carve-out (D-60 — divergence from state/library):
//   STATE / LIBRARY are AUTHORITATIVE persistence — newer-on-disk content from
//   a future pensmith version, opened by older code, MUST refuse-forward
//   (ForwardIncompatError) so we don't silently downgrade the user's data.
//   CHECKPOINTS, by contrast, are an append-only AUDIT history. Newer-versioned
//   entries are interesting to a newer reader and uninteresting to an older
//   one. Skipping them in listCheckpoints is the safe behavior because the
//   file is append-only — skipping never causes data loss; the older reader
//   simply sees an older "history view." This is the SOLE Phase-1 exception
//   to D-39 refuse-forward-incompat, and it is justified by the append-only
//   audit-log semantic.
//
// Defense-in-depth schema validation:
//   CheckpointSchema.parse  (throws) on the WRITE path — refuses to commit a
//                                    malformed envelope to disk.
//   CheckpointSchema.safeParse (no throw) on the READ path — invalid lines
//                                    (parse failure, schema-mismatch, future
//                                    version) are SKIPPED with a single WARN
//                                    record per call, never crash the reader.
//
// findCheckpoint is intentionally lock-free: it walks listCheckpoints' result
// in REVERSE so the most-recent matching label wins. Pure read against the
// loaded snapshot; predicate runs in-memory and cannot tear under concurrent
// writers. Callers needing record-then-find atomicity should use
// recordCheckpoint's return value directly.
//
// Imports limited to: node:fs, node:path, and the four W2/W3/W7/W9
// chokepoint modules above. No third-party deps.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicAppendFile } from './atomic-write.js';
import { withLock } from './lock.js';
import {
  Schema as CheckpointSchema,
  CURRENT_CHECKPOINT_VERSION,
  type Checkpoint,
} from './schemas/checkpoint.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

// ---------------------------------------------------------------------------
// Re-export the Checkpoint type so callers can import it from this module
// (consistent with state.ts / library.ts, which re-export their domain types
// via `import type` even though the schemas module is the source of truth).
// ---------------------------------------------------------------------------

export type { Checkpoint };

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to CHECKPOINTS.jsonl under `paperRoot`. Resolving
 * up-front ensures the lock key (which is the file path) is identical across
 * callers regardless of relative vs. absolute paperRoot input.
 */
function checkpointFile(paperRoot: string): string {
  return path.join(path.resolve(paperRoot), 'CHECKPOINTS.jsonl');
}

/**
 * Module-level singleton SessionLogger child bound to `module: 'checkpoint'`.
 * Lazy-initialized so test files that mutate process.env (LOCALAPPDATA,
 * XDG_DATA_HOME, HOME) BEFORE dynamically importing this module observe the
 * mutated env. openSessionLog reads paths.ts at call-time, so this singleton
 * resolves the log destination at first use, not at import.
 */
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'checkpoint' });
  }
  return _log;
}

// ---------------------------------------------------------------------------
// Public API (D-60 foundation slice).
// ---------------------------------------------------------------------------

/**
 * Append a single Checkpoint envelope to CHECKPOINTS.jsonl under `paperRoot`.
 *
 * Operation sequence inside ONE withLock critical section:
 *   1. CheckpointSchema.parse the constructed envelope (throws on malformed
 *      input — fail-fast guard against caller-side garbage)
 *   2. atomicAppendFile(file, JSON.stringify(envelope) + '\n')
 *
 * The schema parse runs BEFORE the lock is taken — fail-fast on caller-side
 * garbage without contending the per-file critical section. The append is
 * INSIDE the lock so two concurrent recordCheckpoint callers serialize at
 * the proper-lockfile boundary. The "20 concurrent recordCheckpoint calls"
 * test is the regression gate.
 *
 * Returns the parsed Checkpoint (the same shape that was written to disk),
 * so callers don't have to re-read the file to learn the assigned tookAt /
 * normalized refs (per W7 schema, refs defaults to {} if absent).
 *
 * Per D-60 foundation slice, refs is a `Record<string, string>` map of
 * content-addressed pointers (W7 schema: `z.record(z.string(), z.string())`).
 * Future schemas may broaden the value type post-Phase-1 via versioned
 * migration, but the foundation slice is intentionally locked to string→string.
 */
export async function recordCheckpoint(
  paperRoot: string,
  label: string,
  refs?: Record<string, string>,
): Promise<Checkpoint> {
  const file = checkpointFile(paperRoot);

  // Schema parse runs BEFORE the lock — fail-fast on caller-side garbage.
  // Note: per W7 schema, `refs` defaults to {} when omitted, so the parsed
  // value always has refs:{} on the result even if the caller didn't pass
  // one. We omit refs from the input object entirely (rather than passing
  // undefined) so verbatimModuleSyntax + exactOptionalPropertyTypes don't
  // get angry at us about literal `undefined` slipping into a non-optional
  // property.
  const checkpoint: Checkpoint = CheckpointSchema.parse({
    $schemaVersion: CURRENT_CHECKPOINT_VERSION,
    label,
    tookAt: new Date().toISOString(),
    ...(refs !== undefined ? { refs } : {}),
  });

  const line = JSON.stringify(checkpoint) + '\n';

  await withLock(file, async () => {
    await atomicAppendFile(file, line);
  });

  log().event({
    event: 'checkpoint.record',
    label: checkpoint.label,
    schemaVersion: checkpoint.$schemaVersion,
  });

  return checkpoint;
}

/**
 * Read CHECKPOINTS.jsonl under `paperRoot`, parse each non-empty line, and
 * return Checkpoint[] in chronological (insertion) order. O_APPEND guarantees
 * file-order = insertion-order on POSIX; Windows behavior is validated by
 * the W0 CI matrix.
 *
 * Returns [] when CHECKPOINTS.jsonl does not exist (ENOENT — empty history
 * is a valid state, NOT an error).
 *
 * Tolerant reader (D-60 carve-out from D-39 refuse-forward-incompat):
 *   - Each non-empty line is parsed via JSON.parse, then validated via
 *     CheckpointSchema.safeParse (NOT .parse — never throws).
 *   - Lines that fail JSON.parse are SKIPPED (corruption tolerance —
 *     T-01-CORRUPT-01 mitigation).
 *   - Lines that fail CheckpointSchema.safeParse are SKIPPED (forward-version
 *     tolerance — T-01-COMPAT-02 mitigation; see D-60 carve-out at the top
 *     of this file for why this differs from state/library refuse-forward).
 *   - When ANY line is skipped, ONE WARN log record is emitted with the
 *     skipped count. Otherwise ONE EVENT log record with the kept count.
 *
 * Lock-free by design: pure read of an immutable-on-disk file. Concurrent
 * recordCheckpoint writers append lines that this reader either sees (if
 * they completed before our readFile) or doesn't (if they completed after) —
 * never tears mid-line because each append is one O_APPEND syscall.
 */
export async function listCheckpoints(paperRoot: string): Promise<Checkpoint[]> {
  const file = checkpointFile(paperRoot);

  let raw: string;
  try {
    raw = await fs.promises.readFile(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') {
      // Empty history is a valid state, not an error. Emit one event-kind
      // log record so the read is observable in the session log.
      log().event({ event: 'checkpoint.list', count: 0 });
      return [];
    }
    throw e;
  }

  // split('\n') yields a trailing '' for a file ending in '\n'; .filter
  // drops it along with any other empty lines.
  const lines = raw.split('\n').filter((l) => l.length > 0);

  const out: Checkpoint[] = [];
  let skipped = 0;

  for (const ln of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ln);
    } catch {
      skipped++;
      continue;
    }
    const result = CheckpointSchema.safeParse(parsed);
    if (result.success) {
      out.push(result.data);
    } else {
      skipped++;
    }
  }

  if (skipped > 0) {
    log().warn({
      event: 'checkpoint.list.skipped',
      skipped,
      kept: out.length,
    });
  } else {
    log().event({ event: 'checkpoint.list', count: out.length });
  }

  return out;
}

/**
 * Return the most-recent Checkpoint with matching `label`, or undefined if
 * none. Walks listCheckpoints' result in REVERSE so callers don't need to
 * post-sort by tookAt — file order is chronological order, and the last
 * matching label is the most recent.
 *
 * Lock-free: piggybacks on listCheckpoints' lock-free read. Callers that
 * need record-then-find atomicity should use recordCheckpoint's return
 * value directly rather than re-querying.
 */
export async function findCheckpoint(
  paperRoot: string,
  label: string,
): Promise<Checkpoint | undefined> {
  const all = await listCheckpoints(paperRoot);
  for (let i = all.length - 1; i >= 0; i--) {
    const cp = all[i];
    if (cp && cp.label === label) {
      return cp;
    }
  }
  return undefined;
}
