// bin/lib/doctor/probes/zotero-mcp-presence.ts
//
// DOCT-02b / SRC-16 (D-19-24): can pensmith read the user's Zotero library?
// The probe id stays `zotero-mcp-presence` (references/doctor-output.md is
// locked); the summary always starts with `Zotero: `.
//
//   ZOTERO_API_KEY set  → an authenticated check through http.ts:
//                         `GET https://api.zotero.org/keys/current`
//                           200 → PASS  "Zotero: authenticated (…)"
//                           403 → WARN  "Zotero: key rejected (…)"
//                           other / transport → WARN "Zotero: not checked (…)"
//                           sources offline without a fixture → SKIP
//                             "Zotero: not checked (offline)"
//   PENSMITH_ZOTERO_LOCAL=1 (no key) → the Zotero 7 local API answers?
//                           PASS "Zotero: local API reachable" / WARN.
//   ZOTERO_GROUP_ID only → a public group library readable without a key?
//   otherwise           → WARN, "Zotero: MCP server detected — not
//                         authenticated for the CLI" when a Zotero MCP server
//                         is configured for Claude Code, else
//                         "Zotero: not detected".
// "authenticated" is never inferred from a key's presence. The detail always
// starts with `MCP server: detected …` / `MCP server: not detected` (the fact
// paper://capabilities reports as zotero_mcp — tier-contract Case A), then
// the config files checked.
//
// T-01-07 no-leak: the key VALUE never reaches any output — only the variable
// name. D-19 read-only: no writes (one GET at most).

import type { Probe, ProbeResult, Severity } from '../probes.js';
import { detectZoteroMcpServers, describeZoteroMcpSearch } from '../../ecosystem-presence.js';
import { isZoteroLocalEnabled, ZOTERO_LOCAL_ORIGIN } from '../../http.js';
import {
  checkZoteroKey,
  checkZoteroLibrary,
  zoteroConnection,
  ZOTERO_KEYS_URL,
  ZOTERO_WEB_ORIGIN,
  type ZoteroConnection,
} from '../../sources/zotero.js';

const ID = 'zotero-mcp-presence';
/** A Zotero MCP server for Claude Code (verified reachable when written, D-19-24). */
export const ZOTERO_MCP_SERVER_REPO = 'https://github.com/54yyyu/zotero-mcp';

const SETUP_FIX =
  `Optional — to use your Zotero library: set ZOTERO_API_KEY (create a read-only key at ${ZOTERO_KEYS_URL}), ` +
  'or enable the Zotero 7 local API (Settings → Advanced → "Allow other applications on this computer to communicate with Zotero") ' +
  `and set PENSMITH_ZOTERO_LOCAL=1. In Claude Code you can also add a Zotero MCP server, e.g. ${ZOTERO_MCP_SERVER_REPO}.`;

/** The detail is one line (the doctor renders it on one indented line), parts joined by "; ". */
function result(severity: Severity, summary: string, detail: string[], fix?: string): ProbeResult {
  return { id: ID, severity, summary, detail: detail.join('; '), ...(fix !== undefined ? { fix } : {}) };
}

async function keylessCheck(conn: ZoteroConnection, lines: string[], mcpDetected: boolean): Promise<ProbeResult> {
  const check = await checkZoteroLibrary(conn);
  const what = conn.mode === 'local' ? `local API (${ZOTERO_LOCAL_ORIGIN})` : `group library groups/${conn.groupId ?? ''} (no key)`;
  if (check.status === 'readable') {
    return result('PASS', `Zotero: ${conn.mode === 'local' ? 'local API reachable' : `group library ${check.library} readable`} — research can pull from it`, [...lines, `${what}: readable`]);
  }
  if (check.status === 'offline') {
    return result('SKIP', `Zotero: not checked (${check.reason})`, [...lines, `${what}: not checked (${check.reason})`]);
  }
  const fix =
    conn.mode === 'local'
      ? 'Start Zotero 7 and tick Settings → Advanced → "Allow other applications on this computer to communicate with Zotero".'
      : `A private group needs ZOTERO_API_KEY (create one at ${ZOTERO_KEYS_URL}); check ZOTERO_GROUP_ID.`;
  const also = mcpDetected ? ' (Claude Code research can still use the Zotero MCP server)' : '';
  return result('WARN', `Zotero: ${what} not readable — ${check.reason}${also}`, [...lines, `${what}: ${check.reason}`], fix);
}

export const zoteroMcpPresenceProbe: Probe = {
  id: ID,
  async run(): Promise<ProbeResult> {
    const detection = detectZoteroMcpServers();
    const mcpDetected = detection.servers.length > 0;
    const lines = [
      mcpDetected
        ? `MCP server: detected — ${detection.servers.map((s) => `"${s.name}" (${s.scope} scope, ${s.file})`).join('; ')}`
        : 'MCP server: not detected',
      describeZoteroMcpSearch(detection),
    ];

    let conn: ZoteroConnection | null;
    try {
      conn = zoteroConnection();
    } catch (e) {
      return result('WARN', `Zotero: not checked — ${(e as Error).message}`, lines, 'Set ZOTERO_GROUP_ID to the number in the group\'s URL (zotero.org/groups/<number>).');
    }

    if (process.env.ZOTERO_API_KEY?.trim()) {
      // An authenticated check — never inferred from the key's presence.
      const key = await checkZoteroKey();
      const web = `Web API: GET ${ZOTERO_WEB_ORIGIN}/keys/current`;
      switch (key.status) {
        case 'authenticated':
          return result(
            'PASS',
            `Zotero: authenticated (Web API, library ${conn?.groupId ? `groups/${conn.groupId}` : `users/${key.userId}`}${key.libraryAccess ? '' : '; the key has no library read access'})`,
            [...lines, `${web} → 200`],
            key.libraryAccess ? undefined : `Give the key "Allow library access" at ${ZOTERO_KEYS_URL}.`,
          );
        case 'rejected':
          return result('WARN', `Zotero: key rejected (HTTP ${key.httpStatus}) — ZOTERO_API_KEY is not a valid Zotero key`, [...lines, `${web} → ${key.httpStatus}`], `Create a key at ${ZOTERO_KEYS_URL} (read access to your library) and set ZOTERO_API_KEY to it.`);
        case 'offline':
          return result('SKIP', `Zotero: not checked (${key.reason})`, [...lines, `${web}: not sent (${key.reason})`]);
        case 'failed':
          return result('WARN', `Zotero: not checked (${key.reason})`, [...lines, `${web} → ${key.reason}`], 'Re-run `pensmith doctor` later; Zotero may be unreachable right now.');
        default:
          break;
      }
    }

    if (conn !== null && (isZoteroLocalEnabled() || conn.groupId !== null)) return keylessCheck(conn, lines, mcpDetected);

    if (mcpDetected) {
      return result(
        'WARN',
        'Zotero: MCP server detected — not authenticated for the CLI (Claude Code research can use the MCP server; the CLI needs ZOTERO_API_KEY or PENSMITH_ZOTERO_LOCAL=1)',
        lines,
        `For the CLI, set ZOTERO_API_KEY (${ZOTERO_KEYS_URL}) or enable the Zotero 7 local API and set PENSMITH_ZOTERO_LOCAL=1.`,
      );
    }
    return result('WARN', 'Zotero: not detected — research will not search your Zotero library (the scholarly sources are unaffected)', lines, SETUP_FIX);
  },
};
