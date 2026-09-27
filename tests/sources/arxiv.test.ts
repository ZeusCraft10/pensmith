// tests/sources/arxiv.test.ts — arXiv adapter against RECORDED cassettes (https,
// CI-07; RSCH-03/04, T-3-13). Offline replay is exact-match only (RUN-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as arxiv from '../../bin/lib/sources/arxiv.js';
import { RECORDED_QUERY, RECORDED_ARXIV_ID, recorded, assertOfflineMiss } from './recorded.js';

function entryTitles(xml: string): string[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].map((m) => {
    const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[1] ?? '');
    return (t?.[1] ?? '').replace(/\s+/g, ' ').trim();
  });
}

test('arxiv: the recorded cassettes come from the https endpoint (the http host answers 301)', () => {
  for (const name of ['search-attention-neural-networks', 'id-1706.03762']) {
    for (const e of recorded('arxiv', name)) assert.equal(e.scope, 'https://export.arxiv.org');
  }
});

test('arxiv.search() parses every recorded Atom entry (RSCH-03)', async () => {
  const [entry] = recorded('arxiv', 'search-attention-neural-networks');
  const titles = entryTitles(String(entry!.response));
  assert.ok(titles.length > 0);
  const results = await arxiv.search(RECORDED_QUERY, { limit: 10 });
  assert.deepEqual(results.map((r) => r.title), titles);
  for (const r of results) {
    assert.equal(r.source, 'arxiv');
    assert.match(r.id, /^https?:\/\/arxiv\.org\/abs\//);
    assert.ok(r.authors.length > 0);
    assert.ok(typeof r.year === 'number' && r.year >= 1991);
  }
});

test('arxiv.fetchById() hydrates the recorded id (RSCH-04)', async () => {
  const r = await arxiv.fetchById(RECORDED_ARXIV_ID);
  assert.ok(r, 'the recorded id resolves');
  assert.equal(r.title, 'Attention Is All You Need');
  assert.match(r.id, /1706\.03762/);
  assert.equal(r.year, 2017);
  assert.ok(r.authors.includes('Ashish Vaswani'));
});

test('RUN-03: an unrecorded arXiv query or id is a typed offline miss', async () => {
  await assertOfflineMiss(() => arxiv.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => arxiv.fetchById('2101.00001'), 'fetchById miss');
});
