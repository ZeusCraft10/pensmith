// tests/sources/openalex.test.ts — OpenAlex adapter (RSCH-03/04, SRC-05, SRC-06,
// T-3-13) against REAL recordings (`npm run cassettes:refresh -- --only
// openalex`, CI-07, D-19-26) and the three-way lookup contract (D-19-05).
//
// The search recording is keyless: the recorder lowered its result count to 5
// to fit the 51200-byte cap (OpenAlex authorships are large). The keyless 429
// "Insufficient budget" answer is a hand-written SYNTHETIC fixture
// (tests/fixtures/cassettes/synthetic/openalex/), copied from the live answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as openalex from '../../bin/lib/sources/openalex.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, liveLane, uniq } from './three-way.js';

interface Work {
  id?: string;
  doi?: string;
  title?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
}

/** The result count the recorder settled on (the `per-page` of the recorded request). */
function recordedLimit(path: string): number {
  return Number(new URL(`https://api.openalex.org${path}`).searchParams.get('per-page'));
}

test('openalex.search() returns exactly the recorded works, with venue, type, biblio and abstracts (RSCH-03, SRC-05)', async () => {
  const [entry] = recorded('openalex', 'search-attention-neural-networks');
  const works = (entry!.response as { results: Work[] }).results;
  const expected = works
    .filter((w) => w.id && w.title && (w.authorships ?? []).some((a) => (a.author?.display_name ?? '').trim()))
    .map((w) => w.id);
  assert.ok(expected.length > 0, 'the recording carries usable works');
  assert.ok(!/mailto|api_key/.test(entry!.path), 'identity params are scrubbed from the recording');
  const results = await openalex.search(RECORDED_QUERY, { limit: recordedLimit(entry!.path) });
  assert.deepEqual(results.map((r) => r.id), expected);
  for (const r of results) {
    assert.equal(r.source, 'openalex');
    assert.ok(r.authors.length > 0);
    assert.ok(!r.doi?.startsWith('https://'), 'the doi.org prefix is stripped');
    assert.ok(r.type !== undefined);
    assert.ok(SourceCandidateSchema.safeParse(r).success);
  }
  assert.ok(results.some((r) => (r.abstract ?? '').length > 50), 'abstracts are rebuilt from the inverted index');
  assert.ok(results.some((r) => r.venue !== undefined), 'venues come from the primary location');
});

test('SRC-05: OpenAlex by DOI — Nature 521(7553) 436-444, PMID, publisher (recorded)', async () => {
  const r = await openalex.lookupById('10.1038/nature14539');
  assert.equal(r.kind, 'found');
  if (r.kind !== 'found') return;
  const c = r.candidate;
  assert.equal(c.id, 'https://openalex.org/W2919115771');
  assert.equal(c.doi, '10.1038/nature14539');
  assert.equal(c.title, 'Deep learning');
  assert.deepEqual(c.authors, ['Yann LeCun', 'Yoshua Bengio', 'Geoffrey E. Hinton']);
  assert.equal(c.venue, 'Nature');
  assert.equal(c.volume, '521');
  assert.equal(c.issue, '7553');
  assert.equal(c.pages, '436-444');
  assert.equal(c.pmid, '26017442');
  assert.equal(c.type, 'article-journal');
  assert.equal(c.year, 2015);
  // The same work by its W-id.
  const byW = await openalex.fetchById('https://openalex.org/W2919115771');
  assert.equal(byW?.doi, '10.1038/nature14539');
});

test('a W-id OpenAlex does not know is a recorded 404 → not-found', async () => {
  const [entry] = recorded('openalex', 'works-W2963403868-404');
  assert.equal(entry!.status, 404);
  const r = await openalex.lookupById('W2963403868');
  assert.equal(r.kind, 'not-found');
  assert.equal(await openalex.fetchById('W2963403868'), null);
});

test('SRC-06: the keyless 429 "Insufficient budget" answer → keyless daily budget exhausted — set OPENALEX_API_KEY (free)', async () => {
  const reasons: string[] = [];
  const hits = await openalex.search('insufficient budget probe', { limit: 10, onFailure: (r) => reasons.push(r) });
  assert.deepEqual(hits, []);
  assert.deepEqual(reasons, ['keyless daily budget exhausted — set OPENALEX_API_KEY (free)']);
});

