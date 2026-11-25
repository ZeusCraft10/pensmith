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
// NOTE: this probe composes its OWN `configured && !!key` check inline
// rather than calling the adapter's key-only isZoteroAuthenticated() (which is
// decoupled from FS-presence per the H3 fix). The coupling is intentional: the
// probe must distinguish ABSENT from CONFIGURED_NO_AUTH to report REAL state.

import type { Probe, ProbeResult } from '../probes.js';
import { zoteroMcpScan } from '../../ecosystem-presence.js';

// T-01-07: the env-var NAME (never its value) is the only key-derived token that
// ever reaches probe output.
const API_KEY_ENV = 'ZOTERO_API_KEY';

// The zotero-mcp adapter returns [] unless a test-only client is injected, so
// research does not read from Zotero in this alpha. Every outcome says so, and
// none may imply Zotero is a research source.
const NOT_A_SOURCE_YET = 'research does not read from Zotero yet in this alpha';

export const zoteroMcpPresenceProbe: Probe = {
  id: 'zotero-mcp-presence',
  async run(): Promise<ProbeResult> {
    // CR-01: share the FS-presence detection with bin/lib/capabilities.ts via
    // ecosystem-presence.ts so both tiers report the same boolean. Tri-state:
    //   configured     = Zotero MCP server in a Claude Code MCP config.
    //   authenticated  = configured AND ZOTERO_API_KEY present (boolean-only).
    // `checked` is where Claude Code keeps MCP server configs, shown in the
    // WARN `detail` so users see where we looked.
    const { checked, present: configured } = zoteroMcpScan();
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
        summary: `Zotero MCP server not configured (optional; ${NOT_A_SOURCE_YET}).`,
        detail: `Checked: ${checked.join(', ')}`,
        fix: 'Add a Zotero MCP server to Claude Code (`claude mcp add`), then set ZOTERO_API_KEY.',
      };
    }

    if (!authenticated) {
      // CONFIGURED_NO_AUTH — RESEARCH Pitfall 6. Keeps 'Checked:' in detail and
      // emits only the env-var NAME (never the value).
      return {
        id: 'zotero-mcp-presence',
        severity: 'WARN',
        summary: `Zotero MCP configured but ${API_KEY_ENV} not set (optional; ${NOT_A_SOURCE_YET}).`,
        detail: `Checked: ${checked.join(', ')}. ${API_KEY_ENV} not found in env.`,
        fix: `Set ${API_KEY_ENV} in your environment if your Zotero MCP server needs it.`,
      };
    }

    return {
      id: 'zotero-mcp-presence',
      severity: 'PASS',
      summary: `Zotero MCP server configured; ${NOT_A_SOURCE_YET}.`,
    };
  },
};
