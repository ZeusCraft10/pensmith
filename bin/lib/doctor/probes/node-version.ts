// bin/lib/doctor/probes/node-version.ts
//
// DOCT-01: Node.js runtime version probe.
// CI-06 / D-V1-06 / D-17-39: pensmith supports the current Node LTS lines (22
// and 24). The floor is 22.12.0 — the same value as package.json engines.node
// (tests/node-version-probe.test.ts pins the two together).
// D-15 severity: PASS at or above the floor, FAIL below it.
// D-19 read-only: no filesystem or network I/O.

import type { Probe, ProbeResult } from '../probes.js';

/** The minimum supported Node version (package.json engines.node). */
export const NODE_VERSION_FLOOR = '22.12.0';

function parseSemver(v: string): [number, number, number] {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** True when `version` (e.g. `v22.12.0` or `22.12.0`) is at or above the floor. */
export function meetsNodeFloor(version: string, floor: string = NODE_VERSION_FLOOR): boolean {
  const have = parseSemver(version);
  const need = parseSemver(floor);
  for (let i = 0; i < 3; i += 1) {
    if (have[i]! > need[i]!) return true;
    if (have[i]! < need[i]!) return false;
  }
  return true;
}

/** The probe body over an injected version string (unit-testable). */
export function checkNodeVersion(version: string): ProbeResult {
  return meetsNodeFloor(version)
    ? { id: 'node-version', severity: 'PASS', summary: `Node ${version} (>= v${NODE_VERSION_FLOOR})` }
    : {
        id: 'node-version',
        severity: 'FAIL',
        summary: `Node ${version} (< v${NODE_VERSION_FLOOR} — required)`,
        fix: `Install Node ${NODE_VERSION_FLOOR} or newer (the Node 22 or 24 LTS line). https://nodejs.org/`,
      };
}

export const nodeVersionProbe: Probe = {
  id: 'node-version',
  async run(): Promise<ProbeResult> {
    return checkNodeVersion(process.version);
  },
};
