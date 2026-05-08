// tests/http-cache.test.ts — per-source TTL cache behavior verification.
//
// What this test file proves:
//   - cache hit short-circuits BEFORE the network (registers exactly 1
//     interceptor; second call must NOT consume an interceptor)
//   - TTL expiry triggers re-fetch (we manipulate the cache file's savedAt
//     timestamp to be older than TTL)
//   - noCache:true bypasses cache (forces network on every call)
//   - cache writes go through atomicWriteFile — no .tmp leak after success
//   - clearCache removes every entry

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
  _resetWarnedForTest,
  _resetBucketsForTest,
} from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

interface Cassette {
  request: { method: string; url: string };
  responses: Array<{
    status: number;
    headers: Record<string, string>;
    // undici MockInterceptor.reply accepts `string | object | Buffer`.
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

async function withFreshState<T>(fn: () => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-cache-'));
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
// Tests
// ==================================================================

test('http-cache: second GET returns cached:true and does not consume a second interceptor', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-200');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    const r0 = cassette.responses[0]!;
    // Register EXACTLY ONE interceptor. If the cache fails to short-circuit,
    // the second call would error or consume a missing interceptor.
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    try {
      const first = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(first.cached, false, 'first call should NOT be cached');
      const second = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(second.cached, true, 'second call MUST be cached');
      assert.ok(second.cachedAt, 'cachedAt must be populated on cache hit');
      assert.equal(second.body, first.body, 'cached body must match the network body');
      // No remaining interceptors prove we hit network exactly once.
      assert.deepEqual(agent.pendingInterceptors(), [], 'no leftover interceptors');
    } finally {
      await agent.close();
    }
  });
});

test('http-cache: TTL expiry triggers re-fetch', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-200');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    const r0 = cassette.responses[0]!;
    // Two interceptors: first warms the cache, second proves TTL-expiry refetch.
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    try {
      await fetch(cassette.request.url, { source: 'crossref' });
      // Find the cache file and rewrite its savedAt to 100 days ago — well
      // beyond the 7-day crossref TTL.
      const dir = pensmithHttpCacheDir();
      const files = await fsp.readdir(dir);
      assert.equal(files.length, 1, 'exactly one cache file should exist');
      const cachePath = path.join(dir, files[0]!);
      const raw = await fsp.readFile(cachePath, 'utf8');
      const env = JSON.parse(raw) as { savedAt: string; response: unknown };
      env.savedAt = new Date(Date.now() - 100 * 24 * 3600_000).toISOString();
      // Use atomicWriteFile (chokepoint) to rewrite the cache envelope —
      // direct fsp.writeFile is banned by the D-07 lint rule.
      await atomicWriteFile(cachePath, JSON.stringify(env));
      const second = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(second.cached, false, 'TTL-expired entry must be ignored');
      assert.deepEqual(agent.pendingInterceptors(), [], 'both interceptors must have fired');
    } finally {
      await agent.close();
    }
  });
});

test('http-cache: noCache:true bypasses cache for both read and write', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-200');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    const r0 = cassette.responses[0]!;
    // Register 2 interceptors — both calls must hit network because noCache.
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers })
      .times(2);
    try {
      const first = await fetch(cassette.request.url, { source: 'crossref', noCache: true });
      const second = await fetch(cassette.request.url, { source: 'crossref', noCache: true });
      assert.equal(first.cached, false);
      assert.equal(second.cached, false);
      // Cache dir should be empty (noCache also disables write).
      const dir = pensmithHttpCacheDir();
      const files = await fsp.readdir(dir).catch(() => [] as string[]);
      assert.equal(files.length, 0, `noCache must skip write; got ${files.join(', ')}`);
    } finally {
      await agent.close();
    }
  });
});

test('http-cache: cache writes leave no .tmp file behind (atomicWriteFile)', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-200');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    const r0 = cassette.responses[0]!;
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    try {
      await fetch(cassette.request.url, { source: 'crossref' });
      const dir = pensmithHttpCacheDir();
      const files = await fsp.readdir(dir);
      const tmpLeaks = files.filter((f) => f.endsWith('.tmp'));
      assert.deepEqual(tmpLeaks, [], `unexpected .tmp leak: ${files.join(', ')}`);
    } finally {
      await agent.close();
    }
  });
});

test('http-cache: 404 GET is also cached (verifier short-circuit)', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-404');
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(cassette.request.url);
    const pool = agent.get(u.origin);
    const r0 = cassette.responses[0]!;
    // ONE interceptor — the second call must short-circuit the cache.
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r0.status, r0.body, { headers: r0.headers });
    try {
      const first = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(first.status, 404);
      const second = await fetch(cassette.request.url, { source: 'crossref' });
      assert.equal(second.status, 404);
      assert.equal(second.cached, true);
      assert.deepEqual(agent.pendingInterceptors(), []);
    } finally {
      await agent.close();
    }
  });
});

test('http-cache: clearCache removes every entry', async () => {
  await withFreshState(async () => {
    const cassette = loadCassette('crossref-doi-200');
    const agent = applyCassetteWithReplies(cassette);
    try {
      await fetch(cassette.request.url, { source: 'crossref' });
      const dir = pensmithHttpCacheDir();
      const before = await fsp.readdir(dir);
      assert.ok(before.length >= 1, 'cache should exist before clear');
      const { clearCache } = await import('../bin/lib/http.js');
      await clearCache();
      const after = await fsp.readdir(dir).catch(() => [] as string[]);
      assert.equal(after.length, 0, 'clearCache must empty the dir');
    } finally {
      await agent.close();
    }
  });
});

// ------------------------------------------------------------------
// Helper used by the last test
// ------------------------------------------------------------------
function applyCassetteWithReplies(cassette: Cassette): MockAgent {
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
