// tests/export-non-latin.test.ts — works with non-Latin names and titles keep
// them in every export.
//
// The exported CITATIONS.bib is written by citation-js, whose BibTeX writer
// defaults to ASCII-only output: it dropped Chinese, Cyrillic and Arabic
// letters and turned Greek into math-mode commands. Pandoc reads that file for
// docx, pdf and latex, so those exports cited "(, 2019)" and listed empty
// titles, and the .bib that goes to the user's reference manager was
// corrupted. Markdown and RIS were unaffected: they render from the parsed
// entries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportDraft } from '../bin/lib/exporter.js';
import { readBibEntries, type CslEntry } from '../bin/lib/export-bib.js';
import { compiledPaper, needsTool, runCli } from './lib/export-fixture.js';

const BIB = [
  '@book{zh2019, author = {张, 伟}, title = {潮汐 Barrages}, publisher = {Press}, year = {2019}}',
  '@article{ru2018, author = {Иванов, Иван}, title = {Приливы и отливы в России}, journal = {Вестник}, year = {2018}}',
  '@article{gr2017, author = {Παπαδόπουλος, Γιώργος}, title = {Παλίρροιες της Ελλάδας}, journal = {J}, year = {2017}}',
  '@article{ar2016, author = {علي, أحمد}, title = {المد والجزر}, journal = {J}, year = {2016}}',
  // Latin letters with diacritics and LaTeX's special characters must survive too.
  '@article{pl2015, author = {Łukasz, Żółć and {World Health Organization}}, title = {Pływy w Łodzi \\& Tides: 100\\% of \\#1 \\_data \\$5}, journal = {A \\& B}, year = {2015}, doi = {10.1000/a_b}, url = {https://example.org/a_b%20c}}',
  '',
].join('\n');

const DRAFT = 'Tides shape coasts [@zh2019; @ru2018; @gr2017; @ar2016; @pl2015].\n';

function paper(): string {
  return compiledPaper({
    title: 'Tides',
    bib: BIB,
    sections: [{ slug: 'intro', title: 'Introduction', draft: DRAFT, sources: ['zh2019', 'ru2018', 'gr2017', 'ar2016', 'pl2015'] }],
  });
}

function names(e: CslEntry): string {
  return JSON.stringify(e['author'] ?? null);
}

test('the exported CITATIONS.bib keeps non-Latin names and titles and LaTeX special characters', async () => {
  const root = paper();
  const res = await exportDraft({ inputPath: join(root, '.paper', 'DRAFT.md'), format: 'md', paperRoot: root, pandocPresent: false });
  assert.ok(res.bibPath, 'a bibliography was exported');
  const exportedText = readFileSync(res.bibPath, 'utf8');
  const exported = new Map((await readBibEntries(exportedText)).map((e) => [e.id, e]));
  const source = await readBibEntries(BIB);
  assert.equal(exported.size, source.length, exportedText);
  for (const want of source) {
    const got = exported.get(want.id);
    assert.ok(got, `${want.id} is missing:\n${exportedText}`);
    assert.equal(names(got), names(want), `${want.id}: authors changed:\n${exportedText}`);
    for (const field of ['title', 'container-title', 'publisher', 'DOI', 'URL']) {
      assert.equal(got[field], want[field], `${want.id}: ${field} changed:\n${exportedText}`);
    }
  }
  // The non-Latin text is stored as text, not as LaTeX math or empty braces.
  for (const s of ['张', '潮汐', 'Иванов', 'Приливы', 'России', 'Παπαδόπουλος', 'Παλίρροιες', 'Ελλάδας', 'علي', 'المد والجزر', 'Łukasz', 'Łodzi']) {
    assert.ok(exportedText.includes(s), `${s} is not in the exported .bib:\n${exportedText}`);
  }
  assert.doesNotMatch(exportedText, /\$\\[A-Za-z]+\$/, 'no math-mode letters');
});

test('done --format docx with real Pandoc cites and lists non-Latin works in full', needsTool('pandoc'), () => {
  const root = paper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'docx'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const plain = spawnSync('pandoc', [join(root, '.paper', 'export', 'DRAFT.docx'), '-t', 'plain', '--wrap=none'], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
  const text = plain.stdout;
  const cite = /Tides shape coasts \(([^)]*)\)/.exec(text)?.[1] ?? '';
  for (const family of ['张', 'Иванов', 'Παπαδόπουλος', 'علي', 'Łukasz']) {
    assert.ok(cite.includes(family), `the citation does not name ${family}: (${cite})\n${text}`);
  }
  // Capitals inside a title stay capitals in a sentence-case style (APA), in any script.
  for (const title of ['潮汐', 'Приливы и отливы в России', 'Παλίρροιες της Ελλάδας', 'المد والجزر', 'Pływy w Łodzi & Tides: 100% of #1 _data $5']) {
    assert.ok(text.includes(title), `the reference list does not show ${title}:\n${text}`);
  }
});
