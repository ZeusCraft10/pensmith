// tests/retry.test.ts — full-jitter retry shim verification.
//
// Two layers of testing:
//   (1) Pure shim tests — retry() and fullJitterDelayMs() in isolation,
//       no network. Tight delays (baseMs:1, capMs:5) keep the suite fast.
//   (2) Integration tests — exercise bin/lib/http.ts against the
//       crossref-doi-429-retry and crossref-doi-500-retry cassettes to
//       prove the retry contract end-to-end (D-32). These verify that
//       HTTP 429 / 500 responses are auto-retried, and that exhausting
//       `maxAttempts` on a permanent 500 throws.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { retry, fullJitterDelayMs, parseRetryAfter } from '../bin/lib/retry.js';
import {
  fetch,
  _resetWarnedForTest,
  _resetBucketsForTest,
} from '../bin/lib/http.js';

// ------------------------------------------------------------------
// Cassette helper (subset — same shape as tests/http.test.ts)
// ------------------------------------------------------------------
interface Cassette {
  request: { method: string; url: string };
  responses: Array<{
    status: number;
    headers: Record<string, string>;
    body: object | string;
  }>;
}

function loadCassette(name: string): Cassette {
  const file = path.resolve(
    process.cwd(),
    'tests',
    'fixtures',
    'http-cassettes',
    `${name}.json`,
  );
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Cassette;
}

function applyCassette(cassette: Cassette): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const u = new URL(cassette.request.url);
  const pool = agent.get(u.origin);
  for (const r of cassette.responses) {
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r.status, r.body, { headers: r.headers });
  }
  return agent;
}

async function withFreshState<T>(fn: () => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-retry-'));
  const savedLad = process.env.LOCALAPPDATA;
  const savedXdg = process.env.XDG_DATA_HOME;
  const savedHome = process.env.HOME;
  const savedEmail = process.env.PENSMITH_CONTACT_EMAIL;
  const savedDispatcher: Dispatcher = getGlobalDispatcher();
  process.env.LOCALAPPDATA = tmpRoot;
  process.env.XDG_DATA_HOME = tmpRoot;
  process.env.HOME = tmpRoot;
  process.env.PENSMITH_CONTACT_EMAIL = 'test@example.org';
  _resetWarnedForTest();
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    if (savedLad === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = savedLad;
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedEmail === undefined) delete process.env.PENSMITH_CONTACT_EMAIL;
    else process.env.PENSMITH_CONTACT_EMAIL = savedEmail;
    setGlobalDispatcher(savedDispatcher);
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ==================================================================
// Layer 1: Shim tests
// ==================================================================

test('retry: returns immediately when fn succeeds on first try', async () => {
  const v = await retry(async () => 42);
  assert.equal(v, 42);
});

test('retry: returns success after transient throws', async () => {
  let calls = 0;
  const v = await retry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    },
    { baseMs: 1, capMs: 5, maxAttempts: 5 },
  );
  assert.equal(v, 'ok');
  assert.equal(calls, 3);
});

test('retry: throws the last error when maxAttempts is exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls++;
          throw new Error('always-fail');
        },
        { baseMs: 1, capMs: 5, maxAttempts: 3 },
      ),
    /always-fail/,
  );
  assert.equal(calls, 3, 'maxAttempts=3 must produce exactly 3 calls');
});

test('retry: retryOn returning false aborts immediately', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls++;
          throw new Error('non-retryable');
        },
        {
          baseMs: 1,
          capMs: 5,
          maxAttempts: 5,
          retryOn: () => false,
        },
      ),
    /non-retryable/,
  );
  assert.equal(calls, 1, 'retryOn:false must short-circuit after the first failure');
});

test('retry: onAttempt fires for every failed attempt (including the last)', async () => {
  const attempts: number[] = [];
  await assert.rejects(() =>
    retry(
      async () => {
        throw new Error('boom');
      },
      {
        baseMs: 1,
        capMs: 5,
        maxAttempts: 4,
        onAttempt: (n) => attempts.push(n),
      },
    ),
  );
  assert.deepEqual(attempts, [1, 2, 3, 4]);
});

test('retry: rejects invalid maxAttempts (<1)', async () => {
  await assert.rejects(
    () => retry(async () => 1, { maxAttempts: 0 }),
    /maxAttempts/,
  );
});

test('fullJitterDelayMs: result is in [0, min(cap, base*2^(n-1))]', () => {
  // attempt=3, base=100 -> exp = 400. cap=5000 -> upper = 400.
  for (let i = 0; i < 200; i++) {
    const d = fullJitterDelayMs(3, 100, 5000);
    assert.ok(d >= 0, `d=${d} must be >= 0`);
    assert.ok(d <= 400, `d=${d} must be <= 400`);
  }
});

test('fullJitterDelayMs: cap clamps the upper bound', () => {
  // attempt=10, base=200 -> exp = 200 * 512 = 102400. cap=1000 -> upper = 1000.
  for (let i = 0; i < 200; i++) {
    const d = fullJitterDelayMs(10, 200, 1000);
    assert.ok(d >= 0 && d <= 1000, `d=${d} must be in [0,1000]`);
  }
});

