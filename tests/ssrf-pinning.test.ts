// tests/ssrf-pinning.test.ts — SEC-01: the SSRF guard pins the connection to the
// validated IP (closes WR-03 / DNS rebinding) while keeping the hostname for TLS
// SNI and the Host header; redirects are never followed by undici
// (maxRedirections stays 0); the test seams exist only under a test context.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fetch as httpFetch,
  checkSsrf,
  __setHttpTestSeams,
  _resetBucketsForTest,
  type ResolvedAddress,
} from '../bin/lib/http.js';
import { installDialRecorder } from './helpers/local-servers/dial-recorder.mjs';
import { startSniServer, startHttpServer, withLocalHosts, testCa, SNI_HOST, json } from './helpers/local-servers/transport.js';

const HTTP_TS = fileURLToPath(new URL('../bin/lib/http.ts', import.meta.url));

async function liveLane<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  const savedOffline = process.env['PENSMITH_OFFLINE'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  delete process.env['PENSMITH_OFFLINE'];
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
    if (savedOffline !== undefined) process.env['PENSMITH_OFFLINE'] = savedOffline;
  }
}

test('SEC-01: a DNS answer that flips from a public IP to 127.0.0.1 still dials ONLY the validated public IP', async () => {
  await liveLane(async () => {
    let calls = 0;
    const rebinding = async (): Promise<ResolvedAddress[]> => {
      calls += 1;
      return calls === 1 ? [{ address: '203.0.113.10', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    };
    const rec = installDialRecorder(); // records, then refuses the connect
    __setHttpTestSeams({ resolve: rebinding });
    try {
      await assert.rejects(() => httpFetch('https://rebind.example/x', { source: 'generic', noRetry: true, noCache: true }));
    } finally {
      __setHttpTestSeams(null);
      rec.restore();
    }
    assert.equal(calls, 1, 'the hostname is resolved exactly once — the connect never re-resolves');
    const dials = rec.dials();
    assert.equal(dials.length, 1);
    assert.equal(dials[0]?.servername, 'rebind.example', 'SNI keeps the hostname');
    assert.deepEqual(dials[0]?.addresses, ['203.0.113.10'], 'the socket is pinned to the validated address');
    assert.deepEqual(rec.events.filter((e) => e.kind === 'dns'), [], 'the system resolver is never consulted');
  });
});

test('SEC-01: checkSsrf returns the validated addresses and still refuses private answers', async () => {
  const addrs = await checkSsrf('https://ok.example/', async () => [
    { address: '203.0.113.5', family: 4 },
    { address: '2001:db8::5', family: 6 },
  ]);
  assert.deepEqual(addrs, [
    { address: '203.0.113.5', family: 4 },
    { address: '2001:db8::5', family: 6 },
  ]);
  await assert.rejects(
    () => checkSsrf('https://mixed.example/', async () => [{ address: '203.0.113.5', family: 4 }, { address: '10.0.0.1', family: 4 }]),
    /private\/reserved IP 10\.0\.0\.1/,
    'ANY private answer blocks',
  );
  assert.deepEqual(await checkSsrf('https://93.184.216.34/'), [{ address: '93.184.216.34', family: 4 }], 'an IP literal needs no DNS');
});

test('SEC-01: the local SNI server is reached through the pinned dispatcher with the hostname as SNI and Host', async () => {
  const server = await startSniServer(json(200, { hello: 'sni' }));
  try {
    await liveLane(async () => {
      const r = await withLocalHosts([SNI_HOST], () =>
        httpFetch(`https://${SNI_HOST}:${server.port}/hello`, { source: 'generic', noCache: true, noRetry: true }),
      { ca: testCa() });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body), { hello: 'sni' });
      const req = server.requests[0];
      assert.ok(req, 'the server received the request');
      assert.equal(req.servername, SNI_HOST, 'TLS SNI carries the hostname, not the pinned IP');
      assert.equal(req.headers['host'], `${SNI_HOST}:${server.port}`, 'the Host header carries the hostname');
    });
  } finally {
    await server.close();
  }
});

