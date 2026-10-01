// tests/pdf-writer.test.ts — the built-in PDF writer (EXP-09, D-21-10).
//
// Without pandoc (or without a PDF engine) a requested PDF is still a PDF:
// pdf-lib with the shipped OFL serif family (Liberation Serif, four faces,
// subset on embed), headings, wrapped paragraphs, emphasis, block quotes,
// lists, a table, page footnotes that continue on the next page when they do
// not fit, and the references — real text that pdf-text.ts extracts, with an
// empty /Info (no Producer, no Creator) and no XMP.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { pdfFontPaths, writePdf } from '../bin/lib/export/pdf-writer.js';
import { extractPdf } from '../bin/lib/pdf-text.js';
import { scanExportFile } from '../bin/lib/export/zero-trace.js';
import { sampleDocument, SAMPLE_MD } from './helpers/export-doc.js';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';

test('EXP-09: the shipped font family and its licence are in the plugin (four faces, OFL.txt)', () => {
  const paths = pdfFontPaths();
  assert.equal(paths.length, 4);
  for (const p of paths) assert.ok(existsSync(p), p);
  const ofl = readFileSync(join(paths[0] as string, '..', 'OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE/);
  assert.match(ofl, /Reserved Font Name Liberation/);
});

test('EXP-09: the built-in PDF holds the title, headings, citations and references as extractable text, with no Producer, no Creator and no XMP', async () => {
  const { doc } = await sampleDocument('apa');
  const bytes = await writePdf(doc);
  const out = await extractPdf(bytes);
  const text = out.text.replace(/\s+/g, ' ');
  for (const needle of ['The Paradigm & the Bank: 100% “Growth”', 'Introduction', 'Discussion', 'References', '(Kuhn, 1962)', '(Lindqvist & Berg, 2012, p. 150)', 'Kuhn, T. S. (1962). The Structure of Scientific Revolutions', 'Costs rose by 5% – or $3 per unit']) {
    assert.ok(text.includes(needle), `"${needle}" in the extracted text:\n${text}`);
  }
  assert.equal(out.xmp, null, 'no XMP');
  assert.ok(!('Producer' in out.info) || out.info['Producer'] === '', JSON.stringify(out.info));
  assert.ok(!('Creator' in out.info) || out.info['Creator'] === '', JSON.stringify(out.info));
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.catalog.get(PDFName.of('Metadata')), undefined);
  // The fonts are embedded subsets of the shipped family.
  const fonts: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Font' && obj.get(PDFName.of('Subtype'))?.toString() === '/Type0') {
      fonts.push(String(obj.get(PDFName.of('BaseFont'))));
    }
  }
  assert.ok(fonts.length >= 3 && fonts.every((f) => /LiberationSerif/.test(f)), fonts.join(', '));
  assert.ok(bytes.length < 400_000, `subset embedding keeps the file small (${bytes.length} bytes)`);
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-pdfw-'));
  writeFileSync(join(dir, 'DRAFT.pdf'), bytes);
  assert.deepEqual(await scanExportFile(join(dir, 'DRAFT.pdf'), { paperRoot: dir }), [], 'the zero-trace scan passes');
});

test('EXP-09 / D-21-10: a note style puts its notes at the foot of the page, and a note that does not fit continues at the foot of the next page', async () => {
  // Many paragraphs, each with a long note: some note must start near a page's
  // foot and continue on the next page.
  const filler = 'Growth models changed after the war and the evidence accumulated across many decades of careful study';
  const longSuffix = Array.from({ length: 30 }, (_v, i) => `remark${i}`).join(' ');
  const paras = Array.from({ length: 24 }, (_v, i) => `${filler} in case ${i} [@kuhn1962, p. ${i + 1}, ${longSuffix} end${i}].`);
  const md = `# Notes Everywhere\n\n## One\n\n${paras.join('\n\n')}\n`;
  const { doc } = await sampleDocument('chicago-notes-bib', md);
  const out = await extractPdf(await writePdf(doc));
  assert.ok(out.numpages >= 3, `${out.numpages} pages`);
  const pages = out.pages.map((p) => p.replace(/\s+/g, ' '));
  // Every note is complete somewhere in the document.
  const all = pages.join(' ');
  for (let i = 0; i < 24; i++) assert.ok(all.includes(`end${i}`), `note ${i + 1} is complete`);
  // At least one note runs from one page's foot onto the next page's foot.
  const split = Array.from({ length: 24 }, (_v, i) => i).filter((i) => {
    const pageOf = (needle: string): number => pages.findIndex((p) => p.includes(needle));
    const startPage = pages.findIndex((p) => new RegExp(`p\\. ${i + 1}, remark0\\b`).test(p) || new RegExp(`${i + 1}, remark0\\b`).test(p));
    return startPage !== -1 && pageOf(`end${i}`) === startPage + 1;
  });
  assert.ok(split.length > 0, 'a note continues on the next page');
  // Body text never runs into the footnote area: each page's text puts the
  // page number last.
  for (const [k, p] of pages.entries()) assert.match(p.trim(), new RegExp(`${k + 1}$`), `page ${k + 1} ends with its number`);
});

test('EXP-09: every construct of the sample (quote, lists, table, code, rule, Greek) is laid out without loss of text', async () => {
  const { doc } = await sampleDocument('ieee', SAMPLE_MD);
  const text = (await extractPdf(await writePdf(doc))).text.replace(/\s+/g, ' ');
  for (const needle of ['Trust can be measured', 'First point with code', 'A nested point', 'One', 'Two', 'Region', 'Growth', 'East', '4.2', 'x = f(y)', 'Greek α and β', '[1]']) {
    assert.ok(text.includes(needle), `"${needle}" in:\n${text}`);
  }
});

// Review round 3: a word longer than the line (a long URL, a hash, a base64
// string, a long code line) is cut from per-character advances summed once —
// re-measuring every shorter prefix took 110 s for 3,200 characters.
test('review r3: a 10,000-character token is laid out within seconds, every character kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pdf-long-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@book{kuhn1962, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, publisher = {University of Chicago Press}, year = {1962}}\n');
  const token = Array.from({ length: 10_000 }, (_v, i) => 'abcdefghijklmnopqrstuvwxyz0123456789'[i % 36]).join('');
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, `A ${token} word [@kuhn1962].\n\n\`\`\`\n${token.slice(0, 4000)}\n\`\`\`\n`);
  const started = Date.now();
  const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'pdf', paperRoot: root, pandocPresent: false, style: 'apa' }));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 20_000, `the export took ${elapsed} ms`);
  // The page numbers (a line of digits at each page's foot) are not the token's.
  const text = (await extractPdf(readFileSync(result.outputPath))).text.split('\n').filter((l) => !/^\s*\d+\s*$/.test(l)).join('').replace(/\s+/g, '');
  assert.ok(text.includes(token), 'the token is kept whole across its lines and pages');
  assert.ok(text.includes(token.slice(0, 4000)), 'the code line too');
});
