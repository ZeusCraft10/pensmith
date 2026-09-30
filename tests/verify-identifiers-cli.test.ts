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
//     UNVERIFIABLE-NETWORK (blocking), never OK and never FABRICATED; one with
//     no identifier at all goes to the metadata search (VRFY-12) and, when no
//     registrar record matches it (recorded), is UNRESOLVABLE (blocking).

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

// Review round 2 of the Phase 20 + 23a merge: `add PMID:…` confirms a PubMed
// record that carries a DOI at Crossref (source-input.ts pubmedConfirmed), so
// the entry holds the names Pass 1 compares — Crossref's `Zhu, Na` for
// 31978945. PubMed's own "Family Initials" names are what a PMID whose DOI
// Crossref does not hold keeps (42706103, below).
test('SRC-12 (built CLI): `add PMID:31978945` stores the names of the DOI\'s Crossref record ("Zhu, Na", never "N, Zhu") and `verify 1` passes Pass 1 against Crossref (never MIS-CITED)', () => {
  const sb = sandbox('verify-ids-pmid');
  const { root, key } = paperCiting(sb, 'pmid', 'PMID:31978945');
  const [entry] = library(root);
  assert.equal(key, 'zhu2020', 'the citekey keys the real surname');
  assert.equal(entry!.authors[0], 'Zhu, Na');
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /author = \{Zhu, Na and Zhang, Dingyu and /);
  assert.doesNotMatch(bib, /\{N, Zhu|\{Na, Zhu/);
  assert.match(bib, /pmid = \{31978945\}/);

  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, /- zhu2020: \*\*OK\*\* — titleJW=1\.00, authorJW=1\.00/);
  assert.match(v.md, /^Status: verified$/m);
});

test('SRC-12 (built CLI): `add PMID:42706103` — its DOI is registered with ISTIC, not Crossref — keeps PubMed\'s "Family Initials" names as "Zou, P. R." (never "PR, Zou"), and `verify 1` passes it on its PMID', () => {
  const sb = sandbox('verify-ids-pmid-istic');
  const { root, key } = paperCiting(sb, 'pmid-istic', 'PMID:42706103');
  const [entry] = library(root);
  assert.equal(key, 'zou2026');
  assert.equal(entry!.authors[0], 'Zou, P. R.');
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /author = \{Zou, P\. R\. and Lin, Q\. F\. and /);
  assert.doesNotMatch(bib, /\{PR, Zou/);
  assert.match(bib, /pmid = \{42706103\}/);

  const v = verify(sb, root);
  assert.equal(v.status, 0, v.out);
  assert.match(v.md, /- zou2026: \*\*OK\*\* — .*PMID 42706103 re-fetched from PubMed; D-11 AND-gate passed/);
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

test('Pass 1 (built CLI): a DOI-less entry is UNVERIFIABLE-NETWORK when its registrar cannot be asked (offline, no recording); one with no identifier that no registrar record matches is UNRESOLVABLE', () => {
  const sb = sandbox('verify-ids-unknown');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'background' }], 'verify-ids-unknown');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['smith2001', 'nobody2017'] }]);
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
      '@misc{nobody2017,',
      '  author = {Nobody, Ann},',
      '  title = {A Work That Was Never Published},',
      '  year = {2017},',
      '}',
      '',
    ].join('\n'),
  );
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[smith2001, nobody2017]' });
  writeFileSync(
    join(sectionDirOf(root, 1, 'background'), 'DRAFT.md'),
    '# Background\n\nOne claim [@smith2001]. Another claim [@nobody2017].\n',
  );
  const v = verify(sb, root);
  assert.equal(v.status, 4, v.out);
  assert.match(v.md, /- smith2001: \*\*UNVERIFIABLE-NETWORK\*\* — .*offline: no recorded fixture — re-run online \(the books registries lookup of ISBN 9780000000002\)/);
  // The recorded Crossref bibliographic search for it answers with no strict match.
  assert.match(v.md, /- nobody2017: \*\*UNRESOLVABLE\*\* — .*no registrar record matches its title, first author and year/);
  assert.ok(!/\*\*(OK|FABRICATED)\*\*/.test(v.md), 'never OK, never FABRICATED');
});
