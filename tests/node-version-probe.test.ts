// tests/node-version-probe.test.ts — CI-06 / D-17-39: the doctor node-version
// floor is the supported LTS floor (22.12.0), it matches package.json
// engines.node, and it FAILs below the floor (injected version — no need to run
// an old Node).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NODE_VERSION_FLOOR,
  checkNodeVersion,
  meetsNodeFloor,
  nodeVersionProbe,
} from '../bin/lib/doctor/probes/node-version.js';

test('CI-06: the doctor floor equals package.json engines.node', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { engines?: { node?: string } };
  assert.equal(pkg.engines?.node, `>=${NODE_VERSION_FLOOR}`);
  assert.equal(NODE_VERSION_FLOOR, '22.12.0');
});

test('CI-06: node-version FAILs below 22.12 and PASSes on the 22 and 24 LTS lines', () => {
  for (const v of ['v20.18.0', 'v20.10.0', 'v21.7.3', 'v22.0.0', 'v22.11.0', 'v18.20.4']) {
    const r = checkNodeVersion(v);
    assert.equal(r.severity, 'FAIL', `${v} must FAIL`);
    assert.match(r.summary, /< v22\.12\.0 — required/);
    assert.match(r.fix ?? '', /22\.12\.0 or newer/);
  }
  for (const v of ['v22.12.0', 'v22.22.2', 'v23.1.0', 'v24.0.0', 'v24.11.1']) {
    assert.equal(checkNodeVersion(v).severity, 'PASS', `${v} must PASS`);
  }
});

test('CI-06: meetsNodeFloor compares major, minor and patch', () => {
  assert.equal(meetsNodeFloor('22.12.0'), true);
  assert.equal(meetsNodeFloor('22.11.99'), false);
  assert.equal(meetsNodeFloor('22.12.1'), true);
  assert.equal(meetsNodeFloor('garbage'), false);
});

test('CI-06: the probe runs against the live runtime (which is supported)', async () => {
  const r = await nodeVersionProbe.run();
  assert.equal(r.id, 'node-version');
  assert.equal(r.severity, 'PASS', `this suite must run on a supported Node: ${r.summary}`);
});
