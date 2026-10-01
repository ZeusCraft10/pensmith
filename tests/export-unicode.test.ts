// tests/export-unicode.test.ts — every PDF path shows a paper's Greek, math
// and typographic characters, prints what no shipped font has as `?` and SAYS
// so; pandoc reaches nothing the gate did not read (EXP-09, review round 1).
//
// The review found a PDF that silently lost characters on every path: pandoc
// with tectonic / xelatex / lualatex used Latin Modern (Greek, ≥ and ₀
// vanished), pandoc with pdflatex stopped on β (and the run fell back to the
// built-in writer with a note showing pandoc's argv), and the built-in PDF
// writer drew U+2011 and CJK as `?` with no word. It also found pandoc
// fetching a draft's image URL (outside the http.ts egress gate) even with
// PENSMITH_OFFLINE=1. Each case below is the fix's acceptance check; the
// pandoc and TeX cases run when pandoc / an engine is on PATH (CI installs
// pandoc; with CI=true a missing pandoc fails).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { exportDraft, type ExportFormat } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { extractPdfText } from '../bin/lib/pdf-text.js';
import { detectPdfEngine, pandocFailure, pdfEngineHeader } from '../bin/lib/export/pandoc.js';
import { escapeLatex, latexCharFor, pdfTexUnprintable, writeLatex } from '../bin/lib/export/latex-writer.js';
import { drawableText, pdfUnprintable } from '../bin/lib/export/glyphs.js';
import { buildExportDocument } from '../bin/lib/export/document.js';
import { prepareText } from '../bin/lib/export/render.js';
import { parseBibEntries } from '../bin/lib/citations.js';
import { requirePandoc } from './helpers/pandoc-oracle.js';
import { startHttpServer } from './helpers/local-servers/transport.js';

const BIB =
  '@article{x2020, author = {Xu, Wei}, title = {Growth in China}, journal = {J}, year = {2020}, doi = {10.1/x}}\n' +
  '@article{y2007, author = {Young, Ann}, title = {Older Work}, journal = {K}, year = {2007}, doi = {10.1/y}}\n';

const UNICODE =
  '# Données et β-Amyloid: 注意力 Across Fields\n\n## One\n\n' +
  'R₀ ≥ 2 was estimated and ΔT ≈ 3 days (SARS‑CoV‑2) [@x2020, p. 4]. First, the 注意力 (attention).\n\n' +
  '| a | b |\n|---|---|\n| cell with cite [@y2007] | z |\n';

function paper(text: string): { root: string; inputPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-unicode-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, text);
  return { root, inputPath };
}

async function run(text: string, format: ExportFormat, o: { pandoc: boolean; style?: string; engine?: string | null }): Promise<{ file: string; writer: string; notes: readonly string[]; output: string }> {
  const { root, inputPath } = paper(text);
  const { result, output } = await withCapturedOutput(() =>
    exportDraft({ inputPath, paperRoot: root, format, pandocPresent: o.pandoc, style: o.style ?? 'apa', ...(o.engine !== undefined ? { pdfEngine: o.engine } : {}) }),
  );
  return { file: result.outputPath, writer: result.writer, notes: result.notes, output };
}

test('EXP-09 (review r1): drawableText folds what the font lacks and records only what it cannot fold', () => {
  const missing = new Set<string>();
  const has = (cp: number): boolean => cp < 0x2000 || cp === 0x2010;
  assert.equal(drawableText('SARS‑CoV‑2 a b​c 注', has, missing), 'SARS‐CoV‐2 a bc ?');
  assert.deepEqual([...missing], ['注']);
  // The shipped Liberation Serif shows Greek, the common math symbols and sub/superscript digits.
  assert.deepEqual(pdfUnprintable([...'β≥≈ΔR₀²‑']), []);
  assert.deepEqual(pdfUnprintable([...'注意力']), ['力', '意', '注']);
});

