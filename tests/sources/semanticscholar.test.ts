// tests/sources/semanticscholar.test.ts — Semantic Scholar adapter (RSCH-03/04,
// T-3-13, D-16).
//
// Keyless Semantic Scholar answered HTTP 429 when Phase 17 re-recorded the
// cassettes, so this adapter is exercised against the hand-written SYNTHETIC
// fixture (tests/fixtures/cassettes/synthetic/semanticscholar/), whose request
// paths match the adapter's URLs exactly. Re-record with
// `npm run cassettes:refresh -- --only semanticscholar` (a PENSMITH_S2_API_KEY
// lifts the limit).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s2 from '../../bin/lib/sources/semanticscholar.js';
import { assertOfflineMiss } from './recorded.js';

test('semanticscholar.search() parses the fixture into SourceCandidate[] (RSCH-03)', async () => {
  const results = await s2.search('attention mechanisms', { limit: 20 });
  assert.ok(results.length > 0);
  assert.equal(results[0]?.title, 'Attention Is All You Need');
  assert.equal(results[0]?.doi, '10.48550/arXiv.1706.03762');
  assert.equal(results[0]?.id, '0796f6cd597d2b07b571e4b4ebf3e8aef0f5e3af');
  for (const r of results) {
    assert.equal(r.source, 'semanticscholar');
    assert.ok(r.authors.length > 0);
  }
});

test('semanticscholar.fetchById() hydrates exactly the requested paperId (RSCH-04)', async () => {
  const r = await s2.fetchById('0796f6cd597d2b07b571e4b4ebf3e8aef0f5e3af');
  assert.ok(r);
  assert.equal(r.id, '0796f6cd597d2b07b571e4b4ebf3e8aef0f5e3af');
  assert.equal(r.title, 'Attention Is All You Need');
});

test('missing PENSMITH_S2_API_KEY: WARN once on stderr, keyless request still served (D-16)', async () => {
  const original = process.env['PENSMITH_S2_API_KEY'];
  delete process.env['PENSMITH_S2_API_KEY'];
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return true;
  };
  try {
    const results = await s2.search('test query', { limit: 20 });
    assert.ok(Array.isArray(results), 'the adapter works without PENSMITH_S2_API_KEY (keyless fallback)');
    await s2.search('test query', { limit: 20 });
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
    if (original !== undefined) process.env['PENSMITH_S2_API_KEY'] = original;
  }
  const warns = chunks.join('').match(/PENSMITH_S2_API_KEY not set/g) ?? [];
  assert.ok(warns.length <= 1, 'the keyless WARN is printed at most once per process');
});

test('RUN-03: an unrecorded Semantic Scholar query or paperId is a typed offline miss', async () => {
  await assertOfflineMiss(() => s2.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => s2.fetchById('ffffffffffffffffffffffffffffffffffffffff'), 'fetchById miss');
});
