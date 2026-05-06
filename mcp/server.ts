// Phase 0 stub: empty MCP server. Resources land in Phase 2 (TIER-01).
// Source: @modelcontextprotocol/sdk basic stdio server pattern.
// We do NOT install the SDK at Phase 0 — the file is a placeholder that
// satisfies REPO-03 (the .mcp.json reference resolves to a real file when
// `npm run build` produces dist/mcp/server.js).
//
// Phase 0 acceptance: `tsc --noEmit` succeeds against this file.
// Phase 0 does NOT require the server to actually start.

export {}; // makes this a module under verbatimModuleSyntax
