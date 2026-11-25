// tests/library-bibliography.test.ts — CITATIONS.bib as a view of the library.
//
// The research-time writer used citation-js's ASCII-only BibTeX: Chinese,
// Cyrillic and Arabic text was dropped and Greek turned into math mode;
// display names became literal surnames; and a work with no DOI was left out
// of the bibliography, so a draft citing a preprint known by its arXiv ID, or
// an article known by its PubMed ID, read as FABRICATED. The library now
// writes every work, through formatBibtex, with the identifiers Pass 1 looks
// it up by. Entries the library did not write (by hand, imported, by an older
// pensmith) are kept byte for byte, and so are its own: adding a source
// changes no other entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBibtex } from '../bin/lib/bibtex-write.js';
import { addToLibrary, loadLibrary } from '../bin/lib/library.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import * as arxiv from '../bin/lib/sources/arxiv.js';
import * as pubmed from '../bin/lib/sources/pubmed.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

function paperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-libbib-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  return root;
}

const bibOf = (root: string): string => readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');

async function verdictFor(bibPath: string, key: string): Promise<{ verdict: string; reason: string }> {
  const results = await runPass1(`# S\n\nA claim [@${key}].\n`, bibPath);
  const r = results.find((x) => x.citekey === key);
  assert.ok(r, `no verdict for ${key}`);
  return r;
}

