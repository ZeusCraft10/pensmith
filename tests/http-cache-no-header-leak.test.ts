// tests/http-cache-no-header-leak.test.ts
//
// CR-03 / FLAG-06 regression: the http cache MUST NOT persist auth-bearing
// or session-bearing response headers to disk. The on-disk cache survives
// for up to 7 days and may be tailed by log shippers / cloud-sync clients.
// `Set-Cookie`, `Authorization` echoes, x-amz-* / x-azure-* debug headers,
// and provider-specific opaque session tokens MUST be dropped before the
// cache envelope reaches atomicWriteFile.
//
// Test method: plant sentinel-bearing headers in a mocked response, drive
// the http chokepoint to cache it, walk the cache_dir recursively, and
// assert no file contains the sentinel substring.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { fetch, _resetWarnedForTest, _resetBucketsForTest } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';

// SENTINELS must be unique enough that an accidental substring match in
// normal cassette content is implausible. We grep every cache file for
// these strings and the test fails on the first hit.
const COOKIE_SENTINEL = 'SENTINEL-COOKIE-LEAK-12345';
const AUTH_SENTINEL = 'SENTINEL-AUTH-LEAK-67890';
const AMZ_SENTINEL = 'SENTINEL-AMZ-LEAK-ABCDE';

async function withFreshState<T>(fn: () => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-cache-leak-'));
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

async function walkAndReadAll(dir: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkAndReadAll(p)));
    } else if (e.isFile()) {
      try {
        out.push({ path: p, text: await fsp.readFile(p, 'utf8') });
      } catch {
        // Best-effort — unreadable file is not a leak.
      }
    }
  }
  return out;
}

test('CR-03 / FLAG-06: Set-Cookie / Authorization / x-amz-* never reach the cache file', async () => {
  await withFreshState(async () => {
    const url = 'https://api.crossref.org/works/10.1038/header-leak-test';
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    const u = new URL(url);
    const pool = agent.get(u.origin);
    // Plant the sentinel-bearing headers alongside benign cache-relevant
    // headers. The benign headers MUST be preserved; the sentinels MUST be
    // dropped before atomicWriteFile.
    pool
      .intercept({ path: u.pathname, method: 'GET' })
      .reply(200, { ok: true }, {
        headers: {
          'content-type': 'application/json',
          'etag': '"abc123"',
          'cache-control': 'public, max-age=3600',
          'set-cookie': `session=${COOKIE_SENTINEL}; HttpOnly`,
          'authorization': `Bearer ${AUTH_SENTINEL}`,
          'x-amz-request-id': AMZ_SENTINEL,
        },
      });
    try {
      const r = await fetch(url, { source: 'crossref' });
      assert.equal(r.status, 200);
      // The response object IN MEMORY may still carry these headers (the
      // application code might need to inspect them). The CR-03 invariant
      // is about what reaches DISK.
      const cacheDir = pensmithHttpCacheDir();
      const files = await walkAndReadAll(cacheDir);
      assert.ok(files.length >= 1, `expected >=1 cache file after fetch, got ${files.length}`);

      for (const f of files) {
        for (const sentinel of [COOKIE_SENTINEL, AUTH_SENTINEL, AMZ_SENTINEL]) {
          assert.equal(
            f.text.includes(sentinel),
            false,
            `CR-03 leak: sentinel "${sentinel}" found in ${f.path}. ` +
              'writeCache must allowlist headers before serializing to disk.',
          );
        }
      }

      // Positive control: the allowlisted headers MUST survive so cache
      // replay semantics still work.
      const combined = files.map((f) => f.text).join('\n');
      assert.ok(
        combined.toLowerCase().includes('content-type'),
        'content-type must be preserved by the allowlist (cache replay needs it)',
      );
      assert.ok(
        combined.toLowerCase().includes('etag'),
        'etag must be preserved by the allowlist',
      );
    } finally {
      await agent.close();
    }
  });
});
