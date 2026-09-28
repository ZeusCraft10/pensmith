// tests/pymupdf-result-file.test.ts — SRC-15 / SWP-59 (RSCH-05b), D-19-22:
// the PyMuPDF fallback imports `pymupdf` (falling back to `fitz` only when that
// name is missing), reads its answer from a RESULT FILE — interpreter
// warnings on stdout/stderr are never text — and runs when pdf-parse THROWS,
// not only on near-empty text.
//
// A fake PyMuPDF module on PYTHONPATH (ahead of any installed PyMuPDF) makes
// the interpreter's behaviour deterministic on every OS: it prints a
// deprecation warning to stdout and stderr on import, as PyMuPDF's `fitz`
// shim does, and returns fixed page texts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pymupdfExtract, pythonCandidates, PYMUPDF_SCRIPT } from '../bin/lib/pymupdf-shellout.js';
import { extractPdf } from '../bin/lib/pdf-text.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** The first interpreter pythonCandidates() can run, or null. */
function python(): string | null {
  for (const c of pythonCandidates()) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

const FAKE_DOC = [
  'class _Page:',
  '    def __init__(self, text): self._t = text',
  '    def get_text(self): return self._t',
  'class _Doc:',
  '    def __init__(self, path):',
  '        self.metadata = {"title": "Recovered Title", "author": "Ada Lovelace", "format": "PDF 1.4", "subject": ""}',
  '        self._pages = [_Page(t) for t in PAGES]',
  '    def __iter__(self): return iter(self._pages)',
  'def open(path): return _Doc(path)',
];

function fakeModule(name: string, pages: string[], opts: { noisy?: boolean; broken?: boolean } = {}): string {
  if (opts.broken) return 'raise ImportError("this PyMuPDF release has no `pymupdf` name")\n';
  return [
    'import sys',
    ...(opts.noisy
      ? [
          'print("warning: The `fitz` API is deprecated and will be removed in future. Use `import pymupdf` instead.")',
          'print("DeprecationWarning: something noisy", file=sys.stderr)',
        ]
      : []),
    `PAGES = ${JSON.stringify(pages)}`,
    ...FAKE_DOC,
    '',
  ].join('\n');
}

function withPythonPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env['PYTHONPATH'];
  process.env['PYTHONPATH'] = dir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env['PYTHONPATH'];
    else process.env['PYTHONPATH'] = prev;
  });
}

const RECOVERED = 'Recovered page one: a long enough passage of text that PyMuPDF read where pdf-parse could not.';

test('SWP-59: the script imports pymupdf first, falls back to fitz, and writes a result file (never stdout)', () => {
  assert.match(PYMUPDF_SCRIPT, /try:\n {4}import pymupdf\nexcept ImportError:\n {4}import fitz as pymupdf/);
  assert.match(PYMUPDF_SCRIPT, /open\(sys\.argv\[2\], "w", encoding="utf-8"\)/);
  assert.doesNotMatch(PYMUPDF_SCRIPT, /sys\.stdout\.write|print\(/, 'nothing is read from stdout');
});

test('SWP-59: interpreter warnings on stdout/stderr are never returned as PDF text', async (t) => {
  if (python() === null) {
    t.diagnostic('no Python interpreter on PATH: only the null contract can be checked here');
    assert.equal(await pymupdfExtract(Buffer.from('%PDF-1.4\n')), null);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-fakepymupdf-'));
  fs.writeFileSync(path.join(dir, 'pymupdf.py'), fakeModule('pymupdf', [RECOVERED, 'Page two.'], { noisy: true }));
  await withPythonPath(dir, async () => {
    const r = await pymupdfExtract(Buffer.from('%PDF-1.4\n%fake\n'));
    assert.ok(r, 'the fake PyMuPDF answered');
    assert.deepEqual(r.pages, [RECOVERED, 'Page two.']);
    assert.equal(r.numpages, 2);
    assert.equal(r.text, `\n\n${RECOVERED}\n\nPage two.`);
    assert.doesNotMatch(r.text, /deprecated|DeprecationWarning|warning:/i);
    assert.deepEqual(r.info, { Title: 'Recovered Title', Author: 'Ada Lovelace' });
  });
});

test('SWP-59: an old PyMuPDF without the `pymupdf` name is reached through `fitz`', async (t) => {
  if (python() === null) {
    t.diagnostic('no Python interpreter on PATH');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-fakefitz-'));
  fs.writeFileSync(path.join(dir, 'pymupdf.py'), fakeModule('pymupdf', [], { broken: true }));
  fs.writeFileSync(path.join(dir, 'fitz.py'), fakeModule('fitz', ['Text read through the legacy fitz name.'], { noisy: true }));
  await withPythonPath(dir, async () => {
    const r = await pymupdfExtract(Buffer.from('%PDF-1.4\n%fake\n'));
    assert.ok(r);
    assert.deepEqual(r.pages, ['Text read through the legacy fitz name.']);
  });
});

test('SWP-59: extractPdf runs PyMuPDF when pdf-parse THROWS (not only on near-empty text)', async (t) => {
  if (python() === null) {
    t.diagnostic('no Python interpreter on PATH');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-fakepymupdf2-'));
  fs.writeFileSync(path.join(dir, 'pymupdf.py'), fakeModule('pymupdf', [RECOVERED], { noisy: true }));
  await withPythonPath(dir, async () => {
    // pdf-parse (PDF.js 1.10) rejects this: "Invalid PDF structure".
    const out = await extractPdf(Buffer.from('%PDF-1.4\nnot a real pdf body\n'));
    assert.equal(out.engine, 'pymupdf');
    assert.equal(out.imageOnly, false);
    assert.match(out.text, /Recovered page one/);
    assert.doesNotMatch(out.text, /deprecated/);
  });
});

test('SWP-59: a PDF neither extractor finds text in is imageOnly — never text made of warnings', async (t) => {
  const bytes = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'byo', 'image-only.pdf'));
  if (python() === null) {
    t.diagnostic('no Python interpreter on PATH');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-fakepymupdf3-'));
    fs.writeFileSync(path.join(dir, 'pymupdf.py'), fakeModule('pymupdf', [''], { noisy: true }));
    await withPythonPath(dir, async () => {
      const out = await extractPdf(bytes);
      assert.equal(out.imageOnly, true);
      assert.equal(out.text.trim(), '');
    });
  }
  const prev = process.env['PENSMITH_PYTHON'];
  process.env['PENSMITH_PYTHON'] = path.join(REPO, 'no-such-python');
  try {
    const out = await extractPdf(bytes);
    assert.equal(out.imageOnly, true, 'without PyMuPDF too');
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_PYTHON'];
    else process.env['PENSMITH_PYTHON'] = prev;
  }
});
