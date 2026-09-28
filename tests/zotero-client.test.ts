// tests/zotero-client.test.ts — the Tier 2 Zotero client (SRC-16, D-19-24)
// against MockAgent, through the real http.ts egress gate.
//
//   - Web API: the user id comes from GET /keys/current; the key rides ONLY in
//     the Zotero-API-Key header (never a URL, never the cache, never the log);
//   - `[sources] zotero_collection` restricts a pull to that collection (found
//     by name), paginated with Total-Results;
//   - ZOTERO_GROUP_ID reads a group library (no key needed for a public one);
//   - PENSMITH_ZOTERO_LOCAL=1 reads the Zotero 7 local API at
//     http://127.0.0.1:23119 (and wins over a key — nothing leaves the machine);
//   - not configured → [] with no request; failures are one-line reasons;
//     offline → OfflineEgressError.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import { _resetHostStateForTest, _resetHttpLoggersForTest, isOfflineEgressError, ZOTERO_LOCAL_ORIGIN } from '../bin/lib/http.js';
import * as zotero from '../bin/lib/sources/zotero.js';
import { sources } from '../bin/lib/sources/index.js';
import { SourceLookupError } from '../bin/lib/sources/lookup.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
import { closeSessionLog } from '../bin/lib/session-log.js';
import { CURRENT_CONFIG_VERSION } from '../bin/lib/config.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

const KEY = 'zk-SENTINEL-4f1c9a7e2b';
const JSON_H = { 'content-type': 'application/json' };

function item(key: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    version: 3,
    library: { type: 'user', id: 12345 },
    data: { key, itemType: 'journalArticle', title, creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }], date: '2019', ...extra },
  };
}

interface Seen {
  path: string;
  headers: Record<string, string>;
}

