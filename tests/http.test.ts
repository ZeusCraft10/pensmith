// tests/http.test.ts — bin/lib/http.ts behavior tests using undici MockAgent
// cassettes (D-32). Lockdown mode (CI default) calls disableNetConnect() so
// any URL not declared in a cassette throws — proves the eslint chokepoint
// is load-bearing.
//
// Strategy:
//   - Each test loads ONE cassette JSON, builds a MockAgent that intercepts
//     the cassette's request URL, registers the responses array (in order),
//     installs the dispatcher globally, and exercises bin/lib/http.ts.
//   - Cache + bucket state is reset between tests via _resetBucketsForTest /
//     _resetWarnedForTest, plus PENSMITH_DATA_DIR-style isolation through
//     pensmithHttpCacheDir() (we override LOCALAPPDATA per-test so each test
//     has a fresh cache dir).
//   - The lockdown test never registers an interceptor; it asserts
//     disableNetConnect() blocks the request with an undici error.
//
// undici@7 note: MockAgent + setGlobalDispatcher replaces the global
// dispatcher used by request(). After the test we restore the original
// dispatcher to keep parallel test files isolated.

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
import {
  fetch,
  clearCache,
  _resetWarnedForTest,
  _resetBucketsForTest,
} from '../bin/lib/http.js';

// ------------------------------------------------------------------
// Cassette helper
// ------------------------------------------------------------------
interface Cassette {
  request: { method: string; url: string };
  responses: Array<{
    status: number;
    headers: Record<string, string>;
    // undici MockInterceptor.reply accepts `string | object | Buffer` — use
    // a permissive shape that satisfies its overload.
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
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as Cassette;
}

function applyCassette(cassette: Cassette): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const u = new URL(cassette.request.url);
  const pool = agent.get(u.origin);
  for (const r of cassette.responses) {
    pool
      .intercept({
        path: u.pathname + u.search,
        method: cassette.request.method,
      })
      .reply(r.status, r.body, { headers: r.headers });
  }
  return agent;
}

// ------------------------------------------------------------------
// Per-test isolation: redirect pensmithHttpCacheDir() to a tmp dir by
// pointing LOCALAPPDATA / XDG_DATA_HOME / HOME at it. paths.ts uses these
// envs to derive pensmithDataDir(), and pensmithHttpCacheDir() composes
// from there. Restore afterwards.
// ------------------------------------------------------------------
async function withFreshState<T>(
  fn: () => Promise<T>,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-http-'));
  const savedLad = process.env.LOCALAPPDATA;
  const savedXdg = process.env.XDG_DATA_HOME;
  const savedHome = process.env.HOME;
  const savedEmail = process.env.PENSMITH_CONTACT_EMAIL;
  const savedDispatcher: Dispatcher = getGlobalDispatcher();
  // Point all three so every platform branch lands inside tmpRoot.
  process.env.LOCALAPPDATA = tmpRoot;
  process.env.XDG_DATA_HOME = tmpRoot;
  process.env.HOME = tmpRoot;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
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

// ------------------------------------------------------------------
// stderr capture helper — used by the WARN-once tests.
// ------------------------------------------------------------------
function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let buf = '';
  // Override only for the duration of fn().
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  return fn()
    .then(() => buf)
    .finally(() => {
      process.stderr.write = original;
    });
}

// ==================================================================
// Tests
// ==================================================================

test('http: 200 cassette returns parsed body', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-200');
      const agent = applyCassette(cassette);
      try {
        const r = await fetch(cassette.request.url, { source: 'crossref' });
        assert.equal(r.status, 200);
        assert.equal(r.cached, false);
        const body = JSON.parse(r.body) as { message: { DOI: string } };
        assert.equal(body.message.DOI, '10.1038/test');
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: 404 cassette returns status 404 without throwing', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-404');
      const agent = applyCassette(cassette);
      try {
        const r = await fetch(cassette.request.url, { source: 'crossref' });
        assert.equal(r.status, 404);
        assert.equal(r.cached, false);
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: User-Agent contains pensmith/{version} and the email', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-200');
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      const u = new URL(cassette.request.url);
      const pool = agent.get(u.origin);
      // Capture the inbound User-Agent via the reply callback form.
      let observedUA = '';
      pool
        .intercept({ path: u.pathname + u.search, method: cassette.request.method })
        .reply((opts) => {
          const headers = opts.headers as Record<string, string> | undefined;
          if (headers) {
            for (const [k, v] of Object.entries(headers)) {
              if (k.toLowerCase() === 'user-agent') observedUA = v;
            }
          }
          const r0 = cassette.responses[0]!;
          return { statusCode: r0.status, data: r0.body, responseOptions: { headers: r0.headers } };
        });
      try {
        await fetch(cassette.request.url, { source: 'crossref' });
        assert.match(observedUA, /^pensmith\//, `UA should start with pensmith/, got "${observedUA}"`);
        assert.match(observedUA, /\(test@example\.org\)/, 'UA should contain the email');
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: WARN-once banner emitted exactly once across multiple fetches when PENSMITH_CONTACT_EMAIL is unset', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-200');
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      const u = new URL(cassette.request.url);
      const pool = agent.get(u.origin);
      const r0 = cassette.responses[0]!;
      // Intercept twice — bypassing cache for the second call so we hit the
      // network (and userAgent()) again.
      pool
        .intercept({ path: u.pathname + u.search, method: cassette.request.method })
        .reply(r0.status, r0.body, { headers: r0.headers })
        .times(3);

      const stderr = await captureStderr(async () => {
        await fetch(cassette.request.url, { source: 'crossref', noCache: true });
        await fetch(cassette.request.url, { source: 'crossref', noCache: true });
        await fetch(cassette.request.url, { source: 'crossref', noCache: true });
      });
      try {
        // Use a unique-to-the-banner sentinel that appears EXACTLY ONCE in
        // the locked banner (`pensmith: PENSMITH_CONTACT_EMAIL is not set.`)
        // — the full word "PENSMITH_CONTACT_EMAIL" appears twice in the
        // banner itself (once in the lead, once in the "Set ..." sentence),
        // so counting that is misleading.
        const sentinel = /pensmith: PENSMITH_CONTACT_EMAIL is not set\./g;
        const occurrences = (stderr.match(sentinel) ?? []).length;
        assert.equal(
          occurrences,
          1,
          `WARN-once expected exactly 1 banner emission across 3 fetches, got ${occurrences}`,
        );
        // Locked banner must contain the no-contact User-Agent phrasing.
        assert.match(stderr, /no-contact User-Agent/, 'Locked banner phrasing missing');
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: undefined },
  );
});

