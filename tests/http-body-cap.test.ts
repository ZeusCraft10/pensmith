// tests/http-body-cap.test.ts — http.ts stops reading a response at a size
// limit, and streams a response to an API SDK through the same chokepoint.
//
// fetch() used to read every body whole into memory with no limit: a 2 GB
// "PDF" from a registry link was read in full before extractPdfText's 50 MB
// cap could refuse it. A request now carries a maximum body size, and a body
// past it fails with ResponseTooLargeError as soon as the limit is crossed.
//
// chokepointFetch() is the WHATWG fetch the Anthropic SDK is given, so a
// model call goes through the same proxy-aware dispatcher, rate bucket,
// deadline, offline refusal and size limit as every other request, with the
// body streamed instead of buffered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetch,
  chokepointFetch,
  ResponseTooLargeError,
  RequestNotResentError,
  HttpDeadlineError,
} from '../bin/lib/http.js';
import { OfflineEgressError } from '../bin/lib/network-mode.js';
import { MAX_PDF_BYTES } from '../bin/lib/pdf-text.js';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { JSON_HEADERS, useMockRegistries } from './lib/mock-registries.js';

const mockAgent = useMockRegistries('pensmith-body-cap-');

const ORIGIN = 'https://api.crossref.org';

test('fetch refuses a body larger than maxBodyBytes', async () => {
  mockAgent().get(ORIGIN).intercept({ path: '/big', method: 'GET' })
    .reply(200, Buffer.alloc(2048, 0x61), { headers: { 'content-type': 'text/plain' } });
  await assert.rejects(
    fetch(`${ORIGIN}/big`, { source: 'crossref', noCache: true, maxBodyBytes: 1024 }),
    (e: unknown) => e instanceof ResponseTooLargeError && e.limitBytes === 1024 && /api\.crossref\.org/.test(e.message),
  );
});

test('fetch refuses up front when the declared content-length is past the limit', async () => {
  // The interceptor is registered once: a retry would find no answer and fail
  // with a different error, so this also shows the refusal is not retried.
  mockAgent().get(ORIGIN).intercept({ path: '/declared', method: 'GET' })
    .reply(200, 'small', { headers: { 'content-type': 'text/plain', 'content-length': String(10_000_000) } });
  await assert.rejects(
    fetch(`${ORIGIN}/declared`, { source: 'crossref', noCache: true, maxBodyBytes: 1_000_000 }),
    ResponseTooLargeError,
  );
});

test('a HEAD answer is not refused for the size of the body it describes', async () => {
  // A HEAD response's content-length is the size a GET would return; there
  // is no body to read.
  mockAgent().get(ORIGIN).intercept({ path: '/head', method: 'HEAD' })
    .reply(200, '', { headers: { 'content-type': 'application/pdf', 'content-length': String(200_000_000) } });
  const res = await fetch(`${ORIGIN}/head`, { method: 'HEAD', source: 'crossref', noCache: true, maxBodyBytes: 1024 });
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
});

