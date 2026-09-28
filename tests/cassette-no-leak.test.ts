// tests/cassette-no-leak.test.ts — Plan 04 Wave 3 sentinel (CYCLE-3 substantive LOW).
//
// Asserts that NO committed cassette under tests/fixtures/cassettes/**/*.json
// contains any header from SENSITIVE_HEADERS (case-insensitive) in either
// `responseHeaders` OR `requestHeaders`/`reqheaders` keys.
//
// Single source of truth: SENSITIVE_HEADERS is imported from
// bin/lib/http-mock.ts. The recorder uses the same set when scrubbing
// during finalizeRecording(); this test is the second-line defense that
// catches a leak even if the recorder were misconfigured.
//
// Threat model: T-3-02 / T-01-07 — never persist Authorization,
// x-api-key, Cookie, Set-Cookie, x-amz-security-token, x-csrf-token,
// or proxy-authorization in a checked-in cassette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENSITIVE_HEADERS } from '../bin/lib/http-mock.js';

const CASSETTE_ROOT = fileURLToPath(
  new URL('../tests/fixtures/cassettes', import.meta.url),
);

function walkDir(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

function scanHeaderMap(
  obj: unknown,
  filePath: string,
  bucketName: string,
): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    assert.ok(
      !SENSITIVE_HEADERS.has(key.toLowerCase()),
      `Cassette ${filePath} ${bucketName}.${key} is on the SENSITIVE_HEADERS deny-list — recorder leak (T-3-02 / T-01-07)`,
    );
  }
}

test('cassette-no-leak: no committed cassette carries SENSITIVE_HEADERS (T-3-02 / T-01-07)', () => {
  if (!existsSync(CASSETTE_ROOT) || !statSync(CASSETTE_ROOT).isDirectory()) {
    // Vacuous pass if no cassettes dir — cassette-size.test.ts owns the
    // existence assertion. Once Plan 04 lands, this branch is unreachable.
    return;
  }
  const cassettes = walkDir(CASSETTE_ROOT);
  for (const file of cassettes) {
    const raw = readFileSync(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      assert.fail(
        `Cassette ${file} did not parse as JSON: ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      assert.fail(
        `Cassette ${file} is not a JSON array (got ${typeof parsed})`,
      );
    }
    for (const entry of parsed as Array<Record<string, unknown>>) {
      scanHeaderMap(entry['responseHeaders'], file, 'responseHeaders');
      scanHeaderMap(entry['requestHeaders'], file, 'requestHeaders');
      scanHeaderMap(entry['reqheaders'], file, 'reqheaders');
    }
  }
});

// SRC-06 (D-19-10): a key sent as a query parameter (OpenAlex `api_key`,
// Google Books `key`, a `token`) is never committed in a recorded path or in a
// recorded redirect Location.
const SECRET_QUERY_PARAMS = ['api_key', 'apikey', 'key', 'token', 'access_token'];

function secretParamsIn(url: string): string[] {
  const u = new URL(url);
  return [...u.searchParams.keys()].filter((k) => SECRET_QUERY_PARAMS.includes(k.toLowerCase()));
}

test('cassette-no-leak: no committed cassette path or Location carries a secret query parameter (api_key, key, token …)', () => {
  if (!existsSync(CASSETTE_ROOT) || !statSync(CASSETTE_ROOT).isDirectory()) return;
  for (const file of walkDir(CASSETTE_ROOT)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;
    for (const entry of parsed) {
      if (typeof entry['scope'] !== 'string' || typeof entry['path'] !== 'string') continue;
      const url = `${entry['scope']}${entry['path']}`;
      assert.deepEqual(secretParamsIn(url), [], `Cassette ${file}: ${url} carries a secret query parameter`);
      const headers = entry['responseHeaders'] as Record<string, string> | undefined;
      const location = headers?.['location'];
      if (typeof location === 'string') {
        assert.deepEqual(secretParamsIn(new URL(location, url).href), [], `Cassette ${file}: Location ${location} carries a secret query parameter`);
      }
    }
  }
});

test('cassette-no-leak: the path scan catches a key in a path (self-check)', () => {
  assert.deepEqual(secretParamsIn('https://api.openalex.org/works?search=x&api_key=abc'), ['api_key']);
  assert.deepEqual(secretParamsIn('https://www.googleapis.com/books/v1/volumes?q=isbn:1&key=abc'), ['key']);
  assert.deepEqual(secretParamsIn('https://api.crossref.org/works?query=x'), []);
});
