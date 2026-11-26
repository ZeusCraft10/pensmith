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
//   - A 200 whose fields are the wrong type is "unavailable" too: Pass 1
//     reports the entry UNRESOLVED instead of crashing.
//   - Each source is read under its own key spellings, so a doi.org record
//     that also carries Crossref's `published` / `short-container-title` (or
//     a Crossref message carrying CSL's) does not let a mismatch pass.
//   - OpenAlex is asked once per DOI, in normalized form, whether the work is retracted.
//   - arXiv and PubMed fetchById (research candidates, not Pass 1) read a
//     response as their search() does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { lookupDoi as crossrefLookup } from '../../bin/lib/sources/crossref.js';
import { lookupDoi as doiOrgLookup } from '../../bin/lib/sources/doi-content.js';
import { lookupIsbn } from '../../bin/lib/sources/openlibrary.js';
import { fetchById as arxivFetchById, lookupArxiv, search as arxivSearch } from '../../bin/lib/sources/arxiv.js';
import { fetchById as pubmedFetchById, lookupPmid } from '../../bin/lib/sources/pubmed.js';
import { pass1Verdict } from '../lib/bib-fixture.js';
import { JSON_HEADERS, pubmedAnswers, useMockRegistries } from '../lib/mock-registries.js';

const agent = useMockRegistries('pensmith-registry-lookups-');

const CROSSREF_MESSAGE = JSON.stringify({
  status: 'ok',
  message: { DOI: '10.1234/polite', title: ['A Polite Request'], author: [{ family: 'Roe', given: 'Jane' }], issued: { 'date-parts': [[2020]] } },
});

test('Crossref: the contact address goes as mailto when it is set', async () => {
  process.env['PENSMITH_CONTACT_EMAIL'] = 'author@example.org';
  const paths: string[] = [];
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => { paths.push(p); return p.startsWith('/works/10.1234%2Fpolite'); }, method: 'GET' })
    .reply(200, CROSSREF_MESSAGE, { headers: { 'content-type': 'application/json' } });
  const r = await crossrefLookup('10.1234/polite');
  assert.equal(r.kind, 'found');
  assert.ok(paths.some((p) => p.includes('mailto=author%40example.org')), paths.join(', '));
});

test('Crossref: no mailto when no contact address is configured', async () => {
  const paths: string[] = [];
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => { paths.push(p); return p.startsWith('/works/10.1234%2Fanonymous'); }, method: 'GET' })
    .reply(200, CROSSREF_MESSAGE, { headers: { 'content-type': 'application/json' } });
  const r = await crossrefLookup('10.1234/anonymous');
  assert.equal(r.kind, 'found');
  assert.ok(paths.length > 0 && paths.every((p) => !p.includes('mailto')), paths.join(', '));
});

test('Crossref: a 503 that outlasts the retries is unavailable, not not_found', { timeout: 60_000 }, async () => {
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => p.startsWith('/works/10.1234%2Foutage'), method: 'GET' })
    .reply(503, 'Service Unavailable')
    .persist();
  const r = await crossrefLookup('10.1234/outage');
  assert.deepEqual(r, { kind: 'unavailable', registry: 'Crossref', detail: 'HTTP 503' });
});

