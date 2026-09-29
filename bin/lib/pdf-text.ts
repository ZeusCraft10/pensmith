// bin/lib/pdf-text.ts — PDF text-extraction chokepoint per D-06 / T-3-11 / WRTE-04.
//
// SOLE call site for `pdf-parse` in the repo. The ESLint chokepoint
// (eslint.config.js → no-restricted-imports for `pdf-parse` and
// `pdf-parse/lib/pdf-parse.js`) bans these imports everywhere EXCEPT this
// file (per-file `no-restricted-imports` override). The red-team fixture
// at tests/fixtures/lint-chokepoint-fixture.ts is the regression gate.
//
// =====================================================================
//   Why the sub-path import (D-06 RESEARCH.md Pitfall #1)
// =====================================================================
// `pdf-parse@1.1.1`'s index.js has a debug-mode shim that does
// `fs.readFileSync('./test/data/05-versions-space.pdf')` at import time
// when `module.parent` is undefined (the ESM-consumer case). This throws
// ENOENT in any non-development consumer. Workaround: import the inner
// implementation directly from the sub-path
// `pdf-parse/lib/pdf-parse.js`, which skips the debug shim entirely.
// Both spellings are banned by the chokepoint outside this file; only this
// file's per-file override allows the sub-path spelling.
//
// =====================================================================
//   Bytes only — never a path (T-3-FS-01 information-disclosure mitigation)
// =====================================================================
// `extractPdfText` accepts `Buffer | Uint8Array` only. Callers MUST
// `fs.readFile` (or fetch from the network) before invoking the
// chokepoint. This keeps the chokepoint pure with respect to the
// filesystem: it CANNOT be tricked into reading an arbitrary path because
// it never touches `fs` at all.
//
// =====================================================================
//   Image-only / scanned-PDF surfacing (REVIEWS amendment, D-08-AMENDED)
// =====================================================================
// `pdf-parse` silently returns empty / near-empty `text` on image-only
// (scanned) PDFs. Without surfacing, this would land downstream as a
// Pass-3 "quote NOT_FOUND" with no diagnostic for the user. Heuristic:
// if the parsed text has fewer than 50 non-whitespace characters across
// >= 1 pages, log ONE WARN line and return the (possibly empty) string.
// The `verify` verb (Plan 06 amendment) catches this via a sibling
// signal and assigns the `unverifiable` verdict per D-08-AMENDED — it
// does NOT block compile.
//
// TODO(Phase 4): route the WARN through the structured logger landing in
// Plan 04. Until then we use `console.warn` so test consumers can spy via
// the standard process.stderr stub pattern.

// The `pdf-parse` package ships no `.d.ts` for the sub-path
// `pdf-parse/lib/pdf-parse.js` (the index.js subpath, see RESEARCH.md
// Pitfall #1). Ambient declarations live in the sibling
// `pdf-text-shim.d.ts`. We narrow the declared surface to only `.text`
// and `.numpages` — the two fields this chokepoint actually consumes.
// Future callers needing richer pdf-parse fields go through this file
// (D-06 chokepoint), not by widening the global typings.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/** Minimum non-whitespace character count below which a PDF is treated as image-only. */
const IMAGE_ONLY_TEXT_THRESHOLD = 50;

/**
 * Maximum PDF input size in bytes (50 MB). Any Buffer larger than this is rejected
 * BEFORE parsing so an attacker-supplied PDF cannot OOM the process (HARD-04b / T-15-04b).
 * Exported so the test scaffold can construct an over-cap buffer without hard-coding the value.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Wall-clock timeout for the pdf-parse call in milliseconds (30 s). If the parse does not
 * resolve within this window, extractPdfText rejects with a clear timeout error (no hang).
 * Exported so the test scaffold can exercise the timeout path with a tiny injected value.
 */
export const PDF_TIMEOUT_MS = 30_000;

function isImageOnlyResult(text: string, numpages: number): boolean {
  if (numpages < 1) return false;
  const nonWhitespaceLength = text.replace(/\s/g, '').length;
  return nonWhitespaceLength < IMAGE_ONLY_TEXT_THRESHOLD;
}

/** Result fields this chokepoint consumes from pdf-parse. */
interface PdfParseResult {
  text?: string;
  numpages?: number;
}

/**
 * Hand pdf-parse a Uint8Array that OWNS its whole ArrayBuffer (byteOffset 0,
 * byteLength === buffer.byteLength).
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
 * (`add <pdf>` and @assignment.pdf failed on Node 24 only). A plain
 * Uint8Array copy has its own exactly-sized ArrayBuffer, and
 * PDF.js's clone of it (`new Uint8Array(view)`) is one too, so the parse is
 * deterministic on every Node version. A genuinely broken PDF still fails,
 * once and loudly; the extractPdfText catch routes it onward per RSCH-05b.
 */
