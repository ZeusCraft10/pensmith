// tests/freshness-probe.test.ts — RED spec for bin/lib/verify/freshness.ts
// (RSCH-10, D-10: WARN-only, never blocking).
//
// retraction-watch.ts IS a real HTTP adapter (not a Phase-3 stub):
//   - It calls fetchById() which makes a live GET to
//     https://api.labs.crossref.org/data/retractions?filter=record:<doi>
//   - In offline mode (isOfflineMode()===true) it short-circuits through
//     loadCassetteFile('retraction-watch', 'fetchById-fake')
//   - The freshness probe calls fetchById() directly, so the retraction-watch
//     test uses the existing retraction-watch adapter path in offline mode.
//
// DOI HEAD request:
//   probeFreshness issues a HEAD via bin/lib/http.ts (the undici chokepoint).
//   In offline mode we cannot intercept undici via nock. Therefore freshness.ts
//   must check isOfflineMode() and, when offline, load a cassette from
//   tests/fixtures/cassettes/freshness/ to short-circuit the HEAD.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { FreshnessResult } from '../bin/lib/verify/freshness.js';
import { probeFreshness } from '../bin/lib/verify/freshness.js';

// The freshness probe runs in offline mode (CI default: PENSMITH_NETWORK_TESTS !== '1').
// All assertions are against offline cassette playback.

test('probeFreshness: DOI HEAD 200 — no WARN, advisory=false', async () => {
  // doi-head-ok cassette: HEAD doi.org/10.1038/... → 200
  const result: FreshnessResult = await probeFreshness(
    'vaswani2017',
    '10.1038/s41586-021-03819-2',
  );
  assert.equal(result.warnDoi, false, 'DOI 200 should not produce a WARN');
  assert.equal(result.advisory, false, 'No advisory on clean DOI');
});

test('probeFreshness: DOI HEAD 404 — WARN, advisory=true, no hard-fail', async () => {
  // doi-head-404 cassette: HEAD doi.org/10.9999/does-not-exist → 404
  const result: FreshnessResult = await probeFreshness(
    'missing2024',
    '10.9999/does-not-exist',
  );
  assert.equal(result.warnDoi, true, 'DOI 404 should produce a WARN');
  assert.equal(result.advisory, true, 'Advisory flag should be true on stale DOI');
  // Must not throw — WARN-only, never blocking
});

test('probeFreshness: retraction-watch hit — WARN, retraction_warnings populated', async () => {
  // The retraction-watch adapter in offline mode uses loadCassetteFile(
  //   'retraction-watch', 'fetchById-fake'
  // ) with the DOI 10.0000/test. We use 10.0000/test to match that cassette.
  const result: FreshnessResult = await probeFreshness(
    'doe2010',
    '10.0000/test',
  );
  assert.equal(result.warnRetraction, true, 'Retraction hit should produce a WARN');
  assert.equal(result.advisory, true, 'Advisory flag should be true on retraction');
  assert.ok(
    Array.isArray(result.retraction_warnings),
    'retraction_warnings must be an array',
  );
  assert.ok(
    result.retraction_warnings.length > 0,
    'retraction_warnings must have at least one entry for Plan 05 aggregation',
  );
  const w = result.retraction_warnings[0];
  assert.ok(w !== undefined, 'first retraction_warning entry must exist');
  assert.ok('citekey' in w, 'retraction_warning must have citekey');
  assert.ok('note' in w, 'retraction_warning must have note');
});

test('probeFreshness: transport error (null DOI) — silent, no WARN', async () => {
  // Null DOI fails validation before any network attempt → silent (not WARN)
  const result: FreshnessResult = await probeFreshness('nocite2024', null);
  assert.equal(result.warnDoi, false, 'null DOI must be silent (no WARN)');
  assert.equal(result.warnRetraction, false, 'null DOI must be silent on retraction too');
  assert.equal(result.advisory, false, 'No advisory on skipped probe');
});

test('probeFreshness: invalid DOI format — silent, no WARN (SSRF mitigation)', async () => {
  // An invalid DOI string must fail format validation before any HEAD request.
  const result: FreshnessResult = await probeFreshness('bad2024', 'not-a-doi/garbage');
  assert.equal(result.warnDoi, false, 'Invalid DOI format must not produce WARN (SSRF)');
  assert.equal(result.advisory, false, 'No advisory on invalid DOI');
});
