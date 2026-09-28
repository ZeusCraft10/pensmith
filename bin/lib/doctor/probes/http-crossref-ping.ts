// bin/lib/doctor/probes/http-crossref-ping.ts
//
// D-03(d): the offline-replay wiring probe.
//
// Offline replay (PENSMITH_OFFLINE=1 and the test runner) answers a request
// ONLY from the exact-match fixture store in bin/lib/http-mock.ts (D-17-06).
// This probe checks that the store is usable when offline replay is ACTIVE: in
// a source checkout every committed fixture must parse and the Crossref
// fixtures must be present (PASS, with the count); outside a checkout — an
// installed package, which does not ship tests/ — the honest answer is SKIP
// (offline replay is refused there before any work, D-17-15). A corrupt
// cassette is FAIL. In live mode (and under --dry-run) the store is not used,
// so the probe is SKIP and never reads tests/ (RUN-05).
//
// The probe interface (id + run signature) is stable — the tier contract
// extracts `probes['http-crossref-ping']?.severity` and treats SKIP as a
// non-failure (parity is asserted on existence + canonical id).
//
// D-19 read-only: it only READS the committed fixtures; it never dials.

import type { Probe, ProbeResult } from '../probes.js';
import { networkMode, listCassetteFiles, loadCassetteDir } from '../../http-mock.js';

export const httpCrossrefPingProbe: Probe = {
  id: 'http-crossref-ping',
  async run(): Promise<ProbeResult> {
    const mode = networkMode();
    // RUN-05: a live run never reads tests/ — the fixture store is not in use,
    // so the probe does not load it (and --dry-run uses the synthetic provider).
    if (!mode.sourcesOffline || mode.dryRun) {
      return {
        id: 'http-crossref-ping',
        severity: 'SKIP',
        summary: mode.dryRun
          ? 'Offline-replay wiring probe — SKIP: not used under --dry-run (sources come from the synthetic dry-run provider).'
          : 'Offline-replay wiring probe — SKIP: not used (network: live); recorded fixtures are read only with PENSMITH_OFFLINE=1 or under the test runner.',
      };
    }
    if (!mode.fixturesAvailable) {
      return {
        id: 'http-crossref-ping',
        severity: 'SKIP',
        summary:
          'Offline-replay wiring probe — SKIP: recorded fixtures are not shipped in the installed package (offline replay needs a source checkout; live mode is unaffected).',
      };
    }
    let files = 0;
    let crossref = 0;
    try {
      files = listCassetteFiles().length;
      crossref = (loadCassetteDir('crossref') ?? []).length;
    } catch (e) {
      return {
        id: 'http-crossref-ping',
        severity: 'FAIL',
        summary: 'Offline-replay wiring probe — a committed fixture does not parse.',
        detail: (e as Error).message,
        fix: 'Re-record the adapter with `npm run cassettes:refresh -- --only <adapter>` (CONTRIBUTING.md).',
      };
    }
    if (crossref === 0) {
      return {
        id: 'http-crossref-ping',
        severity: 'FAIL',
        summary: 'Offline-replay wiring probe — no recorded Crossref fixture found.',
        fix: 'Re-record with `npm run cassettes:refresh -- --only crossref` (needs network + PENSMITH_CONTACT_EMAIL).',
      };
    }
    return {
      id: 'http-crossref-ping',
      severity: 'PASS',
      summary: `Offline-replay wiring probe — ${files} fixture file(s) load (${crossref} Crossref entr${crossref === 1 ? 'y' : 'ies'}); offline replay is exact-match only.`,
    };
  },
};
