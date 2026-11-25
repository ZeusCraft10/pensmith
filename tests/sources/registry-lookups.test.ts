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
//     does not list is "not found", but not authoritatively.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { lookupDoi as crossrefLookup } from '../../bin/lib/sources/crossref.js';
import { lookupDoi as doiOrgLookup } from '../../bin/lib/sources/doi-content.js';
import { lookupIsbn } from '../../bin/lib/sources/openlibrary.js';

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
