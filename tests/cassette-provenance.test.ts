// tests/cassette-provenance.test.ts — CI-07 / D-17-14: cassettes are real
// recordings from a working recorder, and synthetic fixtures are confined.
//
//   - Every cassette OUTSIDE tests/fixtures/cassettes/synthetic/ is a real
//     recording: every entry carries the provenance scripts/refresh-cassettes.mjs
//     writes ({ recordedAt, recorder, adapter }), with adapter = its directory
//     (`<adapter>/`, or `e2e/<adapter>/` for the recorded e2e corpus, D-18-31).
//   - Synthetic identifiers (10.0000/…, 10.1234/example) appear only under
//     synthetic/ (the packaged RUN-27 dry-run corpus is not a cassette).
//   - The exact-match store is unambiguous: no two committed entries share a
//     canonical key, and every recorded entry replays through lookupFixture.
//   - Recordings are https-only (arXiv included) and never commit a contact
//     email or key in a path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listCassetteFiles,
  cassetteKey,
  lookupFixture,
  recordedErrorBody,
  SCRUBBED_QUERY_PARAMS,
  E2E_CASSETTES_DIR,
  type Cassette,
} from '../bin/lib/http-mock.js';

const ROOT = fileURLToPath(new URL('./fixtures/cassettes/', import.meta.url));
const RECORDER = 'scripts/refresh-cassettes.mjs';

function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

const files = listCassetteFiles();
const recorded = files.filter((f) => !rel(f).startsWith('synthetic/'));

/**
 * The adapter a recorded cassette belongs to: its directory — `<adapter>/…`,
 * or `e2e/<adapter>/…` for the recorded end-to-end corpus (D-18-31).
 */
function adapterOf(file: string): string {
  const parts = rel(file).split('/');
  return (parts[0] === E2E_CASSETTES_DIR ? parts[1] : parts[0]) ?? '';
}

/**
 * Search adapters whose real recording is still OPEN (CI-07), each with why.
 * Listed here instead of being silently left out of the required set: the
 * moment a recording lands, the test below fails until the adapter moves from
 * this list into the required one.
 */
const OPEN_RECORDINGS: Readonly<Record<string, string>> = Object.freeze({});

test('CI-07: the store has real recordings (recorded cassettes exist outside synthetic/)', () => {
  assert.ok(files.length > 0, 'cassettes exist');
  assert.ok(recorded.length >= 8, `real recordings for the source adapters, got ${recorded.map(rel).join(', ')}`);
  for (const adapter of ['crossref', 'openalex', 'arxiv', 'pubmed', 'unpaywall', 'retraction-watch', 'semanticscholar', 'books']) {
    assert.ok(recorded.some((f) => rel(f).startsWith(`${adapter}/`)), `a recorded ${adapter} cassette`);
  }
});

test('CI-07: an adapter with no real recording yet is an explicit open item, never a silent exclusion', () => {
  for (const [adapter, why] of Object.entries(OPEN_RECORDINGS)) {
    assert.ok(why.length > 0);
    assert.ok(
      !recorded.some((f) => rel(f).startsWith(`${adapter}/`)),
      `${adapter} now has a real recording: remove it from OPEN_RECORDINGS and add it to the required list above`,
    );
    assert.ok(files.some((f) => rel(f).startsWith(`synthetic/${adapter}/`)), `${adapter}: its interim fixture is confined to synthetic/`);
  }
});

test('CI-07: every entry outside synthetic/ carries recorder provenance for its own adapter', () => {
  for (const file of recorded) {
    const adapter = adapterOf(file);
    const entries = JSON.parse(readFileSync(file, 'utf8')) as Cassette[];
    assert.ok(Array.isArray(entries) && entries.length > 0, `${rel(file)} is a non-empty Cassette[]`);
    for (const e of entries) {
      const p = e.provenance;
      assert.ok(p, `${rel(file)}: every recorded entry has provenance`);
      assert.equal(p.recorder, RECORDER, `${rel(file)}: recorded by ${RECORDER}`);
      assert.equal(p.adapter, adapter, `${rel(file)}: provenance.adapter matches the directory`);
      assert.ok(!Number.isNaN(Date.parse(p.recordedAt)) && /^\d{4}-\d{2}-\d{2}T/.test(p.recordedAt), `${rel(file)}: ISO recordedAt`);
    }
  }
});

test('CI-07: no recording is an API error document (an error inside an HTTP 200 is not a recording)', () => {
  for (const file of recorded) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Cassette[]) {
      const why = recordedErrorBody(e.status, e.response);
      assert.equal(why, null, `${rel(file)}: ${e.scope}${e.path} recorded an error body (${why}) — fix the adapter's request and re-record`);
    }
  }
});