test('SEC-01: certificate verification stays on — without the test CA the SNI server is refused', async () => {
  const server = await startSniServer(json(200, { hello: 'sni' }));
  try {
    await liveLane(async () => {
      await assert.rejects(() =>
        withLocalHosts([SNI_HOST], () =>
          httpFetch(`https://${SNI_HOST}:${server.port}/hello`, { source: 'generic', noCache: true, noRetry: true }),
        ),
      );
      assert.equal(server.requests.length, 0, 'no request is sent over an untrusted TLS session');
    });
  } finally {
    await server.close();
  }
});

test('SEC-01: redirects are never followed by undici (maxRedirections stays 0)', async () => {
  const server = await startHttpServer((_req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });
  try {
    await liveLane(async () => {
      const host = 'redirect.pensmith.test';
      const r = await withLocalHosts([host], () =>
        httpFetch(`http://${host}:${server.port}/start`, { source: 'generic', noCache: true, noRetry: true }),
      );
      assert.equal(r.status, 302, 'the 302 is returned to the caller, not followed');
      assert.equal(r.headers['location'], 'http://169.254.169.254/latest/meta-data/');
      assert.equal(server.requests.length, 1);
    });
  } finally {
    await server.close();
  }
});

test('SEC-01: http.ts sets maxRedirections: 0 exactly once and has no dead `void Agent`', () => {
  const src = readFileSync(HTTP_TS, 'utf8');
  const all = [...src.matchAll(/maxRedirections\s*:\s*([^,\s}]+)/g)].map((m) => m[1]);
  assert.deepEqual(all, ['0'], 'the only maxRedirections in http.ts is the literal 0');
  assert.ok(!/void\s+Agent\b/.test(src), 'the unused `void Agent;` import touch is gone');
  assert.ok(/new Agent\(/.test(src), 'a per-request pinned Agent is built');
});

test('SEC-01: the test seams exist only under a test context', async () => {
  const saved = { ctx: process.env['NODE_TEST_CONTEXT'], t: process.env['PENSMITH_TEST'] };
  delete process.env['NODE_TEST_CONTEXT'];
  delete process.env['PENSMITH_TEST'];
  try {
    assert.throws(() => __setHttpTestSeams({ localHosts: ['evil.example'] }), /only under the test runner/);
  } finally {
    if (saved.ctx !== undefined) process.env['NODE_TEST_CONTEXT'] = saved.ctx;
    if (saved.t !== undefined) process.env['PENSMITH_TEST'] = saved.t;
  }
  // A seam installed in a test context is ignored the moment the context is gone.
  __setHttpTestSeams({ resolve: async () => [{ address: '127.0.0.1', family: 4 }], localHosts: ['local.pensmith.test'] });
  delete process.env['NODE_TEST_CONTEXT'];
  delete process.env['PENSMITH_TEST'];
  const rec = installDialRecorder();
  try {
    await assert.rejects(() =>
      httpFetch('http://local.pensmith.test/', { source: 'generic', noCache: true, noRetry: true }),
    );
    assert.ok(
      rec.events.some((e) => e.kind === 'dns' && e.host === 'local.pensmith.test'),
      'outside a test context the real resolver (here the recorder) is used, not the seam',
    );
  } finally {
    rec.restore();
    if (saved.ctx !== undefined) process.env['NODE_TEST_CONTEXT'] = saved.ctx;
    if (saved.t !== undefined) process.env['PENSMITH_TEST'] = saved.t;
    __setHttpTestSeams(null);
  }
});

test('SEC-01: .planning/SECURITY.md records row 2a (IP pinning) as PROVEN', () => {
  const sec = readFileSync(fileURLToPath(new URL('../.planning/SECURITY.md', import.meta.url)), 'utf8');
  const row = sec.split(/\r?\n/).find((l) => /\|\s*2a\s*\|/.test(l));
  assert.ok(row, 'SECURITY.md has a row 2a');
  assert.match(row, /PROVEN/);
  assert.match(row, /ssrf-pinning/);
});
