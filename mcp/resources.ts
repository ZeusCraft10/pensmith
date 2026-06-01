// mcp/resources.ts
//
// TIER-01 + D-07 + D-13: exactly 5 paper:// resources —
//   paper://state, paper://outline, paper://section/{N}, paper://library, paper://capabilities.
// D-19: all resources are READ-ONLY (no writes from resource handlers).
// D-12: paper://capabilities emits PRESENCE FLAGS only — never a resolved
//       env value. THIN SHIM: handler delegates to
//       bin/lib/capabilities.ts::loadCapabilityFacts, which is the SINGLE
//       location authorised to combine the runtime-config loader and
//       computed env-presence checks into the capability shape. mcp/ MUST
//       NOT import that loader nor bind environment variables by computed
//       key — D-12 lint (from 02-03) catches both directly here.
// D-08: each handler body ≤30 statements (AST-counted in tests/mcp-server-thin-shim.test.ts).
// D-07/Pitfall 7: no console.* in this file — would corrupt stdio MCP frame.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadState } from '../bin/lib/state.js';
import { loadLibrary } from '../bin/lib/library.js';
import { loadOutline } from '../bin/lib/outline.js';
import { loadSection } from '../bin/lib/section.js';
import { loadCapabilityFacts } from '../bin/lib/capabilities.js';

// cross-AI cycle-2 HIGH #4 fix: registerPaperResources accepts an optional
// `paperRoot` so the server boot site (mcp/server.ts main()) can thread the
// root selected via PENSMITH_PAPER_ROOT (env) or the CWD default. Every
// resource handler closes over THIS paperRoot — no handler re-derives it
// by calling `paperDir()` with no args, which would silently target the
// host process CWD instead of the requested root. 02-07 Case C exercises
// this by spawning the server with PENSMITH_PAPER_ROOT=<temp dir> and
// asserting paper://state reflects writes made through the tools.
export function registerPaperResources(server: McpServer, paperRoot: string): void {
  // 1. paper://state — read-only state document
  server.registerResource(
    'state',
    'paper://state',
    { title: 'Paper state', description: 'Section status, milestones, verification flags.', mimeType: 'application/json' },
    async (uri) => {
      const state = await loadState(paperRoot);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(state, null, 2) }] };
    },
  );

  // 2. paper://outline — approved outline markdown
  server.registerResource(
    'outline',
    'paper://outline',
    { title: 'Paper outline', description: 'Approved outline markdown.', mimeType: 'text/markdown' },
    async (uri) => {
      const outline = await loadOutline(paperRoot);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: outline }] };
    },
  );

  // 3. paper://section/{N} — read-only per-section payload (TIER-01)
  server.registerResource(
    'section',
    new ResourceTemplate('paper://section/{n}', { list: undefined }),
    { title: 'Paper section', description: 'Per-section state + plan/draft/verification markdown.', mimeType: 'application/json' },
    async (uri, vars) => {
      const n = Number(vars.n);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`paper://section/{n}: invalid section number "${String(vars.n)}"`);
      }
      const payload = await loadSection(paperRoot, n);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  // 4. paper://library — citation library
  server.registerResource(
    'library',
    'paper://library',
    { title: 'Citation library', description: 'All cited works with DOI verification status.', mimeType: 'application/json' },
    async (uri) => {
      const library = await loadLibrary(paperRoot);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(library, null, 2) }] };
    },
  );

  // 5. paper://capabilities — presence-flag booleans ONLY (D-12 lint-enforced).
  //    THIN SHIM: delegates 100% to bin/lib/capabilities.ts::loadCapabilityFacts.
  //    This file (mcp/resources.ts) MUST NOT import the runtime-config loader
  //    and MUST NOT bind environment variables by computed key — D-12 lint
  //    enforces both. The helper performs the composition safely on the
  //    non-mcp side (T-01-07 symmetric defence).
  server.registerResource(
    'capabilities',
    'paper://capabilities',
    { title: 'Runtime capability flags', description: 'Presence flags only — NEVER resolved key values (D-12).', mimeType: 'application/json' },
    async (uri) => {
      const facts = await loadCapabilityFacts();
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(facts, null, 2) }] };
    },
  );
}
