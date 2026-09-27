// tests/sources/crossref.test.ts — Crossref adapter against RECORDED cassettes
// (RSCH-03/04, T-3-13, CI-07). Offline replay is exact-match only (RUN-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crossref from '../../bin/lib/sources/crossref.js';
import { RECORDED_QUERY, RECORDED_DOI, RECORDED_CROSSREF_404_DOI, recorded, assertOfflineMiss } from './recorded.js';

interface Item {
  DOI?: string;
  title?: string[];
  author?: Array<{ family?: string; given?: string }>;
  issued?: { 'date-parts'?: number[][] };
}

test('crossref.search() returns exactly the recorded works for the recorded query (RSCH-03)', async () => {
  const [entry] = recorded('crossref', 'search-attention-neural-networks');
  const items = ((entry!.response as { message: { items: Item[] } }).message.items);
  const expected = items
    .filter((i) => i.DOI && i.title?.[0] && (i.author ?? []).some((a) => (a.family ?? '').trim()))
    .map((i) => i.DOI);
  assert.ok(expected.length > 0, 'the recording carries usable works');

  const results = await crossref.search(RECORDED_QUERY, { limit: 10 });
  assert.deepEqual(results.map((r) => r.doi), expected);
  for (const r of results) {
    assert.equal(r.source, 'crossref');
    assert.equal(r.id, r.doi);
    assert.match(r.citekey, /^[a-z][a-z0-9_-]*$/);
    assert.ok(r.authors.length > 0 && r.authors.every((a) => a.length > 0));
    assert.equal(r.retracted, false);
  }
});

test('crossref.fetchById() hydrates the recorded work for exactly that DOI (RSCH-04)', async () => {
  const [entry] = recorded('crossref', 'works-nphys1170');
  const msg = (entry!.response as { message: Item }).message;
  const r = await crossref.fetchById(RECORDED_DOI);
  assert.ok(r, 'the recorded DOI resolves');
  assert.equal(r.doi?.toLowerCase(), RECORDED_DOI);
  assert.equal(r.title, msg.title?.[0]);
  assert.equal(r.authors[0], `${msg.author?.[0]?.family}, ${msg.author?.[0]?.given}`);
  assert.equal(r.year, msg.issued?.['date-parts']?.[0]?.[0]);
});

test('crossref.fetchById() of a DOI Crossref does not know returns null (a recorded 404, not a fallback)', async () => {
  const [entry] = recorded('crossref', 'works-arxiv-doi-404');
  assert.equal(entry!.status, 404);
  assert.equal(await crossref.fetchById(RECORDED_CROSSREF_404_DOI), null);
});

test('RUN-03: an unrecorded DOI or query is a typed offline miss — never the first search item', async () => {
  await assertOfflineMiss(() => crossref.fetchById('10.9999/not-recorded'), 'fetchById miss');
  await assertOfflineMiss(() => crossref.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  // Exact means exact: the recorded query at a different result count is a different request.
  await assertOfflineMiss(() => crossref.search(RECORDED_QUERY, { limit: 7 }), 'limit mismatch');
});
