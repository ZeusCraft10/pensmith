// bin/lib/doctor/probes/network-mode.ts
//
// RUN-02 / D-17-08: the effective network mode and why.
//   live                      → PASS  'network: live'
//   PENSMITH_OFFLINE=1        → WARN  'network: OFFLINE (PENSMITH_OFFLINE=1)'
//   --dry-run                 → WARN  'network: OFFLINE (--dry-run)'
//   the test runner           → WARN  'network: OFFLINE (test runner)'
// Offline replay in an installed package (no fixtures shipped) is FAIL: every
// work verb would refuse (D-17-15), so doctor names the fix.
//
// D-19 read-only: no filesystem writes. The mode comes from bin/lib/http-mock.ts
// networkMode() — the ONE place the network mode is decided (D-17-04); this
// probe never reads a mode variable itself.

import type { Probe, ProbeResult } from '../probes.js';
import { networkMode, OFFLINE_FIXTURES_NOT_SHIPPED } from '../../http-mock.js';

export const networkModeProbe: Probe = {
  id: 'network-mode',
  async run(): Promise<ProbeResult> {
    const mode = networkMode();
    const llm = mode.llmStubbed
      ? ' LLM calls are stubbed (PENSMITH_NO_LLM=1): every model call returns a deterministic stub.'
      : '';
    if (!mode.sourcesOffline || mode.reason === null) {
      return {
        id: 'network-mode',
        severity: 'PASS',
        summary: 'network: live',
        detail: `Sources, DOI verification, retraction checks, plagiarism and the detector score use the live services.${llm}`,
      };
    }
    if (!mode.dryRun && !mode.fixturesAvailable) {
      return {
        id: 'network-mode',
        severity: 'FAIL',
        summary: `network: OFFLINE (${mode.reason})`,
        detail: `${OFFLINE_FIXTURES_NOT_SHIPPED}.${llm}`,
        fix: 'Unset PENSMITH_OFFLINE to run live, or use --dry-run for a synthetic rehearsal.',
      };
    }
    const what = mode.dryRun
      ? 'Sources are labelled synthetic dry-run sources; no network or model call is made.'
      : 'Sources, verification, detector and plagiarism results are recorded fixtures, not live.';
    return {
      id: 'network-mode',
      severity: 'WARN',
      summary: `network: OFFLINE (${mode.reason})`,
      detail: `${what}${llm}`,
      fix:
        mode.reason === 'PENSMITH_OFFLINE=1'
          ? 'Unset PENSMITH_OFFLINE to verify against the live sources.'
          : mode.reason === '--dry-run'
            ? 'Drop --dry-run to run for real.'
            : 'Offline under the test runner by design; the live test lane is described in CONTRIBUTING.md.',
    };
  },
};
