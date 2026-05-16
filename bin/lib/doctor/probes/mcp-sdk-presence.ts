// bin/lib/doctor/probes/mcp-sdk-presence.ts
//
// DOCT-01 wiring: MCP server build artifact presence probe.
// D-15 severity: PASS if dist/mcp/server.js exists and is non-empty (>= 200B);
//   WARN if smaller than 200 bytes (stub); FAIL if missing or empty.
// D-19 read-only: statSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';

const MCP_PATH = 'dist/mcp/server.js';

export const mcpSdkPresenceProbe: Probe = {
  id: 'mcp-sdk-presence',
  async run(): Promise<ProbeResult> {
    try {
      const s = statSync(MCP_PATH);
      if (s.size === 0) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_PATH} exists but is empty`,
          fix: 'Run `npm run build`.',
        };
      }
      if (s.size < 200) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'WARN',
          summary: `${MCP_PATH} suspiciously small (${s.size}B)`,
          fix: 'Rebuild — `npm run clean && npm run build`.',
        };
      }
      return { id: 'mcp-sdk-presence', severity: 'PASS', summary: `${MCP_PATH} present (${s.size}B)` };
    } catch {
      return {
        id: 'mcp-sdk-presence',
        severity: 'FAIL',
        summary: `${MCP_PATH} not found`,
        fix: 'Run `npm run build`.',
      };
    }
  },
};
