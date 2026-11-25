// tests/export-failures.test.ts — an export that fails says why and ships nothing.
//
// The exporter used to catch every Pandoc or scrub failure, report it as
// "Pandoc/PDF engine not available", write a Markdown file instead and exit
// 0: `--format pdf` "succeeded" with a .md, a Pandoc error was hidden, and a
// docx whose scrub failed stayed in the export folder unscrubbed. Old
// DRAFT.docx/.pdf files from earlier runs also stayed next to the new export.
//
// These cases drive the real CLI with a PATH that has no Pandoc, or a fake
// Pandoc that fails in a chosen way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compiledPaper, fakePandocPath, pathWithoutPandoc, runCli } from './lib/export-fixture.js';

const BIB = '@article{zeta2020, author = {Zeta, Zed}, title = {Tidal Sediment Transport}, journal = {J}, year = {2020}, doi = {10.1000/zeta}}\n';

async function paper(): Promise<string> {
  return compiledPaper({
    title: 'Tidal Barrages',
    bib: BIB,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'Barrages trap sediment [@zeta2020].\n', sources: ['zeta2020'] }],
  });
}

function exportDir(root: string): string[] {
  const d = join(root, '.paper', 'export');
  return existsSync(d) ? readdirSync(d).sort() : [];
}

const POSIX = process.platform !== 'win32';

for (const format of ['docx', 'pdf'] as const) {
  test(`done --format ${format} without Pandoc refuses (exit 2), names Pandoc, and writes no Markdown stand-in`, async () => {
    const root = await paper();
    const r = runCli(['done', '--yolo', '--raw', '--format', format], root, { PATH: pathWithoutPandoc() });
    assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout + r.stderr, /Pandoc is not installed/);
    assert.match(r.stdout + r.stderr, /--format md/, 'the message says how to export without Pandoc');
    assert.deepEqual(exportDir(root), [], 'nothing is exported');
    assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'the paper is not marked done');
  });
}

test('done with no --format and no Pandoc exports Markdown and says so', async () => {
  const root = await paper();
  const r = runCli(['done', '--yolo', '--raw'], root, { PATH: pathWithoutPandoc() });
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /Pandoc is not installed, so the paper was exported as Markdown/);
  assert.ok(exportDir(root).includes('DRAFT.md'), exportDir(root).join(', '));
});

test('done --format docx: a Pandoc error is reported with its own message and exits 1', { skip: !POSIX }, async () => {
  const root = await paper();
  const PATH = fakePandocPath('echo "pandoc: Could not parse CSL style: unexpected element" >&2; exit 64');
  const r = runCli(['done', '--yolo', '--raw', '--format', 'docx'], root, { PATH });
  assert.equal(r.status, 1, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /Could not parse CSL style/);
  assert.doesNotMatch(r.stdout + r.stderr, /not available|markdown-only fallback/i);
  assert.deepEqual(exportDir(root), []);
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')));
});

test('done --format pdf: a missing TeX engine is a refusal that says so (exit 2)', { skip: !POSIX }, async () => {
  const root = await paper();
  const PATH = fakePandocPath('echo "pdflatex not found. Please select a different --pdf-engine or install pdflatex" >&2; exit 47');
  const r = runCli(['done', '--yolo', '--raw', '--format', 'pdf'], root, { PATH });
  assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /PDF engine/);
  assert.deepEqual(exportDir(root), []);
});

test('done --format docx: a file the scrub cannot clean is never left in the export folder', { skip: !POSIX }, async () => {
  const root = await paper();
  // Pandoc "succeeds" but writes something that is not a docx: the metadata
  // scrub cannot run, so the file must not ship.
  const PATH = fakePandocPath(
    'out=""; while [ $# -gt 0 ]; do if [ "$1" = "--output" ]; then out="$2"; fi; shift; done; echo "not a zip, $HOME" > "$out"; exit 0',
  );
  const r = runCli(['done', '--yolo', '--raw', '--format', 'docx'], root, { PATH });
  assert.notEqual(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.deepEqual(exportDir(root), [], 'the unscrubbed file must not ship');
  assert.deepEqual(readdirSync(join(root, '.paper')).filter((n) => n.startsWith('.export-')), [], 'no staging folder is left');
});

test('done: files from an earlier export do not stay next to the new one', async () => {
  const root = await paper();
  const dir = join(root, '.paper', 'export');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DRAFT.pdf'), 'stale pdf from yesterday');
  writeFileSync(join(dir, 'DRAFT.docx'), 'stale docx from yesterday');
  writeFileSync(join(dir, 'CITATIONS.ris'), 'TY  - JOUR\nID  - stale\nER  - \n');
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.deepEqual(exportDir(root), ['CITATIONS.bib', 'CITATIONS.ris', 'DRAFT.md']);
});
