// bin/lib/pdf-text.ts — PDF text-extraction chokepoint per D-06 / T-3-11 /
// WRTE-04, hardened by SEC-02 (D-19-22).
//
// Every PDF the product reads — an assignment PDF, a Pass-3 open-access copy,
// a PDF passed to `add`, a bring-your-own folder — is extracted here, and ONLY
// here. pdf-parse itself runs in a worker thread (bin/lib/pdf-worker.ts); the
// ESLint pdf-parse exemption names exactly these two files.
//
// =====================================================================
//   SEC-02 — a parse that can be stopped (closes WR-05)
// =====================================================================
// pdf-parse is synchronous-ish, CPU-bound PDF.js code: a `Promise.race`
// timeout returned an error but left the parse burning a core. Now each
// extraction starts one worker (`pdf-worker.ts` under tsx, `pdf-worker.js`
// from dist/, resolved next to this module) and a one-shot settle guard over
// its message / error / exit events and the timeout decides the outcome
// exactly once:
//   - a result that arrives before the timeout fires is returned (never
//     discarded), then the worker is terminated;
//   - on timeout the parent AWAITS `worker.terminate()` before rejecting, so
//     no zombie parse outlives the call (activePdfWorkers() returns to 0);
//   - an error or an early exit rejects, after the same terminate.
// The worker's stdout/stderr are captured (pdf.js prints warnings with
// console.log), so parser noise never reaches the user's terminal.
//
// =====================================================================
//   Fallback and image-only PDFs (RSCH-05b, SRC-15 / SWP-59)
// =====================================================================
// PyMuPDF (bin/lib/pymupdf-shellout.ts) runs when pdf-parse THROWS or returns
// near-empty text (< 50 non-whitespace characters). Its text comes from a
// result file, never from the interpreter's stdout (current PyMuPDF prints a
// `fitz` deprecation warning there). A PDF that still has no text is
// `imageOnly: true` (a scanned PDF): `add` refuses it, BYO keeps it
// unhydrated, Pass 3 reports the text unavailable.
//
// =====================================================================
//   Bytes only — never a path (T-3-FS-01)
// =====================================================================
// `extractPdf` / `extractPdfText` accept `Buffer | Uint8Array` only; callers
// read the file (or fetch it) first. Neither this module nor the worker opens
// any path. HARD-04b: inputs over MAX_PDF_BYTES are rejected before any work.

import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestContext } from './http-mock.js';
import type { WorkerInput, WorkerMessage, WorkerResult } from './pdf-worker.js';

/** Minimum non-whitespace character count below which a PDF is treated as image-only. */
const IMAGE_ONLY_TEXT_THRESHOLD = 50;

/**
 * Maximum PDF input size in bytes (50 MB). Any Buffer larger than this is rejected
 * BEFORE parsing so an attacker-supplied PDF cannot OOM the process (HARD-04b / T-15-04b).
 * Exported so the test scaffold can construct an over-cap buffer without hard-coding the value.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Wall-clock limit for one pdf-parse run in milliseconds (30 s). When it
 * passes, the worker is terminated and the extraction rejects with
 * PdfTimeoutError (SEC-02).
 */
export const PDF_TIMEOUT_MS = 30_000;

/** Heap ceiling for one parse worker; a PDF that needs more is a failed extraction, not an OOM of the CLI. */
const WORKER_MAX_OLD_GENERATION_MB = 1536;

/** Bytes of worker stdout/stderr kept for diagnostics (the rest is dropped). */
const CAPTURE_LIMIT = 16 * 1024;

/** The extracted content of one PDF. */
export interface PdfExtraction {
  /** The PDF's text (pdf-parse's layout: each page preceded by a blank line). */
  readonly text: string;
  /** Each page's text (index 0 = page 1). */
  readonly pages: readonly string[];
  readonly numpages: number;
  /** The PDF Info dictionary (Title, Author, Subject, Keywords, …), primitive values only. */
  readonly info: Readonly<Record<string, string | number | boolean>>;
  /** XMP metadata as a flat key → text map (dc:title, prism:doi, …), or null. */
  readonly xmp: Readonly<Record<string, string>> | null;
  /** True when no text could be extracted (a scanned / image-only PDF). */
  readonly imageOnly: boolean;
  /** Which extractor produced `text`. */
  readonly engine: 'pdf-parse' | 'pymupdf';
}

/** A parse that did not finish within its time limit (the worker was terminated). */
export class PdfTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`extractPdfText: parse timed out after ${timeoutMs}ms (the parser was stopped)`);
    this.name = 'PdfTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function isNearEmpty(text: string): boolean {
  return text.replace(/\s/g, '').length < IMAGE_ONLY_TEXT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// The worker.
