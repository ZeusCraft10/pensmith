// tests/doctor-probes-cwd-independence.test.ts
//
// CR-02 regression: build-artifact-resolves and mcp-sdk-presence probes must
// resolve dist/* relative to the PROBE FILE, not process.cwd(). PRD §3 / §19
// Tier-2 contract requires `pensmith doctor` to work from inside a user's
// paper directory (which is NOT the pensmith repo root).
//
// This test changes cwd to an empty tmpdir, runs the probes, and asserts
// they still report PASS (assuming `npm run build` has produced dist/). If
// the probes regressed to cwd-relative resolution they would FAIL here
// because the tmpdir contains no dist/ subtree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtifactResolvesProbe } from '../bin/lib/doctor/probes/build-artifact-resolves.js';
import { mcpSdkPresenceProbe } from '../bin/lib/doctor/probes/mcp-sdk-presence.js';

// Skip the test if the build artifacts are not present at the expected
// location — the probes would legitimately FAIL in either cwd in that
// scenario (regression-irrelevant; the precondition for this test is a
// completed build). When the CI matrix runs `npm run build` before tests,
// this branch is never taken.
const REPO_ROOT = process.cwd();
const REQUIRED = [
  join(REPO_ROOT, 'dist', 'bin', 'pensmith.js'),
  join(REPO_ROOT, 'dist', 'mcp', 'server.js'),
];
const BUILD_PRESENT = REQUIRED.every((p) => {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
});

test('CR-02: build-artifact-resolves PASSes when invoked from a non-repo cwd', async () => {
  if (!BUILD_PRESENT) {
    // Cannot verify cwd-independence without a built dist/. Skip rather than
    // emit a spurious failure.
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-cwd-indep-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const r = await buildArtifactResolvesProbe.run();
    assert.equal(
      r.severity,
      'PASS',
      `build-artifact-resolves regressed to cwd-relative: got ${r.severity} (${r.summary}). The probe must resolve dist/bin/pensmith.js relative to its own file location, not process.cwd().`,
    );
  } finally {
    process.chdir(cwd);
  }
});

test('CR-02: mcp-sdk-presence PASSes when invoked from a non-repo cwd', async () => {
  if (!BUILD_PRESENT) {
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-cwd-indep-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const r = await mcpSdkPresenceProbe.run();
    assert.equal(
      r.severity,
      'PASS',
      `mcp-sdk-presence regressed to cwd-relative: got ${r.severity} (${r.summary}). The probe must resolve dist/mcp/server.js relative to its own file location, not process.cwd().`,
    );
  } finally {
    process.chdir(cwd);
  }
});
