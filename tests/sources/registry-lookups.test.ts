// tests/sources/registry-lookups.test.ts — the live request path of Pass 1's
// registry lookups, against an undici MockAgent that refuses every connection
// it was not told to answer.
//
//   - Crossref carries the contact address as `mailto` only when one is set.
//   - A 5xx that outlasts http.ts's retries is "unavailable", not "not found".
//   - doi.org content negotiation follows a redirect only to a registration
//     agency's metadata host; a redirect to a publisher's landing page proves
//     the DOI exists but gives nothing to compare, and is not followed.
//   - Open Library holds only part of the world's books, so a valid ISBN it
//     does not list is UNRESOLVED, never FABRICATED.
//   - arXiv and PubMed each say "no such paper" in their own way (an empty
//     feed or an api/errors entry; an esummary `error` entry). Only that is
//     not_found, and only that makes an arXiv-only or PMID-only entry
//     FABRICATED; no answer, or a refusal such as a proxy's 403, is
//     UNRESOLVED.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { lookupDoi as crossrefLookup } from '../../bin/lib/sources/crossref.js';
import { lookupDoi as doiOrgLookup } from '../../bin/lib/sources/doi-content.js';
import { lookupIsbn } from '../../bin/lib/sources/openlibrary.js';
import { fetchById as arxivFetchById, lookupArxiv, search as arxivSearch } from '../../bin/lib/sources/arxiv.js';
import { lookupPmid } from '../../bin/lib/sources/pubmed.js';
import { runPass1, type Pass1Result } from '../../bin/lib/verify/pass1.js';

