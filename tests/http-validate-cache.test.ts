// tests/http-validate-cache.test.ts — Phase 19 seam S-B (SRC-17): a response
// body that is not the service's answer never reaches the HTTP cache.
//
//   - a caller's `validate` that names a reason keeps a 200 out of the cache
//     (the response is still returned, so the adapter can report it);
//   - a 200 carrying an API error document (http-mock.ts recordedErrorBody —
//     e.g. `{"status":"failed"}` or an inner statusCode 403) is never cached,
//     with or without a validator;
//   - a valid 200 is cached as before.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import { fetch, _resetWarnedForTest, _resetBucketsForTest, type HttpResponse } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';

async function withLiveLane<T>(fn: (m: InstalledMockAgent) => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-validate-'));
  const saved = {
    lane: process.env['PENSMITH_NETWORK_TESTS'],
    lad: process.env['LOCALAPPDATA'],
    xdg: process.env['XDG_DATA_HOME'],
    home: process.env['HOME'],
  };
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  process.env['LOCALAPPDATA'] = tmpRoot;
  process.env['XDG_DATA_HOME'] = tmpRoot;
  process.env['HOME'] = tmpRoot;
  _resetWarnedForTest();
  _resetBucketsForTest();
  const m = installMockAgent();
  try {
    return await fn(m);
  } finally {
    await m.restore().catch(() => undefined);
    for (const [k, v] of [['PENSMITH_NETWORK_TESTS', saved.lane], ['LOCALAPPDATA', saved.lad], ['XDG_DATA_HOME', saved.xdg], ['HOME', saved.home]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function cacheFiles(): string[] {
  const dir = pensmithHttpCacheDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

const JSON_HEADERS = { 'content-type': 'application/json' };

test('seam S-B: a validate() reason keeps a 200 out of the cache but returns it', async () => {
  await withLiveLane(async ({ agent }) => {
    const pool = agent.get('https://api.crossref.org');
    pool.intercept({ path: '/works/10.5555%2Fbad-shape', method: 'GET' }).reply(200, { status: 'ok', message: 'not a work' }, { headers: JSON_HEADERS });
    const seen: HttpResponse[] = [];
    const res = await fetch('https://api.crossref.org/works/10.5555%2Fbad-shape', {
      source: 'crossref',
      validate: (r) => {
        seen.push(r);
        return 'message is not a work record';
      },
    });
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1, 'validate saw the live response');
    assert.deepEqual(cacheFiles(), [], 'nothing was cached');
  });
});

test('seam S-B: an error document served with HTTP 200 is never cached', async () => {
  await withLiveLane(async ({ agent }) => {
    const pool = agent.get('https://api.crossref.org');
    pool
      .intercept({ path: '/works?filter=updates%3A10.5555%2Fx', method: 'GET' })
      .reply(200, { statusCode: '403', 'message-type': 'not-polite', body: 'no mailto' }, { headers: JSON_HEADERS });
    const res = await fetch('https://api.crossref.org/works?filter=updates%3A10.5555%2Fx', { source: 'retraction-watch' });
    assert.equal(res.status, 200);
    assert.deepEqual(cacheFiles(), []);
  });
});

test('seam S-B: a valid 200 is still cached', async () => {
  await withLiveLane(async ({ agent }) => {
    const pool = agent.get('https://api.crossref.org');
    pool
      .intercept({ path: '/works/10.5555%2Fgood', method: 'GET' })
      .reply(200, { status: 'ok', 'message-type': 'work', message: { DOI: '10.5555/good' } }, { headers: JSON_HEADERS });
    await fetch('https://api.crossref.org/works/10.5555%2Fgood', { source: 'crossref', validate: () => null });
    assert.equal(cacheFiles().length, 1);
  });
});
