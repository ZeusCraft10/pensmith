// tests/freshness-probe.test.ts — RSCH-10 source-freshness probe (D-10, WARN-only).
//
// RED-first (Plan 04-02 Task 1). Production code lives in
// bin/lib/verify/freshness.ts (probeFreshness + FreshnessResult). This suite
// exercises the locked WARN-only policy:
//   - DOI HEAD 200            → no WARN
//   - DOI HEAD 4xx/5xx        → WARN row, advisory only (never blocking)
//   - transport error (ECONNREFUSED) → SILENT (network noise, not staleness)
//
// The probes answer from the committed cassettes under
// tests/fixtures/cassettes/doi-head/. Retraction is not a freshness probe any
// more: Pass 1 reads it from the registry record, and it blocks
// (tests/retraction.test.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeFreshness } from '../bin/lib/verify/freshness.js';

// A clean DOI whose HEAD cassette returns 200.
const OK_DOI = '10.1038/s41586-021-03819-2';
// A DOI whose HEAD cassette returns 404.
const STALE_DOI = '10.0000/does-not-resolve';
// A DOI with no matching cassette → simulates a transport error / no response.
const NO_CASSETTE_DOI = '10.0000/no-cassette-at-all';

test('freshness: returns a FreshnessResult tagged with the citekey', async () => {
  const r = await probeFreshness('smith2020', OK_DOI);
  assert.equal(r.citekey, 'smith2020');
  assert.ok(Array.isArray(r.warnings), 'warnings must be an array');
});

test('freshness: DOI HEAD 200 produces NO warning', async () => {
  const r = await probeFreshness('smith2020', OK_DOI);
  const doiWarn = r.warnings[0];
  assert.equal(doiWarn, undefined, 'a resolving DOI must not warn');
});

test('freshness: DOI HEAD 404 produces a WARN row (advisory, not blocking)', async () => {
  const r = await probeFreshness('jones2019', STALE_DOI);
  const doiWarn = r.warnings[0];
  assert.ok(doiWarn, 'a 404 DOI HEAD must emit a WARN');
  assert.equal(doiWarn?.status, 'WARN');
  // RSCH-10 / D-10 — freshness is advisory: never escalates to a hard block.
  assert.notEqual(doiWarn?.status, 'FABRICATED');
  assert.notEqual(doiWarn?.status, 'MIS-CITED');
});

test('freshness: transport error (no cassette / ECONNREFUSED) is SILENT — no WARN', async () => {
  // No cassette for this DOI and no live network in offline mode → the probe
  // must treat the absence of a real HTTP status as network noise, not
  // staleness (D-10 / RESEARCH §J). No DOI HEAD warning is emitted.
  const r = await probeFreshness('ghost2099', NO_CASSETTE_DOI);
  const doiWarn = r.warnings[0];
  assert.equal(doiWarn, undefined, 'transport noise must NOT produce a WARN');
});

test('freshness: a null DOI skips the HEAD probe without throwing', async () => {
  const r = await probeFreshness('nodoi2021', null);
  const doiWarn = r.warnings[0];
  assert.equal(doiWarn, undefined, 'no DOI → no HEAD probe, no warning');
});
