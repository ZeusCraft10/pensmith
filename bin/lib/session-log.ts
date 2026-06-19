// bin/lib/session-log.ts — JSONL session logger (ARCH-16 / D-49 / D-50 / D-51 / D-52).
//
// Single chokepoint for all phase-1 logging output. Every record on disk has
// shape `{at, kind, run_id, ...payload}` per D-49. No `ts`/`level`/`msg`/`ctx`
// field names appear anywhere — payload is spread inline so downstream
// replay (D-53) can read fields directly.
//
// Threat model (mitigated):
//   T-01-06 (PII to disk)        — every string field redacted via redactPii (W8)
//   T-01-07 (secrets in logs)    — every object field redacted via redactKeys (W8)
//   T-01-LOG-01 (unbounded log)  — D-51 size-based rotation at 50 MB, depth=3
//   T-01-LOG-02 (partial line)   — atomic append (W2 — D-04); oversize lines truncated
//   T-01-LOG-03 (spillover leak) — spill payload built FROM the redacted record;
//                                  no raw payload bypasses redaction
//
// Imports (allowed): node:fs, node:path, node:crypto, ./atomic-write.js,
// ./pii.js, ./paths.js. Nothing else.
//
// run_id source (D-64): Per RESEARCH §V3 line 972, crypto.randomUUID() is
// explicitly accepted as a substitute for ULID. We have no `ulid` dep —
// using the Node built-in keeps the dep list lean and is uniqueness-equivalent
// for our purposes (per-handle identifier, not a secret, not sortable
// requirement).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicAppendFile, atomicWriteFile } from './atomic-write.js';
import { redactPii, redactKeys } from './pii.js';
import { paperDir, pensmithDataDir } from './paths.js';

// ---------------------------------------------------------------------------
// Public types (per D-49 / D-50 / D-51 / D-52).
// ---------------------------------------------------------------------------

export type Kind =
  | 'prompt'
  | 'response'
  | 'tool_call'
  | 'tool_result'
  | 'cost'
  | 'event'
  | 'warn'
  | 'error';

export interface SessionLogger {
  prompt(payload: Record<string, unknown>): void;
  response(payload: Record<string, unknown>): void;
  toolCall(payload: Record<string, unknown>): void;     // wire `kind` = 'tool_call'
  toolResult(payload: Record<string, unknown>): void;   // wire `kind` = 'tool_result'
  cost(payload: Record<string, unknown>): void;
  event(payload: Record<string, unknown>): void;
  warn(payload: Record<string, unknown>): void;
  error(payload: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): SessionLogger;
  close(): Promise<void>;
}

export interface OpenSessionLogOptions {
  scope?: 'paper' | 'global' | 'auto';   // default 'auto'
  cwd?: string;                          // override for tests
  maxBytes?: number;                     // default 50 * 1024 * 1024 (D-51)
  maxBackups?: number;                   // default 3 (D-51)
  maxRecordBytes?: number;               // default 16 * 1024 (D-50)
}

// ---------------------------------------------------------------------------
// Constants (D-50, D-51).
// ---------------------------------------------------------------------------

const MAX_LOG_BYTES = 50 * 1024 * 1024;   // D-51 — 50 MB rotation threshold
const MAX_BACKUPS = 3;                    // D-51 — last 3 rotated files kept
const MAX_RECORD_BYTES = 16 * 1024;       // D-50 — per-record size limit
const HEAD_TAIL_BYTES = 4 * 1024;         // D-50 — head + tail slice when truncating

// ---------------------------------------------------------------------------
// D-52 stderr-mirror toggle (module-scope).
// Phase 7's CLI flag --show-prompts will call setMirrorPromptsToStderr(true).
// Phase 1 only ships the setter.
// ---------------------------------------------------------------------------

let mirrorPromptsToStderr = false;

export function setMirrorPromptsToStderr(enabled: boolean): void {
  mirrorPromptsToStderr = !!enabled;
}

// ---------------------------------------------------------------------------
// Path resolution (D-50).
//
// 'paper'  — paperDir(cwd)/SESSION.log
// 'global' — pensmithDataDir()/session.log  (lowercase intentional)
// 'auto'   — paper if cwd/.paper exists as a directory, else global
//
// Note: paperDir() does NOT throw — it just joins root + '.paper'. The
// PLAN snippet's try/catch on paperDir is therefore inert. We instead
// fs.statSync the candidate path and fall back to global when it's not a
// directory. Documented in 01-09-SUMMARY.md as a Rule 3 deviation.
// ---------------------------------------------------------------------------

interface ResolvedRoot {
  logFile: string;
  spillRoot: string;
}

