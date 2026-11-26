// tests/verify-cli-exit-criteria.test.ts — the verifier's Phase 1 exit
// criterion, each part through the real `pensmith verify`:
//
//   - 10/10 fabricated DOIs → FABRICATED;
//   - arXiv 10.48550/* and Zenodo DOIs → OK;
//   - a registry answering 429 / 5xx → UNRESOLVED, never FABRICATED;
//   - Wakefield 1998 → RETRACTED;
//   - fabricated quotations cited with a page locator, an uppercase key and
//     in a multi-cite cluster → NOT_FOUND.
//
// Every registry answer is a recording of the real registry
// (tests/fixtures/cassettes), except the outage, which no registry can be
// made to give on demand: tests/fixtures/cassettes/registry-errors/ holds
// 429/503 answers under the unregistered 10.0000 test prefix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bibEntry, citationVerdicts, verifySection, VISIBLE_ISLANDS_BIB } from './lib/verify-cli.js';

interface Entry { citekey: string; title: string; authors: string[]; year: number; journal?: string; doi: string; expected_verdict: string }
const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/known-bad-citations.json', import.meta.url), 'utf8')) as Entry[];

const cites = (keys: string[]): string => `# Introduction\n\n${keys.map((k) => `One claim here rests on this work [@${k}].`).join('\n')}\n`;

test('10/10 fabricated DOIs are FABRICATED, and the section is refused', () => {
  const fabricated = CORPUS.filter((e) => e.expected_verdict === 'FABRICATED');
  assert.equal(fabricated.length, 10);
  const v = verifySection(cites(fabricated.map((e) => e.citekey)), fabricated.map(bibEntry).join('\n'));
  assert.equal(v.status, 2, v.out);
  const verdicts = citationVerdicts(v.record);
  assert.deepEqual(Object.values(verdicts), Array(10).fill('FABRICATED'), JSON.stringify(v.record.citations, null, 1));
});

test('an arXiv DOI (10.48550, DataCite) and a Zenodo DOI are OK, checked against OpenAlex too', () => {
  const bib =
    '@article{vaswani2017,\n  title = {Attention is all you need},\n  author = {Vaswani, A. and Shazeer, N. and others},\n' +
    '  journal = {arXiv preprint arXiv:1706.03762},\n  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n' +
    '@software{matplotlib,\n  title = {Matplotlib: Visualization with Python},\n  author = {{The Matplotlib Development Team}},\n' +
    '  year = {2026},\n  doi = {10.5281/zenodo.592536}\n}\n';
  const v = verifySection(cites(['vaswani2017', 'matplotlib']), bib);
  assert.equal(v.status, 0, v.out);
  assert.equal(v.record.status, 'verified');
  assert.deepEqual(citationVerdicts(v.record), { vaswani2017: 'OK', matplotlib: 'OK' });
  for (const c of v.record.citations) assert.doesNotMatch(c.reason, /OpenAlex could not be asked/, c.reason);
});

test('a registry that answers 429 and 503 gives UNRESOLVED, to retry, and no FABRICATED', () => {
  const bib = '@article{down2020,\n  title = {A Work the Registries Could Not Look Up},\n  author = {Doe, Jane},\n  year = {2020},\n  doi = {10.0000/pensmith-registry-down}\n}\n';
  const v = verifySection(cites(['down2020']), bib);
  assert.equal(v.status, 2, `UNRESOLVED blocks: nothing was checked\n${v.out}`);
  const [c] = v.record.citations;
  assert.equal(c?.verdict, 'UNRESOLVED', JSON.stringify(c));
  assert.equal(c?.retry, true, 'verify again may decide it');
  assert.match(c?.reason ?? '', /429/);
  assert.match(c?.reason ?? '', /503/);
  assert.equal(v.record.citations.filter((x) => x.verdict === 'FABRICATED').length, 0);
});

test('Wakefield 1998 is RETRACTED, and the section is refused', () => {
  const wakefield = CORPUS.find((e) => e.citekey === 'wakefield1998');
  assert.ok(wakefield);
  const v = verifySection(cites(['wakefield1998']), bibEntry(wakefield));
  assert.equal(v.status, 2, v.out);
  assert.deepEqual(citationVerdicts(v.record), { wakefield1998: 'RETRACTED' });
  assert.match(v.record.citations[0]!.reason, /retract/i);
});

const FABRICATED_QUOTE = 'Visible islands of every size exist in every sufficiently large point set with no four collinear members';

/** The quotation verdicts for `key`, from a section quoting FABRICATED_QUOTE as `cited`. */
function quoteVerdicts(cited: string, bib: string): { status: number | null; rows: Array<{ citekey: string; verdict: string; reason: string }>; out: string } {
  const v = verifySection(`# Introduction\n\nThe authors claim that "${FABRICATED_QUOTE}" ${cited}.\n`, bib);
  return { status: v.status, rows: v.record.quotes, out: v.out };
}

test('a fabricated quotation cited with a page locator is NOT_FOUND', () => {
  const r = quoteVerdicts('[@leuchtner2022, p. 2]', VISIBLE_ISLANDS_BIB('leuchtner2022'));
  assert.equal(r.status, 2, r.out);
  assert.deepEqual(r.rows.map((q) => [q.citekey, q.verdict]), [['leuchtner2022', 'NOT_FOUND']], JSON.stringify(r.rows));
  assert.match(r.rows[0]!.reason, /arxiv\.org\/pdf\/2109\.00022/);
});

test('a fabricated quotation cited with an uppercase key is NOT_FOUND', () => {
  const r = quoteVerdicts('[@LeuchtnerSuk2022]', VISIBLE_ISLANDS_BIB('LeuchtnerSuk2022'));
  assert.equal(r.status, 2, r.out);
  assert.deepEqual(r.rows.map((q) => [q.citekey, q.verdict]), [['LeuchtnerSuk2022', 'NOT_FOUND']], JSON.stringify(r.rows));
});

test('a fabricated quotation cited in a multi-cite cluster is NOT_FOUND for the work whose text is open', () => {
  // The other work in the cluster (a JaLC article) has no open-access copy,
  // so its row says the text could not be read; the open one is checked.
  const jalc = '@article{jslis,\n  title = {起業者の情報行動からみた公共図書館のビジネス支援サービス},\n  author = {滑川, 貴之},\n' +
    '  journal = {日本図書館情報学会誌},\n  year = {2016},\n  doi = {10.20651/jslis.62.1_1}\n}\n';
  const r = quoteVerdicts('[see @jslis; @leuchtner2022, p. 2]', jalc + VISIBLE_ISLANDS_BIB('leuchtner2022'));
  assert.equal(r.status, 2, r.out);
  const byKey = Object.fromEntries(r.rows.map((q) => [q.citekey, q.verdict]));
  assert.equal(byKey['leuchtner2022'], 'NOT_FOUND', JSON.stringify(r.rows));
  assert.equal(byKey['jslis'], 'PDF_UNAVAILABLE', JSON.stringify(r.rows));
});
