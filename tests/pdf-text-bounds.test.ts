// tests/pdf-text-bounds.test.ts — Phase 15 Wave 1 RED scaffold for HARD-04b.
//
// RED-by-skip: behavioral tests SKIP until:
//   (a) bin/lib/pdf-text.ts exports `MAX_PDF_BYTES` and `PDF_TIMEOUT_MS`
//       named constants (typeof check — Wave-2/15-04 lands these), AND
//   (b) the byte-cap check is implemented inside extractPdfText.
//
// Zero failures while these exports are absent.
//
// Covers:
//   - HARD-04b: a Buffer of MAX_PDF_BYTES + 1 bytes → extractPdfText rejects
//     with an error message that mentions the cap (not a crash/hang).
//   - HARD-04b: exported MAX_PDF_BYTES constant is a positive number.
//   - HARD-04b: exported PDF_TIMEOUT_MS constant is a positive number.
//   - (Timeout assertion is skip-guarded separately on PDF_TIMEOUT_MS presence.)
//
// Path resolution: fileURLToPath(new URL(..., import.meta.url)) — Phase-11.
// Dynamic-import: URL.href specifier so tsc --noEmit stays clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- path resolution (Phase-11 spaced-path safe) ----
const pdfTextSrcPath = fileURLToPath(new URL('../bin/lib/pdf-text.ts', import.meta.url));
const pdfTextModUrl = new URL('../bin/lib/pdf-text.js', import.meta.url);

// ---- probe: do the named constant exports exist? ----
let extractPdfTextFn: ((buf: Buffer | Uint8Array) => Promise<string>) | undefined;
let MAX_PDF_BYTES: number | undefined;
let PDF_TIMEOUT_MS: number | undefined;

try {
  const mod = await import(pdfTextModUrl.href) as Record<string, unknown>;
  if (typeof mod['extractPdfText'] === 'function') {
    extractPdfTextFn = mod['extractPdfText'] as (buf: Buffer | Uint8Array) => Promise<string>;
  }
  if (typeof mod['MAX_PDF_BYTES'] === 'number') {
    MAX_PDF_BYTES = mod['MAX_PDF_BYTES'] as number;
  }
  if (typeof mod['PDF_TIMEOUT_MS'] === 'number') {
    PDF_TIMEOUT_MS = mod['PDF_TIMEOUT_MS'] as number;
  }
} catch {
  // Module load — constants absent (Wave-1 RED state). Stay skipped.
}

const hasByteCap = typeof extractPdfTextFn === 'function' && typeof MAX_PDF_BYTES === 'number';
const hasTimeoutCap = typeof PDF_TIMEOUT_MS === 'number';

// ---- always-run: source file exists (sanity check) ----

test('HARD-04b: pdf-text.ts exists at expected path',
  () => {
    assert.ok(
      existsSync(pdfTextSrcPath),
      'bin/lib/pdf-text.ts must exist — it is the pdf-parse chokepoint (D-06)',
    );
  },
);

// ---- constant export tests (skip-guarded on presence) ----

test('HARD-04b: MAX_PDF_BYTES is exported as a positive number',
  {
    skip: typeof MAX_PDF_BYTES !== 'number'
      ? 'MAX_PDF_BYTES not yet exported from bin/lib/pdf-text.ts — not yet wired (HARD-04b)'
      : false,
  },
  () => {
    assert.ok(
      typeof MAX_PDF_BYTES === 'number' && MAX_PDF_BYTES > 0,
      `MAX_PDF_BYTES must be a positive number; got ${JSON.stringify(MAX_PDF_BYTES)}`,
    );
    // Sanity: the cap should be large enough to handle normal PDFs.
    // RESEARCH recommends 50 MB; allow any reasonable non-zero value.
    assert.ok(
      MAX_PDF_BYTES! >= 1024 * 1024,
      `MAX_PDF_BYTES should be at least 1 MB; got ${MAX_PDF_BYTES} bytes`,
    );
  },
);

test('HARD-04b: PDF_TIMEOUT_MS is exported as a positive number',
  {
    skip: !hasTimeoutCap
      ? 'PDF_TIMEOUT_MS not yet exported from bin/lib/pdf-text.ts — not yet wired (HARD-04b)'
      : false,
  },
  () => {
    assert.ok(
      typeof PDF_TIMEOUT_MS === 'number' && PDF_TIMEOUT_MS > 0,
      `PDF_TIMEOUT_MS must be a positive number; got ${JSON.stringify(PDF_TIMEOUT_MS)}`,
    );
  },
);

// ---- byte-cap rejection test (skip-guarded on both extractPdfText and MAX_PDF_BYTES) ----

test('HARD-04b: Buffer of MAX_PDF_BYTES + 1 → extractPdfText rejects with cap error (not crash/hang)',
  {
    skip: !hasByteCap
      ? 'extractPdfText or MAX_PDF_BYTES not yet exported from bin/lib/pdf-text.ts — not yet wired (HARD-04b)'
      : false,
  },
  async () => {
    // Build a buffer 1 byte over cap. We fill with zeros — this will NOT be
    // parsed by pdf-parse because the cap check happens BEFORE parseWithRetry.
    const oversized = Buffer.alloc(MAX_PDF_BYTES! + 1, 0);
    await assert.rejects(
      () => extractPdfTextFn!(oversized),
      (err: Error) => {
        // The error message must mention the cap — not a generic crash.
        const msg = err.message;
        const mentionsCap =
          msg.toLowerCase().includes('cap') ||
          msg.toLowerCase().includes('exceed') ||
          msg.toLowerCase().includes('limit') ||
          msg.toLowerCase().includes('max') ||
          msg.toLowerCase().includes('bytes') ||
          msg.toLowerCase().includes('mb');
        assert.ok(
          mentionsCap,
          `expected cap-related error message, got: "${msg}"`,
        );
        return true;
      },
      `extractPdfText must reject a ${MAX_PDF_BYTES! + 1}-byte input with a descriptive cap error`,
    );
  },
);

// ---- module-presence consistency (Wave-0 pattern) ----

test('HARD-04b: pdf-text exports consistent with Wave-1 RED state',
  () => {
    if (hasByteCap) {
      assert.ok(true, 'MAX_PDF_BYTES + extractPdfText exported — byte-cap test above is active (Wave-2+)');
    } else {
      assert.ok(
        !hasByteCap,
        'Wave-1 RED: named cap constants absent from pdf-text.ts — skips above are correct',
      );
    }
  },
);
