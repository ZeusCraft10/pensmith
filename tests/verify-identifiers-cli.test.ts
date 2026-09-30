// tests/verify-identifiers-cli.test.ts — Pass 1 on the sources `add` brings in
// through their own identifiers (SRC-11, SRC-12, SRC-13; ROADMAP Phase 19
// criterion 7), through the BUILT CLI on recorded answers.
//
//   - `add PMID:31978945`: PubMed's compact names ("Zhu N") are stored and
//     written surname first ("Zhu, N."), so `verify 1` compares the surname
//     "zhu" with Crossref's record of the DOI and the citation is OK — never a
//     MIS-CITED with authorJW 0 (the swapped "N, Zhu" of the review finding).
//   - `add isbn:9780226458083` (a book with no DOI): Pass 1 re-fetches the ISBN
//     from the books registries and the AND-gate passes — a History paper can
//     cite a book (criterion 7); compile accepts the section.
//   - `add arXiv:1706.03762` (an arXiv-only preprint): Pass 1 re-fetches the
//     arXiv id from the arXiv API and the citation is OK.
//   - A DOI-less entry whose identifier the registrar does not know is still
//     FABRICATED; one that cannot be looked up (no recording offline) is
//     UNVERIFIABLE (blocking), never OK and never FABRICATED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sandbox,
  runCli,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  STACK_LINE,
  type Sandbox,
} from './helpers/paper-cli-harness.js';

interface LibEntry {
  citekey: string;
  authors: string[];
  doi: string | null;
  isbn: string | null;
  arxiv: string | null;
}

function library(root: string): LibEntry[] {
  return (JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: LibEntry[] }).entries;
}

/** `add <id> --yolo` into an empty paper, then one written section citing the added key. */
function paperCiting(sb: Sandbox, name: string, identifier: string): { root: string; key: string; dir: string } {
  const root = sb.project(name);
  writeState(root, [], `verify-ids-${name}`);
  const a = runCli(sb, root, ['add', identifier, '--yolo'], { timeoutMs: 120_000 });
  assert.equal(a.status, 0, `add ${identifier}\nstdout=${a.stdout}\nstderr=${a.stderr}`);
  const [entry] = library(root);
  assert.ok(entry, 'one library entry');
  const key = entry.citekey;
  writeState(root, [{ n: 1, slug: 'background' }], `verify-ids-${name}`);
  writeOutline(root, [{ n: 1, slug: 'background', sources: [key] }]);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: `[${key}]` });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(join(dir, 'DRAFT.md'), `# Background\n\nThis section rests on one source [@${key}].\n`);
  return { root, key, dir };
}

function verify(sb: Sandbox, root: string): { status: number | null; md: string; out: string } {
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(v.stderr, STACK_LINE, 'no stack trace');
  const md = readFileSync(join(sectionDirOf(root, 1, 'background'), 'VERIFICATION.md'), 'utf8');
  return { status: v.status, md, out: `${v.stdout}\n${v.stderr}` };
}

test('SRC-12 (built CLI): `add PMID:31978945` stores "Zhu, N." and `verify 1` passes Pass 1 against Crossref (never MIS-CITED)', () => {
  const sb = sandbox('verify-ids-pmid');
  const { root, key } = paperCiting(sb, 'pmid', 'PMID:31978945');
  const [entry] = library(root);
  assert.equal(key, 'zhu2020', 'the citekey keys the real surname');
  assert.equal(entry!.authors[0], 'Zhu, N.');
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /author = \{Zhu, N\. and Zhang, D\. and /);
  assert.doesNotMatch(bib, /\{N, Zhu/);
  assert.match(bib, /pmid = \{31978945\}/);

  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, /- zhu2020: \*\*OK\*\* — titleJW=1\.00, authorJW=1\.00/);
  assert.match(v.md, /^Status: verified$/m);
});