// ---------------------------------------------------------------------------

let liveWorkers = 0;

/** How many PDF parse workers are alive right now (SEC-02 tests assert it returns to 0). */
export function activePdfWorkers(): number {
  return liveWorkers;
}

/**
 * The worker entry next to this module: `.ts` from source (tsx), `.js` from
 * dist/, and `.mjs` inside a plugin bundle (PLUG-02) — there this module is
 * inlined into `plugin/dist/mcp/server.mjs` and the worker is its own bundle,
 * `plugin/dist/mcp/pdf-worker.mjs`, in the same directory.
 */
export function pdfWorkerEntry(here: string = fileURLToPath(import.meta.url)): string {
  const own = path.extname(here);
  const ext = own === '.ts' || own === '.mjs' ? own : '.js';
  return path.join(path.dirname(here), `pdf-worker${ext}`);
}

/**
 * execArgv for the worker — never the parent's execArgv, which may hold
 * options a worker rejects (`-e <code>`, `--input-type`, `--test`, …) or a
 * bare `--import tsx` that no longer resolves once the process has changed
 * directory. A `.js` entry (dist/) needs no option. A `.ts` entry (running
 * from source) needs exactly the tsx loader, resolved here — from this
 * module's own location — to an absolute URL.
 */
export function workerExecArgv(entry: string): string[] {
  return path.extname(entry) === '.ts' ? ['--import', import.meta.resolve('tsx')] : [];
}

