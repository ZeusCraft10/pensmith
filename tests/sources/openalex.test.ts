// tests/sources/openalex.test.ts — OpenAlex adapter (RSCH-03/04, T-3-13).
//
// The search path replays a REAL recording
// (tests/fixtures/cassettes/openalex/search-attention-neural-networks.json,
// `npm run cassettes:refresh -- --only openalex`, CI-07). The recorder lowered
// its result count to 3 to fit the 51200-byte cassette cap (OpenAlex
// authorships are large), so the recorded request is limit 3. fetchById and the
// parser edge cases still use the hand-written SYNTHETIC fixture
// (tests/fixtures/cassettes/synthetic/openalex/), whose request paths match the
// adapter's URLs exactly (select= fields, mailto scrubbed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as openalex from '../../bin/lib/sources/openalex.js';
import { loadCassetteFile } from '../../bin/lib/http-mock.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';

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

test('openalex.search() returns exactly the recorded works for the recorded query (RSCH-03, CI-07)', async () => {
  const [entry] = recorded('openalex', 'search-attention-neural-networks');
  const works = (entry!.response as { results: Work[] }).results;
  const expected = works
    .filter((w) => w.id && w.title && (w.authorships ?? []).some((a) => (a.author?.display_name ?? '').trim()))
    .map((w) => w.id);
  assert.ok(expected.length > 0, 'the recording carries usable works');
  const results = await openalex.search(RECORDED_QUERY, { limit: recordedLimit(entry!.path) });
  assert.deepEqual(results.map((r) => r.id), expected);
  for (const r of results) {
    assert.equal(r.source, 'openalex');
    assert.ok(r.authors.length > 0);
    assert.ok(!r.doi?.startsWith('10.0000/'), 'real records only');
    assert.ok(!r.doi?.startsWith('https://'), 'the doi.org prefix is stripped');
  }
});

test('openalex.search() parses the fixture into SourceCandidate[] with normalized DOIs (RSCH-03)', async () => {
  const fixture = loadCassetteFile('openalex', 'works-attention');
  assert.ok(fixture, 'the synthetic openalex fixture exists');
  const results = await openalex.search('attention mechanisms', { limit: 20 });
  assert.ok(results.length > 0);
  assert.equal(results[0]?.title, 'Attention Is All You Need');
  assert.equal(results[0]?.doi, '10.48550/arxiv.1706.03762', 'https://doi.org/ prefix stripped');
  assert.equal(results[0]?.id, 'https://openalex.org/W2963403868');
  for (const r of results) {
    assert.equal(r.source, 'openalex');
    assert.ok(r.authors.length > 0);
  }
});

test('openalex.fetchById() hydrates exactly the requested W-id (RSCH-04)', async () => {
  const r = await openalex.fetchById('W2741809807');
  assert.ok(r);
  assert.equal(r.source, 'openalex');
  assert.match(r.id, /W2741809807$/);
});

test('RUN-03: an unrecorded OpenAlex query or id is a typed offline miss — never the first search result', async () => {
  await assertOfflineMiss(() => openalex.fetchById('W0000000000'), 'fetchById miss');
  await assertOfflineMiss(() => openalex.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
});
