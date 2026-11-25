// tests/export-bibliography.test.ts — the exported CITATIONS.bib and .ris list
// exactly the works the exported paper cites.
//
// research writes .paper/CITATIONS.ris with every candidate it found: uncited,
// pruned, retracted and never checked by the verifier. The exporter used to
// copy that file into the deliverable, so the user's reference manager got
// works the paper never cites, fabricated records included, while works added
// later with `add` were missing. The exported .bib also carried pensmith's own
// fields (the verification timestamp, the RETRACTED note) and free-text notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compiledPaper, runCli } from './lib/export-fixture.js';

// Two cited works, one uncited candidate, one fabricated candidate.
const BIB = [
  '@article{zeta2020,',
  '  author = {Zeta, Zed},',
  '  title = {Tidal Sediment Transport},',
  '  journal = {Estuarine Science},',
  '  year = {2020},',
  '  doi = {10.1000/zeta.2020},',
  '  note = {RETRACTED},',
  '  last_verified = {2026-11-25T00:00:00Z},',
  '  abstract = {Long abstract text.}',
  '}',
  '@book{alpha2019,',
  '  author = {Alpha, Al},',
  '  title = {Barrage Effects on Estuaries},',
  '  publisher = {Coastal Press},',
  '  year = {2019},',
  '  isbn = {978-0-306-40615-7},',
  '  note = {Found via the search step}',
  '}',
  '@article{uncited2018,',
  '  author = {Never, Cited},',
  '  title = {An Uncited Candidate},',
  '  journal = {J},',
  '  year = {2018},',
  '  doi = {10.1000/uncited}',
  '}',
  '',
].join('\n');

const RESEARCH_RIS = [
  'TY  - JOUR', 'ID  - fabricated2024', 'TI  - A Paper That Does Not Exist', 'DO  - 10.9999/fake', 'ER  - ',
  'TY  - JOUR', 'ID  - uncited2018', 'TI  - An Uncited Candidate', 'ER  - ',
  '',
].join('\n');

function keysInBib(bib: string): string[] {
  return [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!).sort();
}

function keysInRis(ris: string): string[] {
  return [...ris.matchAll(/^ID {2}- (.+)$/gm)].map((m) => m[1]!.trim()).sort();
}

test('done: the exported .bib and .ris hold exactly the cited works, with no pensmith fields', () => {
  const root = compiledPaper({
    bib: BIB,
    ris: RESEARCH_RIS,
    sections: [
      { slug: 'intro', title: 'Introduction', draft: 'Barrages trap sediment [@zeta2020, p. 5].\n', sources: ['zeta2020'] },
      { slug: 'effects', title: 'Effects', draft: 'Beds change [see @alpha2019; @zeta2020].\n', sources: ['alpha2019', 'zeta2020'] },
    ],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);

  const bib = readFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), 'utf8');
  const ris = readFileSync(join(root, '.paper', 'export', 'CITATIONS.ris'), 'utf8');
  assert.deepEqual(keysInBib(bib), ['alpha2019', 'zeta2020'], bib);
  assert.deepEqual(keysInRis(ris), keysInBib(bib), `the RIS and BibTeX key sets must match:\n${ris}`);
  for (const [name, text] of [['CITATIONS.bib', bib], ['CITATIONS.ris', ris]] as const) {
    assert.doesNotMatch(text, /fabricated2024|uncited2018|10\.9999\/fake/, `${name} must not carry uncited candidates`);
    assert.doesNotMatch(text, /RETRACTED|last_verified|Found via the search step|Long abstract/i, `${name} must not carry pensmith or free-text fields`);
  }
  // The identifiers a reader needs survive.
  assert.match(bib, /10\.1000\/zeta\.2020/);
  assert.match(bib, /978-0-306-40615-7/);
  assert.match(ris, /^DO {2}- 10\.1000\/zeta\.2020$/m);
});

test('done: a source added after research (only in CITATIONS.bib) is in the exported .ris too', () => {
  // `add` rewrites CITATIONS.bib but not the research-time .ris.
  const root = compiledPaper({
    bib: BIB,
    ris: RESEARCH_RIS,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'A book on barrages [@alpha2019].\n', sources: ['alpha2019'] }],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const ris = readFileSync(join(root, '.paper', 'export', 'CITATIONS.ris'), 'utf8');
  assert.deepEqual(keysInRis(ris), ['alpha2019']);
});

test('done: a citation with no bibliography entry refuses the export (exit 2)', () => {
  const root = compiledPaper({
    bib: BIB,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'A claim [@ghost2022].\n', sources: [] }],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /ghost2022/);
});
