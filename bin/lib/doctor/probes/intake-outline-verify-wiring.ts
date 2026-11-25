// bin/lib/doctor/probes/intake-outline-verify-wiring.ts
//
// DOCT-05: intake/outline/verify wiring smoke probe.
//
// Confirms the per-section pipeline is wired in the running CLI:
//   (a) the dispatcher registers new, research, outline, plan, write, verify;
//   (b) bin/lib/drafter-input.ts exports `assertDrafterInput`.
//
// The workflow markdown bodies are a source-tree artifact, not something the
// installed CLI reads, so their structure is checked by the test suite
// (tests/workflow-bodies.test.ts), not here.
//
// D-19 read-only: probe only imports modules; no filesystem writes, no .paper/
// touches, no network I/O. A FAIL lists every missing piece so one
// `pensmith doctor` run tells the operator exactly which wiring regressed.

import type { Probe, ProbeResult } from '../probes.js';

// `new` is the canonical verb key even though its implementation file is
// bin/cli/intake.ts.
const EXPECTED_VERB_KEYS = ['new', 'research', 'outline', 'plan', 'write', 'verify'] as const;

export const intakeOutlineVerifyWiringProbe: Probe = {
  id: 'intake-outline-verify-wiring',
  async run(): Promise<ProbeResult> {
    const failures: string[] = [];

    // (a) The dispatcher's citty command exposes every pipeline verb.
    try {
      const dispatcher = (await import('../../../pensmith.js')) as {
        command?: { subCommands?: Record<string, unknown> };
      };
      const subs = dispatcher.command?.subCommands ?? {};
      for (const v of EXPECTED_VERB_KEYS) {
        if (!(v in subs)) {
          failures.push(`pensmith.ts subCommands missing verb: ${v}`);
        }
      }
    } catch (e) {
      failures.push(
        `pensmith.ts dispatcher not importable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // (b) bin/lib/drafter-input.ts exports assertDrafterInput.
    try {
      const di = (await import('../../drafter-input.js')) as {
        assertDrafterInput?: unknown;
      };
      if (typeof di.assertDrafterInput !== 'function') {
        failures.push('bin/lib/drafter-input.ts missing assertDrafterInput export');
      }
    } catch (e) {
      failures.push(
        `bin/lib/drafter-input.ts not importable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (failures.length > 0) {
      return {
        id: 'intake-outline-verify-wiring',
        severity: 'FAIL',
        summary: 'Intake/outline/verify wiring incomplete',
        detail: failures.join('; '),
        fix: 'Check the REAL_VERB_LOADERS map in bin/pensmith.ts and the drafter-input contract.',
      };
    }

    return {
      id: 'intake-outline-verify-wiring',
      severity: 'PASS',
      summary: 'All 6 pipeline verbs (new, research, outline, plan, write, verify) are wired, with the drafter contract.',
    };
  },
};
