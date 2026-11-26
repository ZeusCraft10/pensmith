// tests/verify-cli-exit-criteria.test.ts — the verifier's Phase 1 exit
// criterion, each part through the real `pensmith verify`:
//
//   - arXiv 10.48550/* and Zenodo DOIs → OK;
//   - a registry answering 429 / 5xx → UNRESOLVED, never FABRICATED;
//   - fabricated quotations cited with a page locator, an uppercase key and
//     in a multi-cite cluster → NOT_FOUND.
//
// The other two parts run elsewhere through the same CLI: 10/10 fabricated
// DOIs → FABRICATED in tests/known-bad-citations.test.ts, and Wakefield 1998
// → RETRACTED (the section refused) there and in tests/retraction.test.ts.
//
// Every registry answer is a recording of the real registry
// (tests/fixtures/cassettes), except the outage, which no registry can be
// made to give on demand: tests/fixtures/cassettes/registry-errors/ holds
// 429/503 answers under the unregistered 10.0000 test prefix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationVerdicts, citingDraft, verifySection, VISIBLE_ISLANDS_BIB, type VerifiedSection } from './lib/verify-cli.js';

test('an arXiv DOI (10.48550, DataCite) and a Zenodo DOI are OK, checked against OpenAlex too', () => {
  const bib =
    '@article{vaswani2017,\n  title = {Attention is all you need},\n  author = {Vaswani, A. and Shazeer, N. and others},\n' +
    '  journal = {arXiv preprint arXiv:1706.03762},\n  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n' +
    '@software{matplotlib,\n  title = {Matplotlib: Visualization with Python},\n  author = {{The Matplotlib Development Team}},\n' +
    '  year = {2026},\n  doi = {10.5281/zenodo.592536}\n}\n';
  const v = verifySection(citingDraft(['vaswani2017', 'matplotlib']), bib);
  assert.equal(v.status, 0, v.out);
  assert.equal(v.record.status, 'verified');
  assert.deepEqual(citationVerdicts(v.record), { vaswani2017: 'OK', matplotlib: 'OK' });
  for (const c of v.record.citations) assert.doesNotMatch(c.reason, /OpenAlex could not be asked/, c.reason);
});

test('a registry that answers 429 and 503 gives UNRESOLVED, to retry, and no FABRICATED', () => {
  const bib = '@article{down2020,\n  title = {A Work the Registries Could Not Look Up},\n  author = {Doe, Jane},\n  year = {2020},\n  doi = {10.0000/pensmith-registry-down}\n}\n';
  const v = verifySection(citingDraft(['down2020']), bib);
  assert.equal(v.status, 2, `UNRESOLVED blocks: nothing was checked\n${v.out}`);
  const [c] = v.record.citations;
  assert.equal(c?.verdict, 'UNRESOLVED', JSON.stringify(c));
  assert.equal(c?.retry, true, 'verify again may decide it');
  assert.match(c?.reason ?? '', /429/);
  assert.match(c?.reason ?? '', /503/);
  assert.equal(v.record.citations.filter((x) => x.verdict === 'FABRICATED').length, 0);
});

const FABRICATED_QUOTE = 'Visible islands of every size exist in every sufficiently large point set with no four collinear members';

/** A section quoting FABRICATED_QUOTE, cited as `cited`, verified. */
function quoting(cited: string, bib: string): VerifiedSection {
  return verifySection(`# Introduction\n\nThe authors claim that "${FABRICATED_QUOTE}" ${cited}.\n`, bib);
}

test('a fabricated quotation cited with a page locator is NOT_FOUND', () => {
  const r = quoting('[@leuchtner2022, p. 2]', VISIBLE_ISLANDS_BIB('leuchtner2022'));
  const rows = r.record.quotes;
  assert.equal(r.status, 2, r.out);
  assert.deepEqual(rows.map((q) => [q.citekey, q.verdict]), [['leuchtner2022', 'NOT_FOUND']], JSON.stringify(rows));
  assert.match(rows[0]!.reason, /arxiv\.org\/pdf\/2109\.00022/);
});

test('a fabricated quotation cited with an uppercase key is NOT_FOUND', () => {
  const r = quoting('[@LeuchtnerSuk2022]', VISIBLE_ISLANDS_BIB('LeuchtnerSuk2022'));
  const rows = r.record.quotes;
  assert.equal(r.status, 2, r.out);
  assert.deepEqual(rows.map((q) => [q.citekey, q.verdict]), [['LeuchtnerSuk2022', 'NOT_FOUND']], JSON.stringify(rows));
});

test('a fabricated quotation cited in a multi-cite cluster is NOT_FOUND for the work whose text is open', () => {
  // The other work in the cluster (a JaLC article) has no open-access copy,
  // so its row says the text could not be read; the open one is checked.
  const jalc = '@article{jslis,\n  title = {起業者の情報行動からみた公共図書館のビジネス支援サービス},\n  author = {滑川, 貴之},\n' +
    '  journal = {日本図書館情報学会誌},\n  year = {2016},\n  doi = {10.20651/jslis.62.1_1}\n}\n';
  const r = quoting('[see @jslis; @leuchtner2022, p. 2]', jalc + VISIBLE_ISLANDS_BIB('leuchtner2022'));
  const rows = r.record.quotes;
  assert.equal(r.status, 2, r.out);
  const byKey = Object.fromEntries(rows.map((q) => [q.citekey, q.verdict]));
  assert.equal(byKey['leuchtner2022'], 'NOT_FOUND', JSON.stringify(rows));
  assert.equal(byKey['jslis'], 'PDF_UNAVAILABLE', JSON.stringify(rows));
});
