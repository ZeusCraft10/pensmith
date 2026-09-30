// tests/sources/pubmed.test.ts — PubMed E-utilities adapter against RECORDED
// cassettes (two-step esearch → esummary; RSCH-03/04, SRC-05, T-3-13, CI-07) and
// the three-way lookup contract (D-19-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pubmed from '../../bin/lib/sources/pubmed.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { RECORDED_QUERY, recorded, assertOfflineMiss } from './recorded.js';
import { threeWayContract, liveLane, uniq, idDigits } from './three-way.js';

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
    assert.equal(r.pmid, r.id);
    // The trailing period PubMed puts on every title is punctuation, not title.
    assert.equal(r.title, String(summary[r.id]?.title).trim().replace(/\.$/, ''));
    assert.ok(r.authors.length > 0);
    assert.ok(r.venue !== undefined, 'the journal is the venue');
    assert.ok(SourceCandidateSchema.safeParse(r).success);
  }
});

test('SRC-05: PMID 31978945 — NEJM 382(8) 727-733, DOI, PMCID, the group author braced (recorded)', async () => {
  for (const spelling of ['31978945', 'PMID:31978945', 'pmid:31978945']) {
    const r = await pubmed.lookupById(spelling);
    assert.equal(r.kind, 'found', spelling);
    if (r.kind !== 'found') continue;
    const c = r.candidate;
    assert.equal(c.pmid, '31978945');
    assert.equal(c.doi, '10.1056/NEJMoa2001017');
    assert.equal(c.pmcid, 'PMC7092803');
    assert.equal(c.title, 'A Novel Coronavirus from Patients with Pneumonia in China, 2019');
    assert.equal(c.venue, 'The New England journal of medicine');
    assert.equal(c.volume, '382');
    assert.equal(c.issue, '8');
    assert.equal(c.pages, '727-733');
    assert.equal(c.year, 2020);
    assert.equal(c.type, 'article-journal');
    assert.equal(c.authors[0], 'Zhu, N.', 'PubMed "Zhu N" is written Family, Initials (SRC-12)');
    assert.equal(c.citekey, 'zhu2020');
    assert.equal(c.authors.at(-1), '{China Novel Coronavirus Investigating and Research Team}');
  }
});

