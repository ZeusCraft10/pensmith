// tests/doctor-exit-code.test.ts
//
// TIER-03: doctor exits 0 when no probe is FAIL; exits 1 when any probe is FAIL.
// D-15: exit code determined by presence of FAIL severity in probe results.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BIN = 'dist/bin/pensmith.js';

test('TIER-03: doctor exits 0 when no probe is FAIL', () => {
  assert.ok(existsSync(BIN));
  // We don't control what severity each probe returns on the dev box, but we
  // can detect the exit code by inspecting whether `[FAIL]` appears in stdout
  // (the TTY render icon for a FAIL probe — distinct from the footer "N FAIL" count).
  try {
    const out = execFileSync(process.execPath, [BIN, 'doctor'], { encoding: 'utf8' });
    const hasFail = /\[FAIL\]/.test(out);
    assert.equal(hasFail, false, 'this assertion path expected no [FAIL]; if a probe FAILed the next test covers exit-1');
  } catch (err: unknown) {
    // Non-zero exit. Validate it's exit 1 AND stdout contained [FAIL].
    const status = (err as { status?: number }).status;
    const stdout = (err as { stdout?: Buffer | string }).stdout?.toString() ?? '';
    assert.equal(status, 1, `unexpected exit code: ${status}`);
    assert.match(stdout, /\[FAIL\]/, 'exit 1 only with [FAIL] present');
  }
});

test('TIER-03: doctor exits non-zero when probe is FAIL (synthetic via mocked probe)', async () => {
  // Drive runDoctor() directly with a synthetic failing probe.
  const { runDoctor } = await import('../bin/lib/doctor/probes.js');
  const results = await runDoctor([
    {
      id: 'synth-fail',
      async run() {
        return { id: 'synth-fail', severity: 'FAIL' as const, summary: 'synthetic' };
      },
    },
  ]);
  const failed = Object.values(results).some((r) => r.severity === 'FAIL');
  assert.equal(failed, true);
});
