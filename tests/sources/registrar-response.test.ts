// tests/sources/registrar-response.test.ts — the outcome classification every
// registrar adapter shares (SRC-05, SRC-17, D-19-05): what counts as the
// service's answer, what a failure reads like, and that OfflineEgressError is a
// mode (rethrown), never an outcome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exchange,
  jsonShape,
  validator,
  bodyMessage,
  statusReason,
  parseJsonBody,
  __setRegistrarSendForTest,
} from '../../bin/lib/sources/registrar-response.js';
import {
  OfflineEgressError,
  RateLimitExhaustedError,
  CircuitOpenError,
  RedirectError,
  SsrfBlockedError,
  type HttpResponse,
} from '../../bin/lib/http.js';
import * as dryRun from '../../bin/lib/sources/dry-run.js';

function res(status: number, body: string, headers: Record<string, string> = {}): HttpResponse {
  return { status, body, headers, cached: false };
}

const SHAPE = jsonShape((b) => typeof b === 'object' && b !== null && Array.isArray((b as { items?: unknown }).items), 'item list');
const OPTS = { service: 'Example', check: SHAPE };

test('jsonShape: the service answer passes; unreadable JSON, an error document or the wrong shape is named', () => {
  assert.equal(SHAPE(res(200, '{"items":[]}')), null);
  assert.equal(SHAPE(res(200, '<html>')), 'unreadable JSON');
  assert.equal(SHAPE(res(200, '{"statusCode":"403","message-type":"not-polite"}')), 'an error document: an inner statusCode 403');
  assert.equal(SHAPE(res(200, '{"error":"Rate limit exceeded"}')), 'an error document: an "error" member');
  assert.equal(SHAPE(res(200, '{"other":1}')), 'no item list');
  // The transport validator judges only a 200 (a 404 is the registrar's answer).
  const v = validator(SHAPE);
  assert.equal(v(res(404, 'Not Found')), null);
  assert.equal(v(res(200, '{"other":1}')), 'no item list');
});

test('bodyMessage / statusReason: the service\'s own words, one line, bounded (LF and CRLF)', () => {
  assert.equal(bodyMessage('{"HTTP_status_code":422,"error":true,"message":"Email address required"}'), 'Email address required');
  assert.equal(bodyMessage('{"error":{"code":429,"message":"Quota exceeded"}}'), 'Quota exceeded');
  assert.equal(bodyMessage('{"status":"failed","message":[{"type":"x","message":"This route does not support select"}]}'), 'This route does not support select');
  assert.equal(bodyMessage('Resource not found.'), 'Resource not found.');
  assert.equal(bodyMessage('first line\r\nsecond line'), 'first line');
  assert.equal(bodyMessage('first line\nsecond line'), 'first line');
  assert.equal(bodyMessage('<!doctype html><html></html>'), null);
  assert.equal(bodyMessage('{}'), null);
  assert.equal(bodyMessage(''), null);
  assert.ok((bodyMessage(`{"message":"${'x'.repeat(500)}"}`) ?? '').length <= 160);
  assert.equal(statusReason(res(422, '{"message":"Email address required"}')), 'HTTP 422: Email address required');
  assert.equal(statusReason(res(404, '')), 'HTTP 404');
  assert.equal(parseJsonBody({ body: 'nope' }), undefined);
});

test('exchange: ok / status / failed for a response', async () => {
  const ok = await exchange(async () => res(200, '{"items":[1]}'), OPTS);
  assert.equal(ok.kind, 'ok');
  const notFound = await exchange(async () => res(404, 'Not Found'), OPTS);
  assert.equal(notFound.kind, 'status');
  const invalid = await exchange(async () => res(200, '{"statusCode":400}'), OPTS);
  assert.deepEqual(invalid, { kind: 'failed', reason: 'response is not an Example answer (an error document: an inner statusCode 400)', status: 200 });
  const down = await exchange(async () => res(503, 'down'), OPTS);
  assert.deepEqual(down, { kind: 'failed', reason: 'HTTP 503 after retries', status: 503 });
  const limited = await exchange(async () => res(429, '{"message":"slow down"}', { 'retry-after': '35' }), OPTS);
  assert.deepEqual(limited, { kind: 'failed', reason: 'HTTP 429 after retries: slow down', status: 429, retryAfterMs: 35_000 });
});