test('fullJitterDelayMs: rejects attempt < 1', () => {
  assert.throws(() => fullJitterDelayMs(0, 100, 1000), /attempt/);
});

test('fullJitterDelayMs: large attempt does not overflow to NaN', () => {
  // attempt=100 would normally produce 2^99 — we cap the exponent at 30
  // internally so capMs still wins. Result must be finite.
  const d = fullJitterDelayMs(100, 200, 1000);
  assert.ok(Number.isFinite(d), `d=${d} must be finite`);
  assert.ok(d >= 0 && d <= 1000, `d=${d} must be in [0,1000]`);
});

// ==================================================================
// parseRetryAfter unit tests (D-01, Phase 2 carry-forward)
// ==================================================================

test('parseRetryAfter: undefined returns 0', () => {
  assert.equal(parseRetryAfter(undefined, Date.now()), 0);
});

test('parseRetryAfter: empty string returns 0', () => {
  assert.equal(parseRetryAfter('', Date.now()), 0);
});

test('parseRetryAfter: delta-seconds "120" returns 120_000 ms', () => {
  const anyNow = Date.now();
  assert.equal(parseRetryAfter('120', anyNow), 120_000);
});

test('parseRetryAfter: delta-seconds "0" returns 0', () => {
  const anyNow = Date.now();
  assert.equal(parseRetryAfter('0', anyNow), 0);
});

test('parseRetryAfter: invalid string "not-a-number" returns 0 (never throws)', () => {
  const anyNow = Date.now();
  assert.equal(parseRetryAfter('not-a-number', anyNow), 0);
});

test('parseRetryAfter: negative delta "-30" returns 0 (clamped)', () => {
  const anyNow = Date.now();
  assert.equal(parseRetryAfter('-30', anyNow), 0);
});

test('parseRetryAfter: HTTP-date form 1-minute future returns 60_000 ms', () => {
  const refNow = new Date('2026-10-21T07:27:00Z').getTime();
  assert.equal(
    parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', refNow),
    60_000,
  );
});

test('parseRetryAfter: HTTP-date form past date returns 0 (clamped)', () => {
  const refNow = new Date('2026-10-21T08:00:00Z').getTime();
  assert.equal(
    parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', refNow),
    0,
  );
});

test('parseRetryAfter: invalid date string returns 0', () => {
  const anyNow = Date.now();
  assert.equal(parseRetryAfter('not a valid date string', anyNow), 0);
});

// ==================================================================
// Layer 2: HTTP cassette integration tests
// ==================================================================

test('retry-cassette: 429 then 200 — retry succeeds on second attempt', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-429-retry');
    const agent = applyCassette(cassette);
    try {
      const r = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(r.status, 200, '429-then-200 cassette should resolve to 200');
      assert.equal(r.cached, false);
      assert.deepEqual(
        agent.pendingInterceptors(),
        [],
        'both interceptors must have fired (429 then 200)',
      );
    } finally {
      await agent.close();
    }
  });
});

test('retry-cassette: 500 then 200 — retry succeeds on second attempt', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-500-retry');
    const agent = applyCassette(cassette);
    try {
      const r = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(r.status, 200, '500-then-200 cassette should resolve to 200');
      assert.equal(r.cached, false);
      assert.deepEqual(agent.pendingInterceptors(), []);
    } finally {
      await agent.close();
    }
  });
});

test('retry-cassette: noRetry:true skips retry on 500 (returns the 500 directly)', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-500-retry');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    // Register only the FIRST response (the 500).
    const r0 = cassette.responses[0]!;
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    try {
      const r = await fetch(cassette.request.url, {
        source: 'crossref',
        noRetry: true,
      });
      assert.equal(r.status, 500, 'noRetry must surface the 500 directly');
      assert.deepEqual(agent.pendingInterceptors(), [], 'exactly 1 interceptor consumed');
    } finally {
      await agent.close();
    }
  });
});

test('retry-cassette: 4xx (404) is NOT retried', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-404');
    const agent = applyCassette(cassette); // exactly 1 interceptor
    try {
      const r = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(r.status, 404);
      assert.deepEqual(
        agent.pendingInterceptors(),
        [],
        '404 should be a single dispatch, not retried',
      );
    } finally {
      await agent.close();
    }
  });
});

test('retry-cassette: permanent 500 — maxAttempts exhausted -> throws', async () => {
  await withFreshState(async () => {
    // Build a cassette that ALWAYS returns 500 — register 5 interceptors
    // (the maxAttempts default) and assert all are consumed.
    const url = 'https://api.crossref.org/works/10.1038/permerr';
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(url);
    const pool = agent.get(u.origin);
    for (let i = 0; i < 5; i++) {
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(500, { error: 'permanent' }, { headers: {} });
    }
    try {
      await assert.rejects(
        () => fetch(url, { source: 'crossref' }),
        /HTTP 500/,
      );
      assert.deepEqual(
        agent.pendingInterceptors(),
        [],
        'all 5 interceptors must have fired before the throw',
      );
    } finally {
      await agent.close();
    }
  });
});
