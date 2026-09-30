// tests/sources/pubmed.test.ts — PubMed E-utilities adapter against RECORDED
// cassettes (two-step esearch → esummary; RSCH-03/04, SRC-05, T-3-13, CI-07) and
// the three-way lookup contract (D-19-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pubmed from '../../bin/lib/sources/pubmed.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, liveLane, uniq } from './three-way.js';

interface Esearch { esearchresult: { idlist: string[] } }
interface Esummary { result: Record<string, { uid?: string; title?: string; authors?: Array<{ name?: string }> }> }

test('pubmed.search() replays the recorded esearch + esummary pair (RSCH-03)', async () => {
  const entries = recorded('pubmed', 'search-attention-neural-networks');
  const esearch = entries.find((e) => e.path.includes('esearch.fcgi'));
  const esummary = entries.find((e) => e.path.includes('esummary.fcgi'));
  assert.ok(esearch && esummary, 'both steps are recorded');
  const ids = (esearch.response as Esearch).esearchresult.idlist;
  assert.ok(ids.length > 0);
  const summary = (esummary.response as Esummary).result;
  const expected = ids.filter((id) => summary[id]?.title && (summary[id]?.authors ?? []).length > 0);

  const results = await pubmed.search(RECORDED_QUERY, { limit: 10 });
  assert.deepEqual(results.map((r) => r.id), expected, 'one candidate per recorded PMID with a title and authors');
  for (const r of results) {
    assert.equal(r.source, 'pubmed');
    assert.equal(r.pmid, r.id);
    // The trailing period PubMed puts on every title is punctuation, not title.
    assert.equal(r.title, String(summary[r.id]?.title).trim().replace(/\.$/, ''));
    assert.ok(r.authors.length > 0);
    assert.ok(r.venue !== undefined, 'the journal is the venue');
    assert.ok(SourceCandidateSchema.safeParse(r).success);
  }
});

test('SRC-05: PMID 31978945 — NEJM 382(8) 727-733, DOI, PMCID, the group author braced (recorded)', async () => {
  for (const spelling of ['31978945', 'PMID:31978945', 'pmid:31978945']) {
    const r = await pubmed.lookupById(spelling);
    assert.equal(r.kind, 'found', spelling);
    if (r.kind !== 'found') continue;
    const c = r.candidate;
    assert.equal(c.pmid, '31978945');
    assert.equal(c.doi, '10.1056/NEJMoa2001017');
    assert.equal(c.pmcid, 'PMC7092803');
    assert.equal(c.title, 'A Novel Coronavirus from Patients with Pneumonia in China, 2019');
    assert.equal(c.venue, 'The New England journal of medicine');
    assert.equal(c.volume, '382');
    assert.equal(c.issue, '8');
    assert.equal(c.pages, '727-733');
    assert.equal(c.year, 2020);
    assert.equal(c.type, 'article-journal');
    assert.equal(c.authors[0], 'Zhu, N.', 'PubMed "Zhu N" is written Family, Initials (SRC-12)');
    assert.equal(c.citekey, 'zhu2020');
    assert.equal(c.authors.at(-1), '{China Novel Coronavirus Investigating and Research Team}');
  }
});

test('SRC-10: fromYear → datetype=pdat&mindate=<year>&maxdate=3000 (esearch)', async () => {
  await liveLane(async (agent) => {
    const seen: string[] = [];
    agent
      .get('https://eutils.ncbi.nlm.nih.gov')
      .intercept({ path: (p: string) => { seen.push(p); return p.includes('/esearch.fcgi?'); }, method: 'GET' })
      .reply(200, JSON.stringify({ esearchresult: { count: '0', idlist: [] } }), { headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await pubmed.search(uniq('pubmed min year'), { limit: 5, fromYear: 2015 }), []);
    const url = new URL(`https://eutils.ncbi.nlm.nih.gov${seen.at(-1)}`);
    assert.equal(url.searchParams.get('mindate'), '2015');
    assert.equal(url.searchParams.get('maxdate'), '3000');
    assert.equal(url.searchParams.get('datetype'), 'pdat');
  });
});

test('RUN-03: an unrecorded PubMed query or PMID is a typed offline miss', async () => {
  await assertOfflineMiss(() => pubmed.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => pubmed.fetchById('12345678'), 'fetchById miss');
});

test('not-found: esummary answers a per-record error for an unknown PMID', async () => {
  await liveLane(async (agent) => {
    agent
      .get('https://eutils.ncbi.nlm.nih.gov')
      .intercept({ path: (p: string) => p.includes('/esummary.fcgi?') && p.includes('id=999999998'), method: 'GET' })
      .reply(200, JSON.stringify({ header: { type: 'esummary' }, result: { uids: ['999999998'], '999999998': { uid: '999999998', error: 'cannot get document summary' } } }), { headers: { 'content-type': 'application/json' } });
    const r = await pubmed.lookupById('999999998');
    assert.equal(r.kind, 'not-found');
    assert.match(r.kind === 'not-found' ? r.reason : '', /cannot get document summary/);
  });
});

/** A PMID per token (the contract needs unique ids). */
const idFor = (t: string): string => {
  let h = 7;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(100_000_000 + (h % 800_000_000));
};

threeWayContract({
  adapter: 'pubmed',
  lookupById: pubmed.lookupById,
  fetchById: pubmed.fetchById,
  origin: 'https://eutils.ncbi.nlm.nih.gov',
  idFor,
  pathPrefixFor: (t) => `/entrez/eutils/esummary.fcgi?db=pubmed&id=${idFor(t)}&`,
  found: (t) => ({
    body: {
      header: { type: 'esummary', version: '0.3' },
      result: {
        uids: [idFor(t)],
        [idFor(t)]: {
          uid: idFor(t),
          title: 'A found article.',
          authors: [{ name: 'Found F', authtype: 'Author' }],
          pubdate: '2019 Jul',
          fulljournalname: 'Journal of Tests',
          volume: '4',
          issue: '2',
          pages: '1-9',
          pubtype: ['Journal Article'],
          articleids: [{ idtype: 'pubmed', value: idFor(t) }, { idtype: 'doi', value: `10.5555/${t}` }],
        },
      },
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.pmid, idFor(t));
    assert.equal(c.title, 'A found article');
    assert.equal(c.doi, `10.5555/${t}`);
    assert.equal(c.venue, 'Journal of Tests');
  },
  invalid: (m) => ({ body: { error: `API rate limit exceeded ${m}`, count: '4' } }),
  offlineMissId: '12345679',
});