test('http: WARN does NOT fire when PENSMITH_CONTACT_EMAIL is set', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-200');
      const agent = applyCassette(cassette);
      const stderr = await captureStderr(async () => {
        await fetch(cassette.request.url, { source: 'crossref' });
      });
      try {
        assert.ok(
          !stderr.includes('PENSMITH_CONTACT_EMAIL'),
          `expected no WARN, got: ${JSON.stringify(stderr)}`,
        );
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'set@example.org' },
  );
});

test('http: lockdown mode — request to non-mocked URL throws (no live network)', async () => {
  await withFreshState(
    async () => {
      // Install a MockAgent with NO interceptors, disableNetConnect.
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      try {
        await assert.rejects(
          () =>
            fetch('https://api.example.invalid/never-mocked', {
              source: 'generic',
              noRetry: true,
            }),
        );
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: 429 with retry-after:1 — next attempt waits at least ~900ms', async () => {
  // Cassette: first response is 429 with retry-after: 1, second is 200.
  // We use a small value (1 second) to keep the test fast but still observable.
  // The delay assertion allows ±200ms tolerance (generous for CI environments).
  await withFreshState(
    async () => {
      const url = 'https://api.crossref.org/works/10.1038/retry-after-test';
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      const u = new URL(url);
      const pool = agent.get(u.origin);
      // First response: 429 with retry-after header
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(429, { error: 'rate limited' }, { headers: { 'retry-after': '1' } });
      // Second response: 200 success
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(200, { message: { DOI: '10.1038/retry-after-test' } }, { headers: {} });
      const start = Date.now();
      try {
        const r = await fetch(url, { source: 'crossref' });
        const elapsed = Date.now() - start;
        assert.equal(r.status, 200, '429-then-200 with retry-after should resolve to 200');
        assert.ok(
          elapsed >= 900,
          `expected elapsed >= 900ms (retry-after:1), got ${elapsed}ms`,
        );
        assert.deepEqual(agent.pendingInterceptors(), [], 'both interceptors must have fired');
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: 429 with NO retry-after header — normal jitter behavior (regression)', async () => {
  // This ensures the existing retry path still works when retry-after is absent.
  await withFreshState(
    async () => {
      const url = 'https://api.crossref.org/works/10.1038/no-retry-after';
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      const u = new URL(url);
      const pool = agent.get(u.origin);
      // First response: 429 without retry-after header
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(429, { error: 'rate limited' }, { headers: {} });
      // Second response: 200 success
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(200, { message: { DOI: '10.1038/no-retry-after' } }, { headers: {} });
      try {
        const r = await fetch(url, { source: 'crossref', noRetry: false });
        assert.equal(r.status, 200, '429-then-200 without retry-after should still resolve to 200');
        assert.deepEqual(agent.pendingInterceptors(), []);
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: 503 with retry-after:0 — next attempt fires without extra wait', async () => {
  // retry-after:0 means parseRetryAfter returns 0, so no extra sleep is added.
  await withFreshState(
    async () => {
      const url = 'https://api.crossref.org/works/10.1038/503-retry-after-zero';
      const agent = new MockAgent();
      agent.disableNetConnect();
      setGlobalDispatcher(agent);
      const u = new URL(url);
      const pool = agent.get(u.origin);
      // First response: 503 with retry-after: 0
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(503, { error: 'service unavailable' }, { headers: { 'retry-after': '0' } });
      // Second response: 200
      pool
        .intercept({ path: u.pathname + u.search, method: 'GET' })
        .reply(200, { message: { DOI: '10.1038/503-retry-after-zero' } }, { headers: {} });
      try {
        const r = await fetch(url, { source: 'crossref' });
        assert.equal(r.status, 200, '503-then-200 with retry-after:0 should resolve to 200');
        assert.deepEqual(agent.pendingInterceptors(), []);
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});

test('http: clearCache removes all entries', async () => {
  await withFreshState(
    async () => {
      const cassette = loadCassette('crossref-doi-200');
      const agent = applyCassette(cassette);
      try {
        await fetch(cassette.request.url, { source: 'crossref' });
        // Cache file should exist after the GET.
        const { pensmithHttpCacheDir } = await import('../bin/lib/paths.js');
        const dir = pensmithHttpCacheDir();
        const before = await fsp.readdir(dir);
        assert.ok(before.length >= 1, `expected cache file, got ${before.length}`);
        await clearCache();
        const after = await fsp.readdir(dir).catch(() => [] as string[]);
        assert.equal(after.length, 0, `clearCache should empty the dir, got ${after.length}`);
      } finally {
        await agent.close();
      }
    },
    { PENSMITH_CONTACT_EMAIL: 'test@example.org' },
  );
});