test('exchange: the transport\'s refusals become failed with a complete reason', async () => {
  const exhausted = await exchange(async () => {
    throw new RateLimitExhaustedError('api.example.org', 22_400_000, 429);
  }, OPTS);
  assert.deepEqual(exhausted, { kind: 'failed', reason: 'rate limit exhausted (retry after ~6 h)', status: 429, retryAfterMs: 22_400_000 });
  const hinted = await exchange(async () => {
    throw new RateLimitExhaustedError('api.example.org', 60_000, 429);
  }, { ...OPTS, rateLimited: (i) => `budget gone (${i.exhausted ? 'exhausted' : 'limited'}, ${i.retryAfterMs} ms)` });
  assert.equal(hinted.kind === 'failed' ? hinted.reason : '', 'budget gone (exhausted, 60000 ms)');
  const breaker = await exchange(async () => {
    throw new CircuitOpenError('api.example.org', 503, 3);
  }, OPTS);
  assert.deepEqual(breaker, { kind: 'failed', reason: 'skipped after 3 consecutive HTTP 503 responses', status: 503 });
  const breaker429 = await exchange(async () => {
    throw new CircuitOpenError('api.example.org', 429, 3);
  }, { ...OPTS, rateLimited: () => 'set THE_KEY' });
  assert.equal(breaker429.kind === 'failed' ? breaker429.reason : '', 'set THE_KEY');
  const retried = await exchange(async () => {
    throw Object.assign(new Error('HTTP 429'), { status: 429, response: res(429, '{"message":"x"}', { 'retry-after': '2' }) });
  }, { ...OPTS, rateLimited: (i) => `limited, body ${i.body}, wait ${i.retryAfterMs}` });
  assert.equal(retried.kind === 'failed' ? retried.reason : '', 'limited, body {"message":"x"}, wait 2000');
  const redirect = await exchange(async () => {
    throw new RedirectError('too-many', 'https://a.example/x', 'more than 5 hops');
  }, OPTS);
  assert.equal(redirect.kind === 'failed' ? redirect.reason : '', 'too many redirects: more than 5 hops');
  const ssrf = await exchange(async () => {
    throw new SsrfBlockedError('SSRF guard: "x" resolves to private/reserved IP 10.0.0.1 — blocked');
  }, OPTS);
  assert.match(ssrf.kind === 'failed' ? ssrf.reason : '', /^SSRF guard: /);
  const transport = await exchange(async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 192.0.2.1:443'), { code: 'ECONNREFUSED' });
  }, OPTS);
  assert.equal(transport.kind === 'failed' ? transport.reason : '', 'connect ECONNREFUSED 192.0.2.1:443');
});

test('exchange: OfflineEgressError is a mode — rethrown untouched', async () => {
  const err = new OfflineEgressError('offline', 'test runner', 'GET https://x', 'offline: no recorded fixture for GET https://x — re-run online');
  await assert.rejects(() => exchange(async () => { throw err; }, OPTS), (e: unknown) => e === err);
});

test('__setRegistrarSendForTest answers every exchange until reset (test contexts only)', async () => {
  try {
    __setRegistrarSendForTest(async () => res(200, '{"items":["seam"]}'));
    const r = await exchange(async () => res(500, 'never sent'), OPTS);
    assert.equal(r.kind, 'ok');
  } finally {
    __setRegistrarSendForTest(null);
  }
  const back = await exchange(async () => res(404, ''), OPTS);
  assert.equal(back.kind, 'status');
});

test('dry-run provider: lookupById is found for a minted id, not-found otherwise (never failed, no request)', async () => {
  const [minted] = await dryRun.search('any topic');
  assert.ok(minted?.doi);
  const r = await dryRun.lookupById(minted.doi);
  assert.equal(r.kind, 'found');
  assert.equal(r.kind === 'found' ? r.candidate.title : '', minted.title);
  assert.equal(r.kind === 'found' ? r.candidate.type : '', minted.type);
  const other = await dryRun.lookupById('10.1038/nature14539');
  assert.equal(other.kind, 'not-found');
  assert.equal(await dryRun.fetchById('10.1038/nature14539'), null);
  const all = await dryRun.search('another topic');
  assert.ok(all.some((c) => c.type === 'book' && c.publisher !== undefined), 'a book carries its publisher');
  assert.ok(all.some((c) => c.type === 'article-journal' && c.venue !== undefined), 'an article carries its venue');
});
