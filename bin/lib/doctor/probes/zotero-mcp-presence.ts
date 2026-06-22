// bin/lib/doctor/probes/zotero-mcp-presence.ts
//
// DOCT-02b: Zotero MCP server presence probe — TRI-STATE auth check (RSCH-06).
// D-15 severity:
//   PASS  — Zotero MCP configured in Claude MCP config AND ZOTERO_API_KEY set.
//   WARN  — not configured (ABSENT), OR configured but ZOTERO_API_KEY not set
//           (CONFIGURED_NO_AUTH — RESEARCH Pitfall 6: configured-but-not-auth'd).
// D-19 read-only: readFileSync only, no writes.
//
// T-01-07 no-leak: the probe emits only the env-var NAME (ZOTERO_API_KEY) and a
// boolean-derived message — it NEVER interpolates process.env['ZOTERO_API_KEY']
// (the value) into any string.
//
// NOTE: this probe composes its OWN `isZoteroMcpPresent() && !!key` check inline
// rather than calling the adapter's key-only isZoteroAuthenticated() (which is
// decoupled from FS-presence per the H3 fix). The coupling is intentional: the
// probe must distinguish ABSENT from CONFIGURED_NO_AUTH to report REAL state.

import type { Probe, ProbeResult } from '../probes.js';
import { isZoteroMcpPresent } from '../../ecosystem-presence.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

// T-01-07: the env-var NAME (never its value) is the only key-derived token that
// ever reaches probe output.
const API_KEY_ENV = 'ZOTERO_API_KEY';

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
    // CR-01: share the FS-presence detection with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers report the same boolean. Tri-state:
    //   configured     = Zotero MCP server in a known Claude MCP config.
    //   authenticated  = configured AND ZOTERO_API_KEY present (boolean-only).
    const configured = isZoteroMcpPresent();
    // T-01-07: boolean presence ONLY — the value is never read into a variable
    // that could reach output. D-12: DOT-ACCESS env read (not a computed
    // process.env[var] index) keeps this probe inside the doctor-probe chokepoint
    // (only runtime-config-presence.ts may bind a computed env key — see
    // contact-email-presence.ts for the same dot-access pattern). The boolean
    // coercion discards the value immediately.
    const authenticated = configured && !!process.env.ZOTERO_API_KEY;

    if (!configured) {
      // ABSENT — keeps 'Checked:' in detail so the existing WARN-branch test holds.
      return {
        id: 'zotero-mcp-presence',
        severity: 'WARN',
        summary: 'Zotero MCP server not configured — citations and research verbs (Phase 3+) will be offline-only.',
        detail: `Checked: ${candidatePaths().join(', ')}`,
        fix: 'See https://github.com/<zotero-mcp-org>/zotero-mcp for installation. Then add to your Claude MCP config.',
      };
    }

    if (!authenticated) {
      // CONFIGURED_NO_AUTH — RESEARCH Pitfall 6. Keeps 'Checked:' in detail and
      // emits only the env-var NAME (never the value).
      return {
        id: 'zotero-mcp-presence',
        severity: 'WARN',
        summary: `Zotero MCP configured but ${API_KEY_ENV} not set — Zotero sources will be skipped.`,
        detail: `Checked: ${candidatePaths().join(', ')}. ${API_KEY_ENV} not found in env.`,
        fix: `Set ${API_KEY_ENV} in your environment so Zotero sources can be pulled during research.`,
      };
    }

    return {
      id: 'zotero-mcp-presence',
      severity: 'PASS',
      summary: 'Zotero MCP configured and authenticated',
    };
  },
};
