// tests/sources/retraction-watch.test.ts — Wave 0 stub for T-3-13.
// D-15: Retraction Watch is a side-channel filter — exposes fetchById ONLY, no search().
//
// Production code required: bin/lib/sources/retraction-watch.ts + cassette
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';

const ADAPTER = 'retraction-watch';
const adapterPath = new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url);
const cassetteDir = new URL(`../../tests/fixtures/cassettes/${ADAPTER}/`, import.meta.url);

test(`${ADAPTER}: production adapter exists (T-3-13)`, () => {
  assert.ok(existsSync(adapterPath), `MISSING: bin/lib/sources/${ADAPTER}.ts — Plan 04 must create before this test passes`);
});

test(`${ADAPTER}: at least one cassette exists (T-3-13)`, () => {
  const hasCassettes = existsSync(cassetteDir) && readdirSync(cassetteDir).some(f => f.endsWith('.json'));
  assert.ok(hasCassettes, `MISSING: tests/fixtures/cassettes/${ADAPTER}/*.json — Plan 04 Task 4.1 must create`);
});

const skip = !existsSync(adapterPath);

test(`${ADAPTER}: NO search export (D-15 LOCKED: retraction-watch exposes fetchById only)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  // D-15 LOCKED: retraction-watch exposes fetchById only — no search() export.
  assert.equal(
    typeof adapter.search,
    'undefined',
    'D-15 LOCKED: retraction-watch exposes fetchById only — search() must NOT be exported',
  );
});

test(`${ADAPTER}.fetchById() parses cassette into SourceCandidate | null with retracted flag (T-3-13)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  const result = await adapter.fetchById('10.0000/test');
  assert.ok(result === null || typeof result === 'object', 'fetchById returns object or null');
  if (result !== null) {
    // Retraction Watch SourceCandidate must have retracted boolean field (D-14).
    assert.ok(
      'retracted' in (result as object),
      'Retraction Watch SourceCandidate must have retracted boolean field (D-14/D-15)',
    );
  }
});