test('criterion 7 (built CLI): a book added by ISBN (no DOI) passes Pass 1 through the books registries, and compile accepts it', () => {
  const sb = sandbox('verify-ids-isbn');
  const { root, key } = paperCiting(sb, 'isbn', 'isbn:9780226458083');
  assert.equal(key, 'kuhn1996');
  const [entry] = library(root);
  assert.equal(entry!.doi, null, 'the book has no DOI');

  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, /- kuhn1996: \*\*OK\*\* — .*ISBN 9780226458083 re-fetched from the books registries; D-11 AND-gate passed/);

  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 0, `compile\nstdout=${c.stdout}\nstderr=${c.stderr}`);
  assert.match(readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8'), /\[@kuhn1996\]|Kuhn/);
});

test('SRC-13 (built CLI): an arXiv-only preprint (no DOI) passes Pass 1 through the arXiv API', () => {
  const sb = sandbox('verify-ids-arxiv');
  const { root, key } = paperCiting(sb, 'arxiv', 'arXiv:1706.03762');
  assert.equal(key, 'vaswani2017');
  const [entry] = library(root);
  assert.equal(entry!.doi, null, 'the preprint has no DOI');
  assert.equal(entry!.arxiv, '1706.03762');

  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, /- vaswani2017: \*\*OK\*\* — .*arXiv:1706\.03762 re-fetched from arXiv; D-11 AND-gate passed/);
});

test('review round 1 (built CLI): an arXiv id whose record lists a journal DOI is added as the preprint and verified at arXiv — never against the journal\'s record', () => {
  const sb = sandbox('verify-ids-arxiv-vor');
  // arXiv lists 10.1143/PTP.101.1155 (Progress of Theoretical Physics) for hep-th/9901001.
  const { root, key } = paperCiting(sb, 'arxiv-vor', 'arXiv:hep-th/9901001');
  const [entry] = library(root) as Array<LibEntry & { alternate_dois: string[] }>;
  assert.equal(entry!.doi, null, 'the journal DOI is not paired with the preprint metadata');
  assert.deepEqual(entry!.alternate_dois, ['10.1143/ptp.101.1155'], 'kept as a candidate only');
  assert.equal(entry!.arxiv, 'hep-th/9901001');
  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, new RegExp(`- ${key}: \\*\\*OK\\*\\* — .*arXiv:hep-th/9901001 re-fetched from arXiv; D-11 AND-gate passed`));
});

test('Pass 1 (built CLI): a DOI-less entry is UNVERIFIABLE when its registrar cannot be asked (offline, no recording), FABRICATED with no identifier at all', () => {
  const sb = sandbox('verify-ids-unknown');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'background' }], 'verify-ids-unknown');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['smith2001', 'nobody2002'] }]);
  writeFileSync(
    join(root, '.paper', 'CITATIONS.bib'),
    [
      '@book{smith2001,',
      '  author = {Smith, Jane},',
      '  title = {A Book Nobody Recorded},',
      '  year = {2001},',
      '  isbn = {9780000000002},',
      '}',
      '',
      '@misc{nobody2002,',
      '  author = {Nobody, Ann},',
      '  title = {No Identifier At All},',
      '  year = {2002},',
      '}',
      '',
    ].join('\n'),
  );
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[smith2001, nobody2002]' });
  writeFileSync(
    join(sectionDirOf(root, 1, 'background'), 'DRAFT.md'),
    '# Background\n\nOne claim [@smith2001]. Another claim [@nobody2002].\n',
  );
  const v = verify(sb, root);
  assert.equal(v.status, 4, v.out);
  assert.match(v.md, /- smith2001: \*\*UNVERIFIABLE\*\* — .*offline: no recorded fixture — re-run online \(the books registries lookup of ISBN 9780000000002\)/);
  assert.match(v.md, /- nobody2002: \*\*FABRICATED\*\* — .*no DOI, arXiv id, PMID or ISBN in citation entry/);
});
