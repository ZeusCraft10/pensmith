// tests/cassette-binary.test.ts — D-19-07: recorded redirects and binary bodies.
//
//   - the recorder keeps a redirect hop's `location` and stores a non-text body
//     (a PDF) as base64 with `bodyEncoding: "base64"`; secrets the request
//     carried never reach a recording; JSON stays JSON;
//   - offline replay follows recorded hops through the exact-match store and
//     returns the exact bytes; a loop, a downgrade, a hop to a private address
//     and a hop with no recording are refused, each with its own record;
//   - the synthetic mechanics fixtures live only under synthetic/net/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetch as httpFetch,
  fixtureEntryFor,
  isOfflineEgressError,
  RedirectError,
  SsrfBlockedError,
  _resetHttpLoggersForTest,
  type HttpResponse,
} from '../bin/lib/http.js';
import { fixtureBodyBytes, lookupFixture, type Cassette } from '../bin/lib/http-mock.js';
import { closeSessionLog } from '../bin/lib/session-log.js';

const NET_DIR = new URL('./fixtures/cassettes/synthetic/net/', import.meta.url);

function chainFixture(): Cassette[] {
  return JSON.parse(readFileSync(new URL('redirect-chain-pdf.json', NET_DIR), 'utf8')) as Cassette[];
}

function res(status: number, headers: Record<string, string>, bytes: Buffer): HttpResponse {
  return { status, headers, body: bytes.toString('utf8'), bodyBytes: bytes, cached: false };
}

