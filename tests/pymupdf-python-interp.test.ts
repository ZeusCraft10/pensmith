// tests/pymupdf-python-interp.test.ts — audit #37 regression.
//
// The PyMuPDF fallback hardcoded the interpreter as `python3`, which is usually
// absent on a standard Windows install (where it's `python` or the `py`
// launcher) — so the fallback never ran there even with Python + fitz present.
// pythonCandidates() now returns an ordered candidate list (Windows tries
// `python`/`py` first), and pymupdfShellout tries each until one works.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonCandidates } from '../bin/lib/pymupdf-shellout.js';

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env['PENSMITH_PYTHON'];
  if (value === undefined) delete process.env['PENSMITH_PYTHON'];
  else process.env['PENSMITH_PYTHON'] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_PYTHON'];
    else process.env['PENSMITH_PYTHON'] = prev;
  }
}

test('audit #37: without an override, the candidate list includes BOTH python3 and python', () => {
  const cands = withEnv(undefined, () => pythonCandidates());
  // The crux of the fix: it no longer tries ONLY python3, so a Windows box (no
  // python3) still reaches `python` / `py`.
  assert.ok(cands.includes('python3'), 'must still try python3');
  assert.ok(cands.includes('python'), 'must ALSO try python (Windows / venv installs)');
  assert.ok(cands.length >= 2, 'more than one interpreter candidate');
});

test('audit #37: PENSMITH_PYTHON override is the SOLE candidate (test/operator pin)', () => {
  const cands = withEnv('/nonexistent/python', () => pythonCandidates());
  assert.deepEqual(cands, ['/nonexistent/python'], 'an explicit override pins exactly one interpreter');
});

test('audit #37: the first candidate matches the current platform convention', () => {
  const cands = withEnv(undefined, () => pythonCandidates());
  const expectedFirst = process.platform === 'win32' ? 'python' : 'python3';
  assert.equal(cands[0], expectedFirst, `on ${process.platform} the first candidate should be ${expectedFirst}`);
});
