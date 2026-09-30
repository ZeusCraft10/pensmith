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
// reads the PDF bytes from `workerData`, parses them (from a copy that owns
// its ArrayBuffer — parsePdf below) and posts exactly one message:
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
 * Parse with pdf-parse, handing it a Uint8Array that OWNS its whole
 * ArrayBuffer (byteOffset 0, byteLength === buffer.byteLength).
 *
 * pdf-parse@1.1.1 bundles PDF.js v1.10.100, whose `Stream.makeSubStream` builds
 * every sub-stream from `this.bytes.buffer` — the view's byteOffset is dropped.
 * A small Node Buffer (< poolSize / 2: `fs.readFile` of a short PDF, any
 * `Buffer.from` copy, and PDF.js's own fake-worker clone, which re-creates a
 * Buffer through `new value.constructor(value)`) is a view into the shared
 * Buffer pool at a non-zero offset, so each object fetched through a
 * sub-stream was read from the wrong bytes and the parse failed with a
 * FormatError ("bad XRef entry", "Command token too long", "Invalid number").
 * Whether a parse survived depended on where the pool cursor happened to sit
 * — and Node 24's 64 KiB pool (8 KiB before) made a non-zero offset the rule
 * (`add <pdf>` and @assignment.pdf failed on Node 24 only). The old bounded
 * retry only re-rolled the pool offset. A plain Uint8Array copy has its own
 * exactly-sized ArrayBuffer, and PDF.js's clone of it (`new Uint8Array(view)`)
 * is one too, so the parse is deterministic on every Node version. A
 * genuinely broken PDF fails once, loudly; pdf-text.ts maps the debug-shim
 * ENOENT (the bare `pdf-parse` import, D-06 Pitfall #1) and routes any other
 * failure to the PyMuPDF fallback (RSCH-05b).
 */
async function parsePdf(bytes: Uint8Array): Promise<{ result: ParseResult; pages: string[] }> {
  const pages: string[] = [];
  const owned = new Uint8Array(bytes); // a copy: byteOffset 0, its own exactly-sized ArrayBuffer
  const result = (await pdfParse(owned, { pagerender: recordingRender(pages) })) as ParseResult;
  return { result, pages };
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
  const { result, pages } = await parsePdf(bytes);
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