async function lane<T>(env: Record<string, string | undefined>, config: string | null, fn: (m: InstalledMockAgent, seen: Seen[], cwd: string) => Promise<T>): Promise<T> {
  const data = mkdtempSync(join(tmpdir(), 'pensmith-zotero-data-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-zotero-paper-'));
  mkdirSync(join(cwd, '.paper'), { recursive: true });
  if (config !== null) await atomicWriteFile(join(cwd, '.paper', 'config.toml'), `schema_version = ${CURRENT_CONFIG_VERSION}\n${config}`);
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    LOCALAPPDATA: data,
    XDG_DATA_HOME: data,
    HOME: data,
    ZOTERO_API_KEY: undefined,
    ZOTERO_GROUP_ID: undefined,
    PENSMITH_ZOTERO_LOCAL: undefined,
    ...env,
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
  const seen: Seen[] = [];
  try {
    return await fn(m, seen, cwd);
  } finally {
    await m.restore().catch(() => undefined);
    await closeSessionLog();
    _resetHttpLoggersForTest();
    process.chdir(savedCwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(cwd, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}

/** Intercept `origin` + an exact path, recording the request; reply with JSON. */
function on(m: InstalledMockAgent, seen: Seen[], origin: string, path: string, status: number, body: unknown, headers: Record<string, string> = {}): void {
  m.agent.get(origin).intercept({ path, method: 'GET' }).reply((opts) => {
    seen.push({ path: opts.path, headers: Object.fromEntries(Object.entries(opts.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
    return { statusCode: status, data: typeof body === 'string' ? body : JSON.stringify(body), responseOptions: { headers: { ...JSON_H, ...headers } } };
  });
}

const KEYS_CURRENT = { key: KEY, userID: 12345, username: 'ada', access: { user: { library: true, files: true } } };

test('SRC-16: the registry key is `zotero` and it is the Web / local API client', () => {
  assert.equal(sources.zotero, zotero);
  assert.equal(typeof sources.zotero.search, 'function');
  assert.equal(typeof sources.zotero.lookupById, 'function');
});

test('SRC-16: not configured → search() returns [] and sends nothing', async () => {
  await lane({}, null, async (m) => {
    assert.equal(zotero.isZoteroConfigured(), false);
    assert.deepEqual(await zotero.search('attention'), []);
    assert.deepEqual(m.agent.pendingInterceptors(), []);
  });
});

test('SRC-16: Web API search — /keys/current gives the user id; the key rides only in the Zotero-API-Key header', async () => {
  await lane({ ZOTERO_API_KEY: KEY }, null, async (m, seen, cwd) => {
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    on(m, seen, 'https://api.zotero.org', '/users/12345/items/top?q=attention&qmode=titleCreatorYear&format=json&limit=10&start=0', 200, [
      item('ABCD2345', 'Attention in machines', { DOI: '10.1000/att' }),
      item('ABCD2346', 'Attention in humans'),
    ], { 'total-results': '2' });
    const failures: string[] = [];
    const hits = await zotero.search('attention', { onFailure: (r) => failures.push(r) });
    assert.deepEqual(failures, []);
    assert.deepEqual(hits.map((h) => [h.source, h.title, h.zotero?.library, h.zotero?.key]), [
      ['zotero', 'Attention in machines', 'users/12345', 'ABCD2345'],
      ['zotero', 'Attention in humans', 'users/12345', 'ABCD2346'],
    ]);
    assert.equal(hits[0]?.doi, '10.1000/att');
    for (const s of seen) {
      assert.equal(s.headers['zotero-api-key'], KEY, 'the key header is sent to api.zotero.org');
      assert.equal(s.headers['zotero-api-version'], '3');
      assert.ok(!s.path.includes(KEY), 'never in a URL');
    }
    // noCache: nothing on disk; SESSION.log has no key.
    const cacheDir = pensmithHttpCacheDir();
    assert.deepEqual(existsSync(cacheDir) ? readdirSync(cacheDir) : [], []);
    await closeSessionLog();
    const log = readFileSync(join(cwd, '.paper', 'SESSION.log'), 'utf8');
    assert.ok(!log.includes(KEY) && !log.includes('Zotero-API-Key'));
  });
});

test('SRC-16: `[sources] zotero_collection = "Thesis"` pulls only that collection (found by name, paginated)', async () => {
  await lane({ ZOTERO_API_KEY: KEY }, '[sources]\nzotero_collection = "Thesis"\n', async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    on(m, seen, 'https://api.zotero.org', '/users/12345/collections?format=json&limit=100&start=0', 200, [
      { key: 'OTHER001', data: { key: 'OTHER001', name: 'Reading list' } },
      { key: 'THESIS01', data: { key: 'THESIS01', name: 'Thesis' } },
    ]);
    const page1 = Array.from({ length: 100 }, (_, i) => item(`TH${String(i).padStart(6, '0')}`, `Thesis source ${i}`));
    const page2 = [item('THZZZZZ1', 'Thesis source 100'), { key: 'NOTE0001', data: { key: 'NOTE0001', itemType: 'note' } }];
    on(m, seen, 'https://api.zotero.org', '/users/12345/collections/THESIS01/items/top?format=json&limit=100&start=0', 200, page1, { 'total-results': '102' });
    on(m, seen, 'https://api.zotero.org', '/users/12345/collections/THESIS01/items/top?format=json&limit=100&start=100', 200, page2, { 'total-results': '102' });
    const pull = await zotero.pullZoteroItems();
    assert.equal(pull.collection, 'Thesis');
    assert.equal(pull.library, 'users/12345');
    assert.equal(pull.items.length, 102);
    assert.deepEqual(pull.invalid, []);
    assert.ok(!seen.some((s) => s.path.includes('OTHER001')), 'the other collection is never read');
    assert.deepEqual(m.agent.pendingInterceptors(), []);
  });
});

test('SRC-16: a missing collection is a one-line failure naming the collections that exist', async () => {
  await lane({ ZOTERO_API_KEY: KEY }, '[sources]\nzotero_collection = "Thesis"\n', async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    on(m, seen, 'https://api.zotero.org', '/users/12345/collections?format=json&limit=100&start=0', 200, [{ key: 'OTHER001', data: { name: 'Reading list' } }]);
    const failures: string[] = [];
    assert.deepEqual(await zotero.search('x', { onFailure: (r) => failures.push(r) }), []);
    assert.deepEqual(failures, ['Zotero collection "Thesis" not found in users/12345 (collections: Reading list)']);
  });
});

test('SRC-16: a rejected key is reported with where to fix it', async () => {
  await lane({ ZOTERO_API_KEY: 'bogus-key-000' }, null, async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/keys/current', 403, 'Invalid key', { 'content-type': 'text/html' });
    const failures: string[] = [];
    assert.deepEqual(await zotero.search('x', { onFailure: (r) => failures.push(r) }), []);
    assert.deepEqual(failures, ['Zotero rejected ZOTERO_API_KEY (HTTP 403) — check the key at https://www.zotero.org/settings/keys']);
    on(m, seen, 'https://api.zotero.org', '/keys/current', 403, 'Invalid key', { 'content-type': 'text/html' });
    assert.deepEqual(await zotero.checkZoteroKey(), { status: 'rejected', httpStatus: 403 });
  });
});

test('SRC-16: ZOTERO_GROUP_ID reads a (public) group library without a key and without /keys/current', async () => {
  await lane({ ZOTERO_GROUP_ID: '100' }, null, async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/groups/100/items/top?format=json&limit=100&start=0', 200, [{ ...item('XMT4Q4FT', 'The art of doing (geographies of) music'), library: { type: 'group', id: 100 } }]);
    const pull = await zotero.pullZoteroItems();
    assert.equal(pull.library, 'groups/100');
    assert.equal(pull.items.length, 1);
    assert.equal(seen[0]?.headers['zotero-api-key'], undefined, 'no key is sent');
    const invalid = await lane({ ZOTERO_GROUP_ID: 'my-group' }, null, async () => zotero.pullZoteroItems().then(() => 'no', (e: Error) => e.message));
    assert.match(invalid, /ZOTERO_GROUP_ID must be a group's number/);
  });
});

test('SRC-16: PENSMITH_ZOTERO_LOCAL=1 reads the Zotero 7 local API at http://127.0.0.1:23119 — and wins over a key (no key is sent)', async () => {
  await lane({ PENSMITH_ZOTERO_LOCAL: '1', ZOTERO_API_KEY: KEY }, null, async (m, seen) => {
    on(m, seen, ZOTERO_LOCAL_ORIGIN, '/api/users/0/items/top?q=music&qmode=titleCreatorYear&format=json&limit=5&start=0', 200, [{ ...item('LOCAL001', 'Music and space'), library: { type: 'user', id: 0 } }]);
    const hits = await zotero.search('music', { limit: 5 });
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]?.zotero, { library: 'local', key: 'LOCAL001' });
    assert.equal(seen[0]?.headers['zotero-api-key'], undefined, 'the local API never gets the Web API key');
  });
});

test('SRC-16: the local API not running → a one-line reason saying how to enable it', async () => {
  await lane({ PENSMITH_ZOTERO_LOCAL: '1' }, null, async (m) => {
    m.agent.get(ZOTERO_LOCAL_ORIGIN).intercept({ path: /.*/, method: 'GET' }).replyWithError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:23119'), { code: 'ECONNREFUSED' }));
    const failures: string[] = [];
    assert.deepEqual(await zotero.search('x', { onFailure: (r) => failures.push(r) }), []);
    assert.match(failures[0] ?? '', /the Zotero local API is not reachable at http:\/\/127\.0\.0\.1:23119 — is Zotero 7 running/);
  });
});

test('SRC-16: lookupById is three-way — found, not-found (404), failed (reason)', async () => {
  await lane({ ZOTERO_API_KEY: KEY }, null, async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    on(m, seen, 'https://api.zotero.org', '/users/12345/items/ABCD2345?format=json', 200, item('ABCD2345', 'Found it'));
    const found = await zotero.lookupById('ABCD2345');
    assert.equal(found.kind, 'found');
    assert.equal(found.kind === 'found' ? found.candidate.title : '', 'Found it');
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    on(m, seen, 'https://api.zotero.org', '/users/12345/items/ZZZZ2345?format=json', 404, 'Not found', { 'content-type': 'text/plain' });
    assert.deepEqual(await zotero.lookupById('zotero:users/12345/ZZZZ2345'), { kind: 'not-found', reason: 'HTTP 404' });
    assert.deepEqual(await zotero.lookupById('not-a-key'), { kind: 'not-found', reason: '"not-a-key" is not a Zotero item key' });
    // A failing Zotero is a FAILED lookup (never "not found"): three 500s open
    // the api.zotero.org breaker, and fetchById throws SourceLookupError.
    on(m, seen, 'https://api.zotero.org', '/keys/current', 200, KEYS_CURRENT);
    for (let i = 0; i < 3; i += 1) on(m, seen, 'https://api.zotero.org', '/users/12345/items/QQQQ2345?format=json', 500, 'down', { 'content-type': 'text/plain' });
    const quiet = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    let failed;
    try {
      failed = await zotero.lookupById('QQQQ2345');
    } finally {
      process.stderr.write = quiet;
    }
    assert.deepEqual(failed, { kind: 'failed', reason: 'skipped after 3 consecutive HTTP 500 responses' });
    await assert.rejects(() => zotero.fetchById('QQQQ2345'), (e: unknown) => e instanceof SourceLookupError && /^zotero lookup of QQQQ2345 failed: /.test(e.message));
  });
});

test('SRC-16: a configured Zotero with sources offline and no fixture throws the typed offline refusal', async () => {
  await lane({ ZOTERO_API_KEY: KEY, PENSMITH_NETWORK_TESTS: undefined }, null, async () => {
    await assert.rejects(() => zotero.search('x'), (e: unknown) => isOfflineEgressError(e));
  });
});

test('SRC-16: rows the service returns that are not Zotero items are reported, never ingested', async () => {
  await lane({ ZOTERO_GROUP_ID: '42' }, null, async (m, seen) => {
    on(m, seen, 'https://api.zotero.org', '/groups/42/items/top?format=json&limit=100&start=0', 200, [item('GOOD0001', 'Good'), { key: 'bad', data: { itemType: 'book' } }]);
    const pull = await zotero.pullZoteroItems();
    assert.equal(pull.items.length, 1);
    assert.equal(pull.invalid.length, 1);
    assert.match(pull.invalid[0]!, /^items\[1\]\.key: a Zotero item key is 8 characters/);
  });
});
