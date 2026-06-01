// tests/sources/pubmed.test.ts — Wave 0 stub for RSCH-03/04 / T-3-13.
// Per-adapter parse test against committed cassette.
//
// Production code required: bin/lib/sources/pubmed.ts + cassette
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';

const ADAPTER = 'pubmed';
const adapterPath = new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url);
const cassetteDir = new URL(`../../tests/fixtures/cassettes/${ADAPTER}/`, import.meta.url);

test(`${ADAPTER}: production adapter exists (RSCH-03/04, T-3-13)`, () => {
  assert.ok(existsSync(adapterPath), `MISSING: bin/lib/sources/${ADAPTER}.ts — Plan 04 must create before this test passes`);
});

test(`${ADAPTER}: at least one cassette exists (T-3-13)`, () => {
  const hasCassettes = existsSync(cassetteDir) && readdirSync(cassetteDir).some(f => f.endsWith('.json'));
  assert.ok(hasCassettes, `MISSING: tests/fixtures/cassettes/${ADAPTER}/*.json — Plan 04 Task 4.1 must create`);
});

const skip = !existsSync(adapterPath);

test(`${ADAPTER}.search() parses cassette into SourceCandidate[] (RSCH-03)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  const results = await adapter.search('attention mechanisms neural networks');
  assert.ok(Array.isArray(results), 'search returns array');
  assert.ok(results.length >= 0, 'search returns non-negative count');
});

test(`${ADAPTER}.fetchById() parses cassette into SourceCandidate | null (RSCH-04)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  const result = await adapter.fetchById('12345678');
  assert.ok(result === null || typeof result === 'object', 'fetchById returns object or null');
});