test('doi.org: a redirect to the agency metadata host is followed to the CSL-JSON record', async () => {
  agent().get('https://doi.org')
    .intercept({ path: '/10.5555/negotiated', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://data.crosscite.org/10.5555%2Fnegotiated' } });
  agent().get('https://data.crosscite.org')
    .intercept({ path: '/10.5555%2Fnegotiated', method: 'GET' })
    .reply(200, JSON.stringify({ type: 'dataset', title: 'A Negotiated Record', author: [{ literal: 'Some Lab' }], issued: { 'date-parts': [[2021]] } }),
      { headers: { 'content-type': 'application/vnd.citationstyles.csl+json' } });
  const r = await doiOrgLookup('10.5555/negotiated');
  assert.equal(r.kind, 'found');
  assert.equal(r.kind === 'found' && r.record.title, 'A Negotiated Record');
});

test('doi.org: a redirect to a landing page is not followed, and the DOI is not called unregistered', async () => {
  agent().get('https://doi.org')
    .intercept({ path: '/10.5555/landing', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://publisher.example.com/article/123' } });
  // No interceptor for publisher.example.com: following the redirect would fail differently.
  const r = await doiOrgLookup('10.5555/landing');
  assert.equal(r.kind, 'unavailable');
  assert.match(r.kind === 'unavailable' ? r.detail : '', /registered, but its agency offers no metadata/);
});

test('doi.org: a 404 from doi.org itself means the DOI was never registered', async () => {
  agent().get('https://doi.org')
    .intercept({ path: '/10.5555/never-registered', method: 'GET' })
    .reply(404, 'DOI Not Found');
  const r = await doiOrgLookup('10.5555/never-registered');
  assert.deepEqual(r, { kind: 'not_found', registry: 'doi.org', authoritative: true });
});

test('Open Library: a book it does not list is not_found, but not authoritatively', async () => {
  agent().get('https://openlibrary.org')
    .intercept({ path: (p) => p.startsWith('/api/books?') && p.includes('9780306406157'), method: 'GET' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await lookupIsbn('9780306406157'), { kind: 'not_found', registry: 'Open Library', authoritative: false });
});

test('Pass 1: a valid ISBN Open Library does not list is UNRESOLVED, not FABRICATED', async () => {
  agent().get('https://openlibrary.org')
    .intercept({ path: (p) => p.startsWith('/api/books?') && p.includes('9780306406157'), method: 'GET' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
  const r = await pass1Verdict('@book{doe1990,\n  title = {An Unlisted Monograph},\n  author = {Doe, Jane},\n  year = {1990},\n  isbn = {978-0-306-40615-7}\n}\n');
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /Open Library has no record of ISBN 978-0-306-40615-7/);
});

// ---------------------------------------------------------------------------
//   arXiv and PubMed: "no such paper" versus "no answer"
// ---------------------------------------------------------------------------

const ATOM = { 'content-type': 'application/atom+xml; charset=utf-8' };
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
  agent().get('https://export.arxiv.org')
    .intercept({ path: (p) => p === `/api/query?id_list=${encodeURIComponent(id)}`, method: 'GET' })
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
  agent().get('https://export.arxiv.org')
    .intercept({ path: (p) => p.startsWith('/api/query?search_query='), method: 'GET' })
    .reply(200, arxivErrorFeed('bad'), { headers: ATOM });
  assert.deepEqual(await arxivSearch('tidal heating'), []);
});

test('PubMed: an esummary error entry for the PMID is not_found', async () => {
  pubmedAnswers(agent(), '39999999', 200, pubmedNoSuchId('39999999'));
  assert.deepEqual(await lookupPmid('39999999'), { kind: 'not_found', registry: 'PubMed', authoritative: true });
});

test('PubMed: a 503 that outlasts the retries is unavailable, not not_found', { timeout: 60_000 }, async () => {
  pubmedAnswers(agent(), '39999998', 503, 'Service Unavailable');
  assert.deepEqual(await lookupPmid('39999998'), { kind: 'unavailable', registry: 'PubMed', detail: 'HTTP 503' });
});

test('PubMed: a 403 is unavailable, not not_found', async () => {
  pubmedAnswers(agent(), '39999996', 403, 'Forbidden', PLAIN);
  assert.deepEqual(await lookupPmid('39999996'), { kind: 'unavailable', registry: 'PubMed', detail: 'HTTP 403' });
});

test('PubMed: an error about the request rather than the PMID is unavailable, not not_found', async () => {
  // E-utilities report a refused request (a rate limit, a bad parameter) as a
  // top-level `error`; it says nothing about whether the PMID exists.
  pubmedAnswers(agent(), '39999997', 200, JSON.stringify({ error: 'API rate limit exceeded', count: '4', limit: '3' }));
  const r = await lookupPmid('39999997');
  assert.equal(r.kind, 'unavailable');
  assert.match(r.kind === 'unavailable' ? r.detail : '', /API rate limit exceeded/);
});

const arxivOnly = (eprint: string): string =>
  `@misc{roe2025,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  year = {2025},\n  eprint = {${eprint}},\n  archivePrefix = {arXiv}\n}\n`;
const pmidOnly = (pmid: string): string =>
  `@article{roe2019,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  year = {2019},\n  journal = {Icarus},\n  pmid = {${pmid}}\n}\n`;

test('Pass 1: an arXiv-only entry arXiv has no record of is FABRICATED', async () => {
  arxivAnswers('2501.99999', 200, ARXIV_EMPTY_FEED);
  const r = await pass1Verdict(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'FABRICATED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 is not registered \(arXiv has no record of it\)/);
});

test('Pass 1: an arXiv-only entry is UNRESOLVED, not FABRICATED, when arXiv does not answer', async () => {
  agent().get('https://export.arxiv.org')
    .intercept({ path: (p) => p.startsWith('/api/query?id_list='), method: 'GET' })
    .replyWithError(new Error('socket hang up'));
  const r = await pass1Verdict(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 could not be checked \(arXiv: /);
});

test('Pass 1: a PMID-only entry PubMed has no record of is FABRICATED', async () => {
  pubmedAnswers(agent(), '39999999', 200, pubmedNoSuchId('39999999'));
  const r = await pass1Verdict(pmidOnly('39999999'));
  assert.equal(r.verdict, 'FABRICATED', r.reason);
  assert.match(r.reason, /PMID 39999999 is not registered \(PubMed has no record of it\)/);
});

test('Pass 1: a PMID-only entry is UNRESOLVED, not FABRICATED, when PubMed does not answer', { timeout: 60_000 }, async () => {
  pubmedAnswers(agent(), '39999998', 503, 'Service Unavailable');
  const r = await pass1Verdict(pmidOnly('39999998'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /PMID 39999998 could not be checked \(PubMed: HTTP 503\)/);
});

test('Pass 1: an arXiv-only entry is UNRESOLVED, not FABRICATED, when arXiv refuses with a 403', async () => {
  arxivAnswers('2501.99999', 403, 'Forbidden', PLAIN);
  const r = await pass1Verdict(arxivOnly('2501.99999'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 could not be checked \(arXiv: HTTP 403\)/);
});

test('Pass 1: a PMID-only entry is UNRESOLVED, not FABRICATED, when PubMed refuses with a 403', async () => {
  pubmedAnswers(agent(), '39999996', 403, 'Forbidden', PLAIN);
  const r = await pass1Verdict(pmidOnly('39999996'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /PMID 39999996 could not be checked \(PubMed: HTTP 403\)/);
});

test('Pass 1: an eprint written "arXiv: <id>" is asked for as <id>', async () => {
  arxivAnswers('2501.99999', 200, ARXIV_EMPTY_FEED);
  const r = await pass1Verdict(arxivOnly('arXiv: 2501.99999'));
  assert.equal(r.verdict, 'FABRICATED', r.reason);
  assert.match(r.reason, /arXiv:2501\.99999 is not registered \(arXiv has no record of it\)/);
});

// ---------------------------------------------------------------------------
//   A 200 that cannot be read is no answer
// ---------------------------------------------------------------------------

// Open Library's answer with `authors` an object instead of a list.
const OPEN_LIBRARY_MALFORMED = JSON.stringify({ 'ISBN:9780306406157': { title: 'A Book', authors: { name: 'Doe' } } });
// esummary's answer with `pubdate` a number instead of a string.
const pubmedNumericPubdate = (pmid: string): string => JSON.stringify({
  result: { uids: [pmid], [pmid]: { uid: pmid, title: 'Tidal Heating in Icy Moons', authors: [{ name: 'Roe J' }], pubdate: 2019 } },
});

test('Open Library: a 200 whose fields are the wrong type is unavailable, and Pass 1 says UNRESOLVED', async () => {
  agent().get('https://openlibrary.org')
    .intercept({ path: (p) => p.startsWith('/api/books?') && p.includes('9780306406157'), method: 'GET' })
    .reply(200, OPEN_LIBRARY_MALFORMED, { headers: JSON_HEADERS })
    .persist();
  assert.deepEqual(await lookupIsbn('9780306406157'), { kind: 'unavailable', registry: 'Open Library', detail: 'unreadable response' });
  const r = await pass1Verdict('@book{doe1990,\n  title = {A Book},\n  author = {Doe, Jane},\n  year = {1990},\n  isbn = {978-0-306-40615-7}\n}\n');
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /ISBN 978-0-306-40615-7 could not be checked \(Open Library: unreadable response\)/);
});

test('PubMed: a 200 whose fields are the wrong type is unavailable, and Pass 1 says UNRESOLVED', async () => {
  pubmedAnswers(agent(), '31452104', 200, pubmedNumericPubdate('31452104'));
  assert.deepEqual(await lookupPmid('31452104'), { kind: 'unavailable', registry: 'PubMed', detail: 'unreadable response' });
  const r = await pass1Verdict(pmidOnly('31452104'));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /PMID 31452104 could not be checked \(PubMed: unreadable response\)/);
});

// ---------------------------------------------------------------------------
//   Each source under its own key spellings
// ---------------------------------------------------------------------------

// The entry claims "Hydro Letters" and 2007; the registry says "Journal of
// Aqueous Things" and 2010. Only an extra year (2008) or short journal name
// ("Hydro Lett.") under some key could make them agree.
const hydroEntry = (doi: string): string =>
  `@article{hydro,\n  title = {Aqueous Things Revisited},\n  author = {Roe, Jane},\n  journal = {Hydro Letters},\n  year = {2007},\n  doi = {${doi}}\n}\n`;
const hydroWork = (doi: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  DOI: doi,
  title: 'Aqueous Things Revisited',
  author: [{ family: 'Roe', given: 'Jane' }],
  'container-title': 'Journal of Aqueous Things',
  issued: { 'date-parts': [[2010]] },
  ...extra,
});
const BOTH_WRONG = [
  /the year 2007 is not within a year of 2010, the year (Crossref|doi\.org) gives/,
  /the journal "Hydro Letters" is not "Journal of Aqueous Things"/,
];

/**
 * OpenAlex holds every DOI it is asked about; only `retracted` is listed as
 * retracted. Each DOI it is asked about goes into `asked`.
 */
function openAlexLists(asked: string[], retracted?: string): void {
  agent().get('https://api.openalex.org')
    .intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' })
    .reply((opts) => {
      const doi = decodeURIComponent(new URL(String(opts.path), 'https://api.openalex.org').pathname.slice('/works/doi:'.length));
      asked.push(doi);
      const work = { id: 'https://openalex.org/W1', doi: `https://doi.org/${doi}`, title: 'Adherence Matters', is_retracted: doi === retracted };
      return { statusCode: 200, data: JSON.stringify(work), responseOptions: { headers: JSON_HEADERS } };
    })
    .persist();
}

/** Crossref answers `message` for `doi`. */
function crossrefHolds(doi: string, message: Record<string, unknown>): void {
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => p.toLowerCase().startsWith(`/works/${encodeURIComponent(doi).toLowerCase()}`), method: 'GET' })
    .reply(200, JSON.stringify({ status: 'ok', message }), { headers: JSON_HEADERS })
    .persist();
}

/** Crossref and DataCite have no record of `doi`; doi.org redirects to Crossref's CSL transform, which answers `csl`. */
function onlyDoiOrgHolds(doi: string, csl: Record<string, unknown>): void {
  const crossref = agent().get('https://api.crossref.org');
  crossref.intercept({ path: (p) => p.startsWith(`/works/${encodeURIComponent(doi)}`), method: 'GET' }).reply(404, 'Resource not found.').persist();
  crossref.intercept({ path: `/v1/works/${doi}/transform`, method: 'GET' })
    .reply(200, JSON.stringify(csl), { headers: { 'content-type': 'application/vnd.citationstyles.csl+json' } })
    .persist();
  agent().get('https://api.datacite.org')
    .intercept({ path: (p) => p.startsWith(`/dois/${encodeURIComponent(doi)}`), method: 'GET' })
    .reply(404, JSON.stringify({ errors: [{ status: '404', title: 'The resource you are looking for doesn\'t exist.' }] }), { headers: JSON_HEADERS })
    .persist();
  agent().get('https://doi.org')
    .intercept({ path: `/${doi}`, method: 'GET' })
    .reply(302, '', { headers: { location: `https://api.crossref.org/v1/works/${doi}/transform` } })
    .persist();
}

test('Pass 1: a doi.org record is read under CSL spellings; a Crossref `published` year or `short-container-title` it carries does not excuse a mismatch', async () => {
  openAlexLists([]);
  const doi = '10.5555/hydro.2010.001';
  onlyDoiOrgHolds(doi, hydroWork(doi, { type: 'article-journal', published: { 'date-parts': [[2008]] }, 'short-container-title': ['Hydro Lett.'] }));
  const r = await pass1Verdict(hydroEntry(doi));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  for (const re of BOTH_WRONG) assert.match(r.reason, re);
  assert.match(r.reason, /doi\.org record/);
});

test('Pass 1: a doi.org record\'s own `original-date` and `container-title-short` are read', async () => {
  openAlexLists([]);
  const doi = '10.5555/hydro.2010.002';
  onlyDoiOrgHolds(doi, hydroWork(doi, { type: 'article-journal', 'original-date': { 'date-parts': [[2008]] }, 'container-title-short': 'Hydro Lett.' }));
  const r = await pass1Verdict(hydroEntry(doi));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /doi\.org record/);
});

test('Pass 1: a Crossref message is read under Crossref spellings; a CSL `original-date` or `container-title-short` it carries does not excuse a mismatch', async () => {
  openAlexLists([]);
  const doi = '10.5555/hydro.2010.003';
  crossrefHolds(doi, hydroWork(doi, { type: 'journal-article', 'original-date': { 'date-parts': [[2008]] }, 'container-title-short': ['Hydro Lett.'] }));
  const r = await pass1Verdict(hydroEntry(doi));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  for (const re of BOTH_WRONG) assert.match(r.reason, re);
  assert.match(r.reason, /Crossref record/);
});

test('Pass 1: a Crossref message\'s own `published` and `short-container-title` are read', async () => {
  openAlexLists([]);
  const doi = '10.5555/hydro.2010.004';
  crossrefHolds(doi, hydroWork(doi, { type: 'journal-article', published: { 'date-parts': [[2008]] }, 'short-container-title': ['Hydro Lett.'] }));
  const r = await pass1Verdict(hydroEntry(doi));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /Crossref record/);
});

// ---------------------------------------------------------------------------
//   OpenAlex retraction cross-check: one query per DOI, normalized
// ---------------------------------------------------------------------------

const ADHERENCE = {
  title: ['Adherence Matters'],
  author: [{ family: 'Smith', given: 'John' }, { family: 'Doe', given: 'Jane' }],
  'container-title': ['Journal of Adherence'],
  issued: { 'date-parts': [[1998]] },
  type: 'journal-article',
};
const adherenceEntry = (doi: string): string =>
  `@article{smith1998,\n  title = {Adherence Matters},\n  author = {Smith, John and Doe, Jane},\n  journal = {Journal of Adherence},\n  year = {1998},\n  doi = {${doi}}\n}\n`;

test('Pass 1: a DOI written as a doi.org link with trailing punctuation is asked of OpenAlex as the DOI, and a retraction there is caught', async () => {
  const asked: string[] = [];
  openAlexLists(asked, '10.1234/abc');
  // The registry record carries no DOI of its own, so the entry's spelling is the only one asked.
  crossrefHolds('10.1234/abc', ADHERENCE);
  const r = await pass1Verdict(adherenceEntry('https://doi.org/10.1234/abc.'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
  assert.match(r.reason, /OpenAlex/);
  assert.deepEqual(asked, ['10.1234/abc']);
});

test('Pass 1: OpenAlex is asked once for a DOI the entry and the registry spell in different case', async () => {
  const asked: string[] = [];
  openAlexLists(asked);
  crossrefHolds('10.1128/iai.66.9.4305-4312.1998', { ...ADHERENCE, DOI: '10.1128/iai.66.9.4305-4312.1998' });
  const r = await pass1Verdict(adherenceEntry('10.1128/IAI.66.9.4305-4312.1998'));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.deepEqual(asked, ['10.1128/iai.66.9.4305-4312.1998']);
});

// ---------------------------------------------------------------------------
//   arXiv and PubMed fetchById read a response as search() does
// ---------------------------------------------------------------------------

const arxivEntryXml = (n: number, title: string, author?: string): string =>
  `<entry><id>http://arxiv.org/abs/2501.0000${n}v1</id><title>${title}</title>` +
  `<published>2017-06-12T17:57:34Z</published>${author ? `<author><name>${author}</name></author>` : ''}</entry>`;

test('arXiv: fetchById gives the first entry that is a usable candidate, as search does', async () => {
  arxivAnswers('2501.00001', 200, `<feed xmlns="http://www.w3.org/2005/Atom">${arxivEntryXml(1, 'First Paper')}${arxivEntryXml(2, 'Second Paper', 'Jane Roe')}</feed>`);
  assert.equal((await arxivFetchById('2501.00001'))?.title, 'Second Paper');
  _resetBucketsForTest();
  arxivAnswers('2501.00003', 200, arxivEntryXml(3, 'Bare Entry', 'Jane Roe'));
  assert.equal((await arxivFetchById('2501.00003'))?.title, 'Bare Entry');
});

test('arXiv: fetchById says on stderr why it reads nothing from an oversized feed', async () => {
  arxivAnswers('2501.00004', 200, `<feed>${' '.repeat(10_000_001)}</feed>`);
  const written: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => { written.push(String(chunk)); return true; }) as typeof process.stderr.write;
  let r;
  try {
    r = await arxivFetchById('2501.00004');
  } finally {
    process.stderr.write = write;
  }
  assert.equal(r, null);
  assert.ok(written.some((w) => /\[arxiv\] feed body exceeds 10000000 bytes/.test(w)), written.join(''));
});

test('PubMed: fetchById reads the fields a candidate needs, whatever epubdate holds', async () => {
  pubmedAnswers(agent(), '31000001', 200, JSON.stringify({
    result: { uids: ['31000001'], '31000001': { uid: '31000001', title: 'A Valid Article', authors: [{ name: 'Roe J' }], pubdate: '2019 Jul', epubdate: 20190101 } },
  }));
  const c = await pubmedFetchById('31000001');
  assert.deepEqual(c && { source: c.source, id: c.id, title: c.title, authors: c.authors, year: c.year }, {
    source: 'pubmed', id: '31000001', title: 'A Valid Article', authors: ['Roe, J.'], year: 2019,
  });
});
