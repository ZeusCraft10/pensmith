// tests/freshness-probe.test.ts — RSCH-10 source-freshness probe (D-10, WARN-only),
// updated for Phase 17 (RUN-01, RUN-03).
//
// Locked WARN-only policy:
//   - DOI HEAD 200            → no WARN
//   - DOI HEAD 4xx/5xx        → WARN row, advisory only (never blocking)
//   - retraction-watch hit    → WARN row
//   - transport error         → SILENT (network noise, not staleness)
// Phase 17: offline (PENSMITH_OFFLINE=1, --dry-run, the test runner) the DOI
// HEAD probe is "skipped (offline)" — it no longer replays a canned HEAD answer —
// and the Retraction Watch cross-check replays an EXACT recorded fixture or is
// skipped the same way. The live behaviour is exercised in the live test lane
// (PENSMITH_NETWORK_TESTS=1) against the V5 MockAgent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeFreshness, renderFreshnessTable } from '../bin/lib/verify/freshness.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';

// A DOI whose (synthetic) Retraction Watch fixture is a hit.
const RETRACTED_DOI = '10.0000/retracted';
// A DOI with no fixture of any kind.
const NO_FIXTURE_DOI = '10.0000/no-fixture-at-all';

async function liveLane<T>(fn: (agent: ReturnType<typeof installMockAgent>['agent']) => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  _resetBucketsForTest();
  const { agent, restore } = installMockAgent();
  try {
    return await fn(agent);
  } finally {
    await restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
}

// ---------------------------------------------------------------------------
// Offline (the test runner default)
// ---------------------------------------------------------------------------

test('freshness: returns a FreshnessResult tagged with the citekey', async () => {
  const r = await probeFreshness('smith2020', '10.1038/nphys1170');
  assert.equal(r.citekey, 'smith2020');
  assert.ok(Array.isArray(r.warnings), 'warnings must be an array');
});

test('RUN-03: offline, the DOI HEAD probe is "skipped (offline)" — never a replayed canned answer', async () => {
  const r = await probeFreshness('aspelmeyer2009', '10.1038/nphys1170');
  assert.equal(r.warnings.find((w) => w.probe === 'DOI HEAD'), undefined);
  assert.deepEqual(r.skipped?.find((s) => s.probe === 'DOI HEAD'), { probe: 'DOI HEAD', detail: 'skipped (offline)' });
  // 10.1038/nphys1170 has a RECORDED Retraction Watch fixture, so that probe ran.
  assert.equal(r.skipped?.find((s) => s.probe === 'retraction-watch'), undefined);
  const table = renderFreshnessTable([r]);
  assert.match(table, /\| aspelmeyer2009 \| DOI HEAD \| skipped \(offline\) \| not probed — re-run online \|/);
  assert.ok(!/\| aspelmeyer2009 \| DOI HEAD \| ok \|/.test(table), 'a skipped probe is never shown as ok');
});

test('freshness: an exact Retraction Watch fixture hit still produces a WARN row offline', async () => {
  const r = await probeFreshness('roe2018', RETRACTED_DOI);
  const rwWarn = r.warnings.find((w) => w.probe === 'retraction-watch');
  assert.ok(rwWarn, 'a retracted DOI must emit a retraction-watch WARN');
  assert.equal(rwWarn?.status, 'WARN');
});

test('RUN-03: offline, a DOI with no Retraction Watch fixture is "skipped (offline)", never "not retracted"', async () => {
  const r = await probeFreshness('ghost2099', NO_FIXTURE_DOI);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.skipped, [
    { probe: 'DOI HEAD', detail: 'skipped (offline)' },
    { probe: 'retraction-watch', detail: 'skipped (offline)' },
  ]);
});

test('freshness: a null DOI skips every probe without throwing', async () => {
  const r = await probeFreshness('nodoi2021', null);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.skipped, undefined);
});

test('RUN-03: --dry-run reports "skipped (dry-run)"', async () => {
  const saved = process.env['PENSMITH_DRY_RUN'];
  process.env['PENSMITH_DRY_RUN'] = '1';
  try {
    const r = await probeFreshness('x2020', '10.1038/nphys1170');
    assert.deepEqual(r.skipped, [
      { probe: 'DOI HEAD', detail: 'skipped (dry-run)' },
      { probe: 'retraction-watch', detail: 'skipped (dry-run)' },
    ]);
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_DRY_RUN'];
    else process.env['PENSMITH_DRY_RUN'] = saved;
  }
});

// ---------------------------------------------------------------------------
// Live (the test lane, MockAgent)
// ---------------------------------------------------------------------------

test('freshness (live): DOI HEAD 200 produces NO warning', async () => {
  await liveLane(async (agent) => {
    agent.get('https://doi.org').intercept({ path: '/10.1038/s41586-021-03819-2', method: 'HEAD' }).reply(200, '');
    agent
      .get('https://api.labs.crossref.org')
      .intercept({ path: /\/data\/retractions/, method: 'GET' })
      .reply(200, { items: [] }, { headers: { 'content-type': 'application/json' } });
    const r = await probeFreshness('jumper2021', '10.1038/s41586-021-03819-2');
    assert.deepEqual(r.warnings, []);
    assert.equal(r.skipped, undefined, 'live probes are never skipped');
    assert.match(renderFreshnessTable([r]), /\| jumper2021 \| DOI HEAD \| ok \|/);
  });
});

test('freshness (live): DOI HEAD 404 produces a WARN row (advisory, not blocking)', async () => {
  await liveLane(async (agent) => {
    agent.get('https://doi.org').intercept({ path: '/10.5555/does-not-resolve', method: 'HEAD' }).reply(404, '');
    agent
      .get('https://api.labs.crossref.org')
      .intercept({ path: /\/data\/retractions/, method: 'GET' })
      .reply(200, { items: [] }, { headers: { 'content-type': 'application/json' } });
    const r = await probeFreshness('jones2019', '10.5555/does-not-resolve');
    const doiWarn = r.warnings.find((w) => w.probe === 'DOI HEAD');
    assert.ok(doiWarn, 'a 404 DOI HEAD must emit a WARN');
    assert.equal(doiWarn?.status, 'WARN');
    assert.match(doiWarn?.detail ?? '', /DOI HEAD returned 404/);
  });
});

test('freshness (live): a transport error is SILENT — no WARN, not skipped', async () => {
  await liveLane(async () => {
    // No interceptor: the V5 MockAgent refuses the connection (net connect disabled).
    const r = await probeFreshness('ghost2099', '10.5555/transport-error');
    assert.deepEqual(r.warnings, [], 'transport noise must NOT produce a WARN');
    assert.equal(r.skipped, undefined, 'a live transport error is noise, not an offline skip');
  });
});
