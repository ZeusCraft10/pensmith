// tests/sources/pubmed.test.ts — PubMed E-utilities adapter against RECORDED
// cassettes (two-step esearch → esummary; RSCH-03/04, T-3-13, CI-07).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pubmed from '../../bin/lib/sources/pubmed.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';

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
    assert.equal(r.title, String(summary[r.id]?.title).trim());
    assert.ok(r.authors.length > 0);
  }
});

test('RUN-03: an unrecorded PubMed query or PMID is a typed offline miss', async () => {
  await assertOfflineMiss(() => pubmed.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => pubmed.fetchById('12345678'), 'fetchById miss');
});