test('SRC-10: fromYear → datetype=pdat&mindate=<year>&maxdate=3000 (esearch)', async () => {
  await liveLane(async (agent) => {
    const seen: string[] = [];
    agent
      .get('https://eutils.ncbi.nlm.nih.gov')
      .intercept({ path: (p: string) => { seen.push(p); return p.includes('/esearch.fcgi?'); }, method: 'GET' })
      .reply(200, JSON.stringify({ esearchresult: { count: '0', idlist: [] } }), { headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await pubmed.search(uniq('pubmed min year'), { limit: 5, fromYear: 2015 }), []);
    const url = new URL(`https://eutils.ncbi.nlm.nih.gov${seen.at(-1)}`);
    assert.equal(url.searchParams.get('mindate'), '2015');
    assert.equal(url.searchParams.get('maxdate'), '3000');
    assert.equal(url.searchParams.get('datetype'), 'pdat');
  });
});

test('RUN-03: an unrecorded PubMed query or PMID is a typed offline miss', async () => {
  await assertOfflineMiss(() => pubmed.search('medieval Icelandic sagas', { limit: 10 }), 'search miss');
  await assertOfflineMiss(() => pubmed.fetchById('12345678'), 'fetchById miss');
});

test('not-found: esummary answers a per-record error for an unknown PMID', async () => {
  await liveLane(async (agent) => {
    agent
      .get('https://eutils.ncbi.nlm.nih.gov')
      .intercept({ path: (p: string) => p.includes('/esummary.fcgi?') && p.includes('id=999999998'), method: 'GET' })
      .reply(200, JSON.stringify({ header: { type: 'esummary' }, result: { uids: ['999999998'], '999999998': { uid: '999999998', error: 'cannot get document summary' } } }), { headers: { 'content-type': 'application/json' } });
    const r = await pubmed.lookupById('999999998');
    assert.equal(r.kind, 'not-found');
    assert.match(r.kind === 'not-found' ? r.reason : '', /cannot get document summary/);
  });
});

/**
 * A PMID of its own per token (the contract needs unique ids): `9<pid>0<serial>`
 * from idDigits, never a hash of the token (CI run 72). Nine digits from
 * 900000001 to 999909999: no real PMID, and none of this file's fixed ones.
 */
const idFor = (t: string): string => `9${idDigits(t)}`;

threeWayContract({
  adapter: 'pubmed',
  lookupById: pubmed.lookupById,
  fetchById: pubmed.fetchById,
  origin: 'https://eutils.ncbi.nlm.nih.gov',
  idFor,
  pathPrefixFor: (t) => `/entrez/eutils/esummary.fcgi?db=pubmed&id=${idFor(t)}&`,
  found: (t) => ({
    body: {
      header: { type: 'esummary', version: '0.3' },
      result: {
        uids: [idFor(t)],
        [idFor(t)]: {
          uid: idFor(t),
          title: 'A found article.',
          authors: [{ name: 'Found F', authtype: 'Author' }],
          pubdate: '2019 Jul',
          fulljournalname: 'Journal of Tests',
          volume: '4',
          issue: '2',
          pages: '1-9',
          pubtype: ['Journal Article'],
          articleids: [{ idtype: 'pubmed', value: idFor(t) }, { idtype: 'doi', value: `10.5555/${t}` }],
        },
      },
    },
  }),
  checkFound: (c, t) => {
    assert.equal(c.pmid, idFor(t));
    assert.equal(c.title, 'A found article');
    assert.equal(c.doi, `10.5555/${t}`);
    assert.equal(c.venue, 'Journal of Tests');
  },
  invalid: (m) => ({ body: { error: `API rate limit exceeded ${m}`, count: '4' } }),
  offlineMissId: '12345679',
});

// ---------------------------------------------------------------------------
// Abstracts and PMCIDs through efetch (Phase 20 carry-over 3, D-20-16):
// batched ≤ 200 ids per request; a failure is named (search: the adapter's
// status note; lookupById: raw.abstractNote), never fatal.
// ---------------------------------------------------------------------------

test('D-20-16: lookupById adds the efetch abstract and the article\'s own PMCID (recorded: esummary + efetch)', async () => {
  const [entry] = recorded('pubmed', 'efetch-31978945');
  assert.equal(`${entry!.scope}${entry!.path}`, pubmed.efetchUrl(['31978945']), 'the exact recorded efetch request');
  const c = await pubmed.fetchById('31978945');
  assert.ok(c);
  assert.match(c.abstract ?? '', /^In December 2019, a cluster of patients with pneumonia of unknown cause was linked to a seafood wholesale market in Wuhan, China\./);
  assert.equal(c.pmcid, 'PMC7092803', 'its own PMCID — never a cited reference\'s (the recorded reference list carries others)');
  assert.equal((c.raw as Record<string, unknown>)['abstractNote'], undefined, 'no failure to name');
  const istic = await pubmed.fetchById('42706103');
  assert.match(istic?.abstract ?? '', /^Peritoneal metastasis is a common manifestation of advanced malignant tumors\./);
});

test('D-20-16: `abstract: false` skips efetch (Pass 1 compares metadata only) — no efetch request is made', async () => {
  // 31535829 has a recorded esummary and no recorded efetch: asking for the abstract would be an offline miss.
  const r = await pubmed.lookupById('31535829', { abstract: false });
  assert.equal(r.kind, 'found', JSON.stringify(r));
  assert.equal(r.kind === 'found' ? r.candidate.abstract : 'x', undefined);
});

test('D-20-16: offline with no recorded efetch, lookupById still finds the record and NAMES the missing abstract — never fails', async () => {
  const r = await pubmed.lookupById('31535829');
  assert.equal(r.kind, 'found', JSON.stringify(r));
  if (r.kind !== 'found') return;
  assert.match(String((r.candidate.raw as Record<string, unknown>)['abstractNote']), /^abstract unavailable \(.*no recorded fixture for the efetch request — re-run online\)$/);
});

test('parseEfetchArticles: structured abstracts joined "LABEL: text", markup and entities out, a book article, and a cited reference\'s PMC id never read', () => {
  const xml = [
    '<?xml version="1.0" ?><PubmedArticleSet>',
    '<PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><Article><Abstract>',
    '<AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Cells <i>in vitro</i> &amp; in vivo.</AbstractText>',
    '<AbstractText Label="RESULTS">It worked (<b>p</b> &lt; 0.05) in H<sub>2</sub>O .</AbstractText>',
    '<AbstractText Label="UNLABELLED">Plain part.</AbstractText>',
    '</Abstract></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">111</ArticleId><ArticleId IdType="pmc">PMC111</ArticleId></ArticleIdList>',
    '<ReferenceList><Reference><ArticleIdList><ArticleId IdType="pmc">PMC999</ArticleId></ArticleIdList></Reference></ReferenceList></PubmedData></PubmedArticle>',
    '<PubmedArticle><MedlineCitation><PMID Version="1">222</PMID><Article></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">222</ArticleId></ArticleIdList>',
    '<ReferenceList><Reference><ArticleIdList><ArticleId IdType="pmc">PMC888</ArticleId></ArticleIdList></Reference></ReferenceList></PubmedData></PubmedArticle>',
    '<PubmedBookArticle><BookDocument><PMID Version="1">333</PMID><Abstract><AbstractText>A book chapter.</AbstractText></Abstract></BookDocument></PubmedBookArticle>',
    '</PubmedArticleSet>',
  ].join('');
  const facts = pubmed.parseEfetchArticles(xml);
  assert.deepEqual(facts.get('111'), { abstract: 'BACKGROUND: Cells in vitro & in vivo. RESULTS: It worked (p < 0.05) in H2O. Plain part.', pmcid: 'PMC111' });
  assert.deepEqual(facts.get('222'), {}, 'no abstract, and the reference list\'s PMC888 is not this article\'s');
  assert.deepEqual(facts.get('333'), { abstract: 'A book chapter.' });
});

test('D-20-16 (MockAgent): efetch is asked in batches of at most 200 ids', async () => {
  await liveLane(async (agent) => {
    const seen: string[] = [];
    agent
      .get('https://eutils.ncbi.nlm.nih.gov')
      .intercept({ path: (p: string) => { if (p.includes('/efetch.fcgi?')) seen.push(p); return p.includes('/efetch.fcgi?'); }, method: 'GET' })
      .reply(200, '<?xml version="1.0" ?><PubmedArticleSet></PubmedArticleSet>', { headers: { 'content-type': 'text/xml' } })
      .persist();
    const base = 700_000_000 + (process.pid % 1000) * 1000;
    const ids = Array.from({ length: pubmed.EFETCH_BATCH + 1 }, (_, i) => String(base + i));
    const { facts, failure } = await pubmed.fetchAbstracts(ids);
    assert.equal(failure, null);
    assert.equal(facts.size, 0);
    assert.equal(seen.length, 2, 'two requests');
    const counts = seen.map((p) => decodeURIComponent(new URL(`https://x${p}`).searchParams.get('id') ?? '').split(',').length);
    assert.deepEqual(counts, [200, 1]);
  });
});

test('D-20-16 (MockAgent): an efetch failure never fails the search — the candidates come back without abstracts and the adapter status names it', async () => {
  await liveLane(async (agent) => {
    const pmid = String(800_000_000 + (process.pid % 1000));
    const pool = agent.get('https://eutils.ncbi.nlm.nih.gov');
    pool
      .intercept({ path: (p: string) => p.includes('/esearch.fcgi?'), method: 'GET' })
      .reply(200, JSON.stringify({ esearchresult: { count: '1', idlist: [pmid] } }), { headers: { 'content-type': 'application/json' } });
    pool
      .intercept({ path: (p: string) => p.includes('/esummary.fcgi?'), method: 'GET' })
      .reply(200, JSON.stringify({ header: { type: 'esummary' }, result: { uids: [pmid], [pmid]: { uid: pmid, title: 'An article.', authors: [{ name: 'Doe J', authtype: 'Author' }], pubdate: '2020', fulljournalname: 'J', articleids: [{ idtype: 'pubmed', value: pmid }] } } }), { headers: { 'content-type': 'application/json' } });
    pool
      .intercept({ path: (p: string) => p.includes('/efetch.fcgi?'), method: 'GET' })
      .reply(503, 'Service Unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    const warnings: string[] = [];
    const results = await pubmed.search(uniq('efetch down'), { limit: 1, onWarning: (w) => warnings.push(w) });
    assert.deepEqual(results.map((r) => [r.pmid, r.abstract]), [[pmid, undefined]]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /^abstracts unavailable \(efetch failed: .*503.*\)$/);
  });
});