function resolveRoot(scope: NonNullable<OpenSessionLogOptions['scope']>, cwd: string): ResolvedRoot {
  let root: string;
  let useGlobalName = false;

  if (scope === 'paper') {
    root = paperDir(cwd);
  } else if (scope === 'global') {
    root = pensmithDataDir();
    useGlobalName = true;
  } else {
    // 'auto' — paper if .paper/ exists as a directory; else global
    const candidate = paperDir(cwd);
    let isPaper = false;
    try {
      isPaper = fs.statSync(candidate).isDirectory();
    } catch {
      isPaper = false;
    }
    if (isPaper) {
      root = candidate;
    } else {
      root = pensmithDataDir();
      useGlobalName = true;
    }
  }

  const logFile = path.join(root, useGlobalName ? 'session.log' : 'SESSION.log');
  const spillRoot = path.join(root, 'sessions');
  return { logFile, spillRoot };
}

// ---------------------------------------------------------------------------
// Record construction (D-49 — `{at, kind, run_id, ...payload}`).
//
// Order:
//   1. Merge bindings + payload (payload wins on key clash).
//   2. redactKeys(merged) — produces a fresh structurally-cloned object
//      (per W8 — uses Object.create(null) containers internally; we receive
//      it as a fresh container we may mutate in place).
//   3. Walk the cloned top-level keys; for each string-typed leaf, run
//      redactPii on it. (Nested object strings are NOT walked here —
//      that's redactKeys' domain via its sensitive-key set; non-sensitive
//      nested strings are intentionally not auto-redacted to avoid
//      corrupting non-PII telemetry like { method: 'POST' }.)
//   4. Return `{at, kind, run_id, ...redactedFields}`.
// ---------------------------------------------------------------------------

interface BaseRecord {
  at: string;          // ISO-8601 — new Date().toISOString()
  kind: Kind;
  run_id: string;
  [key: string]: unknown;
}

function buildRecord(
  kind: Kind,
  payload: Record<string, unknown>,
  bindings: Record<string, unknown>,
  run_id: string,
): BaseRecord {
  const merged: Record<string, unknown> = { ...bindings, ...payload };
  const safe = redactKeys(merged) as Record<string, unknown>;

  // Top-level string leaves: redactPii. Nested structures are already
  // walked by redactKeys for sensitive-key replacement.
  for (const k of Object.keys(safe)) {
    const v = safe[k];
    if (typeof v === 'string') {
      safe[k] = redactPii(v);
    }
  }

  return {
    at: new Date().toISOString(),
    kind,
    run_id,
    ...safe,
  };
}

// ---------------------------------------------------------------------------
// Truncation + spillover (D-50).
//
// If the serialized line exceeds maxRecordBytes:
//   1. Spill the FULL redacted record via atomicWriteFile to
//      `${spillRoot}/${run_id}/${seq}.json` (best-effort).
//   2. Build a TRUNCATED replacement line with shape:
//        { at, kind, run_id, head, tail, truncated: true, spilled_to }
//      where head/tail are HEAD_TAIL_BYTES slices of the stringified
//      payload (i.e. the record minus {at, kind, run_id}).
//   3. Return the truncated line for the main log.
// ---------------------------------------------------------------------------

interface SeqRef {
  value: number;
}

async function writeLineOrTruncate(
  spillRoot: string,
  run_id: string,
  seqRef: SeqRef,
  record: BaseRecord,
  maxRecordBytes: number,
): Promise<string> {
  const line = JSON.stringify(record) + '\n';
  const sizeBytes = Buffer.byteLength(line, 'utf8');
  if (sizeBytes <= maxRecordBytes) return line;

  // Oversize: separate header from payload.
  const { at, kind, run_id: rid, ...payload } = record;
  const seq = seqRef.value++;
  const spillFile = path.join(spillRoot, run_id, `${seq}.json`);
  try {
    await atomicWriteFile(spillFile, JSON.stringify(record, null, 2) + '\n');
  } catch {
    /* spill is best-effort; truncated line still written */
  }

  const stringified = JSON.stringify(payload);
  const head = stringified.slice(0, HEAD_TAIL_BYTES);
  const tail = stringified.slice(-HEAD_TAIL_BYTES);
  // Path written into the line is RELATIVE to the log file's parent so
  // it's grep-friendly and not host-specific.
  const spillRel = `sessions/${run_id}/${seq}.json`;
  const truncated: BaseRecord = {
    at,
    kind,
    run_id: rid,
    head,
    tail,
    truncated: true,
    spilled_to: spillRel,
  };
  return JSON.stringify(truncated) + '\n';
}

// ---------------------------------------------------------------------------
// In-flight write chain.
//
// Methods on SessionLogger return void synchronously (callers don't await),
// but writes are async via atomicAppendFile. We serialize them on a single
// promise chain so concurrent calls don't interleave appends. The second
// arg to .then() ensures one rejection doesn't break the chain.
// ---------------------------------------------------------------------------

