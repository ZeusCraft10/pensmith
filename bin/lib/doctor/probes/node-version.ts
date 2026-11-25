// bin/lib/doctor/probes/node-version.ts
//
// DOCT-01: Node.js runtime version probe.
// PASS on Node >= 22.12 (package.json engines), FAIL otherwise. undici 7 needs
// at least 20.18.1, Node 20 is end-of-life, and 22.12 is the first 22.x line
// with require(esm) unflagged on every supported OS.
// D-19 read-only: no filesystem or network I/O.

import type { Probe, ProbeResult } from '../probes.js';

const MIN_MAJOR = 22;
const MIN_MINOR = 12;

function parseMajorMinor(v: string): [number, number] {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** True when `version` (e.g. process.version) meets the engines.node floor. */
export function isSupportedNodeVersion(version: string): boolean {
  const [major, minor] = parseMajorMinor(version);
  return major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
}

export const nodeVersionProbe: Probe = {
  id: 'node-version',
  async run(): Promise<ProbeResult> {
    const floor = `v${MIN_MAJOR}.${MIN_MINOR}`;
    return isSupportedNodeVersion(process.version)
      ? { id: 'node-version', severity: 'PASS', summary: `Node ${process.version} (>= ${floor})` }
      : {
          id: 'node-version',
          severity: 'FAIL',
          summary: `Node ${process.version} (< ${floor} — required)`,
          fix: `Install Node ${MIN_MAJOR}.${MIN_MINOR} or newer. https://nodejs.org/`,
        };
  },
};