/** Sources offline (the test runner default), a paper cwd for SESSION.log. */
async function offline<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-cassette-binary-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  const savedCwd = process.cwd();
  const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
  delete process.env['PENSMITH_NETWORK_TESTS'];
  process.chdir(cwd);
  _resetHttpLoggersForTest();
  try {
    return await fn(cwd);
  } finally {
    await closeSessionLog();
    _resetHttpLoggersForTest();
    process.chdir(savedCwd);
    if (savedLane !== undefined) process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function records(cwd: string): Promise<Array<{ url: string; status: number | null; cache: string; error?: string }>> {
  await closeSessionLog();
  const file = join(cwd, '.paper', 'SESSION.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { kind: string; url: string; status: number | null; cache: string; error?: string })
    .filter((r) => r.kind === 'http');
}

test('D-19-07: the recorder stores a PDF body as base64 with bodyEncoding, byte-exact on replay', () => {
  const pdf = fixtureBodyBytes(chainFixture()[2]!);
  const entry = fixtureEntryFor(
    { method: 'GET', url: 'https://cdn.pensmith.test/store/demo.pdf', body: undefined, requestHeaders: {}, res: res(200, { 'content-type': 'application/pdf', 'set-cookie': 'sid=1' }, pdf) },
    'generic',
  );
  assert.equal(entry.bodyEncoding, 'base64');
  assert.equal(typeof entry.response, 'string');
  assert.deepEqual(entry.responseHeaders, { 'content-type': 'application/pdf' }, 'set-cookie is never recorded');
  assert.ok(fixtureBodyBytes({ response: entry.response, bodyEncoding: 'base64' }).equals(pdf), 'base64 round-trips to the exact bytes');
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('D-19-07: a redirect hop is recorded with its location (and no other header); text and JSON stay text', () => {
  const hop = fixtureEntryFor(
    { method: 'GET', url: 'http://www.w3.org/x/dummy.pdf', body: undefined, requestHeaders: {}, res: res(301, { location: 'https://www.w3.org/x/dummy.pdf', server: 'x', 'content-type': 'text/html; charset=iso-8859-1' }, Buffer.alloc(0)) },
    'generic',
  );
  assert.deepEqual(hop.responseHeaders, { location: 'https://www.w3.org/x/dummy.pdf', 'content-type': 'text/html; charset=iso-8859-1' });
  assert.equal(hop.response, '');
  assert.equal(hop.bodyEncoding, undefined);
  const json = fixtureEntryFor(
    { method: 'GET', url: 'https://api.crossref.org/works/10.1%2Fx', body: undefined, requestHeaders: {}, res: res(200, { 'content-type': 'application/json' }, Buffer.from('{"status":"ok"}')) },
    'crossref',
  );
  assert.deepEqual(json.response, { status: 'ok' });
  assert.equal(json.bodyEncoding, undefined);
});

test('D-19-07 / SRC-06: a secret the request carried never reaches a recording (echoed body, Location, path)', () => {
  const key = 'zk-SECRET-KEY-1234567890';
  const echoed = fixtureEntryFor(
    {
      method: 'GET',
      url: 'https://api.zotero.org/keys/current',
      body: undefined,
      requestHeaders: { 'Zotero-API-Key': key },
      res: res(200, { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ key, userID: 1 }))),
    },
    'zotero',
  );
  assert.ok(!JSON.stringify(echoed).includes(key), 'the echoed key is scrubbed');
  assert.deepEqual(echoed.response, { key: 'REDACTED', userID: 1 });
  const redirected = fixtureEntryFor(
    {
      method: 'GET',
      url: `https://api.example.org/a?api_key=${key}&q=1`,
      body: undefined,
      requestHeaders: {},
      res: res(302, { location: `https://files.example.org/b?token=${key}` }, Buffer.alloc(0)),
    },
    'generic',
  );
  assert.ok(!JSON.stringify(redirected).includes(key), JSON.stringify(redirected));
  assert.equal(redirected.path, '/a?q=1', 'the secret query parameter is not in the recorded path');
});

test('D-19-07: offline replay follows the recorded 301 → 302 → 200 chain and returns the exact PDF bytes', async () => {
  await offline(async (cwd) => {
    const r = await httpFetch('http://files.pensmith.test/papers/demo.pdf', { source: 'generic', headers: { accept: 'application/pdf' } });
    assert.equal(r.status, 200);
    assert.equal(r.fixture, true);
    assert.equal(r.finalUrl, 'https://cdn.pensmith.test/store/demo.pdf');
    assert.equal(r.headers['content-type'], 'application/pdf');
    const expected = fixtureBodyBytes(chainFixture()[2]!);
    assert.ok(r.bodyBytes?.equals(expected), 'byte-exact');
    assert.equal(r.bodyBytes?.subarray(0, 5).toString('latin1'), '%PDF-');
    const recs = await records(cwd);
    assert.deepEqual(
      recs.map((x) => [x.url, x.status, x.cache]),
      [
        ['http://files.pensmith.test/papers/demo.pdf', 301, 'fixture'],
        ['https://files.pensmith.test/papers/demo.pdf', 302, 'fixture'],
        ['https://cdn.pensmith.test/store/demo.pdf', 200, 'fixture'],
      ],
    );
  });
});

test('D-19-07: offline replay applies the live redirect rules — loop, downgrade, private target, missing hop', async () => {
  await offline(async (cwd) => {
    await assert.rejects(() => httpFetch('https://loop.pensmith.test/a', { source: 'generic' }), (e: unknown) => e instanceof RedirectError && e.kind === 'loop');
    await assert.rejects(() => httpFetch('https://files.pensmith.test/downgrade', { source: 'generic' }), (e: unknown) => e instanceof RedirectError && e.kind === 'downgrade');
    await assert.rejects(
      () => httpFetch('http://files.pensmith.test/to-metadata', { source: 'generic' }),
      (e: unknown) => e instanceof SsrfBlockedError && /169\.254\.169\.254/.test(e.message),
    );
    await assert.rejects(
      () => httpFetch('https://files.pensmith.test/dangling', { source: 'generic' }),
      (e: unknown) => {
        assert.ok(isOfflineEgressError(e));
        assert.match((e as Error).message, /no recorded fixture for GET https:\/\/files\.pensmith\.test\/never-recorded/);
        return true;
      },
    );
    const refused = (await records(cwd)).filter((x) => x.cache === 'refused');
    assert.ok(refused.some((x) => x.url === 'https://files.pensmith.test/never-recorded'), 'the missing hop is named in its refusal record');
  });
});

test('D-19-07: a recorded chain replays through lookupFixture hop by hop', () => {
  const hop1 = lookupFixture('GET', 'http://files.pensmith.test/papers/demo.pdf');
  assert.equal(hop1?.status, 301);
  assert.equal(hop1?.headers['location'], 'https://files.pensmith.test/papers/demo.pdf');
  const last = lookupFixture('GET', 'https://cdn.pensmith.test/store/demo.pdf');
  assert.ok(last && last.bodyBytes.length > 100 && last.bodyBytes.subarray(0, 5).toString('latin1') === '%PDF-');
});
