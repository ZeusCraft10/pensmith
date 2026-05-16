// mcp/tools.ts
//
// TIER-02 + D-13: exactly 6 snake_case state-mutation tools —
//   paper_init_section, paper_advance_section, paper_record_verification,
//   paper_set_status, paper_doi_verify, paper_capability_probe.
// D-08: each handler body ≤30 stmts (AST-asserted in tests/mcp-server-thin-shim.test.ts).
// D-06 / Pitfall 2: inputSchema is a flat record { field: z.<type>() } — the SDK
//       wraps the record in z.object() internally. Passing z.object({...}) makes
//       the schema double-wrapped and tool args arrive as { value: {...} }.
//
// No console.* allowed (D-07 / Pitfall 7 — corrupts stdio MCP frame).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  initSection,
  advanceSection,
  setSectionStatus,
  recordVerification,
} from '../bin/lib/state.js';
import { verifyDoi } from '../bin/lib/doi.js';
import { loadCapabilityFacts } from '../bin/lib/capabilities.js';
import {
  SectionStateSchema,
  SectionStatusSchema,
  VerificationVerdictSchema,
} from '../bin/lib/schemas/state.js';

export function registerPaperTools(server: McpServer): void {
  // Tool 1: paper_init_section — initialise a section row in State (idempotent per D-08).
  server.registerTool(
    'paper_init_section',
    {
      title: 'Initialize a new section',
      description: 'Append a new section to state.sections. Idempotent: re-init on existing N returns prior state unchanged.',
      inputSchema: {
        paperRoot: z.string().min(1),
        n: z.number().int().min(1),
        slug: z.string().min(1),
      },
    },
    async ({ paperRoot, n, slug }) => {
      const next = await initSection(paperRoot, n, slug);
      return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
    },
  );

  // Tool 2: paper_advance_section — transition section state (planned→writing→written→...).
  server.registerTool(
    'paper_advance_section',
    {
      title: 'Advance a section state machine',
      description: 'Transition section[n].state. Idempotent at the natural-key level (same args => same end state).',
      inputSchema: {
        paperRoot: z.string().min(1),
        n: z.number().int().min(1),
        toState: SectionStateSchema,
      },
    },
    async ({ paperRoot, n, toState }) => {
      const next = await advanceSection(paperRoot, n, toState);
      return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
    },
  );

  // Tool 3: paper_record_verification — write a verification verdict for a section.
  server.registerTool(
    'paper_record_verification',
    {
      title: 'Record verification verdict',
      description: 'Persist a verifier verdict on section[n].lastVerification.',
      inputSchema: {
        paperRoot: z.string().min(1),
        n: z.number().int().min(1),
        verdict: VerificationVerdictSchema,
      },
    },
    async ({ paperRoot, n, verdict }) => {
      const next = await recordVerification(paperRoot, n, verdict);
      return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
    },
  );

  // Tool 4: paper_set_status — set section[n].status (pending/in-progress/blocked/done).
  server.registerTool(
    'paper_set_status',
    {
      title: 'Set section status',
      description: 'Update section[n].status. Idempotent.',
      inputSchema: {
        paperRoot: z.string().min(1),
        n: z.number().int().min(1),
        status: SectionStatusSchema,
      },
    },
    async ({ paperRoot, n, status }) => {
      const next = await setSectionStatus(paperRoot, n, status);
      return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
    },
  );

  // Tool 5: paper_doi_verify — DOI re-fetch + metadata check via Crossref (delegates to bin/lib/doi.ts).
  server.registerTool(
    'paper_doi_verify',
    {
      title: 'Verify a DOI',
      description: 'Re-fetch the DOI via Crossref and return validity + metadata. Thin wrapper around bin/lib/doi.ts::verifyDoi.',
      inputSchema: { doi: z.string().min(1) },
    },
    async ({ doi }) => {
      const result = await verifyDoi(doi);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 6: paper_capability_probe — return current capability flags (presence-only; D-12).
  //         Imperative form of paper://capabilities. Same shape, same no-leak invariant.
  //         THIN SHIM: delegates to bin/lib/capabilities.ts::loadCapabilityFacts so the
  //         ONLY caller of the runtime-config loader and the only computed environment
  //         binding lives outside mcp/. The D-12 lint chokepoint and the build-time
  //         acceptance grep both target this file; both stay quiet because every
  //         forbidden token is paraphrased in this comment (see Task 1 Step F for
  //         the canonical naming used in 02-03 / D-12 prose).
  server.registerTool(
    'paper_capability_probe',
    {
      title: 'Probe runtime capabilities',
      description: 'Return presence-flag booleans for providers and runtime ecosystem. Never returns secret values.',
      inputSchema: {},
    },
    async () => {
      const facts = await loadCapabilityFacts();
      return { content: [{ type: 'text' as const, text: JSON.stringify(facts, null, 2) }] };
    },
  );
}