test('fetch returns a body at the limit intact', async () => {
  const body = Buffer.alloc(1024, 0x62);
  mockAgent().get(ORIGIN).intercept({ path: '/fits', method: 'GET' })
    .reply(200, body, { headers: { 'content-type': 'text/plain' } });
  const res = await fetch(`${ORIGIN}/fits`, { source: 'crossref', noCache: true, maxBodyBytes: 1024 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.bodyBytes, body);
});

test('Pass 3 stops reading an open-access PDF past the PDF size limit', async () => {
  const doi = '10.1234/huge';
  const agent = mockAgent();
  agent.get('https://api.openalex.org').intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' }).reply(200,
    JSON.stringify({ id: 'https://openalex.org/W1', doi: `https://doi.org/${doi}`, best_oa_location: { is_oa: true, pdf_url: 'https://93.184.215.14/huge.pdf' } }),
    { headers: JSON_HEADERS }).persist();
  const huge = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
  huge.write('%PDF-1.5\n', 0, 'latin1');
  agent.get('https://93.184.215.14').intercept({ path: '/huge.pdf', method: 'GET' })
    .reply(200, huge, { headers: { 'content-type': 'application/pdf' } });

  const draft = 'They write that "a sentence long enough to be checked as a quotation here" [@k, p. 1].\n';
  const [result] = await runPass3(draft, new Map([['k', { DOI: doi }]]));
  assert.ok(result, 'one quotation was checked');
  assert.notEqual(result.verdict, 'OK');
  assert.match(JSON.stringify(result), /larger than/, `the reason names the size limit: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// chokepointFetch: the SDK's fetch
// ---------------------------------------------------------------------------

const API = 'https://api.anthropic.com';

test('chokepointFetch streams the response body and keeps status and headers', async () => {
  mockAgent().get(API).intercept({ path: '/v1/messages', method: 'POST' }).reply(200, (opts) => {
    assert.equal(opts.body, '{"hello":"there"}', 'the request body is sent as given');
    return 'event: ping\ndata: {}\n\n';
  }, { headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } });

  const f = chokepointFetch({ source: 'generic', timeoutMs: 5_000, maxBodyBytes: 1024, untrusted: false });
  const res = await f(`${API}/v1/messages`, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-api-key': 'k' }),
    body: '{"hello":"there"}',
  });
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('request-id'), 'req_1');
  assert.ok(res.body, 'the body is a stream');
  assert.equal(await res.text(), 'event: ping\ndata: {}\n\n');
});

test('chokepointFetch fails the body stream once it passes maxBodyBytes', async () => {
  mockAgent().get(API).intercept({ path: '/v1/messages', method: 'POST' })
    .reply(200, 'x'.repeat(4096), { headers: { 'content-type': 'text/event-stream' } });
  const f = chokepointFetch({ source: 'generic', timeoutMs: 5_000, maxBodyBytes: 1024, untrusted: false });
  const res = await f(`${API}/v1/messages`, { method: 'POST', body: '{}' });
  await assert.rejects(res.text(), ResponseTooLargeError);
});

test('chokepointFetch refuses every request while offline', async () => {
  process.env['PENSMITH_OFFLINE'] = '1';
  const f = chokepointFetch({ source: 'generic', timeoutMs: 5_000, maxBodyBytes: 1024, untrusted: false });
  await assert.rejects(f(`${API}/v1/messages`, { method: 'POST', body: '{}' }), OfflineEgressError);
});

test('chokepointFetch never sends a POST again after a deadline it may have reached the server in', async () => {
  let hits = 0;
  mockAgent().get(API).intercept({ path: '/v1/messages', method: 'POST' }).reply(() => {
    hits += 1;
    return { statusCode: 200, data: 'late' };
  }).delay(500).persist();
  const f = chokepointFetch({ source: 'generic', timeoutMs: 50, maxBodyBytes: 1024, untrusted: false });
  await assert.rejects(f(`${API}/v1/messages`, { method: 'POST', body: '{}' }), HttpDeadlineError);
  // The SDK retries a failed fetch on its own. That retry is refused here, so a
  // generation that may already be running and billed is not started twice.
  await assert.rejects(f(`${API}/v1/messages`, { method: 'POST', body: '{}' }), RequestNotResentError);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(hits, 1, 'one request reached the server');
});

// ---------------------------------------------------------------------------
// Responses with no body: one rule for fetch() and chokepointFetch()
// ---------------------------------------------------------------------------

// The answer to a HEAD and a 204, 205 or 304 carry no body, whatever their
// content-length says: it describes the representation a GET would return.
// fetch() used to refuse a 304 or 204 that declared a large length, and
// chokepointFetch() a HEAD or 304.
const BIG = String(200_000_000);

test('fetch reads no body from a 204 or 304, and does not refuse it for the length it declares', async () => {
  for (const status of [204, 304]) {
    mockAgent().get(ORIGIN).intercept({ path: `/bodyless-${status}`, method: 'GET' })
      .reply(status, '', { headers: { 'content-type': 'application/pdf', 'content-length': BIG } });
    const res = await fetch(`${ORIGIN}/bodyless-${status}`, { source: 'crossref', noCache: true, maxBodyBytes: 1024 });
    assert.equal(res.status, status);
    assert.equal(res.body, '');
    assert.equal(res.bodyBytes?.length ?? 0, 0);
  }
});

test('chokepointFetch gives a HEAD or a 304 a null body, and does not refuse it for the length it declares', async () => {
  const f = chokepointFetch({ source: 'generic', timeoutMs: 5_000, maxBodyBytes: 1024, untrusted: false });
  mockAgent().get(API).intercept({ path: '/v1/models', method: 'HEAD' })
    .reply(200, '', { headers: { 'content-type': 'application/json', 'content-length': BIG } });
  const head = await f(`${API}/v1/models`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('content-length'), BIG);

  mockAgent().get(API).intercept({ path: '/v1/models', method: 'GET' })
    .reply(304, '', { headers: { 'content-length': BIG } });
  const notModified = await f(`${API}/v1/models`, { method: 'GET' });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body, null);
});

test('a response with a body is still refused up front by chokepointFetch when its declared length is past the limit', async () => {
  mockAgent().get(API).intercept({ path: '/v1/messages', method: 'POST' })
    .reply(200, 'small', { headers: { 'content-type': 'text/event-stream', 'content-length': BIG } });
  const f = chokepointFetch({ source: 'generic', timeoutMs: 5_000, maxBodyBytes: 1024, untrusted: false });
  await assert.rejects(f(`${API}/v1/messages`, { method: 'POST', body: '{}' }), ResponseTooLargeError);
});
