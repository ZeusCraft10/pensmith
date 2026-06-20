// tests/pymupdf-shellout.test.ts — Phase 8 Wave 0 RED-by-skip scaffold for
// RSCH-05 (the PyMuPDF absent-graceful fallback for scanned/image-only PDFs).
//
// RED-by-skip: READY = existsSync('bin/lib/pymupdf-shellout.ts') (built in
// 08-03). Until then the suite SKIPS so `npm test` stays GREEN.
//
// Contract pinned: pymupdfShellout(buf) returns `null` (NEVER throws) on ANY
// subprocess failure — the designed graceful degradation when the `fitz`
// (PyMuPDF) Python module is absent. A null result is interpreted upstream as
// "PyMuPDF unavailable" and the caller falls back / surfaces UNVERIFIABLE,
// rather than crashing.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const READY = fs.existsSync(repoPath('bin/lib/pymupdf-shellout.ts'));

// Runtime URL.href specifier for the not-yet-built module (keeps tsc clean).
const PM_MOD = new URL('../bin/lib/pymupdf-shellout.js', import.meta.url);
interface PymupdfMod {
  pymupdfShellout: (buf: Buffer | Uint8Array) => Promise<string | null>;
}

// The committed text-bearing PDF fixture (Task 1).
const BYO_PDF = repoPath('tests/fixtures/pdf/byo-text.pdf');

test('RSCH-05: pymupdfShellout returns null (never throws) when the shellout fails — absent-fitz graceful degradation', { skip: !READY }, async () => {
  const { pymupdfShellout } = (await import(PM_MOD.href)) as PymupdfMod;

  // Force the failure path: point PENSMITH_PYTHON at a binary that does not
  // exist so the spawn fails (or `import fitz` errors). Either way the contract
  // is a NULL return, never a throw.
  const prevPython = process.env.PENSMITH_PYTHON;
  process.env.PENSMITH_PYTHON = '/nonexistent/python-that-is-not-here';
  try {
    const buf = fs.readFileSync(BYO_PDF);
    let result: string | null = 'sentinel';
    await assert.doesNotReject(async () => {
      result = await pymupdfShellout(buf);
    }, 'pymupdfShellout must NOT throw on a failed shellout');
    assert.equal(result, null, 'a failed PyMuPDF shellout must return null (graceful degradation)');
  } finally {
    if (prevPython === undefined) delete process.env.PENSMITH_PYTHON;
    else process.env.PENSMITH_PYTHON = prevPython;
  }
});
