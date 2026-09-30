// bin/lib/doctor/probes/mcp-sdk-presence.ts
//
// DOCT-01 wiring: MCP server artifact presence probe — the Tier-1 server the
// plugin manifest launches, the committed bundle plugin/dist/mcp/server.mjs
// (D-23a-04/05).
// D-15 severity: PASS if the bundle exists and is non-empty (>= 200B);
//   WARN if smaller than 200 bytes (stub); FAIL if missing or empty.
// D-19 read-only: statSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { statSync } from 'node:fs';
import { pluginMcpServerBundle, PLUGIN_MCP_SERVER_LABEL } from '../../paths.js';

// CR-02: resolve the bundle from the installed package, never from the process
// working directory (Tier 2 runs `pensmith doctor` from a user's paper folder).
// paths.ts (the one asset resolver, D-23a-03) finds the plugin from its own
// module location in a source checkout, dist/ and an npm install.
const MCP_REL = PLUGIN_MCP_SERVER_LABEL;
const MISSING_FIX = 'In a source checkout run `npm run bundle`; an npm install ships the bundle, so reinstall pensmith.';

export const mcpSdkPresenceProbe: Probe = {
  id: 'mcp-sdk-presence',
  async run(): Promise<ProbeResult> {
    try {
      const s = statSync(pluginMcpServerBundle());
      if (s.size === 0) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_REL} exists but is empty`,
          fix: MISSING_FIX,
        };
      }
      if (s.size < 200) {
        return {
          id: 'mcp-sdk-presence',
          severity: 'WARN',
          summary: `${MCP_REL} suspiciously small (${s.size}B)`,
          fix: MISSING_FIX,
        };
      }
      return { id: 'mcp-sdk-presence', severity: 'PASS', summary: `${MCP_REL} present (${s.size}B)` };
    } catch (err) {
      // IN-01: classify ENOENT vs EACCES so the fix hint matches the cause.
      // ENOENT → build is missing; EACCES → file exists but pensmith can't
      // read it (permission/ACL problem). Other errno values pass through so
      // they don't get misreported as "not found".
      const code = (err as NodeJS.ErrnoException).code;
      if (code === undefined) {
        // The asset resolver itself failed (no plugin/ above this module).
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_REL} not located: ${err instanceof Error ? err.message : String(err)}`,
          fix: 'Reinstall pensmith, or restore plugin/ in a source checkout.',
        };
      }
      if (code === 'EACCES') {
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_REL} permission denied (EACCES)`,
          fix: 'Check filesystem permissions on the install directory.',
        };
      }
      if (code && code !== 'ENOENT') {
        return {
          id: 'mcp-sdk-presence',
          severity: 'FAIL',
          summary: `${MCP_REL} stat failed (${code})`,
          fix: `Investigate; if the bundle is gone: ${MISSING_FIX}`,
        };
      }
      return {
        id: 'mcp-sdk-presence',
        severity: 'FAIL',
        summary: `${MCP_REL} not found`,
        fix: MISSING_FIX,
      };
    }
  },
};
