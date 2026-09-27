/**
 * tests/http-mock.test.ts — DOCS-03 supply-chain fail-safe (T-16-DEP), updated for
 * Phase 17 (D-17-14).
 *
 * `bin/lib/http-mock.ts` ships in the production tree (it decides the network
 * mode for every request). A production install (npm install -g pensmith)
 * omits devDependencies, so the module must never load `nock` — neither at the
 * top level nor lazily. Phase 17 deleted the nock-based loadCassettes /
 * clearCassettes / recordCassettes / finalizeRecording code (and its
 * eslint-disable): offline replay is the exact-match fixture store read with
 * plain fs, and recording is the http.ts record hook driven by
 * scripts/refresh-cassettes.mjs. (This test previously asserted that nock was
 * imported lazily; that behaviour is superseded.)
 *
 * Path resolution via fileURLToPath(import.meta.url) — spaced-path safe.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HTTP_MOCK_PATH = join(__dirname, '..', 'bin', 'lib', 'http-mock.ts');
const httpMockSrc = readFileSync(HTTP_MOCK_PATH, 'utf8');

test('DOCS-03 / D-17-14: http-mock.ts never loads nock (no static or dynamic import) and has no eslint-disable', () => {
  assert.ok(!/from ['"]nock['"]/.test(httpMockSrc), 'no static nock import');
  assert.ok(!/import\(['"]nock['"]\)/.test(httpMockSrc), 'no dynamic nock import');
  assert.ok(!/eslint-disable/.test(httpMockSrc), 'the nock recorder eslint-disable is gone');
  for (const gone of ['loadCassettes(', 'clearCassettes(', 'recordCassettes(', 'finalizeRecording(']) {
    assert.ok(!httpMockSrc.includes(`export async function ${gone}`), `${gone} was deleted`);
  }
});

test('DOCS-03: the production-facing functions are callable without nock', async () => {
  const mod = (await import('../bin/lib/http-mock.js')) as {
    isOfflineMode: () => boolean;
    networkMode: () => { sourcesOffline: boolean };
    loadCassetteDir: (adapter: string) => unknown[] | null;
    loadCassetteFile: (adapter: string, basename: string) => unknown[] | null;
    lookupFixture: (method: string, url: string) => unknown;
  };
  assert.equal(typeof mod.isOfflineMode(), 'boolean');
  assert.equal(mod.networkMode().sourcesOffline, mod.isOfflineMode());
  const dir = mod.loadCassetteDir('crossref');
  assert.ok(Array.isArray(dir) && dir.length > 0, 'the recorded crossref cassettes load');
  assert.equal(mod.loadCassetteFile('crossref', '__nonexistent_test_sentinel__'), null);
  assert.equal(mod.loadCassetteDir('__no_such_adapter__'), null);
  assert.equal(mod.lookupFixture('GET', 'https://api.crossref.org/works/10.9999%2Fnope'), null, 'a miss is null, never another record');
});

test('D-17-06: loadCassetteFile finds a fixture in <adapter>/ or synthetic/<adapter>/', async () => {
  const mod = await import('../bin/lib/http-mock.js');
  assert.ok(mod.loadCassetteFile('crossref', 'works-nphys1170'), 'a recorded cassette');
  assert.ok(mod.loadCassetteFile('revise-swap', 'revise-swap-suggest'), 'a synthetic cassette (LLM fixture)');
});
