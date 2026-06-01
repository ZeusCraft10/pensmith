// bin/lib/doctor/probes/node-version.ts
//
// DOCT-01: Node.js runtime version probe.
// D-15 severity: PASS if >= v20.10.0, FAIL otherwise.
// D-19 read-only: no filesystem or network I/O.

import type { Probe, ProbeResult } from '../probes.js';

function parseMajorMinor(v: string): [number, number] {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

export const nodeVersionProbe: Probe = {
  id: 'node-version',
  async run(): Promise<ProbeResult> {
    const [major, minor] = parseMajorMinor(process.version);
    const ok = major > 20 || (major === 20 && minor >= 10);
    return ok
      ? { id: 'node-version', severity: 'PASS', summary: `Node ${process.version} (>= v20.10)` }
      : {
          id: 'node-version',
          severity: 'FAIL',
          summary: `Node ${process.version} (< v20.10 — required)`,
          fix: 'Install Node 20.10 or newer. https://nodejs.org/',
        };
  },
};
