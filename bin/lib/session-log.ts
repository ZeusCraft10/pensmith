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
import { createHash, randomUUID } from 'node:crypto';
import { atomicAppendFile, atomicWriteFile } from './atomic-write.js';
import { redactKeys, deepRedactPii } from './pii.js';
import { paperDir, pensmithDataDir, projectRoot } from './paths.js';

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
  | 'error'
  | 'llm'
  | 'http';

export interface SessionLogger {
  prompt(payload: Record<string, unknown>): void;
  response(payload: Record<string, unknown>): void;
  toolCall(payload: Record<string, unknown>): void;     // wire `kind` = 'tool_call'
  toolResult(payload: Record<string, unknown>): void;   // wire `kind` = 'tool_result'
  cost(payload: Record<string, unknown>): void;
  event(payload: Record<string, unknown>): void;
  warn(payload: Record<string, unknown>): void;
  error(payload: Record<string, unknown>): void;
  llm(payload: Record<string, unknown>): void;         // RUN-15 kind:"llm" record (V4)
  http(payload: Record<string, unknown>): void;        // RUN-15 kind:"http" record (V4)
  child(bindings: Record<string, unknown>): SessionLogger;
  close(): Promise<void>;
}

export interface OpenSessionLogOptions {
  scope?: 'paper' | 'global' | 'auto';   // default 'auto'
  cwd?: string;                          // override for tests
  maxBytes?: number;                     // default 50 * 1024 * 1024 (D-51)
  maxBackups?: number;                   // default 3 (D-51)
  maxRecordBytes?: number;               // default 16 * 1024 (D-50)
  runId?: string;                        // default: a fresh UUID per handle; the llm logger passes the session id
}

// ---------------------------------------------------------------------------
// Constants (D-50, D-51).
// ---------------------------------------------------------------------------

const MAX_LOG_BYTES = 50 * 1024 * 1024;   // D-51 — 50 MB rotation threshold
const MAX_BACKUPS = 3;                    // D-51 — last 3 rotated files kept
const MAX_RECORD_BYTES = 16 * 1024;       // D-50 — per-record size limit
const HEAD_TAIL_BYTES = 4 * 1024;         // D-50 — head + tail slice when truncating
const MAX_LLM_RECORD_BYTES = 256 * 1024;  // D-17-29 — kind:"llm" records spill above 256 KiB
const PREVIEW_CHARS = 200;                // D-17-29 — preview length kept in a spilled/redacted record

// ---------------------------------------------------------------------------
// D-52 stderr-mirror toggle (module-scope).
// The --show-prompts pre-parse calls setMirrorPromptsToStderr(true); http.ts
// reads it through isMirrorPromptsEnabled() and mirrors each outbound payload.
// ---------------------------------------------------------------------------

let mirrorPromptsToStderr = false;

export function setMirrorPromptsToStderr(enabled: boolean): void {
  mirrorPromptsToStderr = !!enabled;
}