async function parsePdf(input: Buffer): Promise<PdfParseResult> {
  return (await pdfParse(new Uint8Array(input))) as PdfParseResult;
}

/**
 * Extract the plain-text body from a PDF byte buffer.
 *
 * Contract:
 *   - Accepts only `Buffer | Uint8Array`. A string / path / number / null
 *     throws TypeError — the chokepoint deliberately refuses filesystem
 *     access (T-3-FS-01).
 *   - Returns the raw `pdf-parse` text string. Normalization (NFKC,
 *     ligature-fold, soft-hyphen strip) happens in `bin/lib/normalize.ts`
 *     downstream; this chokepoint stays close to the third-party output.
 *   - On image-only / scanned PDFs (no extractable text), returns the
 *     (possibly empty) string AND emits a single WARN line via
 *     `console.warn`. The caller's verify verb interprets this as
 *     UNVERIFIABLE rather than failed.
 *   - The debug-shim ENOENT (Pitfall #1) is caught and rethrown with a
 *     diagnostic naming the sub-path workaround, so a future regression
 *     (e.g. someone editing this file to use the bare `pdf-parse` path)
 *     fails loudly instead of silently.
 */
export async function extractPdfText(buf: Buffer | Uint8Array): Promise<string> {
  if (!(buf instanceof Uint8Array) && !Buffer.isBuffer(buf)) {
    throw new TypeError(
      'extractPdfText: input must be Buffer or Uint8Array (no filesystem access from this chokepoint)',
    );
  }
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // HARD-04b: byte-cap guard — reject BEFORE parsing to prevent OOM on attacker-supplied input.
  if (input.length > MAX_PDF_BYTES) {
    throw new Error(
      `extractPdfText: PDF exceeds the ${MAX_PDF_BYTES}-byte cap (${input.length} bytes received). ` +
      `Max allowed is ${MAX_PDF_BYTES / (1024 * 1024)} MB.`,
    );
  }

  try {
    // HARD-04b: wall-clock timeout — Promise.race prevents a pathological PDF from hanging.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(
        () => rej(new Error(`extractPdfText: parse timed out after ${PDF_TIMEOUT_MS}ms`)),
        PDF_TIMEOUT_MS,
      );
    });
    let result: PdfParseResult;
    try {
      result = await Promise.race([parsePdf(input), timeoutPromise]);
    } finally {
      // Clear the timer so the timeout promise does not keep the event loop alive on success.
      clearTimeout(timeoutHandle);
    }
    const text: string = typeof result.text === 'string' ? result.text : '';
    const numpages: number = typeof result.numpages === 'number' ? result.numpages : 0;
    if (isImageOnlyResult(text, numpages)) {
      // RSCH-05b: pdf-parse returned near-empty text (image-only / scanned PDF).
      // Attempt the higher-fidelity PyMuPDF fallback ONLY here — never on every
      // PDF (a subprocess spawn per healthy PDF would blow the budget on large
      // research passes; T-08-03-03). The module is imported LAZILY so the
      // child_process surface isn't loaded on the common (healthy-PDF) path.
      const { pymupdfShellout } = await import('./pymupdf-shellout.js');
      const fallbackText = await pymupdfShellout(input);
      if (
        fallbackText !== null &&
        fallbackText.replace(/\s/g, '').length >= IMAGE_ONLY_TEXT_THRESHOLD
      ) {
        // PyMuPDF recovered real text from the scanned/image-only PDF.
        return fallbackText;
      }
      // PyMuPDF absent (the path THIS build machine + CI exercises) or it too
      // returned near-empty. Degrade gracefully: keep the near-empty pdf-parse
      // text + a single WARN so the source stays usable; Pass 3 marks it
      // UNVERIFIABLE rather than failed (D-08-AMENDED, Pitfall 5).
      // TODO(Phase 4): route through bin/lib/logger.ts (Plan 04). Using
      // console.warn for now so tests can spy via process.stderr stub.
      console.warn(
        `extractPdfText: PDF appears to be image-only or scanned (text body <${IMAGE_ONLY_TEXT_THRESHOLD} non-whitespace chars across ${numpages} pages); pymupdf unavailable or returned empty, continuing with near-empty text. Pass 3 quote verification will mark this source UNVERIFIABLE rather than failed.`,
      );
    }
    return text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') && msg.includes('05-versions-space.pdf')) {
      throw new Error(
        'pdf-parse debug-shim ENOENT — confirm import path is `pdf-parse/lib/pdf-parse.js` not bare `pdf-parse`',
      );
    }
    throw err;
  }
}
