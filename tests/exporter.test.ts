// tests/exporter.test.ts — bin/lib/exporter.ts exportDraft (DONE-06, DONE-08;
// Phase 21: EXP-01 … EXP-09, D-21-02 … D-21-12).
//
// Phase 21 rewrote the exporter; these tests encode the new contract, and the
// cases that asserted superseded behaviour were updated (21-PLAN §8):
//   - docx / pdf without pandoc produce the requested format with the built-in
//     writer (no Markdown fallback, D-21-02) and stdout names the writer;
//   - md never uses pandoc, even when it is installed;
//   - export/CITATIONS.ris is rendered from the same parsed entries as the
//     export bib (D-21-11), no longer copied from .paper/CITATIONS.ris;
//   - an empty cited bibliography for a citing text is an error (EXP-01);
//   - a numeric style's narrative citation prints the number only, as pandoc
//     does ("[1] argues"), not "Author [1]" (D-21-04, the goldens).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { exportDraft, ExportFormatError, type ExportFormat } from '../bin/lib/exporter.js';
import { pandocArgs } from '../bin/lib/export/pandoc.js';
import { PensmithError, EXIT_ERROR } from '../bin/lib/exit-codes.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';

const CITED_BIB_ENTRY = '@article{x2020,\n\ttitle = {X},\n\tauthor = {Xu, Wei},\n\tjournal = {J},\n\tyear = {2020},\n\tdoi = {10.1/x},\n}\n';
const UNCITED_BIB_ENTRY = '@article{y2021,\n\ttitle = {Y},\n\tdoi = {10.1/y},\n\tnote = {RETRACTED},\n}\n';

