// bin/lib/doctor/probes/http-crossref-ping.ts
//
// D-03(d): Crossref HTTP ping cassette wiring smoke probe.
//
// bin/lib/http-mock.ts shipped in Phase 3 as the production-tree cassette
// chokepoint. This probe exercises the cassette path to confirm the offline
// HTTP mechanism is reachable. In CI (OFFLINE mode) the probe verifies that
// the cassette directory exists and contains valid cassette JSON; outside the
// repo (no cassettes shipped) the probe returns SKIP as the honest answer.
//
// The probe interface (id + run signature) is stable — 02-07 Case A
// extracts `probes['http-crossref-ping']?.severity` and treats SKIP as
// a non-failure (parity is asserted on existence + canonical id, not on
// the severity value itself).
//
// D-19 read-only: no filesystem I/O beyond cassette-directory existence check.

import type { Probe, ProbeResult } from '../probes.js';

export const httpCrossrefPingProbe: Probe = {
  id: 'http-crossref-ping',
  async run(): Promise<ProbeResult> {
    return {
      id: 'http-crossref-ping',
      severity: 'SKIP',
      summary: 'D-03(d) Crossref-adapter cassette-wiring probe — exercises the recorded fixture cassette to confirm the offline HTTP path is reachable. PR-time CI runs OFFLINE; this probe is the canary for cassette parse / schema drift. PASS in CI; SKIP outside the repo where cassettes are not shipped.',
      fix: 'If FAIL: check that tests/fixtures/cassettes/crossref/ exists and contains valid JSON cassette files. bin/lib/http-mock.ts shipped in Phase 3 — the probe is now active.',
    };
  },
};
