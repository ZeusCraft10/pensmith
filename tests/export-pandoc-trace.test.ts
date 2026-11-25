// tests/export-pandoc-trace.test.ts — real Pandoc exports carry no trace.
//
// Pandoc copies every non-standard metadata field into a .docx's
// docProps/custom.xml. The exporter used to pass absolute --csl and
// --bibliography paths, so every docx that rendered citations shipped the
// user's home folder, the paper folder and the plugin's install path. TeX adds
// its own banner (/PTEX.Fullbanner, /Producer) to a PDF, and Pandoc's LaTeX
// template signs the file (pdfcreator={LaTeX via pandoc}); a LaTeX export
// without --standalone was a fragment that does not compile.
//
// These cases run the real CLI with the real Pandoc and TeX. They are skipped
// when the tool is missing, except in the CI export lane, which installs both
// and sets PENSMITH_REQUIRE_EXPORT_TOOLS=1 so a missing tool fails instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, PDFDict } from 'pdf-lib';
import { compiledPaper, needsTool, runCli } from './lib/export-fixture.js';

const BIB = [
  '@article{zeta2020,',
  '  author = {Zeta, Zed},',
  '  title = {Tidal Sediment Transport},',
  '  journal = {Estuarine Science},',
  '  year = {2020},',
  '  doi = {10.1000/zeta.2020}',
  '}',
  '@article{alpha2019,',
  '  author = {Alpha, Al},',
  '  title = {Barrage Effects on Estuaries},',
  '  journal = {Coastal Engineering},',
  '  year = {2019},',
  '  doi = {10.1000/alpha.2019}',
  '}',
  '',
].join('\n');

function paper(): string {
  return compiledPaper({
    title: 'Tidal Barrages and Sediment',
    bib: BIB,
    sections: [
      { slug: 'intro', title: 'Introduction', draft: 'Barrages trap sediment upstream [@zeta2020, p. 5].\n', sources: ['zeta2020'] },
      { slug: 'effects', title: 'Effects', draft: 'Estuary beds change over decades [@alpha2019; @zeta2020].\n', sources: ['alpha2019', 'zeta2020'] },
    ],
  });
}

/** Every text part of a docx, by name. */
async function docxParts(file: string): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const out = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out.set(name, await entry.async('string'));
  }
  return out;
}

test('done --format docx: no part of the docx names a local path, and custom.xml is gone', needsTool('pandoc'), async () => {
  const root = paper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'docx'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const docx = join(root, '.paper', 'export', 'DRAFT.docx');
  assert.ok(existsSync(docx), 'the docx was exported');

  const parts = await docxParts(docx);
  assert.ok(!parts.has('docProps/custom.xml'), `custom.xml must not ship; parts: ${[...parts.keys()].join(', ')}`);
  const leaks: string[] = [];
  for (const [name, text] of parts) {
    for (const needle of [root, r.home, 'pensmith', '.paper', 'style.csl', 'CITATIONS.bib', '/tmp/', 'LaTeX via pandoc']) {
      if (text.includes(needle)) leaks.push(`${name}: ${needle}`);
    }
    if (/custom-properties/.test(text)) leaks.push(`${name}: custom-properties reference`);
  }
  assert.deepEqual(leaks, [], 'no part may carry a path or a tool name');

  // Metadata parts carry nothing: no names, no application, no edit time.
  const core = parts.get('docProps/core.xml') ?? '';
  const app = parts.get('docProps/app.xml') ?? '';
  assert.doesNotMatch(core, /<dc:(title|creator)>[^<]+</, core);
  assert.doesNotMatch(app, /<(Application|TotalTime|Template|Company)>/, app);

  // Pandoc can read the scrubbed file back, and the paper is intact: title,
  // section headings, rendered citations and the reference list.
  const back = spawnSync('pandoc', [docx, '-s', '-t', 'markdown'], { encoding: 'utf8' });
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /title: Tidal Barrages and Sediment/);
  assert.match(back.stdout, /^# Introduction/m);
  assert.match(back.stdout, /Barrages trap sediment upstream \(Zeta, 2020, p\. 5\)/);
  assert.match(back.stdout, /^# References/m);
  assert.doesNotMatch(back.stdout, /author:|date:/, 'no empty author or date lines');
});

test('done --format latex: a standalone .tex that compiles and carries no Pandoc stamp', needsTool('pandoc'), async (t) => {
  const root = paper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'latex'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const texPath = join(root, '.paper', 'export', 'DRAFT.tex');
  const tex = readFileSync(texPath, 'utf8');
  assert.match(tex, /\\documentclass/, 'a standalone document has a preamble');
  assert.match(tex, /\\begin\{document\}/);
  assert.match(tex, /\\title\{Tidal Barrages and Sediment\}/);
  assert.doesNotMatch(tex, /via pandoc|pensmith/i);
  assert.ok(!tex.includes(root), 'no local path');

  const pdflatex = needsTool('pdflatex');
  if (pdflatex.skip) {
    t.diagnostic(pdflatex.skip);
    return;
  }
  const build = mkdtempSync(join(tmpdir(), 'pensmith-tex-build-'));
  copyFileSync(texPath, join(build, 'paper.tex'));
  const c = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'paper.tex'], { cwd: build, encoding: 'utf8', timeout: 120_000 });
  assert.equal(c.status, 0, `pdflatex failed:\n${c.stdout.slice(-2000)}`);
  assert.ok(existsSync(join(build, 'paper.pdf')));
});

test('done --format pdf: the info dictionary and every TeX banner are gone', { skip: needsTool('pandoc').skip || needsTool('pdflatex').skip }, async () => {
  const root = paper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'pdf'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const pdfPath = join(root, '.paper', 'export', 'DRAFT.pdf');
  const bytes = readFileSync(pdfPath);
  const raw = bytes.toString('latin1');
  for (const stamp of ['PTEX.Fullbanner', 'This is pdfTeX', '/Producer', '/Creator', 'xmpmeta', 'pensmith']) {
    assert.ok(!raw.includes(stamp), `the PDF still contains ${stamp}`);
  }
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info);
  assert.ok(!(info instanceof PDFDict) || info.keys().length === 0, `info dictionary is not empty: ${String(info)}`);
  assert.equal(pdf.getPageCount() > 0, true);
});

test('done --format docx: the export folder holds only the deliverable and the cited bibliography', needsTool('pandoc'), () => {
  const root = paper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'docx'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.deepEqual(readdirSync(join(root, '.paper', 'export')).sort(), ['CITATIONS.bib', 'CITATIONS.ris', 'DRAFT.docx']);
  // No staging folder is left behind in .paper/.
  assert.deepEqual(readdirSync(join(root, '.paper')).filter((n) => n.startsWith('.export-')), []);
});
