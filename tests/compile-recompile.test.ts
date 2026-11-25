// tests/compile-recompile.test.ts — compile leaves the bibliography as verify
// read it.
//
// compile used to rewrite CITATIONS.bib from the works the manuscript cites,
// through a converter that loses detail: "van der Walt, Stéfan" came back as
// "Walt, Stéfan", the journal and the entry type were dropped, and a work
// with no DOI, ISBN or arXiv number (an `eprint` field, a PMID) was dropped
// altogether. Each section's record holds the hash of every cited entry as
// verify read it, so from the second compile on every section looked stale
// and was re-verified against the registries, on every compile; offline, that
// re-verify was UNRESOLVED, and a recompile of an unchanged paper refused and
// moved the good manuscript aside. A dropped work made done refuse a paper
// verify had passed. Every case drives the real CLI on recorded registry
// answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/export-fixture.js';

// The NumPy paper as a bibliography writes it: an unbraced particle surname,
// diacritics, a journal, volume, issue and pages. An uncited work sits beside it.
const BIB =
  '@article{walt2011,\n' +
  '  title = {The NumPy Array: A Structure for Efficient Numerical Computation},\n' +
  '  author = {van der Walt, Stéfan and Colbert, S. Chris and Varoquaux, Gaël},\n' +
  '  journal = {Computing in Science \\& Engineering},\n' +
  '  year = {2011},\n  volume = {13},\n  number = {2},\n  pages = {22--30},\n' +
  '  doi = {10.1109/MCSE.2011.37}\n}\n\n' +
  '@book{kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas S.},\n' +
  '  publisher = {University of Chicago Press},\n  year = {1962},\n  isbn = {9780226458083}\n}\n';

interface Run { status: number | null; out: string }

function cli(root: string, args: string[], env: Record<string, string> = {}): Run {
  const r = runCli(args, root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1', ...env });
  return { status: r.status, out: r.stdout + r.stderr };
}

function seedPaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-recompile-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Array Computing', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | walt2011 |', ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [walt2011]\n---\n# Intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), 'Array programming underpins numerical Python [@walt2011].\n');
  return root;
}

test('a second compile with nothing changed re-verifies nothing, and works offline', () => {
  const root = seedPaper();
  const paper = join(root, '.paper');
  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 0, v.out);
  const first = cli(root, ['compile']);
  assert.equal(first.status, 0, first.out);
  const manuscript = readFileSync(join(paper, 'DRAFT.md'), 'utf8');

  const again = cli(root, ['compile']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /\(1 sections, 0 stale resolved\)/, again.out);
  assert.doesNotMatch(again.out, /re-verifying/, `nothing changed, so nothing is re-verified\n${again.out}`);

  const offline = cli(root, ['compile'], { PENSMITH_OFFLINE: '1' });
  assert.equal(offline.status, 0, offline.out);
  assert.match(offline.out, /\(1 sections, 0 stale resolved\)/, offline.out);
  assert.doesNotMatch(offline.out, /re-verifying|UNRESOLVED/, offline.out);
  assert.equal(readFileSync(join(paper, 'DRAFT.md'), 'utf8'), manuscript, 'the manuscript is where it was, unchanged');
  assert.equal(existsSync(join(paper, 'DRAFT.stale.md')), false, 'nothing was moved aside');
});

test('compile leaves CITATIONS.bib as verify read it: no entry rewritten, none dropped', () => {
  const root = seedPaper();
  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 0, v.out);
  const c = cli(root, ['compile']);
  assert.equal(c.status, 0, c.out);
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), BIB);
});

// Two works with no DOI: an arXiv preprint known by its eprint field, and a
// paper known by its PubMed ID. The registries hold both.
const NO_DOI_BIB =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Łukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv},\n  primaryClass = {cs.CL}\n}\n\n' +
  '@article{encode2012,\n  title = {An integrated encyclopedia of DNA elements in the human genome.},\n' +
  '  author = {{The ENCODE Project Consortium}},\n  journal = {Nature},\n  year = {2012},\n  pmid = {PMID: 22955616}\n}\n';

test('works known by an eprint or a PubMed ID stay in the bibliography through compile, and done exports them', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-recompile-nodoi-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Sequence Models', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | vaswani2017, encode2012 |', ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), NO_DOI_BIB);
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [vaswani2017, encode2012]\n---\n# Intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), 'Attention suffices for translation [@vaswani2017]. Most of the genome is annotated [@encode2012].\n');

  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 0, v.out);
  const c = cli(root, ['compile']);
  assert.equal(c.status, 0, c.out);
  assert.equal(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), NO_DOI_BIB);
  const manifest = JSON.parse(readFileSync(join(root, '.paper', 'COMPILE-MANIFEST.json'), 'utf8')) as { bib_entries: Record<string, string> };
  assert.deepEqual(Object.keys(manifest.bib_entries).sort(), ['encode2012', 'vaswani2017']);

  const d = cli(root, ['done', '--yolo', '--raw', '--format', 'md']);
  assert.equal(d.status, 0, d.out);
  assert.doesNotMatch(d.out, /FABRICATED|BLOCKED/, d.out);
  const exported = readFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), 'utf8');
  assert.match(exported, /@misc\{vaswani2017,/);
  assert.match(exported, /@article\{encode2012,/);
});
