// tests/latex-standalone.test.ts — standalone, compilable LaTeX on both paths
// (EXP-09, D-21-10, D-21-29).
//
// The structure is checked always: a standalone `article` with the paper's
// title as \title, its sections as \section, notes as \footnote,
// superscripts as \textsuperscript, every special character escaped and the
// references as an unnumbered section of hanging paragraphs — loading only
// packages every TeX distribution ships. The output is COMPILED when a TeX
// engine is found (pdflatex, xelatex, tectonic or lualatex on PATH) or
// PENSMITH_TEX_ENGINE names one (a path or a name); with PENSMITH_REQUIRE_TEX=1
// a missing engine fails the test. The product never needs a TeX engine.
// pandoc's own LaTeX (`--standalone`) is compiled too when pandoc is present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { writeLatex, escapeLatex } from '../bin/lib/export/latex-writer.js';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { sampleDocument, samplePaper } from './helpers/export-doc.js';
import { pandocVersion } from './helpers/pandoc-oracle.js';

/** The TeX engine to compile with: PENSMITH_TEX_ENGINE, else the first one on PATH; null when none. */
function texEngine(): string | null {
  const named = process.env['PENSMITH_TEX_ENGINE'];
  if (named !== undefined && named !== '') return named;
  for (const e of ['pdflatex', 'xelatex', 'tectonic', 'lualatex']) {
    try {
      execFileSync(e, ['--version'], { stdio: 'ignore', timeout: 20_000 });
      return e;
    } catch {
      /* not installed */
    }
  }
  return null;
}

/** Compile `tex` with `engine` in a fresh directory; returns the PDF's size. Throws with the log on failure. */
function compile(engine: string, tex: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-tex-'));
  writeFileSync(join(dir, 'paper.tex'), tex);
  const isTectonic = /tectonic(\.exe)?$/i.test(basename(engine));
  const args = isTectonic ? ['-X', 'compile', 'paper.tex'] : ['-interaction=nonstopmode', '-halt-on-error', 'paper.tex'];
  const r = spawnSync(engine, args, { cwd: dir, encoding: 'utf8', timeout: 600_000 });
  if (!isTectonic && r.status === 0) spawnSync(engine, args, { cwd: dir, encoding: 'utf8', timeout: 600_000 });
  const pdf = join(dir, 'paper.pdf');
  assert.equal(r.status, 0, `${engine} failed:\n${(r.stdout ?? '').slice(-3000)}\n${(r.stderr ?? '').slice(-2000)}`);
  assert.ok(existsSync(pdf), `${engine} wrote no PDF`);
  return readFileSync(pdf).length;
}

function requireEngine(t: { skip(msg?: string): void }): string | null {
  const engine = texEngine();
  if (engine !== null) return engine;
  if (process.env['PENSMITH_REQUIRE_TEX'] === '1') assert.fail('PENSMITH_REQUIRE_TEX=1 but no TeX engine was found (pdflatex, xelatex, tectonic, lualatex) and PENSMITH_TEX_ENGINE is unset');
  t.skip('no TeX engine (set PENSMITH_TEX_ENGINE, or install one; CI wiring is HARDEN-04)');
  return null;
}

test('EXP-09: the built-in LaTeX is a standalone article — title, sections, footnotes, superscripts, escapes, references as hanging paragraphs', async () => {
  const apa = writeLatex((await sampleDocument('apa')).doc);
  assert.match(apa, /^\\documentclass\[11pt\]\{article\}\n/);
  for (const pkg of ['iftex', 'hyperref']) assert.ok(apa.includes(`\\usepackage${pkg === 'hyperref' ? '[hidelinks]' : ''}{${pkg}}`), pkg);
  assert.match(apa, /\\ifPDFTeX\n {2}\\usepackage\[T1\]\{fontenc\}\n {2}\\usepackage\[utf8\]\{inputenc\}\n {2}\\usepackage\{textcomp\}\n\\else\n {2}\\usepackage\{fontspec\}\n\\fi/);
  assert.match(apa, /\\title\{The Paradigm \\& the Bank: 100\\% \\textquotedbl\{\}Growth\\textquotedbl\{\}\}|\\title\{The Paradigm \\& the Bank: 100\\% “Growth”\}/);
  assert.match(apa, /\\begin\{document\}\n\\maketitle/);
  assert.match(apa, /\\section\{Introduction\}/);
  assert.match(apa, /\\section\*\{References\}/);
  assert.match(apa, /\\noindent\\hangindent=2em\\hangafter=1 Kuhn, T\. S\. \(1962\)\. \\emph\{The Structure of Scientific Revolutions\}/);
  assert.match(apa, /5\\% – or \\\$3 per unit – in the \\#1 market\\_share case/);
  assert.match(apa, /\\begin\{quote\}/);
  assert.match(apa, /\\begin\{itemize\}/);
  assert.match(apa, /\\begin\{enumerate\}/);
  assert.match(apa, /\\begin\{tabular\}/);
  assert.match(apa, /\\begin\{verbatim\}\nx = f\(y\)  # a comment\n\\end\{verbatim\}/);
  assert.match(apa, /Greek \\ensuremath\{\\alpha\} and \\ensuremath\{\\beta\}/);
  assert.ok(!/^%/m.test(apa), 'no comment line (no generator comment)');
  assert.ok(apa.trimEnd().endsWith('\\end{document}'));
  const notes = writeLatex((await sampleDocument('chicago-notes-bib')).doc);
  assert.match(notes, /accumulate\.\\footnote\{Thomas S\. Kuhn, \\emph\{The Structure of Scientific Revolutions\}/);
  assert.match(notes, /\\section\*\{Bibliography\}/);
  const ama = writeLatex((await sampleDocument('ama')).doc);
  assert.match(ama, /accumulate\\textsuperscript\{1\}\./);
  assert.equal(escapeLatex('a_b{c}^~\\'), 'a\\_b\\{c\\}\\textasciicircum{}\\textasciitilde{}\\textbackslash{}');
});

test('EXP-09: the built-in LaTeX compiles (author-date, note and superscript styles)', async (t) => {
  const engine = requireEngine(t);
  if (engine === null) return;
  for (const style of ['apa', 'chicago-notes-bib', 'ama']) {
    assert.ok(compile(engine, writeLatex((await sampleDocument(style)).doc)) > 1000, `${style} compiled with ${engine}`);
  }
});

test('EXP-09: pandoc\'s LaTeX is standalone (its template defines the citeproc macros) and compiles', async (t) => {
  if (pandocVersion() === null) {
    if (process.env['CI'] === 'true') assert.fail('pandoc is required with CI=true');
    t.skip('pandoc is not on PATH');
    return;
  }
  const { root, inputPath } = samplePaper();
  const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'latex', paperRoot: root, pandocPresent: true, style: 'apa' }));
  assert.equal(result.writer, 'pandoc');
  const tex = readFileSync(result.outputPath, 'utf8');
  assert.match(tex, /\\documentclass/);
  assert.match(tex, /\\title\{The Paradigm \\& the Bank/);
  assert.match(tex, /\\begin\{CSLReferences\}/);
  assert.match(tex, /pdfcreator=\{\}/, 'the creator is blank (scrubbed)');
  const engine = requireEngine(t);
  if (engine === null) return;
  assert.ok(compile(engine, tex) > 1000, `pandoc's LaTeX compiled with ${engine}`);
});