test('EXP-09 (review r1): pdfLaTeX gets a declaration for every character it cannot print; a XeTeX-family engine gets Liberation Serif and `?` for what it lacks', () => {
  const chars = [...'Données β ≥ ≈ Δ R₀ x² SARS‑CoV 注'];
  const pdf = pdfEngineHeader('pdflatex', chars);
  assert.equal(pdf.fonts, false);
  assert.match(pdf.tex, /\\DeclareUnicodeCharacter\{03B2\}\{\\ensuremath\{\\beta\}\}/);
  assert.match(pdf.tex, /\\DeclareUnicodeCharacter\{2265\}\{\\ensuremath\{\\geq\}\}/);
  assert.match(pdf.tex, /\\DeclareUnicodeCharacter\{2080\}\{\\textsubscript\{0\}\}/);
  assert.match(pdf.tex, /\\DeclareUnicodeCharacter\{2011\}\{-\}/);
  assert.match(pdf.tex, /\\DeclareUnicodeCharacter\{6CE8\}\{\?\}/);
  assert.doesNotMatch(pdf.tex, /\{00E9\}/, 'é needs no declaration');
  assert.deepEqual(pdf.unprintable, ['注']);
  for (const engine of ['xelatex', 'lualatex', 'tectonic']) {
    const x = pdfEngineHeader(engine, chars);
    assert.equal(x.fonts, true);
    assert.match(x.tex, /^\\setmainfont\[Path=\.\/,BoldFont=LiberationSerif-Bold\.ttf,ItalicFont=LiberationSerif-Italic\.ttf,BoldItalicFont=LiberationSerif-BoldItalic\.ttf\]\{LiberationSerif-Regular\.ttf\}$/m);
    assert.ok(x.tex.includes('\\lccode`\\~=`注\\lowercase{\\endgroup\\def~{?}}\\catcode`注=\\active'), 'CJK prints as ?');
    assert.ok(x.tex.includes('\\lccode`\\~=`‑\\lowercase{\\endgroup\\def~{‐}}'), 'U+2011 folds to the hyphen the font has');
    assert.doesNotMatch(x.tex, /`β/, 'Greek is in the font');
    assert.deepEqual(x.unprintable, ['注']);
  }
  assert.equal(latexCharFor('₂'), '\\textsubscript{2}');
  assert.equal(escapeLatex('CO₂ and SARS‑CoV'), 'CO\\textsubscript{2} and SARS-CoV');
  assert.deepEqual(pdfTexUnprintable([...'β₂‑注']), ['注']);
});

test('EXP-09 (review r1): a failed pandoc run is reported by its TeX error, never by its argv', () => {
  const e = Object.assign(new Error('Command failed: pandoc input.md --sandbox --from markdown --to latex --output out.pdf --pdf-engine=pdflatex'), {
    stderr: 'Error producing PDF.\n! LaTeX Error: Unicode character β (U+03B2)\n               not set up for use with LaTeX.\n\nSee the LaTeX manual.\nl.56 The β\n',
  });
  assert.equal(pandocFailure(e), '! LaTeX Error: Unicode character β (U+03B2) (l.56 The β)');
  assert.equal(pandocFailure(Object.assign(new Error('Command failed: pandoc x'), { stderr: '[WARNING] something\npandoc: style.csl: openBinaryFile: does not exist\n' })), 'pandoc: style.csl: openBinaryFile: does not exist');
  assert.equal(pandocFailure(new Error('Command failed: pandoc input.md --to docx')), 'pandoc exited with an error and printed no reason');
});

test('EXP-09 (review r1): the built-in PDF shows Greek, math and U+2011, prints CJK as ? and names it; a note cited in a table cell reaches the foot', async () => {
  const r = await run(UNICODE, 'pdf', { pandoc: false, style: 'chicago-notes-bib' });
  assert.equal(r.writer, 'built-in');
  const text = await extractPdfText(readFileSync(r.file));
  for (const s of ['β-Amyloid', 'R₀ ≥ 2', 'ΔT ≈ 3', 'SARS‐CoV‐2', '??? (attention)']) assert.ok(text.includes(s), `${s} in:\n${text}`);
  assert.match(r.output, /note — 3 character\(s\) the built-in PDF font \(Liberation Serif\) has no glyph for were printed as \?: 力 \(U\+529B\), 意 \(U\+610F\), 注 \(U\+6CE8\)/);
  // The table cell's note (2) is at the foot like the body's note (1).
  assert.match(text, /2\s*Ann Young, “Older Work,” K, 2007/);
  assert.match(text, /1\s*Wei Xu, “Growth in China,” J, 2020, 4/);
});

test('EXP-09 (review r1): the built-in LaTeX puts a heading\'s and a table cell\'s note in \\footnotetext (pdfLaTeX stopped on a note in a heading) and names what pdfLaTeX prints as ?', async () => {
  const text = '# A Paper\n\n## Sub heading with a note [@x2020]\n\nBody text.\n\n| a | b |\n|---|---|\n| cell with cite [@y2007] | z |\n\nCJK 注 here.\n';
  const entries = parseBibEntries(BIB).entries;
  const prep = await prepareText(text, entries, 'chicago-notes-bib');
  const tex = writeLatex(buildExportDocument(prep, { withBibliography: true }));
  assert.match(tex, /\\section\[Sub heading with a note\]\{Sub heading with a note\\footnotemark\{\}\}\n\\footnotetext\[1\]\{Wei Xu/);
  assert.match(tex, /cell with cite\\footnotemark\{\} & z/);
  assert.match(tex, /\\end\{center\}\n\\footnotetext\[2\]\{Ann Young/);
  const r = await run(text, 'latex', { pandoc: false, style: 'chicago-notes-bib' });
  assert.match(r.output, /note — 1 character\(s\) pdfLaTeX cannot print are written to print as \? under pdfLaTeX: 注 \(U\+6CE8\)/);
  let pdflatex = false;
  try {
    execFileSync('pdflatex', ['--version'], { stdio: 'ignore', timeout: 20_000 });
    pdflatex = true;
  } catch {
    /* compiled where pdflatex is installed */
  }
  if (pdflatex) {
    const dir = mkdtempSync(join(tmpdir(), 'pensmith-tex-notes-'));
    writeFileSync(join(dir, 'paper.tex'), readFileSync(r.file));
    for (let i = 0; i < 2; i += 1) execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'paper.tex'], { cwd: dir, stdio: 'ignore', timeout: 300_000 });
    // pdfTeX's Computer Modern text extracts without spaces: compare without them.
    const pdfText = (await extractPdfText(readFileSync(join(dir, 'paper.pdf')))).replace(/\s+/g, '');
    assert.match(pdfText, /2AnnYoung,[^A-Za-z]*OlderWork/, 'the table cell\'s note text is printed');
    assert.match(pdfText, /1WeiXu,[^A-Za-z]*GrowthinChina/, 'the heading\'s note text is printed');
  }
});

test('EXP-09 (review r1): the pandoc PDF shows Greek and math on the engine found, names what it prints as ?, and never falls back for β', async (t) => {
  if (!requirePandoc(t, 'export-unicode pandoc PDF')) return;
  const engines = new Set<string>();
  const first = detectPdfEngine();
  if (first !== null) engines.add(first);
  // tectonic (a XeTeX engine) too when it is installed: pandoc's default
  // Latin Modern dropped Greek and math there. Offline under the test runner,
  // it runs --only-cached.
  try {
    execFileSync('tectonic', ['--version'], { stdio: 'ignore', timeout: 20_000 });
    engines.add('tectonic');
  } catch {
    /* not installed */
  }
  if (engines.size === 0) {
    t.skip('no PDF engine on PATH (pdflatex, xelatex, lualatex or tectonic)');
    return;
  }
  for (const engine of engines) {
    const r = await run(UNICODE, 'pdf', { pandoc: true, engine });
    assert.equal(r.writer, 'pandoc', `${engine}: ${r.output}`);
    const text = (await extractPdfText(readFileSync(r.file))).replace(/\s+/g, ' ');
    for (const s of ['β', '≥', '≈', 'Across Fields', '??? (attention)']) assert.ok(text.includes(s), `${engine}: ${s} in:\n${text}`);
    assert.match(r.output, /note — 3 character\(s\) .* were printed as \?: 力 \(U\+529B\), 意 \(U\+610F\), 注 \(U\+6CE8\)/);
  }
});

test('EXP-06 (review r1): pandoc never fetches or embeds an image — a draft\'s image URL is printed as text, as the built-in writers print it, with zero requests', async (t) => {
  if (!requirePandoc(t, 'export-unicode pandoc sandbox')) return;
  const server = await startHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
  });
  const saved = process.env['PENSMITH_OFFLINE'];
  process.env['PENSMITH_OFFLINE'] = '1';
  try {
    const text = `# A Paper\n\n## One\n\nA claim [@x2020].\n\n![Figure 1](${server.origin}/fig.png)\n\nInline ![x](/etc/hostname) and <img src="${server.origin}/raw.png"> end.\n`;
    const formats: ExportFormat[] = ['docx', 'latex'];
    if (detectPdfEngine() !== null) formats.push('pdf');
    for (const format of formats) {
      const r = await run(text, format, { pandoc: true });
      assert.equal(r.writer, 'pandoc', `${format}: ${r.output}`);
      if (format === 'docx') {
        const zip = await JSZip.loadAsync(readFileSync(r.file));
        assert.deepEqual(Object.keys(zip.files).filter((n) => n.startsWith('word/media/')), [], 'no media embedded');
        assert.ok((await zip.file('word/document.xml')!.async('string')).includes(`![Figure 1](${server.origin}/fig.png)`), 'the image is printed as its text');
      } else if (format === 'latex') {
        const tex = readFileSync(r.file, 'utf8');
        assert.doesNotMatch(tex, /\\includegraphics/);
      } else {
        assert.match(await extractPdfText(readFileSync(r.file)), /!\[Figure 1\]/);
      }
    }
    assert.deepEqual(server.requests.map((q) => q.url), [], 'pandoc made no request');
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = saved;
    await server.close();
  }
});