/** Phase 17 seam (verbatim V4): read by bin/lib/http.ts to mirror outbound payloads (RUN-16). */
export function isMirrorPromptsEnabled(): boolean {
  return mirrorPromptsToStderr;
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
// Session identity (RUN-18 / D-17-26, RUN-15 / D-17-29).
//
// A session is one top-level process invocation (a bare-router chain included;
// the MCP server process is one session). The id is minted on first use and
// shared by COSTS.jsonl records (budget.ts) and kind:"llm" record ids
// (`<session_id>:<seq>`), so one invocation's spend and calls line up.
// ---------------------------------------------------------------------------

let sessionIdValue: string | null = null;
let llmSeq = 0;
let sessionArgv: readonly string[] | null = null;
const argvLoggedTo = new Set<string>();

export function currentSessionId(): string {
  if (sessionIdValue === null) sessionIdValue = randomUUID();
  return sessionIdValue;
}

/** The next kind:"llm" record sequence number of this session (1-based). */
export function nextLlmSeq(): number {
  llmSeq += 1;
  return llmSeq;
}

/** Record the invocation argv (the dispatcher calls this once); logged once per session for replay (RUN-17). */
export function setSessionArgv(argv: readonly string[]): void {
  sessionArgv = Object.freeze([...argv]);
}

/** Test-only: start a fresh session (new id, seq 0, argv unlogged). */
export function _resetSessionForTest(): void {
  sessionIdValue = null;
  llmSeq = 0;
  sessionArgv = null;
  argvLoggedTo.clear();
  secrets.clear();
}

// ---------------------------------------------------------------------------
// Known secret values (defence in depth, RUN-15 / T-01-07).
//
// The transport registers every resolved provider key here. Every serialized
// line and spill file is scrubbed of those exact values before it is written,
// so a key can never reach SESSION.log even if a future payload carried one
// (the key-name redaction in redactKeys is the first line of defence).
// ---------------------------------------------------------------------------

const secrets = new Set<string>();

export function registerSecret(value: string): void {
  if (typeof value === 'string' && value.length >= 8) secrets.add(value);
}

function scrubSecrets(line: string): string {
  let out = line;
  for (const s of secrets) {
    const escaped = JSON.stringify(s).slice(1, -1);
    if (out.includes(s)) out = out.split(s).join('[REDACTED]');
    if (escaped !== s && out.includes(escaped)) out = out.split(escaped).join('[REDACTED]');
  }
  return out;
}


// ---------------------------------------------------------------------------
// Record construction (D-49 — `{at, kind, run_id, ...payload}`).
//
// Order:
//   1. Merge bindings + payload (payload wins on key clash).
//   2. redactKeys(merged) — produces a fresh structurally-cloned object
//      (per W8 — uses Object.create(null) containers internally; we receive
//      it as a fresh container we may mutate in place). Replaces VALUES
//      under SENSITIVE key names (authorization, token, secret, …) at
//      ANY depth.
//   3. deepRedactPii per key — recurses into every string leaf at any depth
//      so PII (phone, email, SSN, name, …) under non-sensitive nested keys
//      is also redacted (HARD-03 / T-15-03). Includes top-level strings.
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

  // Two-stage redaction (HARD-03 / T-15-03):
  //   Stage 1 — redactKeys (above): replaces VALUES under SENSITIVE key names
  //             (authorization, token, secret, api_key, …) at ANY depth via
  //             walkAndRedact's recursion. Already done by redactKeys().
  //   Stage 2 — deepRedactPii (below): walks EVERY remaining string leaf at
  //             any depth and applies redactPii so PII (email, phone, SSN,
  //             name, …) under non-sensitive nested keys is also redacted.
  //             Top-level strings are included — deepRedactPii handles them
  //             identically to the old top-level-only loop.
  // The spill payload in writeLineOrTruncate is built FROM the `record`
  // returned below, which already incorporates both stages — no raw payload
  // ever bypasses redaction (invariant T-01-LOG-03 preserved).
  //
  // kind:"llm" (RUN-15 / D-17-29) is the one exception to stage 2: request and
  // response bodies are stored AS SENT, because replay (RUN-17) must reproduce
  // the exact request hash and response, and the prompt is already
  // intake-redacted when the user opted into PII redaction. Keys are still
  // redacted (stage 1 above, plus the registered-secret scrub at write time).
  // `[logging] session_bodies = "redacted"` (the payload's `session_bodies`)
  // replaces every body with its sha256 and a short preview.
  //
  // kind:"http" (RUN-15): the `url` is already secret-scrubbed by its writer
  // (http.ts redactUrl: userinfo dropped, key/token params REDACTED, the
  // contact-email params dropped). It skips the PII patterns, which would read
  // a DOI's digits as a phone number and a loopback host as an IP and destroy
  // the one thing the record is for — which source was requested. Its other
  // fields still get stage 2.
  if (kind === 'llm') {
    if (safe['session_bodies'] === 'redacted') redactLlmBodies(safe);
  } else {
    for (const k of Object.keys(safe)) {
      if (kind === 'http' && k === 'url') continue;
      safe[k] = deepRedactPii(safe[k]);
    }
  }

  return {
    at: new Date().toISOString(),
    kind,
    run_id,
    ...safe,
  };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A 200-char preview, scrubbed BEFORE truncation so a key cut at the boundary cannot leak partially. */
function previewOf(text: string): string {
  const clean = scrubSecrets(text);
  return clean.length <= PREVIEW_CHARS ? clean : clean.slice(0, PREVIEW_CHARS);
}

/** Replace an llm record's bodies with hashes + previews (`session_bodies = "redacted"`). */
function redactLlmBodies(rec: Record<string, unknown>): void {
  if (rec['request'] !== undefined) {
    const text = typeof rec['request'] === 'string' ? rec['request'] : JSON.stringify(rec['request']);
    rec['request'] = { sha256: sha256Hex(text), chars: text.length, preview: previewOf(text) };
  }
  const resp = rec['response'];
  if (resp && typeof resp === 'object') {
    const r = resp as Record<string, unknown>;
    const text = typeof r['text'] === 'string' ? r['text'] : '';
    const out: Record<string, unknown> = { sha256: sha256Hex(text), chars: text.length, preview: previewOf(text) };
    if (r['data'] !== undefined) out['data_sha256'] = sha256Hex(JSON.stringify(r['data']));
    rec['response'] = out;
  }
}

/**
 * kind:"llm" spill (D-17-29): a record above 256 KiB is written whole to
 * `sessions/<run_id>/<seq>.json` (seq = the record id's sequence number) and
 * the log line keeps the sha256 of each body plus 200-character previews.
 */
async function llmLine(spillRoot: string, record: BaseRecord): Promise<string> {
  const line = scrubSecrets(JSON.stringify(record)) + '\n';
  if (Buffer.byteLength(line, 'utf8') <= MAX_LLM_RECORD_BYTES) return line;
  const id = typeof record['id'] === 'string' ? record['id'] : `${record.run_id}:0`;
  const seq = id.slice(id.lastIndexOf(':') + 1) || '0';
  const spillFile = path.join(spillRoot, record.run_id, `${seq}.json`);
  try {
    await atomicWriteFile(spillFile, scrubSecrets(JSON.stringify(record, null, 2)) + '\n');
  } catch {
    /* spill is best-effort; the summary line is still written */
  }
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'request' || k === 'response') continue;
    summary[k] = v;
  }
  const reqText = typeof record['request'] === 'string' ? record['request'] : JSON.stringify(record['request'] ?? null);
  summary['request'] = { sha256: sha256Hex(reqText), chars: reqText.length, preview: previewOf(reqText) };
  const resp = (record['response'] ?? {}) as Record<string, unknown>;
  const respText = typeof resp['text'] === 'string' ? resp['text'] : '';
  summary['response'] = {
    sha256: sha256Hex(respText),
    chars: respText.length,
    preview: previewOf(respText),
    ...(resp['data'] !== undefined ? { data_sha256: sha256Hex(JSON.stringify(resp['data'])) } : {}),
  };
  summary['truncated'] = true;
  summary['spilled_to'] = `sessions/${record.run_id}/${seq}.json`;
  return scrubSecrets(JSON.stringify(summary)) + '\n';
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
// Stderr mirror (D-52 → D-17-12).
//
// The prompt-kind stderr mirror that lived here is removed: `--show-prompts`
// now mirrors every outbound payload exactly once, in bin/lib/http.ts, before
// any byte is sent (it reads isMirrorPromptsEnabled()). Mirroring here as well
// would print each LLM payload twice.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export function openSessionLog(opts: OpenSessionLogOptions = {}): SessionLogger {
  const scope = opts.scope ?? 'auto';
  // The paper is resolved through projectRoot() (D-17-29), so SESSION.log lands
  // in the active paper's .paper/ even when the cwd is elsewhere.
  const cwd = opts.cwd ?? projectRoot();
  const maxBytes = opts.maxBytes ?? MAX_LOG_BYTES;
  const maxBackups = opts.maxBackups ?? MAX_BACKUPS;
  const maxRecordBytes = opts.maxRecordBytes ?? MAX_RECORD_BYTES;
  const { logFile, spillRoot } = resolveRoot(scope, cwd);

  // run_id: per-handle unique identifier. Per D-64 we have no `ulid` dep —
  // crypto.randomUUID() (UUIDv4) per RESEARCH §V3 (line 972). The llm logger
  // passes the session id so `<run_id>:<seq>` record ids span one invocation.
  const run_id = opts.runId ?? randomUUID();
  // Per-handle monotonic counter for spill files. Shared with child() loggers.
  const seqRef: SeqRef = { value: 0 };

  function makeLogger(bindings: Record<string, unknown>): SessionLogger {
    function emit(kind: Kind, payload: Record<string, unknown>): void {
      const record = buildRecord(kind, payload, bindings, run_id);
      enqueue(async () => {
        try {
          // kind:"llm" records use the 256 KiB spill with hashes + previews
          // (D-17-29); every other kind keeps the D-50 16 KiB head/tail spill.
          const line = kind === 'llm'
            ? await llmLine(spillRoot, record)
            : scrubSecrets(await writeLineOrTruncate(
              spillRoot,
              run_id,
              seqRef,
              record,
              maxRecordBytes,
            ));
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
      llm: (p) => emit('llm', p),
      http: (p) => emit('http', p),
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

/**
 * Log the invocation argv once per session per log file (RUN-17 replay needs
 * it). Called by the transport before its first kind:"llm" record.
 */
export function logSessionArgvOnce(logger: SessionLogger, logFileKey: string): void {
  if (sessionArgv === null || argvLoggedTo.has(logFileKey)) return;
  argvLoggedTo.add(logFileKey);
  logger.event({ event: 'session.argv', session: currentSessionId(), argv: [...sessionArgv] });
}

/** The SESSION.log path the 'auto' scope resolves to for `root` (paper when .paper/ exists). */
export function sessionLogPathFor(root: string = projectRoot()): string {
  return resolveRoot('auto', root).logFile;
}
