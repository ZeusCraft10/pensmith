// tests/sources/semanticscholar.test.ts — Semantic Scholar adapter (RSCH-03/04,
// T-3-13, D-16).
//
// The search path replays a REAL recording
// (tests/fixtures/cassettes/semanticscholar/search-attention-neural-networks.json,
// `npm run cassettes:refresh -- --only semanticscholar`; a PENSMITH_S2_API_KEY
// lifts the keyless rate limit). fetchById and the parser edge cases still use
// the hand-written SYNTHETIC fixture (tests/fixtures/cassettes/synthetic/
// semanticscholar/), whose request paths match the adapter's URLs exactly.

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

test('semanticscholar.search() parses the REAL recorded response (null abstracts included)', async () => {
  const results = await s2.search('attention mechanisms in neural networks', { limit: 10 });
  assert.equal(results.length, 10, 'every recorded paper parses — none is dropped for a null abstract');
  assert.equal(results[0]?.title, 'Attention mechanisms in neural networks');
  assert.ok(results.some((r) => r.abstract === undefined), 'the recording holds papers without an abstract');
  for (const r of results) {
    assert.equal(r.source, 'semanticscholar');
    assert.ok(r.authors.length > 0);
    assert.ok(!r.doi?.startsWith('10.0000/'), 'real records only');
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

test('live Semantic Scholar shape: a null abstract or missing DOI keeps the candidate (MockAgent lane)', async () => {
  // The live API answers `"abstract": null` for many papers and omits DOI from
  // externalIds; neither may drop an otherwise valid candidate.
  const { installMockAgent } = await import('../helpers/local-servers/mock-agent.js');
  const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  const { agent, restore } = installMockAgent();
  const query = `null abstract ${process.pid}-${Date.now()}`;
  try {
    agent
      .get('https://api.semanticscholar.org')
      .intercept({ path: (p: string) => p.startsWith('/graph/v1/paper/search?') && p.includes('query=null+abstract'), method: 'GET' })
      .reply(200, {
        data: [
          {
            paperId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            externalIds: { CorpusId: 1 },
            title: 'Old Norse-Icelandic Sagas',
            year: 2014,
            authors: [{ name: 'Russell Poole' }],
            abstract: null,
          },
        ],
      }, { headers: { 'content-type': 'application/json' } });
    const results = await s2.search(query, { limit: 1 });
    assert.equal(results.length, 1, 'the candidate survives');
    assert.equal(results[0]?.abstract, undefined);
    assert.equal(results[0]?.doi, undefined);
    assert.equal(results[0]?.title, 'Old Norse-Icelandic Sagas');
  } finally {
    await restore();
    if (savedLane === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
  }
});
