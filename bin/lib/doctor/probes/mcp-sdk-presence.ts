// bin/lib/doctor/probes/mcp-sdk-presence.ts
//
// DOCT-01 wiring: MCP server build artifact presence probe.
// D-15 severity: PASS if dist/mcp/server.js exists and is non-empty (>= 200B);
//   WARN if smaller than 200 bytes (stub); FAIL if missing or empty.
// D-19 read-only: statSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// CR-02 fix: resolve dist/mcp/server.js relative to THIS file, not
// process.cwd(). Tier-2 (`pensmith doctor` from a user's paper directory)
// must find the build artifact at the installed package root regardless of
// invocation cwd. See sibling probe build-artifact-resolves.ts for the
// full rationale.
//
// After `npm run build`, this file is emitted to:
//   dist/bin/lib/doctor/probes/mcp-sdk-presence.js
// So PKG_ROOT is `..` × 4 from HERE.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const MCP_REL = 'dist/mcp/server.js';
const MCP_PATH = path.join(PKG_ROOT, MCP_REL);

export const mcpSdkPresenceProbe: Probe = {
  id: 'mcp-sdk-presence',
  async run(): Promise<ProbeResult> {
    try {
      const s = statSync(MCP_PATH);
      if (s.size === 0) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_REL} exists but is empty`,
          fix: 'Run `npm run build`.',
        };
      }
      if (s.size < 200) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'WARN',
          summary: `${MCP_REL} suspiciously small (${s.size}B)`,
          fix: 'Rebuild — `npm run clean && npm run build`.',
        };
      }
      return { id: 'mcp-sdk-presence', severity: 'PASS', summary: `${MCP_REL} present (${s.size}B)` };
    } catch {
      return {
        id: 'mcp-sdk-presence',
        severity: 'FAIL',
        summary: `${MCP_REL} not found`,
        fix: 'Run `npm run build`.',
      };
    }
  },
};
