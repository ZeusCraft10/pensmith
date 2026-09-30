// tests/http-cache-keys.test.ts — SRC-06 transport half (D-19-10): secrets
// never shape the HTTP cache.
//
//   - a keyed (`api_key=…`) and a keyless OpenAlex request share ONE cache
//     entry (the second is a cache hit);
//   - the same holds for x-api-key (Semantic Scholar) and Zotero-API-Key
//     header keys, and for the contact parameters;
//   - no file in the cache dir — name or content — contains the key;
//   - SESSION.log shows the key parameter as REDACTED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import { fetch as httpFetch, _resetHostStateForTest, _resetHttpLoggersForTest } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { closeSessionLog } from '../bin/lib/session-log.js';

const KEY = 'oa-KEY-SENTINEL-8c1f2e7d93';

async function lane<T>(fn: (m: InstalledMockAgent, cwd: string) => Promise<T>): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-cachekeys-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-cachekeys-paper-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
    PENSMITH_CONTACT_EMAIL: 'pensmith-dev@example.org',
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  const savedCwd = process.cwd();
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.chdir(cwd);
  _resetHostStateForTest();
  _resetHttpLoggersForTest();
  const m = installMockAgent();
  try {
    return await fn(m, cwd);
  } finally {
    await m.restore().catch(() => undefined);
    await closeSessionLog();
    _resetHttpLoggersForTest();
    process.chdir(savedCwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(data, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

function cacheFiles(): string[] {
  const dir = pensmithHttpCacheDir();
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

const WORKS = { results: [{ id: 'https://openalex.org/W1', title: 'x' }] };

test('SRC-06: a keyed and a keyless OpenAlex request share one cache entry; no cache file contains the key', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.openalex.org').intercept({ path: /^\/works\?/, method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 200, data: JSON.stringify(WORKS), responseOptions: { headers: { 'content-type': 'application/json' } } };
    }).persist();
    const keyed = await httpFetch(`https://api.openalex.org/works?search=attention&api_key=${KEY}&mailto=pensmith-dev%40example.org`, { source: 'openalex' });
    assert.equal(keyed.cached, false);
    const keyless = await httpFetch('https://api.openalex.org/works?search=attention', { source: 'openalex' });
    assert.equal(keyless.cached, true, 'the keyless request is answered by the keyed request\'s entry');
    assert.equal(requests, 1);
    const files = cacheFiles();
    assert.equal(files.length, 1, 'one cache entry');
    for (const f of files) {
      assert.ok(!f.includes(KEY));
      const text = readFileSync(join(pensmithHttpCacheDir(), f), 'utf8');
      assert.ok(!text.includes(KEY), `the cache file ${f} never contains the key`);
      assert.ok(!text.includes('pensmith-dev@example.org') && !text.includes('pensmith-dev%40example.org'), 'nor the contact email');
    }
  });
});

test('SRC-06: header keys (x-api-key, Zotero-API-Key, Authorization) never shape the cache key or reach the cache', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.semanticscholar.org').intercept({ path: /^\/graph/, method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 200, data: '{"data":[]}', responseOptions: { headers: { 'content-type': 'application/json' } } };
    }).persist();
    const url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=attention';
    await httpFetch(url, { source: 'semanticscholar', headers: { 'x-api-key': KEY } });
    const second = await httpFetch(url, { source: 'semanticscholar' });
    const third = await httpFetch(url, { source: 'semanticscholar', headers: { 'Zotero-API-Key': KEY, authorization: `Bearer ${KEY}` } });
    assert.equal(second.cached, true);
    assert.equal(third.cached, true);
    assert.equal(requests, 1);
    for (const f of cacheFiles()) assert.ok(!readFileSync(join(pensmithHttpCacheDir(), f), 'utf8').includes(KEY));
  });
});

test('SRC-06: an ordinary header still separates entries (Accept), so only secrets are dropped', async () => {
  await lane(async (m) => {
    let requests = 0;
    m.agent.get('https://api.crossref.org').intercept({ path: /^\/works\//, method: 'GET' }).reply(() => {
      requests += 1;
      return { statusCode: 200, data: '{"status":"ok","message-type":"work","message":{}}', responseOptions: { headers: { 'content-type': 'application/json' } } };
    }).persist();
    await httpFetch('https://api.crossref.org/works/10.1%2Fx', { source: 'crossref' });
    await httpFetch('https://api.crossref.org/works/10.1%2Fx', { source: 'crossref', headers: { accept: 'application/vnd.citationstyles.csl+json' } });
    assert.equal(requests, 2);
    assert.equal(cacheFiles().length, 2);
  });
});

test('SRC-06: SESSION.log shows the key parameter as REDACTED and never the value', async () => {
  await lane(async (m, cwd) => {
    m.agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(200, JSON.stringify(WORKS), { headers: { 'content-type': 'application/json' } });
    await httpFetch(`https://api.openalex.org/works?search=q&api_key=${KEY}`, { source: 'openalex', noCache: true });
    await closeSessionLog();
    const log = readFileSync(join(cwd, '.paper', 'SESSION.log'), 'utf8');
    assert.ok(log.includes('api_key=REDACTED'), log);
    assert.ok(!log.includes(KEY));
  });
});
