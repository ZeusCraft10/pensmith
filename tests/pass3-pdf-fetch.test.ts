// tests/pass3-pdf-fetch.test.ts — how Pass 3 fetches an open-access PDF over
// the live transport (http.ts against an undici MockAgent).
//
// The PDF must arrive byte for byte: a real PDF's compressed streams do not
// survive a UTF-8 decode, and pdf.js then extracts nothing. A PDF is never
// written to the HTTP cache, which stores text. The link comes from a
// registry record, not from pensmith, so it is fetched as an untrusted URL:
// the SSRF guard refuses a private address, and a redirect is followed only
// through the same guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { runPass3, type Pass3Result } from '../bin/lib/verify/pass3.js';
import { _resetBucketsForTest, _resetWarnedForTest } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';

// Live transport against a MockAgent with net connect disabled, not cassette
// replay (each test file runs in its own process, so this does not leak).
delete process.env['PENSMITH_TEST_CASSETTES'];
delete process.env['PENSMITH_OFFLINE'];

const PDF = readFileSync(fileURLToPath(new URL('./fixtures/cassettes/oa-pdf/arxiv-2109.00022.pdf', import.meta.url)));
const DOI = '10.1234/abc';
// A public address written as an IP literal, so the SSRF guard needs no DNS.
const OA = 'https://93.184.215.14';

const DRAFT = [
  '# Results',
  '',
  'As the authors write, "In this paper, we study a relaxed version of this question by replacing holes with visible islands" [@k, p. 1].',
  '',
  'They also write that "In this paper, we study a stronger version of this question by replacing holes with visible islands" [@k, p. 1].',
  '',
].join('\n');
const BIB = new Map([['k', { DOI }]]);

interface Served { pdfUrl: string; routes: Record<string, (hits: number) => { statusCode: number; data: Buffer | string; headers: Record<string, string> }> }

/**
 * Run Pass 3 on DRAFT with OpenAlex and Unpaywall both naming `pdfUrl` as the
 * open-access PDF, and `routes` answering on the OA hosts. Returns the
 * verdicts, how often each route was asked, and the HTTP cache files left.
 */
async function pass3With(s: Served): Promise<{ results: Pass3Result[]; hits: Record<string, number>; cacheFiles: string[] }> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-pass3-fetch-'));
  const saved = { ...process.env };
  const savedDispatcher = getGlobalDispatcher();
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'LOCALAPPDATA']) process.env[k] = tmp;
  process.env['PENSMITH_CONTACT_EMAIL'] = 'test@example.org';
  _resetWarnedForTest();
  _resetBucketsForTest();

  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const json = { 'content-type': 'application/json' };
  agent.get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' }).reply(200,
    JSON.stringify({ id: 'https://openalex.org/W1', doi: `https://doi.org/${DOI}`, best_oa_location: { is_oa: true, pdf_url: s.pdfUrl }, locations: [] }),
    { headers: json }).persist();
  agent.get('https://api.unpaywall.org').intercept({ path: (p) => p.startsWith('/v2/'), method: 'GET' }).reply(200,
    JSON.stringify({ doi: DOI, title: 'A Paper', year: 2020, is_oa: true, z_authors: [{ given: 'Ann', family: 'Smith' }], best_oa_location: { url_for_pdf: s.pdfUrl } }),
    { headers: json }).persist();
  const hits: Record<string, number> = {};
  for (const [url, answer] of Object.entries(s.routes)) {
    const u = new URL(url);
    hits[url] = 0;
    agent.get(u.origin).intercept({ path: u.pathname, method: 'GET' }).reply(() => {
      hits[url]! += 1;
      const a = answer(hits[url]!);
      return { statusCode: a.statusCode, data: a.data, responseOptions: { headers: a.headers } };
    }).persist();
  }

  try {
    const results = await runPass3(DRAFT, BIB);
    let cacheFiles: string[] = [];
    try {
      const dir = pensmithHttpCacheDir();
      cacheFiles = await Promise.all((await fsp.readdir(dir)).map((f) => fsp.readFile(path.join(dir, f), 'utf8')));
    } catch { /* no cache directory: nothing was cached */ }
    return { results, hits, cacheFiles };
  } finally {
    setGlobalDispatcher(savedDispatcher);
    await agent.close();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

const pdf = () => ({ statusCode: 200, data: PDF, headers: { 'content-type': 'application/pdf' } });
const show = (r: Pass3Result[]): string => r.map((x) => `${x.verdict}: ${x.reason}`).join('\n');

test('pass 3: a real (compressed) PDF arrives byte for byte, so the misquotation is NOT_FOUND', async () => {
  const { results } = await pass3With({ pdfUrl: `${OA}/paper.pdf`, routes: { [`${OA}/paper.pdf`]: pdf } });
  assert.deepEqual(results.map((r) => r.verdict), ['OK', 'NOT_FOUND'], show(results));
});

test('pass 3: the PDF is never written to the HTTP cache', async () => {
  const { results, cacheFiles } = await pass3With({ pdfUrl: `${OA}/paper.pdf`, routes: { [`${OA}/paper.pdf`]: pdf } });
  assert.ok(results.length > 0);
  assert.deepEqual(cacheFiles.filter((f) => f.includes('%PDF') || /application\/pdf/.test(f)), [], 'no cached PDF');
});

test('pass 3: a redirect from the open-access link is followed to the PDF', async () => {
  const { results, hits } = await pass3With({
    pdfUrl: `${OA}/download`,
    routes: {
      [`${OA}/download`]: () => ({ statusCode: 302, data: '', headers: { location: `${OA}/files/paper.pdf` } }),
      [`${OA}/files/paper.pdf`]: pdf,
    },
  });
  assert.deepEqual(results.map((r) => r.verdict), ['OK', 'NOT_FOUND'], show(results));
  assert.ok(hits[`${OA}/files/paper.pdf`]! >= 1);
});

test('pass 3: an open-access link to a private address is refused before any request', async () => {
  const { results, hits } = await pass3With({ pdfUrl: 'http://127.0.0.1:9/paper.pdf', routes: { 'http://127.0.0.1:9/paper.pdf': pdf } });
  assert.equal(hits['http://127.0.0.1:9/paper.pdf'], 0, 'the private address was never asked');
  assert.deepEqual(results.map((r) => r.verdict), ['PDF_UNAVAILABLE', 'PDF_UNAVAILABLE'], show(results));
});

test('pass 3: a redirect to a private address is refused', async () => {
  const { results, hits } = await pass3With({
    pdfUrl: `${OA}/download`,
    routes: {
      [`${OA}/download`]: () => ({ statusCode: 302, data: '', headers: { location: 'http://127.0.0.1:9/paper.pdf' } }),
      'http://127.0.0.1:9/paper.pdf': pdf,
    },
  });
  assert.equal(hits['http://127.0.0.1:9/paper.pdf'], 0, 'the private address was never asked');
  assert.deepEqual(results.map((r) => r.verdict), ['PDF_UNAVAILABLE', 'PDF_UNAVAILABLE'], show(results));
});
