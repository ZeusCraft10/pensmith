// tests/sources/retraction-watch.test.ts — Wave 0 stub for T-3-13.
// D-15: Retraction Watch is a side-channel filter — exposes fetchById ONLY, no search().
//
// Production code required: bin/lib/sources/retraction-watch.ts + cassette
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// ---------------------------------------------------------------------------
// CR-02: empty cassette array must NOT silently pass every DOI as un-retracted.
//
// loadCassetteDir returns [] (empty array, NOT null) when the cassette dir
// exists but contains no .json files. Prior to the CR-02 fix, fetchById's
// guard was `if (!cassettes) return null` — a truthy [] passed through,
// find() returned undefined, and every DOI looked un-retracted (silent
// GATE-03 bypass).
//
// This test exercises the offline fetchById path with a DOI that has no
// cassette entry. In the real cassette dir (which exists with at least one
// file), the DOI '10.0000/no-cassette-cr02' has no matching entry, so
// cassettes.find(...) returns undefined and fetchById must return null
// (same semantic as the empty-dir case after the CR-02 fix).
//
// We cannot inject a custom empty dir here (CASSETTES_ROOT is module-internal),
// but the code path through `!cassettes || cassettes.length === 0` is exercised
// implicitly: if the cassette dir DOES contain files (normal CI run), the DOI
// simply won't match and find() returns undefined → null. The CR-02 belt test
// (structural assertion below) verifies the guard is in the source.
// ---------------------------------------------------------------------------
test(`${ADAPTER} CR-02: fetchById for a DOI with no cassette entry returns null (not a false un-retracted pass)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  // This DOI has no cassette in any committed fixture file.
  const result = await adapter.fetchById('10.0000/no-cassette-cr02');
  assert.equal(
    result,
    null,
    'CR-02: fetchById for a DOI with no cassette entry must return null (no false un-retracted result)',
  );
});

// ---------------------------------------------------------------------------
// CR-02 (belt): verify that the empty-array guard is in the retraction-watch source.
// This structural assertion documents the fix location so a future refactor that
// removes the guard will fail this test loudly rather than silently re-introducing
// the empty-dir bypass.
// ---------------------------------------------------------------------------
test(`${ADAPTER} CR-02: source code contains the empty-cassette array guard (cassettes.length === 0)`, () => {
  const adapterTsPath = fileURLToPath(new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url));
  assert.ok(existsSync(adapterTsPath), `bin/lib/sources/${ADAPTER}.ts must exist`);
  const src = readFileSync(adapterTsPath, 'utf8');
  assert.ok(
    /cassettes\.length\s*===\s*0/.test(src),
    'CR-02: retraction-watch.ts must contain the empty-cassette guard (cassettes.length === 0) to prevent silent GATE-03 bypass',
  );
});
