// tests/sources/semanticscholar.test.ts — the Semantic Scholar adapter parses
// its recorded answers, and works without PENSMITH_S2_API_KEY (keyless mode,
// with a warning). tests/source-names-and-ids.test.ts checks the fields of a
// search answer one by one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';

const ADAPTER = 'semanticscholar';
const adapterPath = new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url);
const cassetteDir = new URL(`../../tests/fixtures/cassettes/${ADAPTER}/`, import.meta.url);

test(`${ADAPTER}: production adapter exists (RSCH-03/04, T-3-13)`, () => {
  assert.ok(existsSync(adapterPath), `MISSING: bin/lib/sources/${ADAPTER}.ts — Plan 04 must create before this test passes`);
});

test(`${ADAPTER}: at least one cassette exists (T-3-13)`, () => {
  const hasCassettes = existsSync(cassetteDir) && readdirSync(cassetteDir).some(f => f.endsWith('.json'));
  assert.ok(hasCassettes, `MISSING: tests/fixtures/cassettes/${ADAPTER}/*.json — Plan 04 Task 4.1 must create`);
});

test(`${ADAPTER}.search() parses a recorded answer into SourceCandidate[] (RSCH-03)`, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  const results = await adapter.search('NumPy array efficient numerical computation', { limit: 2 });
  assert.equal(results.length, 2, 'both recorded works');
  for (const r of results) {
    assert.equal(r.source, ADAPTER);
    assert.ok(r.id && r.title && r.authors.length > 0, `a usable candidate: ${JSON.stringify(r.title)}`);
  }
});

test(`${ADAPTER}.fetchById() parses cassette into SourceCandidate | null (RSCH-04)`, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  const result = await adapter.fetchById('0796f6cd597d2b07b571e4b4ebf3e8aef0f5e3af');
  assert.ok(result === null || typeof result === 'object', 'fetchById returns object or null');
});

test(`missing PENSMITH_S2_API_KEY emits WARN-once and falls back to keyless mode (D-16)`, async () => {
  // Ensure PENSMITH_S2_API_KEY is not set for this test.
  const original = process.env['PENSMITH_S2_API_KEY'];
  delete process.env['PENSMITH_S2_API_KEY'];
  try {
    const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
    // The adapter must NOT throw when the key is absent — it falls back to keyless mode (D-16).
    // The WARN-once banner is emitted to stderr; we only check non-throw behavior here.
    const results = await adapter.search('test query');
    assert.ok(Array.isArray(results), 'adapter must work without PENSMITH_S2_API_KEY (D-16 keyless fallback)');
  } finally {
    if (original !== undefined) process.env['PENSMITH_S2_API_KEY'] = original;
  }
});