test('CI-07: recordedErrorBody recognizes the error documents public APIs send inside a 200', () => {
  assert.match(recordedErrorBody(200, { statusCode: '403', 'message-type': 'not-polite', body: 'x' }) ?? '', /statusCode 403/);
  assert.match(recordedErrorBody(200, { status: 'failed', 'message-type': 'validation-failure' }) ?? '', /validation-failure|failed/);
  assert.match(recordedErrorBody(200, '{"error":"Invalid query"}') ?? '', /error/);
  assert.equal(recordedErrorBody(200, { status: 'ok', 'message-type': 'work-list', message: { items: [] } }), null);
  assert.equal(recordedErrorBody(200, '<?xml version="1.0"?><feed/>'), null);
  assert.equal(recordedErrorBody(404, 'Resource not found.'), null, 'a deliberate non-200 recording is judged by its status');
});

test('CI-07: synthetic identifiers (10.0000/…, 10.1234/example) appear only under synthetic/', () => {
  for (const file of recorded) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/10\.0000[/%]/.test(text), `${rel(file)} must not carry a 10.0000/ identifier`);
    assert.ok(!/10\.1234[/%]2?F?example/i.test(text), `${rel(file)} must not carry a 10.1234/example identifier`);
  }
});

/**
 * D-19-07: the one http:// entry a recording may hold is a redirect hop that
 * upgrades to https (e.g. http://www.w3.org/…/dummy.pdf → 301 https://…) — the
 * recorded first hop of a URL a user or a source gave as http.
 */
function isRecordedUpgradeHop(e: Cassette): boolean {
  const location = e.responseHeaders?.['location'];
  return e.status >= 300 && e.status < 400 && typeof location === 'string' && /^https:\/\//.test(new URL(location, `${e.scope}${e.path}`).href);
}

test('CI-07: recordings are https-only (bar an http→https redirect hop) and commit no contact email or key in a path', () => {
  for (const file of recorded) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Cassette[]) {
      if (!isRecordedUpgradeHop(e)) {
        assert.match(e.scope, /^https:\/\//, `${rel(file)}: ${e.scope} is https (arXiv over http is gone)`);
      }
      const q = new URL(`${e.scope}${e.path}`).searchParams;
      for (const k of q.keys()) {
        assert.ok(!SCRUBBED_QUERY_PARAMS.has(k.toLowerCase()), `${rel(file)}: scrubbed param "${k}" must not be committed`);
      }
    }
  }
});

test('D-19-07: every base64 body decodes, every redirect hop has a Location, and a recorded chain resolves inside the store', () => {
  for (const file of files) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Cassette[]) {
      if (e.bodyEncoding !== undefined) {
        assert.equal(e.bodyEncoding, 'base64', `${rel(file)}: the only body encoding is base64`);
        assert.ok(typeof e.response === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(e.response), `${rel(file)}: ${e.scope}${e.path} is valid base64`);
      }
      if ([301, 302, 303, 307, 308].includes(e.status) && !rel(file).startsWith('synthetic/net/')) {
        const location = e.responseHeaders?.['location'];
        assert.ok(typeof location === 'string' && location.length > 0, `${rel(file)}: redirect ${e.scope}${e.path} records its location`);
        const next = new URL(location, `${e.scope}${e.path}`).href;
        assert.ok(lookupFixture('GET', next), `${rel(file)}: the recorded hop ${next} is in the store too`);
      }
    }
  }
});

test('D-17-06: no two committed entries share a canonical key (the exact-match store is unambiguous)', () => {
  const seen = new Map<string, string>();
  for (const file of files) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Cassette[]) {
      if (typeof e?.scope !== 'string' || typeof e?.path !== 'string') continue;
      const method = String(e.method).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && typeof e.bodySha256 !== 'string') continue; // never replayed
      const key = cassetteKey(e);
      const prior = seen.get(key);
      assert.equal(prior, undefined, `duplicate fixture key ${key} in ${rel(file)} and ${prior}`);
      seen.set(key, rel(file));
    }
  }
  assert.ok(seen.size > 0);
});

test('D-17-06: every recorded entry replays through lookupFixture with its own status and body', () => {
  for (const file of recorded) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as Cassette[]) {
      const hit = lookupFixture(e.method, `${e.scope}${e.path}`);
      assert.ok(hit, `${rel(file)}: ${e.method} ${e.scope}${e.path} replays`);
      assert.equal(hit.status, e.status);
      assert.equal(rel(hit.file), rel(file), 'answered by its own file');
      if (e.bodyEncoding === 'base64') {
        // D-19-07: a binary recording replays its exact bytes.
        assert.equal(typeof e.response, 'string', `${rel(file)}: a base64 body is a string`);
        assert.ok(hit.bodyBytes.equals(Buffer.from(e.response as string, 'base64')), `${rel(file)}: base64 body replays byte-exact`);
      } else {
        const expected = typeof e.response === 'string' ? e.response : JSON.stringify(e.response);
        assert.equal(hit.body, expected);
      }
    }
  }
});