function seedPaper(slug: string, draft = '# Draft\n\nA clean draft with no identifying trace [@x2020].\n', bib = CITED_BIB_ENTRY + UNCITED_BIB_ENTRY): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), `pensmith-exporter-${slug}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, draft);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  return { root, inputPath };
}

/** Run with stdout captured through the output sink (PLUG-13). */
async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const { result, output } = await withCapturedOutput(fn);
  return { value: result, out: output };
}

test('exporter (D-21-02): docx without pandoc is a real .docx from the built-in writer, named on stdout — never a Markdown fallback', async () => {
  const { root, inputPath } = seedPaper('docx');
  const { value: res, out } = await captured(() => exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false, style: 'apa' }));
  assert.ok(res.outputPath.endsWith('DRAFT.docx'), res.outputPath);
  assert.equal(res.writer, 'built-in');
  assert.equal(res.pandocUsed, false);
  assert.match(out, /DRAFT\.docx — built-in docx writer — pandoc not found/);
  const zip = await JSZip.loadAsync(readFileSync(res.outputPath));
  assert.ok(zip.file('word/document.xml'), 'a WordprocessingML package');
  assert.ok(!existsSync(join(dirname(res.outputPath), 'DRAFT.md')), 'no Markdown file stands in for the docx');
  assert.notEqual(resolve(dirname(res.outputPath)), resolve(join(root, '.paper')), 'the export dir is distinct from the paper folder');
});

test('exporter (D-21-02, EXP-09): pdf without pandoc, and with pandoc but no PDF engine, is a real PDF from the built-in writer', async () => {
  const { root, inputPath } = seedPaper('pdf');
  const a = await captured(() => exportDraft({ inputPath, format: 'pdf', paperRoot: root, pandocPresent: false, style: 'apa' }));
  assert.ok(readFileSync(a.value.outputPath).subarray(0, 5).toString('latin1') === '%PDF-', 'a PDF');
  assert.match(a.out, /built-in PDF writer — pandoc not found/);
  const b = await captured(() => exportDraft({ inputPath, format: 'pdf', paperRoot: root, pandocPresent: true, pdfEngine: null, style: 'apa' }));
  assert.equal(b.value.writer, 'built-in');
  assert.match(b.out, /built-in PDF writer — pandoc found but no PDF engine/);
  assert.deepEqual(b.value.notes, ['built-in PDF writer — pandoc found but no PDF engine (pdflatex, xelatex, lualatex or tectonic)']);
});

test('exporter (D-21-02): md is always the built-in writer, even with pandoc installed', async () => {
  const { root, inputPath } = seedPaper('md');
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: true, style: 'apa' }));
  assert.equal(res.writer, 'built-in');
  assert.equal(res.pandocUsed, false);
  const md = readFileSync(res.outputPath, 'utf8');
  assert.match(md, /A clean draft with no identifying trace \(Xu, 2020\)\./);
  assert.match(md, /\n## References\n\nXu, W\. \(2020\)\. X\. \*J\*\./);
});

test('exporter (D-21-02): an unknown format is an ExportFormatError (EXIT_ERROR) and writes nothing', async () => {
  const { root, inputPath } = seedPaper('fmt');
  await assert.rejects(
    exportDraft({ inputPath, format: 'html' as ExportFormat, paperRoot: root, pandocPresent: false }),
    (e: unknown) => e instanceof ExportFormatError && e.exitCode === EXIT_ERROR && /md, docx, pdf and latex/.test(e.message),
  );
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing written');
});

test('exporter (DONE-08, EXP-01): export/CITATIONS.bib holds ONLY the cited entries, byte for byte; the library bib is untouched', async () => {
  const { root, inputPath } = seedPaper('bibcopy');
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'apa' }));
  const copiedBib = join(dirname(res.outputPath), 'CITATIONS.bib');
  assert.equal(readFileSync(copiedBib, 'utf8'), CITED_BIB_ENTRY, 'the exported bib is exactly the cited entry');
  assert.equal(res.bibCopied, true);
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), CITED_BIB_ENTRY + UNCITED_BIB_ENTRY, 'the library bib is untouched');
});

test('exporter (D-21-11, EXP-02): export/CITATIONS.ris is rendered from the same entries as the bib — same keys, never copied from .paper/CITATIONS.ris', async () => {
  const { root, inputPath } = seedPaper('ris');
  // A stale, different .paper/CITATIONS.ris: the export never reads it.
  writeFileSync(join(root, '.paper', 'CITATIONS.ris'), 'TY  - JOUR\nID  - x2020\nTI  - A STALE TITLE\nER  - \n');
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'apa' }));
  const ris = readFileSync(join(dirname(res.outputPath), 'CITATIONS.ris'), 'utf8');
  assert.equal(res.risCopied, true);
  assert.deepEqual([...ris.matchAll(/^ID {2}- (.*)$/gm)].map((m) => m[1]), ['x2020'], 'the RIS holds exactly the bib\'s keys');
  assert.match(ris, /^TI {2}- X$/m, 'rendered from the bib entry');
  assert.match(ris, /^AU {2}- Xu, Wei$/m);
  assert.match(ris, /^JO {2}- J$/m, 'a journal article\'s journal is JO');
  assert.ok(!ris.includes('STALE'), 'never the .paper RIS');
});

test('exporter (DONE-08): a document that cites nothing exports no bibliography, and a stale one is removed', async () => {
  const { root, inputPath } = seedPaper('nocite', '# Draft\n\nNo citations here.\n');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  writeFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), UNCITED_BIB_ENTRY);
  writeFileSync(join(root, '.paper', 'export', 'CITATIONS.ris'), 'TY  - JOUR\nID  - y2021\nER  - \n');
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'apa' }));
  assert.equal(res.bibCopied, false);
  assert.equal(res.risCopied, false);
  assert.ok(!existsSync(join(dirname(res.outputPath), 'CITATIONS.bib')));
  assert.ok(!existsSync(join(dirname(res.outputPath), 'CITATIONS.ris')));
  assert.ok(!readFileSync(res.outputPath, 'utf8').includes('References'), 'no bibliography section');
});

test('exporter (EXP-01): a text whose citations are all missing from the bibliography is an error (EXIT_ERROR) and writes nothing', async () => {
  const { root, inputPath } = seedPaper('emptybib', '# Draft\n\nA claim [@nobody1999].\n');
  await assert.rejects(
    exportDraft({ inputPath, format: 'docx', paperRoot: root, pandocPresent: false, style: 'apa' }),
    (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_ERROR && /the text cites nobody1999/.test(e.message),
  );
  const exportDir = join(root, '.paper', 'export');
  assert.ok(!existsSync(exportDir) || readdirSync(exportDir).length === 0, 'nothing exported');
});

test('exporter (bibliography: none): export/CITATIONS.* are left untouched and no bibliography is printed', async () => {
  const { root, inputPath } = seedPaper('nobib', '# Annotated\n\nKuhn, T. S. (1962). A reference written as text.\n');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  writeFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), CITED_BIB_ENTRY);
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'apa', bibliography: 'none' }));
  assert.equal(res.bibCopied, false);
  assert.equal(readFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), 'utf8'), CITED_BIB_ENTRY, 'untouched');
});

// Fixture dir resolved once (spaced-path safe).
const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url));

async function exportKnownGood(format: ExportFormat): Promise<string> {
  const { root, inputPath } = seedPaper(`rend-${format}`, readFileSync(join(FIXTURE_DIR, 'section.md'), 'utf8'), readFileSync(join(FIXTURE_DIR, 'CITATIONS.bib'), 'utf8'));
  const { value: res } = await captured(() => exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false, style: 'apa' }));
  return readFileSync(res.outputPath, 'utf8');
}

test('exporter (REND-01/02/03, CR-02): the known-good fixture renders offline — APA in-text, the [@k p. 2] locator, a References heading, no raw token, no trace', async () => {
  const md = await exportKnownGood('md');
  assert.ok(!md.includes('[@'), md);
  assert.ok(md.includes('(Vaswani et al., 2017)'), md);
  assert.ok(md.includes('(Vaswani et al., 2017, p. 2)'), `the locator is kept:\n${md}`);
  assert.match(md, /\n## References\n\nVaswani, A\., Shazeer, N\., & Parmar, N\. \(2017\)\. Attention is All You Need\./);
  assert.ok(!/pensmith/i.test(md));
});

test('exporter (#19, EXP-09): the offline LaTeX is a standalone article with the rendered citations and a References section', async () => {
  const tex = await exportKnownGood('latex');
  assert.match(tex, /^\\documentclass/);
  assert.match(tex, /\\begin\{document\}[\s\S]*\\end\{document\}\s*$/);
  assert.ok(!tex.includes('[@'), tex);
  assert.ok(tex.includes('Vaswani et~al., 2017') || tex.includes('Vaswani et al., 2017'), tex);
  assert.match(tex, /\\section\*\{References\}/);
});

test('exporter (EXP-06, D-21-09): pandoc runs on relative, neutral names only — input.md, references.json, style.csl, out.<ext>', () => {
  const args = pandocArgs({ text: '', format: 'docx', citations: { entries: [], style: 'apa', referencesTitle: 'References' } });
  // Review round 1: --sandbox (no file or URL pandoc is not given), no
  // implicit figures, and the images.lua filter that prints an image as text.
  assert.deepEqual(args.slice(0, 10), ['input.md', '--sandbox', '--from', 'markdown-yaml_metadata_block-raw_attribute-raw_tex-implicit_figures', '--to', 'docx', '--output', 'out.docx', '--lua-filter', 'images.lua']);
  assert.ok(args.indexOf('--citeproc') < args.indexOf('--csl'), '--citeproc precedes --csl');
  assert.equal(args[args.indexOf('--csl') + 1], 'style.csl');
  assert.equal(args[args.indexOf('--bibliography') + 1], 'references.json');
  for (const a of args) assert.ok(!/[\\/]/.test(a.replace(/^markdown-.*/, '')), `no path in argv: ${a}`);
  const tex = pandocArgs({ text: '', format: 'latex', citations: null });
  assert.ok(tex.includes('--standalone') && tex.includes('--shift-heading-level-by=-1'), 'LaTeX is standalone, the title is \\title');
  const pdf = pandocArgs({ text: '', format: 'pdf', citations: null, pdfEngine: 'tectonic', pdfHeader: { tex: '\\setmainfont{x}\n', fonts: true, unprintable: [] } });
  assert.ok(pdf.includes('--pdf-engine=tectonic') && pdf.includes('--to') && pdf[pdf.indexOf('--to') + 1] === 'latex');
  assert.equal(pdf[pdf.indexOf('--include-in-header') + 1], 'header.tex', 'the engine header is a neutral relative name');
  assert.ok(pdf.includes('--pdf-engine-opt=--only-cached'), 'tectonic downloads nothing under the test runner (sources offline)');
  assert.ok(!pandocArgs({ text: '', format: 'pdf', citations: null, pdfEngine: 'pdflatex' }).includes('--include-in-header'), 'no header when there is none');
});

// Review round 3 of Phase 18 (D-18-40, D-18-42): the offline renderer reads
// citations with the gates' grammar, so every form a gate accepts is rendered —
// never shipped as raw Pandoc syntax, never with its locator dropped.
const FORMS_BIB =
  '@article{lindqvist2012, author={Lindqvist, Anna and Berg, Olof}, title={Margin debt and crashes}, journal={Journal of Finance}, year={2012}, doi={10.1000/x1}}\n' +
  '@article{smith2020, author={Smith, John}, title={Credit}, journal={Econ}, year={2020}, doi={10.1000/x2}}\n';
const FORMS_MD =
  '# Draft\n\nAs @lindqvist2012 argues, margin debt mattered [@lindqvist2012, p. 5]. Then [see @smith2020, chap. 3; -@lindqvist2012] ' +
  'and @smith2020 [p. 7]. Braced [@{smith2020}] and bare [@smith2020, 33-35, emphasis added]. Year only: -@smith2020. A bare number [@smith2020 33].\n';

async function exportForms(format: 'md' | 'latex', style: string): Promise<string> {
  const { root, inputPath } = seedPaper(`forms-${format}-${style}`, FORMS_MD, FORMS_BIB);
  const { value: res } = await captured(() => exportDraft({ inputPath, format, paperRoot: root, pandocPresent: false, style }));
  return readFileSync(res.outputPath, 'utf8');
}

test('exporter (review round 3, carry-over 3): offline md renders every citation form — locators, prefixes, -@k, @{k}, narrative @k, @k [p. n] and [@k 33]', async () => {
  const md = await exportForms('md', 'apa');
  const body = md.split('## References')[0] as string;
  assert.ok(!/@(?:lindqvist2012|smith2020)/.test(body), `no citation stays raw Pandoc syntax:\n${body}`);
  assert.ok(body.includes('As Lindqvist & Berg (2012) argues'), `a narrative citation is "Author (Year)":\n${body}`);
  assert.ok(body.includes('(Lindqvist & Berg, 2012, p. 5)'), `the locator is kept:\n${body}`);
  assert.ok(/see Smith, 2020, Chapter 3/.test(body) && /; 2012\)/.test(body), `prefix, locator label and -@k (year only) are kept:\n${body}`);
  assert.ok(body.includes('Smith (2020, p. 7)'), `@k [p. 7] is a narrative citation with its locator:\n${body}`);
  assert.ok(body.includes('Braced (Smith, 2020)'), `a braced key renders:\n${body}`);
  assert.ok(body.includes('(Smith, 2020, pp. 33–35, emphasis added)'), `a bare-number locator is a page range, the rest a suffix:\n${body}`);
  assert.ok(body.includes('Year only: (2020).'), `a narrative -@k prints the year only:\n${body}`);
  assert.ok(body.includes('A bare number (Smith, 2020, p. 33).'), `[@k 33] is page 33, as pandoc reads it:\n${body}`);
});

test('exporter (D-21-03, D-21-04): a numeric style numbers sources in first-citation order across the document; a narrative citation prints the number, as pandoc does', async () => {
  const tex = await exportForms('latex', 'apa');
  assert.ok(!/@(?:lindqvist2012|smith2020)/.test(tex), `no raw citation in the .tex:\n${tex}`);
  assert.ok(tex.includes('Lindqvist \\& Berg, 2012, p.~5') || tex.includes('Lindqvist \\& Berg, 2012, p. 5'), `the locator is kept in the .tex:\n${tex}`);
  const ieee = await exportForms('md', 'ieee');
  const [body, refs] = ieee.split('## References') as [string, string];
  assert.ok(body.includes('As \\[1\\] argues'), `a numeric narrative citation prints its number (pandoc):\n${body}`);
  assert.ok(body.includes('\\[1, p. 5\\]') && body.includes('\\[2, p. 7\\]') && body.includes('Braced \\[2\\]') && body.includes('\\[2, p. 33\\]'), `each source keeps its first-citation number:\n${body}`);
  assert.ok(/\\\[1\\\] A\. Lindqvist/.test(refs) && /\\\[2\\\] J\. Smith/.test(refs), `the bibliography numbers match:\n${refs}`);
});

test('exporter (D-21-07): a .csl file outside the bundled 8 renders through the same engine', async () => {
  const csl = fileURLToPath(new URL('./fixtures/export/custom-style.csl', import.meta.url));
  const { root, inputPath } = seedPaper('csl', '# Draft\n\nA claim [@x2020, p. 4].\n');
  const { value: res } = await captured(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: csl }));
  const md = readFileSync(res.outputPath, 'utf8');
  assert.ok(md.includes('A claim <<Xu 2020 at 4>>.') || md.includes('A claim \\<\\<Xu 2020 at 4\\>\\>.'), md);
  assert.match(md, /## References\n\nXU, Wei: X\./);
});
