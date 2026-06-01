// tests/doctor-shape.test.ts
//
// TIER-04: ProbeResult shape {id, severity, summary, detail?, fix?}.
// D-18: doctor --json output matches locked JSON shape from references/doctor-output.md.
// D-20: Record keyed by probe.id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../bin/lib/doctor/probes.js';
import { renderJson } from '../bin/lib/doctor/render.js';

test('TIER-04: ProbeResult shape {id, severity, summary, detail?, fix?}', async () => {
  const results = await runDoctor();
  for (const [key, r] of Object.entries(results)) {
    assert.equal(r.id, key, `key ${key} must match r.id`);
    assert.ok(['PASS', 'WARN', 'FAIL', 'SKIP'].includes(r.severity));
    assert.equal(typeof r.summary, 'string');
    if ('detail' in r && r.detail !== undefined) assert.equal(typeof r.detail, 'string');
    if ('fix' in r && r.fix !== undefined) assert.equal(typeof r.fix, 'string');
  }
});

test('D-18: doctor --json output is jq-pipeable (parses to expected shape)', async () => {
  const results = await runDoctor();
  const json = JSON.parse(renderJson(results)) as {
    schemaVersion: number;
    probes: Record<string, unknown>;
    summary: { pass: number; warn: number; fail: number; skip: number };
  };
  assert.equal(json.schemaVersion, 1);
  assert.equal(typeof json.probes, 'object');
  assert.equal(typeof json.summary.pass, 'number');
  assert.equal(typeof json.summary.warn, 'number');
  assert.equal(typeof json.summary.fail, 'number');
  assert.equal(typeof json.summary.skip, 'number');
});
