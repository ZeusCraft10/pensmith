// tests/sources/semanticscholar.test.ts — Semantic Scholar adapter (RSCH-03/04,
// SRC-05, SRC-06, SRC-17, T-3-13, D-16) against a REAL recording
// (`npm run cassettes:refresh -- --only semanticscholar`) and the three-way
// lookup contract (D-19-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s2 from '../../bin/lib/sources/semanticscholar.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, liveLane, uniq } from './three-way.js';

interface Paper {
  paperId?: string;
  title?: string;
  venue?: string;
  journal?: { name?: string; volume?: string; pages?: string } | null;
  externalIds?: { DOI?: string; ArXiv?: string };
  publicationTypes?: string[] | null;
  abstract?: string | null;
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; text: string }> {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return true;
  };
  try {
    const result = await fn();
    return { result, text: chunks.join('') };
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
}

test('semanticscholar.search() parses the REAL recorded response — venue, externalIds, types (null abstracts included)', async () => {
  const [entry] = recorded('semanticscholar', 'search-attention-neural-networks');
  const data = (entry!.response as { data: Paper[] }).data;
  const results = await s2.search(RECORDED_QUERY, { limit: 10 });
  assert.equal(results.length, data.length, 'every recorded paper parses — none is dropped for a null abstract');
  results.forEach((r, i) => {
    const p = data[i]!;
    assert.equal(r.source, 'semanticscholar');
    assert.equal(r.id, p.paperId);
    assert.equal(r.title, p.title);
    assert.equal(r.venue, p.journal?.name?.trim() || p.venue?.trim() || undefined);
    assert.equal(r.doi, p.externalIds?.DOI);
    assert.equal(r.arxiv, p.externalIds?.ArXiv);
    if ((p.publicationTypes ?? []).length > 0) assert.ok(r.type !== undefined);
    assert.ok(SourceCandidateSchema.safeParse(r).success);
  });
  assert.equal(results[0]?.title, 'Attention mechanisms in neural networks');
  assert.ok(results.some((r) => r.pages !== undefined), 'journal pages are kept');
});

test('SRC-06: the keyless notice describes the shared pool (once per run); with a key, x-api-key is sent', async () => {
  const saved = process.env['PENSMITH_S2_API_KEY'];
  delete process.env['PENSMITH_S2_API_KEY'];
  s2._resetS2NoticeForTest();
  try {
    const { text } = await captureStderr(async () => {
      await s2.search(RECORDED_QUERY, { limit: 10 });
      await s2.search(RECORDED_QUERY, { limit: 10 });
    });
    const notices = text.split('\n').filter((l) => l.includes('PENSMITH_S2_API_KEY'));
    assert.deepEqual(notices, [s2.S2_KEYLESS_NOTICE]);
    assert.match(s2.S2_KEYLESS_NOTICE, /shared keyless pool/);

    process.env['PENSMITH_S2_API_KEY'] = 's2-test-key';
    await liveLane(async (agent) => {
      let key: string | undefined;
      agent
        .get('https://api.semanticscholar.org')
        .intercept({
          path: (p: string) => p.startsWith('/graph/v1/paper/search?'),
          method: 'GET',
          headers: (h: Record<string, string>) => {
            key = h['x-api-key'];
            return true;
          },
        })
        .reply(200, JSON.stringify({ total: 0, offset: 0 }), { headers: { 'content-type': 'application/json' } });
      assert.deepEqual(await s2.search(uniq('s2 keyed'), { limit: 2, fromYear: 2018 }), [], 'total 0 without data is an empty answer');
      assert.equal(key, 's2-test-key');
    });
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_S2_API_KEY'];
    else process.env['PENSMITH_S2_API_KEY'] = saved;
  }
});

test('SRC-17: a keyless 429 reads "HTTP 429 — rate limited; set PENSMITH_S2_API_KEY"; fromYear → year=<from>-', async () => {
  const saved = process.env['PENSMITH_S2_API_KEY'];
  delete process.env['PENSMITH_S2_API_KEY'];
  try {
    await liveLane(async (agent) => {
      const seen: string[] = [];
      agent
        .get('https://api.semanticscholar.org')
        .intercept({ path: (p: string) => { seen.push(p); return p.startsWith('/graph/v1/paper/search?'); }, method: 'GET' })
        .reply(429, JSON.stringify({ message: 'Too Many Requests.', code: '429' }), { headers: { 'content-type': 'application/json', 'retry-after': '0' } })
        .persist();
      const reasons: string[] = [];
      const hits = await captureStderr(() => s2.search(uniq('s2 keyless'), { limit: 3, fromYear: 2015, onFailure: (r) => reasons.push(r) }));
      assert.deepEqual(hits.result, []);
      assert.deepEqual(reasons, [s2.S2_KEYLESS_429_REASON]);
      assert.equal(s2.S2_KEYLESS_429_REASON, 'HTTP 429 — rate limited; set PENSMITH_S2_API_KEY');
      assert.equal(new URL(`https://api.semanticscholar.org${seen.at(-1)}`).searchParams.get('year'), '2015-');
    });
  } finally {
    if (saved !== undefined) process.env['PENSMITH_S2_API_KEY'] = saved;
  }
});

