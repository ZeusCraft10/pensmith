/*
 * pensmith — structured academic paper writing with verified citations
 * Copyright (C) 2026 Akhil Achanta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// mcp/server.ts
//
// Entrypoint: stdio MCP server for Pensmith Tier 1.
//
// D-02: SDK pinned at @modelcontextprotocol/sdk@^1.29 (NOT v2-alpha).
// TIER-01 + TIER-02 + D-13: exactly 5 resources + 6 tools (registered via the helpers below).
// D-07/Pitfall 7: NEVER console.log in this file — corrupts stdio MCP frame.
//                 Use process.stderr.write or the session-log if diagnostics needed.

// FIRST import: filters a dependency's DEP0040 (punycode) deprecation noise
// before any module that loads citation-js is evaluated (RUN-12).
import '../bin/lib/node-warnings.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPaperResources } from './resources.js';
import { registerPaperTools } from './tools.js';
import { servicePaperRoot, setActivePaperRoot } from '../bin/lib/paths.js';
import { migrateLegacyLayout } from '../bin/lib/state.js';
import { VERSION } from '../bin/lib/version.generated.js';

// cross-AI cycle-2 HIGH #4 fix: resolve paperRoot ONCE at boot time and
// close it over the resource handlers. The CLI launcher and the 02-07
// tier-contract test both spawn this server as a subprocess; the test
// sets PENSMITH_PAPER_ROOT=<temp dir> so paper://state / paper://outline /
// paper://section / paper://library all read from the same tmp dir the
// tool calls write to. Without this thread-through, paper://state would
// silently read from the HOST process CWD and Case C's idempotency check
// would compare unrelated state documents.
//
// RUN-13 (D-17-32): `paperRoot` is the PROJECT root — the folder that contains
// `.paper/` — exactly what the CLI resolves, so paper://state and `pensmith
// status` read the same `.paper/STATE.json`. buildServer also records it as the
// active root, so the pensmith_plan / pensmith_write / pensmith_verify tools
// (which run the CLI verbs in-process) work on the same paper.
export function buildServer(paperRoot: string): McpServer {
  setActivePaperRoot(paperRoot);
  const server = new McpServer({
    name: 'pensmith',
    // WR-01: VERSION is derived from package.json#version at prebuild time
    // (scripts/prebuild.mjs writes bin/lib/version.generated.ts). NEVER
    // inline a literal here — it will drift from npm's view of the package.
    version: VERSION,
  });
  registerPaperResources(server, paperRoot);
  registerPaperTools(server);
  return server;
}

function oneLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s*\r?\n\s*/g, ' ').trim() || 'unexpected error';
}

export async function main(): Promise<void> {
  // Boot-time paperRoot resolution (RUN-13 / D-17-33): PENSMITH_PAPER_ROOT,
  // else the working directory — the project root, never `.paper/` itself, and
  // never the `pensmith open` pointer (the MCP server does not follow it).
  // Resolving ONCE here means no handler re-derives it (HIGH #4). A pre-v1
  // root-level STATE.json/config.toml is moved into .paper/ first.
  const paperRoot = servicePaperRoot();
  try {
    await migrateLegacyLayout(paperRoot);
  } catch (e) {
    // RUN-12: an expected failure (two differing STATE.json copies) is one
    // stderr line, and the server still boots — every paper_* tool and
    // resource that reads STATE.json re-runs the move and reports the same
    // conflict as its own error, instead of the plugin losing every tool.
    process.stderr.write(`pensmith (mcp): ${oneLine(e)}\n`);
  }
  const server = buildServer(paperRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// CLI-style invocation: `node dist/mcp/server.js` boots and connects.
// Guarded so importing this module from tests does NOT auto-boot.
// RUN-10: isMainModule compares REALPATHS (relative argv[1], symlinked plugin
// roots, Windows junctions and case all resolve), so a symlinked install boots
// instead of exiting silently before `initialize` (T1-12).
import { isMainModule } from '../bin/lib/main-guard.js';
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    // Never an unhandled-rejection stack trace (RUN-12): one line, exit 1.
    process.stderr.write(`pensmith (mcp): could not start — ${oneLine(e)}\n`);
    process.exit(1);
  });
}
