// mcp/server.ts
//
// Entrypoint: stdio MCP server for Pensmith Tier 1.
//
// D-02: SDK pinned at @modelcontextprotocol/sdk@^1.29 (NOT v2-alpha).
// TIER-01 + TIER-02 + D-13: exactly 5 resources + 6 tools (registered via the helpers below).
// D-07/Pitfall 7: NEVER console.log in this file — corrupts stdio MCP frame.
//                 Use process.stderr.write or the session-log if diagnostics needed.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { registerPaperResources } from './resources.js';
import { registerPaperTools } from './tools.js';
import { paperDir } from '../bin/lib/paths.js';

// cross-AI cycle-2 HIGH #4 fix: resolve paperRoot ONCE at boot time and
// close it over the resource handlers. The CLI launcher and the 02-07
// tier-contract test both spawn this server as a subprocess; the test
// sets PENSMITH_PAPER_ROOT=<temp dir> so paper://state / paper://outline /
// paper://section / paper://library all read from the same tmp dir the
// tool calls write to. Without this thread-through, paper://state would
// silently read from the HOST process CWD and Case C's idempotency check
// would compare unrelated state documents.
export function buildServer(paperRoot: string): McpServer {
  const server = new McpServer({
    name: 'pensmith',
    version: '0.2.0',
  });
  registerPaperResources(server, paperRoot);
  registerPaperTools(server);
  return server;
}

export async function main(): Promise<void> {
  // Boot-time paperRoot resolution: PENSMITH_PAPER_ROOT env var wins;
  // fallback is paperDir() (which respects the CLI's own paperRoot rules
  // — typically the CWD). Resolving ONCE here means the resource handlers
  // never need to call paperDir() with no args (which previously caused
  // HIGH #4: handler would target the host CWD instead of the temp root).
  const envRoot = process.env.PENSMITH_PAPER_ROOT;
  const paperRoot = envRoot && envRoot.length > 0 ? envRoot : paperDir();
  const server = buildServer(paperRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// CLI-style invocation: `node dist/mcp/server.js` boots and connects.
// Guarded so importing this module from tests does NOT auto-boot.
// Rule 1 fix: use pathToFileURL to resolve process.argv[1] to a file: URL
// before comparing — naive `file://${process.argv[1]}` fails on Windows when
// the caller passes a relative path (argv[1]='dist/mcp/server.js' yields
// 'file://dist/mcp/server.js' which never matches the absolute import.meta.url).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