const ENV_KEYS = ['PENSMITH_TEST_CASSETTES', 'PENSMITH_OFFLINE', 'PENSMITH_CONTACT_EMAIL', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA', 'HOME'];
const savedEnv: Record<string, string | undefined> = {};
let prevDispatcher: Dispatcher;
let agent: MockAgent;

const CROSSREF_MESSAGE = JSON.stringify({
  status: 'ok',
  message: { DOI: '10.1234/polite', title: ['A Polite Request'], author: [{ family: 'Roe', given: 'Jane' }], issued: { 'date-parts': [[2020]] } },
});

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env['PENSMITH_TEST_CASSETTES'];
  delete process.env['PENSMITH_OFFLINE'];
  delete process.env['PENSMITH_CONTACT_EMAIL'];
  // A fresh, empty HTTP cache, so nothing cached answers in place of a request.
  const data = mkdtempSync(path.join(tmpdir(), 'pensmith-registry-lookups-'));
  for (const k of ['XDG_DATA_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA', 'HOME']) process.env[k] = data;
  _resetBucketsForTest();
  prevDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  setGlobalDispatcher(prevDispatcher);
  await agent.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('Crossref: the contact address goes as mailto when it is set', async () => {
  process.env['PENSMITH_CONTACT_EMAIL'] = 'author@example.org';
  const paths: string[] = [];
  agent.get('https://api.crossref.org')
    .intercept({ path: (p) => { paths.push(p); return p.startsWith('/works/10.1234%2Fpolite'); }, method: 'GET' })
    .reply(200, CROSSREF_MESSAGE, { headers: { 'content-type': 'application/json' } });
  const r = await crossrefLookup('10.1234/polite');
  assert.equal(r.kind, 'found');
  assert.ok(paths.some((p) => p.includes('mailto=author%40example.org')), paths.join(', '));
});

test('Crossref: no mailto when no contact address is configured', async () => {
  const paths: string[] = [];
  agent.get('https://api.crossref.org')
    .intercept({ path: (p) => { paths.push(p); return p.startsWith('/works/10.1234%2Fanonymous'); }, method: 'GET' })
    .reply(200, CROSSREF_MESSAGE, { headers: { 'content-type': 'application/json' } });
  const r = await crossrefLookup('10.1234/anonymous');
  assert.equal(r.kind, 'found');
  assert.ok(paths.length > 0 && paths.every((p) => !p.includes('mailto')), paths.join(', '));
});

test('Crossref: a 503 that outlasts the retries is unavailable, not not_found', { timeout: 60_000 }, async () => {
  agent.get('https://api.crossref.org')
    .intercept({ path: (p) => p.startsWith('/works/10.1234%2Foutage'), method: 'GET' })
    .reply(503, 'Service Unavailable')
    .persist();
  const r = await crossrefLookup('10.1234/outage');
  assert.deepEqual(r, { kind: 'unavailable', registry: 'Crossref', detail: 'HTTP 503' });
});

test('doi.org: a redirect to the agency metadata host is followed to the CSL-JSON record', async () => {
  agent.get('https://doi.org')
    .intercept({ path: '/10.5555/negotiated', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://data.crosscite.org/10.5555%2Fnegotiated' } });
  agent.get('https://data.crosscite.org')
    .intercept({ path: '/10.5555%2Fnegotiated', method: 'GET' })
    .reply(200, JSON.stringify({ type: 'dataset', title: 'A Negotiated Record', author: [{ literal: 'Some Lab' }], issued: { 'date-parts': [[2021]] } }),
      { headers: { 'content-type': 'application/vnd.citationstyles.csl+json' } });
  const r = await doiOrgLookup('10.5555/negotiated');
  assert.equal(r.kind, 'found');
  assert.equal(r.kind === 'found' && r.record.title, 'A Negotiated Record');
});

test('doi.org: a redirect to a landing page is not followed, and the DOI is not called unregistered', async () => {
  agent.get('https://doi.org')
    .intercept({ path: '/10.5555/landing', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://publisher.example.com/article/123' } });
  // No interceptor for publisher.example.com: following the redirect would fail differently.
  const r = await doiOrgLookup('10.5555/landing');
  assert.equal(r.kind, 'unavailable');
  assert.match(r.kind === 'unavailable' ? r.detail : '', /registered, but its agency offers no metadata/);
});

test('doi.org: a 404 from doi.org itself means the DOI was never registered', async () => {
  agent.get('https://doi.org')
    .intercept({ path: '/10.5555/never-registered', method: 'GET' })
    .reply(404, 'DOI Not Found');
  const r = await doiOrgLookup('10.5555/never-registered');
  assert.deepEqual(r, { kind: 'not_found', registry: 'doi.org', authoritative: true });
});

test('Open Library: a book it does not list is not_found, but not authoritatively', async () => {
  agent.get('https://openlibrary.org')
    .intercept({ path: (p) => p.startsWith('/api/books?') && p.includes('9780306406157'), method: 'GET' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await lookupIsbn('9780306406157'), { kind: 'not_found', registry: 'Open Library', authoritative: false });
});

test('Pass 1: a valid ISBN Open Library does not list is UNRESOLVED, not FABRICATED', async () => {
  agent.get('https://openlibrary.org')
    .intercept({ path: (p) => p.startsWith('/api/books?') && p.includes('9780306406157'), method: 'GET' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-isbn-unlisted-'));
  mkdirSync(path.join(root, '.paper'), { recursive: true });
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, '@book{doe1990,\n  title = {An Unlisted Monograph},\n  author = {Doe, Jane},\n  year = {1990},\n  isbn = {978-0-306-40615-7}\n}\n');
  const [r] = await runPass1('# S\n\nA claim [@doe1990].\n', bibPath);
  assert.equal(r?.verdict, 'UNRESOLVED', r?.reason);
  assert.match(r!.reason, /Open Library has no record of ISBN 978-0-306-40615-7/);
});

// ---------------------------------------------------------------------------
//   arXiv and PubMed: "no such paper" versus "no answer"
// ---------------------------------------------------------------------------

const ATOM = { 'content-type': 'application/atom+xml; charset=utf-8' };
const JSON_HEADERS = { 'content-type': 'application/json' };
// What an egress proxy or a refusing server sends instead of the registry's answer.
const PLAIN = { 'content-type': 'text/plain; charset=utf-8' };

// The head of the feed arXiv sends (as in the recorded id_list=1706.03762
// answer), with no entry: arXiv's answer for an ID it does not hold.
const ARXIV_EMPTY_FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/empty</id>
  <title>arXiv Query: search_query=&amp;id_list=2501.99999&amp;start=0&amp;max_results=10</title>
  <opensearch:itemsPerPage>10</opensearch:itemsPerPage>
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
</feed>`;

// arXiv's error feed: one entry whose id is an api/errors link, titled
// "Error" and "written" by "arXiv api core". It is not a paper.
const arxivErrorFeed = (id: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=${id}&amp;start=0&amp;max_results=10</title>
  <id>http://arxiv.org/api/errors</id>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_${id}</id>
    <title>Error</title>
    <summary>incorrect id format for ${id}</summary>
    <updated>2026-11-25T00:00:00-05:00</updated>
    <author>
      <name>arXiv api core</name>
    </author>
  </entry>
</feed>`;

/** Answer GET export.arxiv.org/api/query?id_list=<id> (and only that) with `status` and `body`. */
function arxivAnswers(id: string, status: number, body: string, headers: Record<string, string> = ATOM): void {
  agent.get('https://export.arxiv.org')
    .intercept({ path: (p) => p === `/api/query?id_list=${encodeURIComponent(id)}`, method: 'GET' })
    .reply(status, body, { headers })
    .persist();
}

/** Answer GET eutils esummary for `pmid` (and only that) with `status` and `body`. */
function pubmedAnswers(pmid: string, status: number, body: string, headers: Record<string, string> = JSON_HEADERS): void {
  agent.get('https://eutils.ncbi.nlm.nih.gov')
    .intercept({
      path: (p) => p.startsWith('/entrez/eutils/esummary.fcgi?') && p.includes(`id=${pmid}&`),
      method: 'GET',
    })
    .reply(status, body, { headers })
    .persist();
}

// esummary's answer for a PMID that does not exist.
const pubmedNoSuchId = (pmid: string): string => JSON.stringify({
  header: { type: 'esummary', version: '0.3' },
  result: { uids: [pmid], [pmid]: { uid: pmid, error: 'cannot get document summary' } },
});

test('arXiv: an empty feed is not_found', async () => {
  arxivAnswers('2501.99999', 200, ARXIV_EMPTY_FEED);
  assert.deepEqual(await lookupArxiv('2501.99999'), { kind: 'not_found', registry: 'arXiv', authoritative: true });
});

test('arXiv: a 400 whose feed holds an api/errors entry is not_found', async () => {
  arxivAnswers('2501.9999x', 400, arxivErrorFeed('2501.9999x'));
  assert.deepEqual(await lookupArxiv('2501.9999x'), { kind: 'not_found', registry: 'arXiv', authoritative: true });
});

test('arXiv: a 503 that outlasts the retries is unavailable, not not_found', { timeout: 90_000 }, async () => {
  // Every retry waits for arXiv's one request in three seconds: about 12 s.
  arxivAnswers('2501.00001', 503, 'Service Unavailable');
  assert.deepEqual(await lookupArxiv('2501.00001'), { kind: 'unavailable', registry: 'arXiv', detail: 'HTTP 503' });
});

// A status http.ts does not retry (an egress proxy's 403, a 404, a 400 with no
// error feed) is returned to the lookup, not thrown. It says nothing about
// the paper, so it is unavailable too.
test('arXiv: a 403 is unavailable, not not_found', async () => {
  arxivAnswers('2501.00002', 403, 'Forbidden', PLAIN);
  assert.deepEqual(await lookupArxiv('2501.00002'), { kind: 'unavailable', registry: 'arXiv', detail: 'HTTP 403' });
});

test('arXiv: a 400 without an api/errors entry is unavailable, not not_found', async () => {
  arxivAnswers('2501.00003', 400, 'Bad Request', PLAIN);
  assert.deepEqual(await lookupArxiv('2501.00003'), { kind: 'unavailable', registry: 'arXiv', detail: 'HTTP 400' });
});

test('arXiv: search and fetchById do not read the error entry as a paper', async () => {
  arxivAnswers('2501.9999y', 200, arxivErrorFeed('2501.9999y'));
  assert.equal(await arxivFetchById('2501.9999y'), null);
  _resetBucketsForTest();
  agent.get('https://export.arxiv.org')
    .intercept({ path: (p) => p.startsWith('/api/query?search_query='), method: 'GET' })
    .reply(200, arxivErrorFeed('bad'), { headers: ATOM });
  assert.deepEqual(await arxivSearch('tidal heating'), []);
});

test('PubMed: an esummary error entry for the PMID is not_found', async () => {
  pubmedAnswers('39999999', 200, pubmedNoSuchId('39999999'));
  assert.deepEqual(await lookupPmid('39999999'), { kind: 'not_found', registry: 'PubMed', authoritative: true });
});

test('PubMed: a 503 that outlasts the retries is unavailable, not not_found', { timeout: 60_000 }, async () => {
  pubmedAnswers('39999998', 503, 'Service Unavailable');
  assert.deepEqual(await lookupPmid('39999998'), { kind: 'unavailable', registry: 'PubMed', detail: 'HTTP 503' });
});

test('PubMed: a 403 is unavailable, not not_found', async () => {
  pubmedAnswers('39999996', 403, 'Forbidden', PLAIN);
  assert.deepEqual(await lookupPmid('39999996'), { kind: 'unavailable', registry: 'PubMed', detail: 'HTTP 403' });
});

test('PubMed: an error about the request rather than the PMID is unavailable, not not_found', async () => {
  // E-utilities report a refused request (a rate limit, a bad parameter) as a
  // top-level `error`; it says nothing about whether the PMID exists.
  pubmedAnswers('39999997', 200, JSON.stringify({ error: 'API rate limit exceeded', count: '4', limit: '3' }));
  const r = await lookupPmid('39999997');
  assert.equal(r.kind, 'unavailable');
  assert.match(r.kind === 'unavailable' ? r.detail : '', /API rate limit exceeded/);
});

/** The Pass-1 verdict for the one entry of `bib`, cited once. */
async function pass1For(bib: string): Promise<Pass1Result> {
  const key = /^@\w+\{([^,]+),/m.exec(bib)![1]!;
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-pass1-live-'));
  mkdirSync(path.join(root, '.paper'), { recursive: true });
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  const [r] = await runPass1(`# S\n\nA claim [@${key}].\n`, bibPath);
  assert.ok(r, `no verdict for ${key}`);
  return r;
}

const arxivOnly = (eprint: string): string =>
  `@misc{roe2025,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  year = {2025},\n  eprint = {${eprint}},\n  archivePrefix = {arXiv}\n}\n`;
const pmidOnly = (pmid: string): string =>
  `@article{roe2019,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  year = {2019},\n  journal = {Icarus},\n  pmid = {${pmid}}\n}\n`;

test('Pass 1: an arXiv-only entry arXiv has no record of is FABRICATED', async () => {
  arxivAnswers('2501.99999', 200, ARXIV_EMPTY_FEED);
  const r = await pass1For(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'FABRICATED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 is not registered \(arXiv has no record of it\)/);
});

test('Pass 1: an arXiv-only entry is UNRESOLVED, not FABRICATED, when arXiv does not answer', async () => {
  agent.get('https://export.arxiv.org')
    .intercept({ path: (p) => p.startsWith('/api/query?id_list='), method: 'GET' })
    .replyWithError(new Error('socket hang up'));
  const r = await pass1For(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 could not be checked \(arXiv: /);
});

test('Pass 1: a PMID-only entry PubMed has no record of is FABRICATED', async () => {
  pubmedAnswers('39999999', 200, pubmedNoSuchId('39999999'));
  const r = await pass1For(pmidOnly('39999999'));
  assert.equal(r.verdict, 'FABRICATED', r.reason);
  assert.match(r.reason, /PMID 39999999 is not registered \(PubMed has no record of it\)/);
});

test('Pass 1: a PMID-only entry is UNRESOLVED, not FABRICATED, when PubMed does not answer', { timeout: 60_000 }, async () => {
  pubmedAnswers('39999998', 503, 'Service Unavailable');
  const r = await pass1For(pmidOnly('39999998'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /PMID 39999998 could not be checked \(PubMed: HTTP 503\)/);
});

test('Pass 1: an arXiv-only entry is UNRESOLVED, not FABRICATED, when arXiv refuses with a 403', async () => {
  arxivAnswers('2501.99999', 403, 'Forbidden', PLAIN);
  const r = await pass1For(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 could not be checked \(arXiv: HTTP 403\)/);
});

test('Pass 1: a PMID-only entry is UNRESOLVED, not FABRICATED, when PubMed refuses with a 403', async () => {
  pubmedAnswers('39999996', 403, 'Forbidden', PLAIN);
  const r = await pass1For(pmidOnly('39999996'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /PMID 39999996 could not be checked \(PubMed: HTTP 403\)/);
});