test('SRC-06: with OPENALEX_API_KEY the request carries api_key and mailto; a keyed 429 reads "rate limited (retry after …)"', async () => {
  const savedKey = process.env['OPENALEX_API_KEY'];
  process.env['OPENALEX_API_KEY'] = 'oa-test-key-123';
  try {
    await liveLane(async (agent) => {
      const q = uniq('keyed');
      const seen: string[] = [];
      agent
        .get('https://api.openalex.org')
        .intercept({ path: (p: string) => { seen.push(p); return p.startsWith('/works?search='); }, method: 'GET' })
        .reply(200, JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } });
      assert.deepEqual(await openalex.search(q, { limit: 3, fromYear: 2015 }), []);
      const url = new URL(`https://api.openalex.org${seen.at(-1)}`);
      assert.equal(url.searchParams.get('api_key'), 'oa-test-key-123');
      assert.equal(url.searchParams.get('mailto'), 'pensmith-dev@example.org');
      assert.equal(url.searchParams.get('filter'), 'from_publication_date:2015-01-01');

      agent
        .get('https://api.openalex.org')
        .intercept({ path: (p: string) => p.startsWith('/works/W1?'), method: 'GET' })
        .reply(429, JSON.stringify({ error: 'Rate limit exceeded' }), { headers: { 'content-type': 'application/json', 'retry-after': '1' } })
        .persist();
      const r = await openalex.lookupById('W1');
      assert.equal(r.kind, 'failed');
      assert.match(r.kind === 'failed' ? r.reason : '', /^rate limited( \(retry after ~\d+ s\))?$/);
    }, { contactEmail: 'pensmith-dev@example.org' });
  } finally {
    if (savedKey === undefined) delete process.env['OPENALEX_API_KEY'];
    else process.env['OPENALEX_API_KEY'] = savedKey;
  }
});

test('SRC-05: the inverted-index abstract, CSL types and identifier forms', () => {
  assert.equal(openalex.abstractFromInvertedIndex({ learning: [1], Deep: [0], 'allows…': [2] }), 'Deep learning allows…');
  assert.equal(openalex.abstractFromInvertedIndex(null), undefined);
  assert.equal(openalex.openAlexCslType('article', 'journal'), 'article-journal');
  assert.equal(openalex.openAlexCslType('article', 'conference'), 'paper-conference');
  assert.equal(openalex.openAlexCslType('book-chapter', null), 'chapter');
  assert.equal(openalex.openAlexCslType('dissertation', null), 'thesis');
  assert.equal(openalex.openAlexCslType('preprint', 'repository'), 'preprint');
  assert.equal(openalex.openAlexCslType('paratext', null), 'other');
  assert.equal(openalex.workPathSegment('W2919115771'), 'W2919115771');
  assert.equal(openalex.workPathSegment('https://openalex.org/w2919115771'), 'W2919115771');
  assert.equal(openalex.workPathSegment('https://doi.org/10.1038/NATURE14539'), 'doi:10.1038%2Fnature14539');
  assert.equal(openalex.workPathSegment('pmid:26017442'), 'pmid:26017442');
  assert.equal(openalex.workPathSegment('not an id'), null);
  const retracted = openalex.openAlexToCandidate({
    id: 'https://openalex.org/W1', title: 'T', authorships: [{ author: { display_name: 'A B' } }], is_retracted: true,
  });
  assert.equal(retracted?.retraction_status, 'retracted');
  assert.equal(retracted?.retracted, true);
});

test('RUN-03: an unrecorded OpenAlex query or id is a typed offline miss — never the first search result', async () => {
  await assertOfflineMiss(() => openalex.fetchById('W0000000000'), 'fetchById miss');
  await assertOfflineMiss(() => openalex.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
});

threeWayContract({
  adapter: 'openalex',
  lookupById: openalex.lookupById,
  fetchById: openalex.fetchById,
  origin: 'https://api.openalex.org',
  idFor: (t) => `10.5555/${t}`,
  pathPrefixFor: (t) => `/works/doi:10.5555/${t}?`,
  found: (t) => ({
    body: {
      id: `https://openalex.org/W${t.length}`,
      doi: `https://doi.org/10.5555/${t}`,
      title: 'A Found Work',
      publication_year: 2021,
      authorships: [{ author: { display_name: 'Fay Found' } }],
      type: 'article',
      primary_location: { source: { display_name: 'Journal of Tests', type: 'journal' } },
      biblio: { volume: '3', issue: '1', first_page: '10', last_page: '20' },
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.doi, `10.5555/${t}`);
    assert.equal(c.venue, 'Journal of Tests');
    assert.equal(c.pages, '10-20');
  },
  invalid: { body: { error: 'Internal error', message: 'something went wrong' } },
  rateLimitReason: /^keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)$/,
  offlineMissId: '10.9999/three-way-offline-miss',
});
