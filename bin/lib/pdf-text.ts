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
 * pdf-parse@1.1.1 wraps a 2018 fork of PDF.js whose content-stream lexer keeps
 * MUTABLE state in module-level globals (e.g. `PDFJS`) and parses in event-loop-
 * scheduled chunks. When the loop has prior async activity (the common case —
 * e.g. STATE.json was just loaded), the chunk boundaries shift and the lexer
 * intermittently mis-reads a token boundary, rejecting with a transient
 * `FormatError` ("Command token too long", "Invalid number", "bad XRef entry").
 * The SAME bytes parse cleanly on the very next tick.
 *
 * We therefore retry the parse a bounded number of times, yielding a fresh tick
 * (`setImmediate`) between attempts so PDF.js re-runs from a clean scheduling
 * state. The retry is transparent — the byte input is unchanged — and the
 * debug-shim ENOENT (Pitfall #1) is NEVER retried (it is a deterministic import-
 * path defect, not transient): it surfaces immediately to the caller's rethrow.
 * If every attempt fails the LAST error propagates (fail-loud for a genuinely
 * broken PDF), and the extractPdfText catch routes it onward per RSCH-05b.
 */
async function parseWithRetry(input: Buffer): Promise<PdfParseResult> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // A fresh Buffer view per attempt avoids any internal cursor reuse.
      return (await pdfParse(Buffer.from(input))) as PdfParseResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // The deterministic debug-shim ENOENT must NOT be retried — rethrow now.
      if (msg.includes('ENOENT') && msg.includes('05-versions-space.pdf')) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
  throw lastErr;
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
  try {
    const result = await parseWithRetry(input);
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