test('a preprint known only by its arXiv ID is in CITATIONS.bib with its eprint, and Pass 1 confirms it', async () => {
  const c = await arxiv.fetchById('1706.03762');
  assert.ok(c && !c.doi, 'the recorded arXiv answer gives the paper with no DOI');
  const root = paperRoot();
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  await writeBibtex([c], bibPath);
  const bib = readFileSync(bibPath, 'utf8');
  assert.match(bib, /^@misc\{vaswani2017,/m);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.match(bib, /archiveprefix = \{arXiv\}/);
  assert.match(bib, /author = \{Vaswani, Ashish and Shazeer, Noam/);
  const v = await verdictFor(bibPath, 'vaswani2017');
  assert.equal(v.verdict, 'OK', v.reason);
});

test('an article known only by its PubMed ID is in CITATIONS.bib with its pmid, and Pass 1 confirms it', async () => {
  const c = await pubmed.fetchById('22955616');
  assert.ok(c);
  // The same article as a PubMed record that lists no DOI.
  delete c.doi;
  const root = paperRoot();
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  await writeBibtex([c], bibPath);
  const bib = readFileSync(bibPath, 'utf8');
  assert.match(bib, /pmid = \{22955616\}/);
  assert.match(bib, /author = \{\{ENCODE Project Consortium\}\}/, 'a collective author is one name');
  const key = /^@\w+\{([^,]+),/m.exec(bib)![1]!;
  const v = await verdictFor(bibPath, key);
  assert.equal(v.verdict, 'OK', v.reason);
});

test('text in any script reaches CITATIONS.bib as it is', async () => {
  const c = {
    source: 'crossref', id: '10.0000/zh', doi: '10.0000/zh', title: '深度学习中的注意力机制 и Ελληνικά',
    authors: ['Иванов, Пётр'], names: [{ family: 'Иванов', given: 'Пётр' }], year: 2019,
    retracted: false, last_verified: '2026-11-25T00:00:00.000Z', citekey: 'ivanov2019', raw: null,
  } as SourceCandidate;
  const root = paperRoot();
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  await writeBibtex([c], bibPath);
  const bib = readFileSync(bibPath, 'utf8');
  assert.match(bib, /深度学习中的注意力机制/);
  assert.match(bib, /Ελληνικά/);
  assert.doesNotMatch(bib, /\$\\/, 'no Greek in math mode');
  assert.match(bib, /author = \{Иванов, Пётр\}/);
});

// A bibliography an older pensmith (or a person) wrote: a work added by hand
// that the library has never seen, a work recorded as retracted, a preprint
// known by its eprint, and an @string macro one entry uses.
const OLD_BIB =
  '@string{cise = {Computing in Science \\& Engineering}}\n\n' +
  '@article{walt2011,\n  title = {The NumPy Array: A Structure for Efficient Numerical Computation},\n' +
  '  author = {van der Walt, Stéfan and Colbert, S. Chris and Varoquaux, Gaël},\n  journal = cise,\n' +
  '  year = {2011},\n  volume = {13},\n  number = {2},\n  pages = {22--30},\n  doi = {10.1109/MCSE.2011.37}\n}\n\n' +
  '@article{wakefield1998,\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n' +
  '  author = {Wakefield, A. J.},\n  journal = {The Lancet},\n  year = {1998},\n  doi = {10.1016/S0140-6736(97)11096-0},\n  note = {RETRACTED}\n}\n\n' +
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n  author = {Vaswani, Ashish},\n  year = {2017},\n' +
  '  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n';

test('adding a work keeps every entry the library did not write byte for byte, retraction note included', async () => {
  const root = paperRoot();
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), OLD_BIB);
  const r = await addToLibrary(root, [{
    source: 'crossref', id: '10.1038/nphys1170', doi: '10.1038/nphys1170', title: 'Measured measurement',
    authors: ['Aspelmeyer, Markus'], names: [{ family: 'Aspelmeyer', given: 'Markus' }], year: 2009,
    retracted: false, last_verified: '2026-11-25T00:00:00.000Z', citekey: 'aspelmeyer2009', raw: null,
  } as SourceCandidate]);
  assert.deepEqual(r.works.map((w) => [w.citekey, w.status]), [['aspelmeyer2009', 'added']]);

  const bib = bibOf(root);
  for (const block of OLD_BIB.split('\n\n')) assert.ok(bib.includes(block.trim()), `kept as it was:\n${block}`);
  assert.match(bib, /@article\{aspelmeyer2009,/);

  const lib = await loadLibrary(root);
  const byKey = new Map(lib.entries.map((e) => [e.id, e]));
  assert.deepEqual([...byKey.keys()].sort(), ['aspelmeyer2009', 'vaswani2017', 'wakefield1998', 'walt2011']);
  assert.equal(byKey.get('wakefield1998')!.custom.retracted, true, 'the RETRACTED note is the retraction flag');
  assert.equal(byKey.get('vaswani2017')!.custom.arxiv, '1706.03762');
  assert.equal(byKey.get('walt2011')!['container-title'], 'Computing in Science & Engineering', 'the @string macro is read');
  assert.match(readFileSync(join(root, '.paper', 'CITATIONS.ris'), 'utf8'), /ID {2}- aspelmeyer2009/);
});

test('a work already in the bibliography under its DOI is not added again', async () => {
  const root = paperRoot();
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), OLD_BIB);
  const r = await addToLibrary(root, [{
    source: 'crossref', id: '10.1109/mcse.2011.37', doi: '10.1109/mcse.2011.37', title: 'The NumPy Array',
    authors: ['van der Walt, Stéfan'], year: 2011, retracted: false, last_verified: '2026-11-25T00:00:00.000Z',
    citekey: 'vanderwalt2011', raw: null,
  } as SourceCandidate]);
  assert.deepEqual(r.works.map((w) => [w.citekey, w.status]), [['walt2011', 'existing']]);
  assert.equal(bibOf(root).match(/^@article\{/gm)?.length, 2);
});

test('the library\'s own entries do not change when another work is added', async () => {
  const root = paperRoot();
  const a = await arxiv.fetchById('1706.03762');
  assert.ok(a);
  await addToLibrary(root, [a]);
  const first = bibOf(root);
  const entry = first.trim();
  await addToLibrary(root, [{
    source: 'crossref', id: '10.1038/nphys1170', doi: '10.1038/nphys1170', title: 'Measured measurement',
    authors: ['Aspelmeyer, Markus'], year: 2009, retracted: false, last_verified: '2026-11-25T00:00:00.000Z',
    citekey: 'aspelmeyer2009', raw: null,
  } as SourceCandidate]);
  assert.ok(bibOf(root).includes(entry), 'the vaswani2017 entry is byte for byte as it was');
});

test('an entry edited by hand is read back in and kept as edited', async () => {
  const root = paperRoot();
  const a = await arxiv.fetchById('1706.03762');
  assert.ok(a);
  await addToLibrary(root, [a]);
  const edited = bibOf(root).replace('title = {Attention {Is} {All} {You} {Need}}', 'title = {Attention Is All You Need}');
  assert.notEqual(edited, bibOf(root));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), edited);
  await addToLibrary(root, [{
    source: 'crossref', id: '10.1038/nphys1170', doi: '10.1038/nphys1170', title: 'Measured measurement',
    authors: ['Aspelmeyer, Markus'], year: 2009, retracted: false, last_verified: '2026-11-25T00:00:00.000Z',
    citekey: 'aspelmeyer2009', raw: null,
  } as SourceCandidate]);
  assert.ok(bibOf(root).includes(edited.trim()), 'the hand edit survives the next write');
  const item = (await loadLibrary(root)).entries.find((e) => e.id === 'vaswani2017')!;
  assert.match(item.abstract ?? '', /dominant sequence transduction/, 'what the library knew about the work is kept');
});
