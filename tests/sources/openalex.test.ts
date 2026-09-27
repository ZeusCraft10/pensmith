// tests/sources/openalex.test.ts — OpenAlex adapter (RSCH-03/04, T-3-13).
//
// OpenAlex's keyless budget is shared per IP and was exhausted when Phase 17
// re-recorded the cassettes, so this adapter is exercised against the
// hand-written SYNTHETIC fixture (tests/fixtures/cassettes/synthetic/openalex/),
// whose request path matches the adapter's current URL (select= fields,
// mailto scrubbed). Re-record with `npm run cassettes:refresh -- --only openalex`
// (see CONTRIBUTING.md); the recorded query is RECORDED_QUERY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as openalex from '../../bin/lib/sources/openalex.js';
import { loadCassetteFile } from '../../bin/lib/http-mock.js';
import { assertOfflineMiss } from './recorded.js';

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
