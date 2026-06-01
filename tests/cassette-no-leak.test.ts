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
