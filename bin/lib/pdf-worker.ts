// bin/lib/pdf-worker.ts — the worker_threads entry that runs pdf-parse
// (SEC-02, D-19-22; D-06 / T-3-11 pdf-parse chokepoint).
//
// pdf-parse (a 2018 PDF.js fork) is CPU-bound and cannot be interrupted from
// the thread that runs it: the old `Promise.race` timeout in pdf-text.ts
// returned an error while the parse kept burning a core (WR-05). It now runs
// here, in a worker thread that bin/lib/pdf-text.ts starts per extraction
// and hard-terminates (`await worker.terminate()`) on timeout.
//
// This file is ONLY ever loaded as a worker entry (pdf-text.ts resolves it
// next to itself: `pdf-worker.ts` under tsx, `pdf-worker.js` from dist/). It
// reads the PDF bytes from `workerData`, parses them (with the transient
// FormatError retry below) and posts exactly one message:
//   { ok: true, result: WorkerResult } | { ok: false, error: string }
// Its console output (pdf.js prints warnings with console.log) goes to the
// worker's own stdout/stderr, which the parent captures and never forwards.
//
// pdf-parse may be imported only here and in pdf-text.ts (eslint.config.js
// names both files). Bytes only — the worker never touches the filesystem.

import { parentPort, workerData } from 'node:worker_threads';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/** What the worker posts back on success. */
export interface WorkerResult {
  /** pdf-parse's text: every page's text, each preceded by a blank line. */
  text: string;
  /** Each page's text (index 0 = page 1). */
  pages: string[];
  numpages: number;
  /** The PDF Info dictionary, primitive values only. */
  info: Record<string, string | number | boolean>;
  /** The XMP metadata as a flat key → text map (e.g. `dc:title`, `prism:doi`), or null. */
  xmp: Record<string, string> | null;
}

/** The input the parent passes in `workerData`. */
export interface WorkerInput {
  bytes: Uint8Array;
  /** Test seam (set by pdf-text.ts only under a test context): delay the answer by this many ms. */
  testDelayMs?: number;
  /** Test seam (set by pdf-text.ts only under a test context): spin forever, like a runaway parse. */
  testHang?: boolean;
  /** Test seam (set by pdf-text.ts only under a test context): print to the worker's stdout/stderr, like pdf.js warnings. */
  testNoise?: boolean;
}

export type WorkerMessage = { ok: true; result: WorkerResult } | { ok: false; error: string };

interface PdfJsTextItem {
  str: string;
  transform: number[];
}
interface PdfJsPage {
  pageIndex: number;
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: PdfJsTextItem[] }>;
}

/**
 * pdf-parse's own page renderer (lib/pdf-parse.js render_page), unchanged,
 * except that it also records each page's text for identification (the DOI,
 * arXiv stamp and title are looked for on the first pages).
 */
function recordingRender(pages: string[]): (pageData: PdfJsPage) => Promise<string> {
  return (pageData) =>
    pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((textContent) => {
      let lastY: number | undefined;
      let text = '';
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) text += item.str;
        else text += '\n' + item.str;
        lastY = item.transform[5];
      }
      pages[pageData.pageIndex] = text;
      return text;
    });
}

interface ParseResult {
  text?: unknown;
  numpages?: unknown;
  info?: unknown;
  metadata?: unknown;
}

/**
 * pdf-parse's PDF.js fork keeps mutable lexer state in module globals and
 * parses in event-loop-scheduled chunks; with prior async activity it can
 * intermittently reject a valid PDF with a transient FormatError ("Command
 * token too long", "Invalid number", "bad XRef entry") that the SAME bytes do
 * not raise on the next tick. Retry a bounded number of times, yielding a
 * fresh tick between attempts. The debug-shim ENOENT (the bare `pdf-parse`
 * import reading a test file, D-06 Pitfall #1) is deterministic and never
 * retried. The last error propagates.
 */
async function parseWithRetry(input: Buffer): Promise<{ result: ParseResult; pages: string[] }> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pages: string[] = [];
    try {
      const result = (await pdfParse(Buffer.from(input), { pagerender: recordingRender(pages) })) as ParseResult;
      return { result, pages };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') && msg.includes('05-versions-space.pdf')) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw lastErr;
}

function primitives(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = x;
  }
  return out;
}

function xmpMap(md: unknown): Record<string, string> | null {
  const m = md as { getAll?: () => unknown } | null;
  const all = typeof m?.getAll === 'function' ? m.getAll() : null;
  if (!all || typeof all !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(all as Record<string, unknown>)) {
    if (typeof x === 'string' && x.trim()) out[k] = x;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse `bytes` into the posted result shape. */
export async function parseInWorker(bytes: Uint8Array): Promise<WorkerResult> {
  const { result, pages } = await parseWithRetry(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const numpages = typeof result.numpages === 'number' ? result.numpages : 0;
  const filled = Array.from({ length: numpages }, (_, i) => (typeof pages[i] === 'string' ? pages[i]! : ''));
  return {
    text: typeof result.text === 'string' ? result.text : '',
    pages: filled,
    numpages,
    info: primitives(result.info),
    xmp: xmpMap(result.metadata),
  };
}

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) return; // imported outside a worker (e.g. by a type-only consumer): do nothing
  const input = workerData as WorkerInput;
  let message: WorkerMessage;
  try {
    if (input.testNoise === true) {
      // pdf.js reports warnings with console.log; the parent must never forward them.
      console.log('Warning: pensmith-worker-noise-stdout');
      console.error('Warning: pensmith-worker-noise-stderr');
    }
    if (input.testHang === true) {
      // A runaway parse: a synchronous spin only terminate() can stop.
      for (;;) {
        /* spin */
      }
    }
    const result = await parseInWorker(input.bytes);
    if (typeof input.testDelayMs === 'number' && input.testDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, input.testDelayMs));
    }
    message = { ok: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    message = { ok: false, error: msg.split('\n')[0] ?? msg };
  }
  port.postMessage(message);
}

void main();