test('SRC-05: publication types → CSL, identifier forms', () => {
  assert.equal(s2.s2CslType(['JournalArticle', 'Conference']), 'paper-conference');
  assert.equal(s2.s2CslType(['JournalArticle', 'Review']), 'article-journal');
  assert.equal(s2.s2CslType(['Book']), 'book');
  assert.equal(s2.s2CslType([]), undefined);
  assert.equal(s2.paperPathSegment('0796F6CD597D2B07B571E4B4EBF3E8AEF0F5E3AF'), '0796f6cd597d2b07b571e4b4ebf3e8aef0f5e3af');
  assert.equal(s2.paperPathSegment('10.1038/nature14539'), 'DOI:10.1038%2Fnature14539');
  assert.equal(s2.paperPathSegment('arxiv:1706.03762'), 'ARXIV:1706.03762');
  assert.equal(s2.paperPathSegment('corpusid:123'), 'CorpusId:123');
  assert.equal(s2.paperPathSegment('???'), null);
});

test('RUN-03: an unrecorded Semantic Scholar query or paperId is a typed offline miss', async () => {
  await assertOfflineMiss(() => s2.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => s2.fetchById('ffffffffffffffffffffffffffffffffffffffff'), 'fetchById miss');
});

test('live Semantic Scholar shape: a null abstract or missing DOI keeps the candidate (MockAgent lane)', async () => {
  await liveLane(async (agent) => {
    const query = uniq('null abstract');
    agent
      .get('https://api.semanticscholar.org')
      .intercept({ path: (p: string) => p.startsWith('/graph/v1/paper/search?') && p.includes('query=null+abstract'), method: 'GET' })
      .reply(200, JSON.stringify({
        data: [
          {
            paperId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            externalIds: { CorpusId: 1 },
            title: 'Old Norse-Icelandic Sagas',
            year: 2014,
            authors: [{ name: 'Russell Poole' }],
            abstract: null,
            journal: null,
            publicationTypes: null,
          },
        ],
      }), { headers: { 'content-type': 'application/json' } });
    const results = await captureStderr(() => s2.search(query, { limit: 1 }));
    assert.equal(results.result.length, 1, 'the candidate survives');
    assert.equal(results.result[0]?.abstract, undefined);
    assert.equal(results.result[0]?.doi, undefined);
    assert.equal(results.result[0]?.title, 'Old Norse-Icelandic Sagas');
  });
});

threeWayContract({
  adapter: 'semanticscholar',
  lookupById: s2.lookupById,
  fetchById: s2.fetchById,
  origin: 'https://api.semanticscholar.org',
  idFor: (t) => `10.5555/${t}`,
  pathPrefixFor: (t) => `/graph/v1/paper/DOI:10.5555/${t}?`,
  found: (t) => ({
    body: {
      paperId: 'b'.repeat(40),
      externalIds: { DOI: `10.5555/${t}`, PubMed: '123456' },
      title: 'A Found Paper',
      year: 2022,
      authors: [{ authorId: '1', name: 'Fay Found' }],
      venue: 'J Tests',
      publicationTypes: ['JournalArticle'],
      journal: { name: 'Journal of Tests', volume: '7', pages: ' 1 - 9' },
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.doi, `10.5555/${t}`);
    assert.equal(c.venue, 'Journal of Tests');
    assert.equal(c.pages, '1-9');
    assert.equal(c.pmid, '123456');
    assert.equal(c.type, 'article-journal');
  },
  invalid: (m) => ({ body: { message: `Internal Server Error ${m}` } }),
  rateLimitReason: /^HTTP 429 — rate limited; set PENSMITH_S2_API_KEY$/,
  offlineMissId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
});

test('SRC-12: a Semantic Scholar author that is a collaboration is one braced name, keyed by its name', () => {
  const c = s2.s2ToCandidate({ paperId: 'abc', title: 'Gemini: a family of highly capable multimodal models', year: 2023, authors: [{ name: 'Gemini Team' }] });
  assert.deepEqual(c?.authors, ['{Gemini Team}']);
  assert.equal(c?.citekey, 'gemini2023');
});
