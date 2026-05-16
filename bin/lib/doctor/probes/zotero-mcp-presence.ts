// bin/lib/doctor/probes/zotero-mcp-presence.ts
//
// DOCT-02b: Zotero MCP server presence probe.
// D-15 severity: PASS when Zotero MCP configured in Claude MCP config;
//   WARN when missing (optional for Phase 3+ research/citation verbs).
// D-19 read-only: readFileSync only, no writes.

import type { Probe, ProbeResult } from '../probes.js';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Standard locations where Claude MCP server configs live.
// The exact set must be re-checked against the user's Claude version;
// probe is best-effort and treats absence as WARN, not FAIL.
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
    const paths = candidatePaths();
    const checked: string[] = [];
    for (const p of paths) {
      checked.push(p);
      if (!existsSync(p)) continue;
      try {
        const raw = readFileSync(p, 'utf8');
        // Parse defensively — config schema may differ across Claude versions.
        // We only care whether the word "zotero" appears as a server key/name.
        const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
        const servers = parsed.mcpServers ?? {};
        const names = Object.keys(servers);
        const match = names.find((n) => /zotero/i.test(n));
        if (match) {
          return {
            id: 'zotero-mcp-presence',
            severity: 'PASS',
            summary: `Zotero MCP configured (${match}) in ${p}`,
          };
        }
      } catch {
        // Malformed JSON — fall through and keep checking.
      }
    }
    return {
      id: 'zotero-mcp-presence',
      severity: 'WARN',
      summary: 'Zotero MCP server not configured — citations and research verbs (Phase 3+) will be offline-only.',
      detail: `Checked: ${checked.join(', ')}`,
      fix: 'See https://github.com/<zotero-mcp-org>/zotero-mcp for installation. Then add to your Claude MCP config.',
    };
  },
};
