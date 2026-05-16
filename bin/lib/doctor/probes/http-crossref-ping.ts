// bin/lib/doctor/probes/http-crossref-ping.ts
//
// D-03(d): Crossref HTTP ping cassette wiring smoke probe.
//
// Phase 2: SKIP-only. Cross-AI review HIGH (Codex iter 1) ruled out any
// dynamic import from the test fixtures directory in production code — it
// inverts the layering and breaks production-only builds (the fixtures
// directory is excluded from tsc dist).
//
// Phase 3 will introduce a production-tree `bin/lib/http-mock.ts`
// chokepoint owned by the http layer (NOT by the fixtures directory).
// When that lands, this probe's `run()` will: (a) check for the chokepoint,
// (b) if present, call `dispatchCrossrefPing()` against MockAgent,
// (c) discriminate PASS/FAIL on response status. Until then, SKIP is the
// honest answer.
//
// The probe interface (id + run signature) is stable — 02-07 Case A
// extracts `probes['http-crossref-ping']?.severity` and treats SKIP as
// a non-failure (parity is asserted on existence + canonical id, not on
// the severity value itself, which Phase 2 pins to SKIP by construction).
//
// D-19 read-only: no filesystem I/O, no network I/O in Phase 2.

import type { Probe, ProbeResult } from '../probes.js';

export const httpCrossrefPingProbe: Probe = {
  id: 'http-crossref-ping',
  async run(): Promise<ProbeResult> {
    return {
      id: 'http-crossref-ping',
      severity: 'SKIP',
      summary: 'D-03(d) cassette wiring smoke deferred to Phase 3 (production-tree http-mock chokepoint not yet shipped). Phase 2 ships this probe with a stable id so tier-fact extraction in 02-07 can rely on its presence.',
      fix: 'No action required in Phase 2. Phase 3 will land bin/lib/http-mock.ts and re-enable this probe with a real PASS/FAIL discrimination.',
    };
  },
};