/** The subset of a worker_threads Worker the settle guard drives (a test can supply a fake). */
export interface PdfWorkerLike {
  on(event: 'message', fn: (m: unknown) => void): unknown;
  on(event: 'error', fn: (e: Error) => void): unknown;
  on(event: 'exit', fn: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export interface WorkerJobTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: WorkerJobTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Run one worker job under the one-shot settle guard (SEC-02). Exactly one of
 * message / error / exit / timeout decides the outcome; the worker is always
 * terminated — and the termination awaited — before the promise settles.
 * Exported for the race tests, which drive it with a fake worker and fake
 * timers; production code calls it through extractPdf.
 */
export function runPdfWorkerJob(
  worker: PdfWorkerLike,
  timeoutMs: number,
  timers: WorkerJobTimers = REAL_TIMERS,
  diagnostics: () => string = () => '',
): Promise<WorkerResult> {
  liveWorkers++;
  let counted = true;
  const release = (): void => {
    if (counted) {
      counted = false;
      liveWorkers--;
    }
  };
  return new Promise<WorkerResult>((resolve, reject) => {
    let settled = false;
    let exited = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      const stopped = exited ? Promise.resolve() : worker.terminate().then(() => undefined, () => undefined);
      void stopped.then(() => {
        release();
        outcome();
      });
    };
    const timer = timers.setTimeout(() => settle(() => reject(new PdfTimeoutError(timeoutMs))), timeoutMs);
    worker.on('message', (m) => {
      const msg = m as WorkerMessage;
      if (msg && typeof msg === 'object' && msg.ok === true) settle(() => resolve(msg.result));
      else settle(() => reject(new Error(msg && typeof msg === 'object' && msg.ok === false ? msg.error : 'the PDF worker sent an unreadable answer')));
    });
    worker.on('error', (e) => settle(() => reject(e)));
    worker.on('exit', (code) => {
      exited = true;
      release();
      const extra = diagnostics().trim().split('\n').slice(-1)[0] ?? '';
      settle(() => reject(new Error(`the PDF worker exited (code ${code}) before answering${extra ? `: ${extra}` : ''}`)));
    });
  });
}

/** Test-only behaviour of the next workers (honoured only under a test context). */
type WorkerTestSeam = Pick<WorkerInput, 'testDelayMs' | 'testHang' | 'testNoise'>;
let workerTestSeam: WorkerTestSeam | null = null;

/** Test seam: make the parse workers delay their answer, spin forever, or print noise (SEC-02 tests). */
export function __setPdfWorkerTestSeam(seam: WorkerTestSeam | null): void {
  if (seam !== null && !isTestContext()) throw new Error('pdf-text.ts: the worker test seam is available only under the test runner');
  workerTestSeam = seam;
}

/** Parse `input` with pdf-parse in a fresh worker thread (see the header). */
async function parseInFreshWorker(input: Buffer, timeoutMs: number): Promise<WorkerResult> {
  // Copy into a standalone buffer and transfer it: the caller's Buffer is
  // never detached, and the worker gets the bytes without a second copy.
  const bytes = new Uint8Array(input.byteLength);
  bytes.set(input);
  const data: WorkerInput = { bytes, ...(workerTestSeam !== null && isTestContext() ? workerTestSeam : {}) };
  const entry = pdfWorkerEntry();
  const worker = new Worker(entry, {
    workerData: data,
    transferList: [bytes.buffer],
    stdout: true,
    stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB },
    execArgv: workerExecArgv(entry),
  });
  let captured = '';
  const capture = (chunk: Buffer | string): void => {
    if (captured.length < CAPTURE_LIMIT) captured += String(chunk).slice(0, CAPTURE_LIMIT - captured.length);
  };
  worker.stdout.on('data', capture);
  worker.stderr.on('data', capture);
  return runPdfWorkerJob(worker, timeoutMs, REAL_TIMERS, () => captured);
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

function assertBytes(buf: unknown, who: string): Buffer {
  if (!(buf instanceof Uint8Array) && !Buffer.isBuffer(buf)) {
    throw new TypeError(`${who}: input must be Buffer or Uint8Array (no filesystem access from this chokepoint)`);
  }
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // HARD-04b: byte-cap guard — reject BEFORE parsing to prevent OOM on attacker-supplied input.
  if (input.length > MAX_PDF_BYTES) {
    throw new Error(
      `${who}: PDF exceeds the ${MAX_PDF_BYTES}-byte cap (${input.length} bytes received). ` +
        `Max allowed is ${MAX_PDF_BYTES / (1024 * 1024)} MB.`,
    );
  }
  return input;
}

/**
 * Extract a PDF's text and metadata (SEC-02, D-19-22): pdf-parse in a
 * terminable worker, PyMuPDF when pdf-parse throws or finds (almost) no text,
 * `imageOnly` when neither finds any. Throws when pdf-parse fails and PyMuPDF
 * is unavailable or fails too (the pdf-parse error), and PdfTimeoutError when
 * the parse ran out of time (the worker has been stopped by then).
 */
export async function extractPdf(buf: Buffer | Uint8Array, opts: { timeoutMs?: number } = {}): Promise<PdfExtraction> {
  const input = assertBytes(buf, 'extractPdf');
  const timeoutMs = opts.timeoutMs ?? PDF_TIMEOUT_MS;
  let parsed: WorkerResult | null = null;
  let parseError: unknown = null;
  try {
    parsed = await parseInFreshWorker(input, timeoutMs);
  } catch (err) {
    if (err instanceof PdfTimeoutError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') && msg.includes('05-versions-space.pdf')) {
      throw new Error('pdf-parse debug-shim ENOENT — confirm import path is `pdf-parse/lib/pdf-parse.js` not bare `pdf-parse`');
    }
    parseError = err;
  }

  if (parsed !== null && !isNearEmpty(parsed.text)) {
    return { ...parsed, imageOnly: false, engine: 'pdf-parse' };
  }

  // RSCH-05b / SWP-59: pdf-parse threw or found (almost) no text. The
  // module is imported lazily so the child_process surface loads only here.
  const { pymupdfExtract } = await import('./pymupdf-shellout.js');
  const fallback = await pymupdfExtract(input);
  if (fallback !== null && !isNearEmpty(fallback.text)) {
    return {
      text: fallback.text,
      pages: fallback.pages,
      numpages: fallback.numpages,
      info: parsed?.info ?? fallback.info,
      xmp: parsed?.xmp ?? null,
      imageOnly: false,
      engine: 'pymupdf',
    };
  }
  if (parsed === null) {
    throw parseError instanceof Error ? parseError : new Error(String(parseError));
  }
  // No extractor found text: a scanned / image-only PDF.
  return { ...parsed, imageOnly: true, engine: 'pdf-parse' };
}

/**
 * Extract the plain-text body from a PDF byte buffer (the pre-SEC-02
 * contract, kept for Pass 3 and assignment PDFs):
 *   - accepts only `Buffer | Uint8Array` (TypeError otherwise — T-3-FS-01);
 *   - returns the extracted text (NFKC etc. happen downstream in normalize.ts);
 *   - on an image-only / scanned PDF returns the (possibly empty) text and
 *     emits ONE WARN line via console.warn (Pass 3 then marks the source
 *     UNVERIFIABLE rather than failed, D-08-AMENDED);
 *   - rejects on a PDF neither extractor can read, and on timeout.
 */
export async function extractPdfText(buf: Buffer | Uint8Array): Promise<string> {
  assertBytes(buf, 'extractPdfText');
  const out = await extractPdf(buf);
  if (out.imageOnly) {
    console.warn(
      `extractPdfText: PDF appears to be image-only or scanned (text body <${IMAGE_ONLY_TEXT_THRESHOLD} non-whitespace chars across ${out.numpages} pages); pymupdf unavailable or returned empty, continuing with near-empty text. Pass 3 quote verification will mark this source UNVERIFIABLE rather than failed.`,
    );
  }
  return out.text;
}