let chain: Promise<void> = Promise.resolve();

function enqueue(work: () => Promise<void>): void {
  chain = chain.then(work, work);
}

// ---------------------------------------------------------------------------
// Module-level flush (HOOK-04 — the Stop hook needs this).
//
// `chain` is the single module-scope write queue shared by EVERY logger handle
// (each handle's close() awaits the same `chain`). closeSessionLog() drains
// that queue without needing a handle — the Stop hook calls it inside
// Promise.allSettled alongside lock release. If no logger ever opened, `chain`
// is the initial resolved promise, so this resolves immediately. enqueue()
// installs `work` as both fulfil + reject handlers so a prior rejected write
// never breaks the chain — awaiting it here therefore never rejects.
// ---------------------------------------------------------------------------

export async function closeSessionLog(): Promise<void> {
  await chain;
}

// ---------------------------------------------------------------------------
// Rotation (D-51 — 50 MB threshold, 3 backups).
//
// Algorithm (highest-numbered slot first; Windows-rename safe):
//   For maxBackups=3:
//     - unlink .3 (drop oldest)
//     - rename .2 → .3
//     - rename .1 → .2
//     - rename current → .1
//
// Each step swallows ENOENT/EACCES/EPERM. Logger never throws.
// ---------------------------------------------------------------------------

async function maybeRotate(filePath: string, maxBytes: number, maxBackups: number): Promise<void> {
  if (maxBackups < 1) return;
  try {
    const st = await fs.promises.stat(filePath);
    if (st.size <= maxBytes) return;

    for (let i = maxBackups; i >= 1; i--) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      if (i === maxBackups) {
        try {
          await fs.promises.unlink(dst);
        } catch {
          /* ENOENT ok — nothing to drop */
        }
      }
      try {
        await fs.promises.rename(src, dst);
      } catch {
        /* ENOENT ok — empty backup slot */
      }
    }
  } catch {
    /* logger must never throw */
  }
}

// ---------------------------------------------------------------------------
// Stderr mirror helper (D-52).
//
// Only kind === 'prompt' records mirror. Mirror is in addition to the
// file write, not a replacement. Runs synchronously before the async
// file write so the caller doesn't race the queue.
// ---------------------------------------------------------------------------

function mirrorIfPrompt(record: BaseRecord): void {
  if (!mirrorPromptsToStderr) return;
  if (record.kind !== 'prompt') return;
  try {
    process.stderr.write(
      `[prompt ${record.at} ${record.run_id}] ${JSON.stringify(record, null, 2)}\n`,
    );
  } catch {
    /* never throw from logger */
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export function openSessionLog(opts: OpenSessionLogOptions = {}): SessionLogger {
  const scope = opts.scope ?? 'auto';
  const cwd = opts.cwd ?? process.cwd();
  const maxBytes = opts.maxBytes ?? MAX_LOG_BYTES;
  const maxBackups = opts.maxBackups ?? MAX_BACKUPS;
  const maxRecordBytes = opts.maxRecordBytes ?? MAX_RECORD_BYTES;
  const { logFile, spillRoot } = resolveRoot(scope, cwd);

  // run_id: per-handle unique identifier. Per D-64 we have no `ulid` dep —
  // crypto.randomUUID() (UUIDv4) per RESEARCH §V3 (line 972).
  const run_id = randomUUID();
  // Per-handle monotonic counter for spill files. Shared with child() loggers.
  const seqRef: SeqRef = { value: 0 };

  function makeLogger(bindings: Record<string, unknown>): SessionLogger {
    function emit(kind: Kind, payload: Record<string, unknown>): void {
      const record = buildRecord(kind, payload, bindings, run_id);
      // Mirror BEFORE async write so it's synchronous from caller's POV.
      mirrorIfPrompt(record);
      enqueue(async () => {
        try {
          const line = await writeLineOrTruncate(
            spillRoot,
            run_id,
            seqRef,
            record,
            maxRecordBytes,
          );
          await atomicAppendFile(logFile, line);
          await maybeRotate(logFile, maxBytes, maxBackups);
        } catch {
          /* swallow — logger must never throw */
        }
      });
    }

    return {
      prompt: (p) => emit('prompt', p),
      response: (p) => emit('response', p),
      toolCall: (p) => emit('tool_call', p),
      toolResult: (p) => emit('tool_result', p),
      cost: (p) => emit('cost', p),
      event: (p) => emit('event', p),
      warn: (p) => emit('warn', p),
      error: (p) => emit('error', p),
      child: (b) =>
        makeLogger({
          ...bindings,
          ...(redactKeys(b) as Record<string, unknown>),
        }),
      close: async () => {
        await chain;
      },
    };
  }

  return makeLogger({});
}
