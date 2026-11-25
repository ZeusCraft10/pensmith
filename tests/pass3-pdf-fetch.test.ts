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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass3, type Pass3Result } from '../bin/lib/verify/pass3.js';
import { _resetWarnedForTest } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { JSON_HEADERS, useMockRegistries } from './lib/mock-registries.js';

// Live transport against a MockAgent with net connect disabled, not cassette
// replay, with an empty HTTP cache for each test.
const mockAgent = useMockRegistries('pensmith-pass3-fetch-');

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

interface Served {
  pdfUrl: string;
  /** The PDF Unpaywall names, when not `pdfUrl`. */
  unpaywallPdfUrl?: string;
  /** The contact email; null for none. */
  email?: string | null;
  routes: Record<string, (hits: number) => { statusCode: number; data: Buffer | string; headers: Record<string, string> }>;
}

/**
 * Run Pass 3 on DRAFT with OpenAlex and Unpaywall naming `pdfUrl` (or
 * `unpaywallPdfUrl`) as the open-access PDF, and `routes` answering on the OA
 * hosts. Returns the verdicts, how often each route and registry was asked,
 * and the HTTP cache files left.
 */
async function pass3With(s: Served): Promise<{ results: Pass3Result[]; hits: Record<string, number>; cacheFiles: string[] }> {
  if (s.email !== null) process.env['PENSMITH_CONTACT_EMAIL'] = s.email ?? 'test@example.org';
  _resetWarnedForTest();

  const agent = mockAgent();
  const hits: Record<string, number> = { unpaywall: 0 };
  agent.get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' }).reply(200,
    JSON.stringify({ id: 'https://openalex.org/W1', doi: `https://doi.org/${DOI}`, best_oa_location: { is_oa: true, pdf_url: s.pdfUrl }, locations: [] }),
    { headers: JSON_HEADERS }).persist();
  agent.get('https://api.unpaywall.org').intercept({ path: (p) => p.startsWith('/v2/'), method: 'GET' }).reply(() => {
    hits['unpaywall']! += 1;
    const body = { doi: DOI, title: 'A Paper', year: 2020, is_oa: true, z_authors: [{ given: 'Ann', family: 'Smith' }], best_oa_location: { url_for_pdf: s.unpaywallPdfUrl ?? s.pdfUrl } };
    return { statusCode: 200, data: JSON.stringify(body), responseOptions: { headers: JSON_HEADERS } };
  }).persist();
  for (const [url, answer] of Object.entries(s.routes)) {
    const u = new URL(url);
    hits[url] = 0;
    agent.get(u.origin).intercept({ path: u.pathname, method: 'GET' }).reply(() => {
      hits[url]! += 1;
      const a = answer(hits[url]!);
      return { statusCode: a.statusCode, data: a.data, responseOptions: { headers: a.headers } };
    }).persist();
  }

  const results = await runPass3(DRAFT, BIB);
  let cacheFiles: string[] = [];
  try {
    const dir = pensmithHttpCacheDir();
    cacheFiles = await Promise.all((await fsp.readdir(dir)).map((f) => fsp.readFile(path.join(dir, f), 'utf8')));
  } catch { /* no cache directory: nothing was cached */ }
  return { results, hits, cacheFiles };
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

// OpenAlex may list only links that fail (a login page, a 404). Unpaywall
// often knows another copy, so with a contact email it is asked then too.
const login = () => ({ statusCode: 200, data: '<!doctype html><title>Sign in</title>', headers: { 'content-type': 'text/html' } });

test('pass 3: when every OpenAlex link fails, Unpaywall is asked for another', async () => {
  const { results, hits } = await pass3With({
    pdfUrl: `${OA}/login`,
    unpaywallPdfUrl: `${OA}/paper.pdf`,
    routes: { [`${OA}/login`]: login, [`${OA}/paper.pdf`]: pdf },
  });
  assert.deepEqual(results.map((r) => r.verdict), ['OK', 'NOT_FOUND'], show(results));
  assert.ok(hits[`${OA}/login`]! >= 1, 'the OpenAlex link was tried first');
});

test('pass 3: when every OpenAlex link fails and no contact email is set, the reason says Unpaywall was not asked', async () => {
  const { results, hits } = await pass3With({
    pdfUrl: `${OA}/login`,
    unpaywallPdfUrl: `${OA}/paper.pdf`,
    email: null,
    routes: { [`${OA}/login`]: login, [`${OA}/paper.pdf`]: pdf },
  });
  assert.deepEqual(results.map((r) => r.verdict), ['PDF_UNAVAILABLE', 'PDF_UNAVAILABLE'], show(results));
  assert.equal(hits['unpaywall'], 0);
  assert.match(results[0]!.reason, /served text\/html rather than a PDF/);
  assert.match(results[0]!.reason, /PENSMITH_CONTACT_EMAIL/);
});

// pdf.js rejects a damaged PDF asynchronously, and an unhandled rejection
// would end the verify run. A damaged PDF must read as no source text, with
// nothing left unhandled.
const DAMAGED: Record<string, Buffer> = {
  truncated: PDF.subarray(0, Math.floor(PDF.length / 3)),
  'garbage after the header': Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 256))]),
  'header only': Buffer.from('%PDF-1.4\n%%EOF\n'),
};

for (const [what, bytes] of Object.entries(DAMAGED)) {
  test(`pass 3: a damaged PDF (${what}) reads PDF_UNAVAILABLE, and nothing is left unhandled`, async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => { unhandled.push(err); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { results } = await pass3With({
        pdfUrl: `${OA}/damaged.pdf`,
        routes: { [`${OA}/damaged.pdf`]: () => ({ statusCode: 200, data: bytes, headers: { 'content-type': 'application/pdf' } }) },
      });
      assert.deepEqual(results.map((r) => r.verdict), ['PDF_UNAVAILABLE', 'PDF_UNAVAILABLE'], show(results));
      assert.match(results[0]!.reason, /could not be read/);
      // Let any rejection pdf.js left behind surface before checking.
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
}
