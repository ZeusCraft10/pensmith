// bin/lib/doctor/probes/zotero-mcp-presence.ts
//
// DOCT-02b: Zotero MCP server presence probe.
// D-15 severity: PASS when Zotero MCP configured in Claude MCP config;
//   WARN when missing (optional for Phase 3+ research/citation verbs).
// D-19 read-only: readFileSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { isZoteroMcpPresent } from '../../ecosystem-presence.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Standard locations where Claude MCP server configs live (kept here for
// the WARN-path `detail` text so users see where we looked).
function candidatePaths(): string[] {
  const home = homedir();
  return [
    join(home, '.claude', 'mcp_servers.json'),
    join(home, '.config', 'claude', 'mcp_servers.json'),
  ];
}

export const zoteroMcpPresenceProbe: Probe = {
  id: 'zotero-mcp-presence',
  async run(): Promise<ProbeResult> {
    // CR-01: share the detection algorithm with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers report the same boolean.
    if (isZoteroMcpPresent()) {
      return {
        id: 'zotero-mcp-presence',
        severity: 'PASS',
        summary: 'Zotero MCP configured in a known Claude MCP config location',
      };
    }
    return {
      id: 'zotero-mcp-presence',
      severity: 'WARN',
      summary: 'Zotero MCP server not configured — citations and research verbs (Phase 3+) will be offline-only.',
      detail: `Checked: ${candidatePaths().join(', ')}`,
      fix: 'See https://github.com/<zotero-mcp-org>/zotero-mcp for installation. Then add to your Claude MCP config.',
    };
  },
};
