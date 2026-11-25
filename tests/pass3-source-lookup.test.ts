// tests/pass3-source-lookup.test.ts — a failed source lookup or PDF fetch for
// one quotation does not decide the next quotation of the same source.
//
// Pass 3 once kept the first Unpaywall answer and the first PDF fetch of each
// source for the whole run, failures included. One rate-limited lookup or one
// timed-out fetch then left every later quotation of that work
// PDF_UNAVAILABLE, so a misquote further down the section was never checked:
// verify called the section unverifiable instead of refusing it as NOT_FOUND.
//
// OpenAlex, which Pass 3 asks first, answers "no such work" here, so the PDF
// link comes from Unpaywall (a contact email is set).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { isBlockingVerdict } from '../bin/lib/verify/verdict-rows.js';
import { _resetBucketsForTest, _resetWarnedForTest } from '../bin/lib/http.js';
import { textPdf } from './lib/pdf-fixture.js';

// These tests drive http.ts's live transport against an undici MockAgent with
// net connect disabled, so they run in live mode, not cassette replay (each
// test file runs in its own process, so this does not leak).
delete process.env['PENSMITH_TEST_CASSETTES'];
delete process.env['PENSMITH_OFFLINE'];

const DOI = '10.1234/abc';
// A public address written as an IP literal: the PDF link is fetched through
// the SSRF guard, which then needs no DNS.
const OA_ORIGIN = 'https://93.184.215.14';
const PDF_URL = `${OA_ORIGIN}/paper.pdf`;
const SOURCE = 'The quick brown fox jumps over the lazy dog while the farmer watches ' +
  'from the old wooden barn near the river bank every single morning.';

// The first quotation is word for word; the second is not in the source.
const DRAFT = [
  '# Section',
  '',
  'As Smith put it, "The quick brown fox jumps over the lazy dog while the farmer watches from the old wooden barn" [@k, p. 1].',
  '',
  'She also wrote that "the slow purple elephant dances beneath the bright silver moon while drunken sailors sing loudly" [@k, p. 2].',
  '',
].join('\n');
const BIB = new Map([['k', { DOI, title: 'A Paper', author: [{ family: 'Smith', given: 'Ann' }] }]]);

const UNPAYWALL_RECORD = JSON.stringify({
  doi: DOI, title: 'A Paper', year: 2020, is_oa: true,
  z_authors: [{ given: 'Ann', family: 'Smith' }],
  best_oa_location: { url_for_pdf: PDF_URL },
});

/** A transport failure http.ts does not retry, so each one is a single request. */
function connectionRefused(): Error {
  return Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
}

interface Counts { unpaywall: number; pdf: number }

/**
 * Run Pass 3 on DRAFT against a mocked Unpaywall and OA host, with an empty
 * HTTP cache. `failFirst` names the request whose first attempt fails; every
 * later request succeeds. Returns the verdicts and the successful requests.
 */
async function pass3With(failFirst: 'none' | 'unpaywall' | 'pdf'): Promise<{ verdicts: string[]; reasons: string[]; ok: Counts }> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-pass3-'));
  const saved = { ...process.env };
  const savedDispatcher = getGlobalDispatcher();
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'LOCALAPPDATA']) process.env[k] = tmp;
  process.env['PENSMITH_CONTACT_EMAIL'] = 'test@example.org';
  _resetWarnedForTest();
  _resetBucketsForTest();

  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const ok: Counts = { unpaywall: 0, pdf: 0 };
  agent.get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' })
    .reply(404, 'not found').persist();
  const unpaywall = agent.get('https://api.unpaywall.org');
  const oaHost = agent.get(OA_ORIGIN);
  // An interceptor answers once; the persisting one registered after it answers the rest.
  if (failFirst === 'unpaywall') {
    unpaywall.intercept({ path: (p) => p.startsWith('/v2/'), method: 'GET' }).replyWithError(connectionRefused());
  }
  unpaywall.intercept({ path: (p) => p.startsWith('/v2/'), method: 'GET' }).reply(() => {
    ok.unpaywall++;
    return { statusCode: 200, data: UNPAYWALL_RECORD, responseOptions: { headers: { 'content-type': 'application/json' } } };
  }).persist();
  if (failFirst === 'pdf') {
    oaHost.intercept({ path: '/paper.pdf', method: 'GET' }).replyWithError(connectionRefused());
  }
  oaHost.intercept({ path: '/paper.pdf', method: 'GET' }).reply(() => {
    ok.pdf++;
    return { statusCode: 200, data: textPdf(SOURCE), responseOptions: { headers: { 'content-type': 'application/pdf' } } };
  }).persist();

  try {
    const results = await runPass3(DRAFT, BIB);
    return { verdicts: results.map((r) => r.verdict), reasons: results.map((r) => r.reason), ok };
  } finally {
    setGlobalDispatcher(savedDispatcher);
    await agent.close();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

test('pass 3: with every request answered, the misquote of the same source is NOT_FOUND', async () => {
  const r = await pass3With('none');
  assert.deepEqual(r.verdicts, ['OK', 'NOT_FOUND'], r.reasons.join(' | '));
});

test('pass 3: a failed Unpaywall lookup for one quotation is asked again for the next', async () => {
  const r = await pass3With('unpaywall');
  assert.deepEqual(r.verdicts, ['PDF_UNAVAILABLE', 'NOT_FOUND'], r.reasons.join(' | '));
  assert.match(r.reasons[0]!, /No OA PDF available for DOI 10\.1234\/abc/);
  // The second quotation's lookup and fetch reached the source.
  assert.deepEqual(r.ok, { unpaywall: 1, pdf: 1 });
  // So the section still holds a blocking verdict: verify refuses it.
  assert.ok(r.verdicts.some(isBlockingVerdict));
});

test('pass 3: a failed PDF fetch for one quotation is fetched again for the next', async () => {
  const r = await pass3With('pdf');
  assert.deepEqual(r.verdicts, ['PDF_UNAVAILABLE', 'NOT_FOUND'], r.reasons.join(' | '));
  assert.match(r.reasons[0]!, /^PDF fetch\/parse failed: /);
  assert.deepEqual(r.ok.pdf, 1);
  assert.ok(r.verdicts.some(isBlockingVerdict));
});
