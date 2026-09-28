// tests/pymupdf-shellout.test.ts — RSCH-05: the PyMuPDF fallback for PDFs
// pdf-parse cannot read degrades gracefully when PyMuPDF (`fitz`) is absent.
//
// Contract: pymupdfExtract(buf) resolves `null` (NEVER throws) on ANY
// subprocess failure. A null result means "PyMuPDF unavailable" upstream
// (pdf-text.ts falls back / reports the PDF as unreadable) rather than a crash.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pymupdfExtract } from '../bin/lib/pymupdf-shellout.js';

const BYO_PDF = fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url));

test('RSCH-05: pymupdfExtract returns null (never throws) when the shellout fails — absent-fitz graceful degradation', async () => {
  // Force the failure path: point PENSMITH_PYTHON at a binary that does not
  // exist so the spawn fails (or `import fitz` errors). Either way the contract
  // is a NULL result, never a throw.
  const prevPython = process.env.PENSMITH_PYTHON;
  process.env.PENSMITH_PYTHON = '/nonexistent/python-that-is-not-here';
  try {
    const buf = fs.readFileSync(BYO_PDF);
    let result: unknown = 'sentinel';
    await assert.doesNotReject(async () => {
      result = await pymupdfExtract(buf);
    }, 'pymupdfExtract must NOT throw on a failed shellout');
    assert.equal(result, null, 'a failed PyMuPDF shellout must return null (graceful degradation)');
  } finally {
    if (prevPython === undefined) delete process.env.PENSMITH_PYTHON;
    else process.env.PENSMITH_PYTHON = prevPython;
  }
});
