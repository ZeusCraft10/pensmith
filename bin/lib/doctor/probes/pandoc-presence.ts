// bin/lib/doctor/probes/pandoc-presence.ts
//
// DOCT-02c: Pandoc binary on PATH probe.
// D-15 severity: PASS when pandoc --version exits 0; WARN when missing.
// D-19 read-only: spawns read-only binary query only.
// Pitfall 8: NEVER exec() (shell-interpolation risk) — always execFileSync with argv array.

import type { Probe, ProbeResult } from '../probes.js';
import { isPandocPresent } from '../../ecosystem-presence.js';

export const pandocPresenceProbe: Probe = {
  id: 'pandoc-presence',
  async run(): Promise<ProbeResult> {
    // CR-01: share the detection algorithm with bin/lib/capabilities.ts via
    // ecosystem-presence.ts. Both tiers MUST converge on the same boolean
    // so the tier-contract Case D fact equivalence holds across hosts.
    if (isPandocPresent()) {
      return {
        id: 'pandoc-presence',
        severity: 'PASS',
        summary: 'pandoc on PATH',
      };
    }
    return {
      id: 'pandoc-presence',
      severity: 'WARN',
      summary: 'pandoc not found on PATH — the `export` verb (Phase 3+) will be unavailable.',
      fix: 'Install pandoc: https://pandoc.org/installing.html',
    };
  },
};
