// tests/exporter.test.ts — exportDraft's contract without Pandoc.
//
//   - The export goes to a distinct folder (default .paper/export/), never onto
//     the source DRAFT.md.
//   - A .docx or .pdf without Pandoc is refused with a typed error that names
//     Pandoc. It used to be swapped for a Markdown file that was reported as
//     the export.
//   - The exported CITATIONS.bib and CITATIONS.ris are built from the works
//     the paper cites. They used to be copies of the
//     research-time files, which hold every uncited candidate.
//   - Offline rendering resolves every citation and appends the reference
//     list, on the committed known-good fixture.
// Real Pandoc output is covered by tests/export-pandoc-trace.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDraft, ExportError } from '../bin/lib/exporter.js';

const BIB = [
  '@article{x2020, author={Ex, Amy}, title={X Marks the Spot}, journal={J}, year={2020}, doi={10.1000/x}}',
  '@article{y2021, author={Why, Bo}, title={An Uncited Work}, journal={J}, year={2021}, doi={10.1000/y}}',
  '',
].join('\n');

function seedPaper(slug: string, draft = '# Draft\n\nA clean draft that cites one work [@x2020].\n'): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), `pensmith-exporter-${slug}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, draft);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  return { root, inputPath };
}

test('exporter: a docx or pdf without Pandoc is refused with a typed error and nothing is written', async () => {
  for (const format of ['docx', 'pdf'] as const) {
    const { root, inputPath } = seedPaper(`nopandoc-${format}`);
    await assert.rejects(
      exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false }),
      (err: unknown) => err instanceof ExportError && err.kind === 'missing-tool' && /Pandoc is not installed/.test(err.message),
    );
    assert.ok(!existsSync(join(root, '.paper', 'export')), `${format}: no stand-in file is exported`);
  }
});

test('exporter: the export goes to a distinct folder and never overwrites the source DRAFT.md', async () => {
  const { root, inputPath } = seedPaper('distinct');
  const before = readFileSync(inputPath, 'utf8');
  const res = await exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
  assert.ok(existsSync(res.outputPath));
  assert.notEqual(resolve(res.outputPath), resolve(inputPath));
  assert.equal(resolve(dirname(res.outputPath)), resolve(join(root, '.paper', 'export')));
  assert.equal(readFileSync(inputPath, 'utf8'), before, 'the source is untouched');
});

test('exporter: an export folder that would replace the manuscript or the canonical bibliography is refused', async () => {
  const { root, inputPath } = seedPaper('collide');
  const draft = readFileSync(inputPath, 'utf8');
  const canonicalBib = join(root, '.paper', 'CITATIONS.bib');
  const bib = readFileSync(canonicalBib, 'utf8');
  const refused = (err: unknown): boolean => err instanceof ExportError && err.kind === 'invalid-input';
  // The paper folder itself, however it is spelled.
  for (const outputDir of [join(root, '.paper'), `${join(root, '.paper', 'sections')}/..`, `${join(root, '.paper')}/`]) {
    await assert.rejects(exportDraft({ inputPath, outputDir, format: 'md', paperRoot: root, pandocPresent: false }), refused, outputDir);
  }
  // The folder that holds the manuscript being exported.
  const elsewhere = mkdtempSync(join(tmpdir(), 'pensmith-exporter-elsewhere-'));
  const manuscript = join(elsewhere, 'FINAL.md');
  writeFileSync(manuscript, draft);
  await assert.rejects(exportDraft({ inputPath: manuscript, outputDir: elsewhere, format: 'md', paperRoot: root, pandocPresent: false }), refused);
  assert.equal(readFileSync(inputPath, 'utf8'), draft, 'the source DRAFT.md is untouched');
  assert.equal(readFileSync(manuscript, 'utf8'), draft, 'the manuscript is untouched');
  assert.equal(readFileSync(canonicalBib, 'utf8'), bib, 'the canonical CITATIONS.bib is untouched');
});

test('exporter: the exported CITATIONS.bib holds the cited works only', async () => {
  const { root, inputPath } = seedPaper('bib');
  const res = await exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
  assert.equal(res.bibPath, join(root, '.paper', 'export', 'CITATIONS.bib'));
  const bib = readFileSync(res.bibPath!, 'utf8');
  assert.match(bib, /@article\{x2020,/);
  assert.doesNotMatch(bib, /y2021|An Uncited Work/, 'an uncited work is not exported');
  assert.deepEqual(res.citedKeys, ['x2020']);
});

test('exporter: the exported CITATIONS.ris is built from the cited works, never copied from research', async () => {
  const { root, inputPath } = seedPaper('ris');
  writeFileSync(join(root, '.paper', 'CITATIONS.ris'), 'TY  - JOUR\nID  - fabricated\nTI  - Fake\nER  - \n');
  const res = await exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
  const ris = readFileSync(res.risPath!, 'utf8');
  assert.match(ris, /^ID {2}- x2020$/m);
  assert.match(ris, /^DO {2}- 10\.1000\/x$/m);
  assert.doesNotMatch(ris, /fabricated|y2021/);
});

test('exporter: a paper that cites nothing ships no bibliography files', async () => {
  const { root, inputPath } = seedPaper('nocites', '# Draft\n\nNo citations here.\n');
  const res = await exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false });
  assert.equal(res.bibPath, undefined);
  assert.equal(res.risPath, undefined);
  assert.ok(!existsSync(join(root, '.paper', 'export', 'CITATIONS.ris')));
  assert.equal(readFileSync(res.outputPath, 'utf8'), '# Draft\n\nNo citations here.\n', 'a paper without citations exports as written');
});

// ---------------------------------------------------------------------------
// The committed known-good fixture, rendered offline in APA
// ---------------------------------------------------------------------------

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url));

async function exportFixture(format: 'md' | 'latex'): Promise<string> {
  const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'pensmith-rend-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, fixtureMd);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8'));
  const res = await exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false, style: 'apa' });
  return readFileSync(res.outputPath, 'utf8');
}

test('exporter: offline — no raw [@key], APA in-text forms, a References list naming Vaswani', async () => {
  const fixtureMd = readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8');
  assert.ok(fixtureMd.includes('[@vaswani2017attention p. 2]'), 'the fixture carries a locator citation');
  const rendered = await exportFixture('md');
  assert.ok(!rendered.includes('[@'), `raw [@key] survived:\n${rendered}`);
  assert.ok(rendered.includes('(Vaswani et al., 2017)'), rendered);
  assert.ok(rendered.includes('(Vaswani et al., 2017, p. 2)'), `the locator is kept:\n${rendered}`);
  assert.ok(rendered.includes('## References'), rendered);
  assert.match(rendered, /Vaswani, A\., Shazeer, N\., & Parmar, N\. \(2017\)/, rendered);
  assert.ok(!rendered.toLowerCase().includes('pensmith'), 'zero trace');
  assert.doesNotMatch(rendered, /Test entry with accent/, 'a bib note is not part of the reference');
});

test('exporter (#19): offline LaTeX resolves citations and emits a References section', async () => {
  const tex = await exportFixture('latex');
  assert.ok(!tex.includes('[@'), `raw [@key] survived in .tex:\n${tex}`);
  assert.ok(tex.includes('Vaswani'), tex);
  assert.match(tex, /\\section\{References\}/, tex);
  assert.match(tex, /\\begin\{document\}/);
});

test('exporter: offline LaTeX escapes a backslash once, with no escaped braces after it', async () => {
  // \textbackslash\{\} (the braces escaped a second time) prints a stray "{}"
  // after every backslash under pdflatex; \textbackslash{} prints the backslash.
  const { root, inputPath } = seedPaper('backslash', '# Draft\n\nThe files live in C:\\Temp\\file today.\n');
  const res = await exportDraft({ inputPath, format: 'latex', paperRoot: root, pandocPresent: false });
  const tex = readFileSync(res.outputPath, 'utf8');
  assert.ok(tex.includes('C:\\textbackslash{}Temp\\textbackslash{}file'), tex);
  assert.ok(!tex.includes('\\textbackslash\\{\\}'), tex);
});

// An export folder on another disk (a USB stick, a synced drive) cannot be
// reached by rename(2) from the staging folder in .paper/. /dev/shm is a
// separate tmpfs on Linux; elsewhere there is no second disk to try.
const SHM = '/dev/shm';
const otherDisk = existsSync(SHM) && statSync(SHM).dev !== statSync(tmpdir()).dev;
test('exporter: an export folder on another disk receives the export', { skip: !otherDisk && 'no second filesystem' }, async () => {
  const { root, inputPath } = seedPaper('otherdisk');
  const outputDir = mkdtempSync(join(SHM, 'pensmith-export-'));
  const res = await exportDraft({ inputPath, outputDir, format: 'md', paperRoot: root, pandocPresent: false });
  assert.equal(dirname(res.outputPath), outputDir);
  assert.match(readFileSync(res.outputPath, 'utf8'), /\(Ex, 2020\)/);
  assert.ok(existsSync(join(outputDir, 'CITATIONS.bib')));
});
