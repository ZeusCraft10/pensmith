// tests/sources/arxiv.test.ts — arXiv adapter against RECORDED cassettes (https,
// CI-07; RSCH-03/04, SRC-02, SRC-05, T-3-13) and the three-way lookup contract
// (D-19-05). Offline replay is exact-match only (RUN-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as arxiv from '../../bin/lib/sources/arxiv.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, RECORDED_ARXIV_ID, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract } from './three-way.js';

function entryTitles(xml: string): string[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].map((m) => {
    const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[1] ?? '');
    return (t?.[1] ?? '').replace(/\s+/g, ' ').trim();
  });
}

test('arxiv: the recorded cassettes come from the https endpoint (the http host answers 301)', () => {
  for (const name of ['search-attention-neural-networks', 'id-1706.03762', 'id-hep-th-9901001']) {
    for (const e of recorded('arxiv', name)) assert.equal(e.scope, 'https://export.arxiv.org');
  }
});

test('arxiv.search() parses every recorded Atom entry into a complete preprint (RSCH-03, SRC-02)', async () => {
  const [entry] = recorded('arxiv', 'search-attention-neural-networks');
  const titles = entryTitles(String(entry!.response));
  assert.ok(titles.length > 0);
  const results = await arxiv.search(RECORDED_QUERY, { limit: 10 });
  assert.deepEqual(results.map((r) => r.title), titles);
  for (const r of results) {
    assert.equal(r.source, 'arxiv');
    assert.match(r.id, /^https?:\/\/arxiv\.org\/abs\//);
    assert.match(r.arxiv ?? '', /^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/, 'the bare, versionless arXiv id');
    assert.ok(r.authors.length > 0);
    assert.ok(typeof r.year === 'number' && r.year >= 1991);
    assert.equal(r.type, 'preprint');
    assert.ok((r.abstract ?? '').length > 0, 'the summary is the abstract');
    assert.ok(SourceCandidateSchema.safeParse(r).success);
  }
});

test('SRC-02: lookupById(1706.03762) → "Attention Is All You Need" with arxiv, abstract, type (recorded)', async () => {
  const r = await arxiv.lookupById(RECORDED_ARXIV_ID);
  assert.equal(r.kind, 'found');
  if (r.kind !== 'found') return;
  const c = r.candidate;
  assert.equal(c.title, 'Attention Is All You Need');
  assert.equal(c.arxiv, '1706.03762');
  assert.equal(c.year, 2017);
  assert.equal(c.type, 'preprint');
  assert.equal(c.authors[0], 'Ashish Vaswani');
  assert.equal(c.authors.length, 8);
  assert.match(c.abstract ?? '', /^The dominant sequence transduction models/);
  assert.equal(c.citekey, 'vaswani2017');
});

test('SRC-02: every spelling of the id resolves to the same recorded paper (prefix, URL, version, trailing period)', async () => {
  for (const spelling of ['arXiv:1706.03762', 'arxiv:1706.03762v7', 'https://arxiv.org/abs/1706.03762v2', 'https://arxiv.org/pdf/1706.03762.pdf', '1706.03762.']) {
    const c = await arxiv.fetchById(spelling);
    assert.equal(c?.arxiv, '1706.03762', spelling);
  }
});

test('SRC-02: an old-style id (hep-th/9901001v2) → the DOI and journal reference of the published version (recorded)', async () => {
  const c = await arxiv.fetchById('hep-th/9901001v2');
  assert.ok(c);
  assert.equal(c.arxiv, 'hep-th/9901001');
  assert.equal(c.title, 'String Junctions and Their Duals in Heterotic String Theory');
  assert.equal(c.doi, '10.1143/PTP.101.1155');
  assert.equal(c.venue, 'Prog.Theor.Phys.101:1155-1164,1999');
  assert.deepEqual(c.authors, ['Yosuke Imamura']);
  assert.equal(c.year, 1999);
  // Upper-case archive and a subject class are the same paper id.
  assert.equal(arxiv.canonicalArxivId('HEP-TH/9901001'), 'hep-th/9901001');
  assert.equal(arxiv.canonicalArxivId('math.GT/0309136'), 'math/0309136');
  assert.equal(arxiv.canonicalArxivId('arXiv:math.GT/0309136v1'), 'math/0309136');
});

test('lookupById of something that is not an arXiv id is not-found without a request', async () => {
  const r = await arxiv.lookupById('not-an-id');
  assert.equal(r.kind, 'not-found');
});

test('RUN-03: an unrecorded arXiv query or id is a typed offline miss', async () => {
  await assertOfflineMiss(() => arxiv.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => arxiv.fetchById('2101.00001'), 'fetchById miss');
});

function atomEntry(id: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <title>A Found Preprint</title>
    <summary>An abstract.</summary>
    <published>2021-03-04T00:00:00Z</published>
    <author><name>Fay Found</name></author>
    <arxiv:journal_ref>J. Tests 1 (2021) 1-2</arxiv:journal_ref>
  </entry>
</feed>`;
}

/** A modern arXiv id per token (the contract needs unique ids). */
const idFor = (t: string): string => {
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `2${String(h % 1000).padStart(3, '0')}.${String(h % 100000).padStart(5, '0')}`;
};

threeWayContract({
  adapter: 'arxiv',
  lookupById: arxiv.lookupById,
  fetchById: arxiv.fetchById,
  origin: 'https://export.arxiv.org',
  idFor,
  pathPrefixFor: (t) => `/api/query?id_list=${idFor(t)}`,
  found: (t) => ({ body: atomEntry(idFor(t)), contentType: 'application/atom+xml' }),
  checkFound: (c, t) => {
    assert.equal(c.arxiv, idFor(t));
    assert.equal(c.venue, 'J. Tests 1 (2021) 1-2');
    assert.equal(c.type, 'preprint');
  },
  invalid: { body: '<!doctype html><html><body>Rate exceeded.</body></html>', contentType: 'text/html' },
  offlineMissId: '2101.00002',
});
