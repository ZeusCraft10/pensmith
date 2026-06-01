// tests/doctor-probes-cwd-independence.test.ts
//
// CR-02 regression: build-artifact-resolves and mcp-sdk-presence probes must
// resolve dist/* relative to the PROBE FILE's package root, not process.cwd().
// PRD §3 / §19 Tier-2 contract requires `pensmith doctor` to work from inside
// a user's paper directory (which is NOT the pensmith repo root).
//
// This test spawns the *compiled* `dist/bin/pensmith.js doctor --json` from
// a non-repo tmp cwd and asserts:
//   1. exit code is 0
//   2. both build-artifact-resolves and mcp-sdk-presence probes report PASS
//
// History: an earlier version of this test imported the probe modules
// directly. Under tsx that resolves to the .ts sources at depth 4 from repo
// root; under compiled .js the same code runs at depth 5 from repo root —
// so importing-and-running the probes silently masked an off-by-one in
// fixed-depth `..` arithmetic. Spawning the compiled CLI is the only way to
// exercise the production path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const DIST_BIN = join(REPO_ROOT, 'dist', 'bin', 'pensmith.js');
const DIST_MCP = join(REPO_ROOT, 'dist', 'mcp', 'server.js');

const BUILD_PRESENT = [DIST_BIN, DIST_MCP].every((p) => {
  try {
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
});

test('CR-02: compiled doctor --json from a non-repo cwd exits 0 with build-artifact probes PASS', () => {
  if (!BUILD_PRESENT) {
    // Cannot verify cwd-independence without a built dist/. Skip rather than
    // emit a spurious failure; the precondition for this test is `npm run build`.
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-cwd-indep-'));
  const result = spawnSync(process.execPath, [DIST_BIN, 'doctor', '--json'], {
    cwd: tmp,
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.equal(
    result.status,
    0,
    `pensmith doctor --json from ${tmp} must exit 0 (got ${result.status}). ` +
      `stderr: ${result.stderr}\nstdout: ${result.stdout.slice(0, 2000)}`,
  );

  let parsed: { probes: Record<string, { severity: string; summary: string }> };
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(
      `doctor --json output is not valid JSON. stdout: ${result.stdout.slice(0, 2000)}\nerr: ${(err as Error).message}`,
    );
  }

  const targets = ['build-artifact-resolves', 'mcp-sdk-presence'];
  for (const id of targets) {
    const probe = parsed.probes[id];
    assert.ok(probe, `doctor --json must include probe ${id}; keys: ${Object.keys(parsed.probes).join(',')}`);
    assert.equal(
      probe.severity,
      'PASS',
      `${id} regressed to cwd-relative or wrong-depth: got ${probe.severity} (${probe.summary}). ` +
        `The probe must resolve dist/* relative to its package root (walked via findPkgRoot), not process.cwd() and not a fixed-depth ..×N.`,
    );
  }
});
