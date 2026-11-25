// tests/export-citation-render.test.ts — Markdown and offline LaTeX exports
// render citations the way the chosen style says.
//
// The offline renderer used to format each work on its own, so in IEEE (the
// computer-science default), Vancouver and AMA every citation read [1] while
// the reference list numbered works by citekey; `[@key, p. 5]` came out as
// `[@key,]`, prefixes were dropped and Chicago notes were inlined. Every
// `--format md` export took that path. These cases export real manuscripts
// and read the result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { exportDraft } from '../bin/lib/exporter.js';
import { compiledPaper, needsTool } from './lib/export-fixture.js';

// zeta2020 sorts after alpha2019 by key and by author, but the text cites it first.
const BIB = [
  '@article{zeta2020, author = {Zeta, Zed}, title = {Tidal Sediment Transport}, journal = {Estuarine Science}, year = {2020}, doi = {10.1000/zeta}}',
  '@article{alpha2019, author = {Alpha, Al}, title = {Barrage Effects on Estuaries}, journal = {Coastal Engineering}, year = {2019}, doi = {10.1000/alpha}}',
  '',
].join('\n');

const MANUSCRIPT = [
  '# Tidal Barrages',
  '',
  '## Introduction',
  '',
  'Barrages trap sediment [@zeta2020, p. 5]. Estuary beds change [see @alpha2019; @zeta2020].',
  '',
  'As @alpha2019 notes, the effect is slow [-@zeta2020]. Write to me@example.com.',
  '',
].join('\n');

async function exportMd(style: string, format: 'md' | 'latex' = 'md'): Promise<string> {
  const root = compiledPaper({ bib: BIB, compiled: MANUSCRIPT, sections: [{ slug: 'intro', title: 'Introduction', draft: 'x\n' }] });
  const res = await exportDraft({ inputPath: join(root, '.paper', 'DRAFT.md'), format, paperRoot: root, pandocPresent: false, style });
  return readFileSync(res.outputPath, 'utf8');
}

function referencesOf(md: string): string {
  const i = md.search(/^## (References|Bibliography|Works Cited)$/m);
  assert.ok(i >= 0, `no reference list:\n${md}`);
  return md.slice(i);
}

test('IEEE: works are numbered by first appearance and the list follows that order', async () => {
  const md = await exportMd('ieee');
  assert.match(md, /trap sediment \[1, p\. 5\]\./, md);
  assert.match(md, /beds change \[1\], see \[2\]\./, md);
  assert.match(md, /As \[2\] notes, the effect is slow \[1\]\./, md);
  const refs = referencesOf(md);
  assert.ok(refs.indexOf('[1] Z. Zeta') >= 0 && refs.indexOf('[2] A. Alpha') > refs.indexOf('[1] Z. Zeta'), refs);
  assert.doesNotMatch(md, /\[@|@zeta|@alpha/, 'no raw citation survives');
  assert.match(md, /me@example\.com/, 'an email address is not a citation');
});

test('Vancouver and AMA number by first appearance too', async () => {
  const van = await exportMd('vancouver');
  assert.match(van, /trap sediment \(1\)/, van);
  assert.match(referencesOf(van), /^1\.\s+Zeta Z\./m);
  assert.match(referencesOf(van), /^2\.\s+Alpha A\./m);
  const ama = await exportMd('ama');
  assert.match(ama, /trap sediment<sup>1\(p5\)<\/sup>/, ama);
});

test('APA: locator, prefix, narrative and suppress-author forms, references by author, italics kept', async () => {
  const md = await exportMd('apa');
  assert.match(md, /trap sediment \(Zeta, 2020, p\. 5\)\./, md);
  assert.match(md, /\(see Alpha, 2019; Zeta, 2020\)/, md);
  assert.match(md, /As Alpha \(2019\) notes, the effect is slow \(2020\)\./, md);
  const refs = referencesOf(md);
  assert.ok(refs.indexOf('Alpha, A.') < refs.indexOf('Zeta, Z.'), refs);
  assert.match(refs, /\*Estuarine Science\*/, 'journal titles are italic');
  assert.doesNotMatch(md, /\[@/);
});

test('Chicago notes: citations become footnotes and the list is a Bibliography', async () => {
  const md = await exportMd('chicago-notes-bib');
  assert.match(md, /trap sediment\.\[\^1\]/, `the note follows the punctuation:\n${md}`);
  assert.match(md, /^\[\^1\]: Zed Zeta, “Tidal Sediment Transport,” \*Estuarine Science\*, 2020, 5/m, md);
  assert.match(md, /^\[\^2\]: See Al Alpha/m, 'a note starts with a capital');
  assert.match(md, /^## Bibliography$/m);
  assert.doesNotMatch(md, /\[@/);
});

test('MLA: the list is Works Cited', async () => {
  const md = await exportMd('mla');
  assert.match(md, /^## Works Cited$/m, md);
  assert.match(md, /\(Zeta 5\)/, md);
});

test('offline LaTeX: numbered citations, a reference section, footnotes for notes, and it compiles', async (t) => {
  const tex = await exportMd('ieee', 'latex');
  assert.match(tex, /\\title\{Tidal Barrages\}/);
  assert.match(tex, /\\section\{Introduction\}/);
  assert.match(tex, /\[1, p\. 5\]/);
  assert.match(tex, /\\section\{References\}/);
  assert.match(tex, /\[2\] A\. Alpha, “Barrage Effects on Estuaries,” \\emph\{Coastal Engineering\}/, tex);
  const notes = await exportMd('chicago-notes-bib', 'latex');
  assert.match(notes, /\\footnote\{Zed Zeta/, notes);

  const pdflatex = needsTool('pdflatex');
  if (pdflatex.skip) {
    t.diagnostic(pdflatex.skip);
    return;
  }
  for (const [name, body] of [['ieee.tex', tex], ['notes.tex', notes]] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'pensmith-offline-tex-'));
    writeFileSync(join(dir, name), body);
    const c = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', name], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    assert.equal(c.status, 0, `${name} does not compile:\n${c.stdout.slice(-2000)}`);
  }
});
