// mcp/tools.ts
//
// TIER-02 + D-13: 6 Phase-2 state-mutation tools + 3 Phase-3 per-section
// verb tools (Plan 03-07 Task 7.3) — total 9 tools:
//   Phase 2: paper_init_section, paper_advance_section,
//            paper_record_verification, paper_set_status,
//            paper_doi_verify, paper_capability_probe
//   Phase 3: pensmith_plan, pensmith_write, pensmith_verify (Tier 1
//            equivalent of the Tier 2 CLI per-section verbs)
// D-08: each handler body ≤30 stmts (AST-asserted in tests/mcp-server-thin-shim.test.ts).
// D-06 / Pitfall 2: inputSchema is a flat record { field: z.<type>() } — the SDK
//       wraps the record in z.object() internally. Passing z.object({...}) makes
//       the schema double-wrapped and tool args arrive as { value: {...} }.
//
// No console.* allowed (D-07 / Pitfall 7 — corrupts stdio MCP frame).
//
// Tier-1 ↔ Tier-2 equivalence (D-17 contract): the 3 Phase-3 handlers
// import the same bin/cli/{plan,write,verify}.ts CommandDef objects the
// CLI dispatcher uses, then invoke their run() with the args translated
// from MCP input. There is exactly one implementation per verb (no
// shell-out, no copy-paste). tests/tier-contract.test.ts plan-section /
// write-section / verify-section cases enforce this.

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

/**
 * Phase 3 Plan 03-07 Task 7.3 — runVerbDirect helper.
 *
 * Loads a citty CommandDef via dynamic import and invokes its `run` with the
 * given verb args. The cast through `unknown` is load-bearing — each
 * CommandDef has a verb-specific ArgsDef (citty's ParsedArgs<...> is invariant
 * over the args object shape), so the MCP-side args object cannot be
 * structurally typed to satisfy every CommandDef's ParsedArgs. The runtime
 * shape is what matters: citty resolves args positionally by name.
 *
 * Each handler that calls this helper stays well under the ARCH-18 30-stmt
 * budget (`tests/mcp-server-thin-shim.test.ts` AST-counts handler bodies).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommandDef = { run?: (ctx: any) => any };
async function runVerbDirect(
  load: () => Promise<AnyCommandDef>,
  args: Record<string, unknown>,
): Promise<unknown> {
  const cmd = await load();
  if (typeof cmd.run !== 'function') {
    throw new Error('runVerbDirect: loaded CommandDef has no run() — was a stub returned?');
  }
  // citty's ctx shape is { args, rawArgs, cmd, subCommand? }. We don't have
  // rawArgs from the MCP path (no shell tokenization happened), so pass an
  // empty array — verb run() implementations don't read rawArgs in Phase 3.
  return cmd.run({ args, rawArgs: [], cmd } as unknown as Parameters<NonNullable<typeof cmd.run>>[0]);
}

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

  // ===========================================================================
  // Phase 3 Plan 03-07 Task 7.3 — 3 per-section verb tools (Tier 1 equivalent).
  // ===========================================================================
  // Each handler imports the SAME bin/cli/<verb>.ts CommandDef the Tier 2 CLI
  // dispatcher uses, then invokes its run() with args translated from MCP input.
  // tests/tier-contract.test.ts plan-section / write-section / verify-section
  // cases enforce equivalence (±20% length tolerance per TIER-07).
  //
  // ARCH-18 statement budget: each handler body ≤30 statements
  // (AST-checked in tests/mcp-server-thin-shim.test.ts).

  // Tool 7: pensmith_plan — Tier 1 equivalent of `pensmith plan <N>`.
  server.registerTool(
    'pensmith_plan',
    {
      title: 'Generate a per-section PLAN.md',
      description: 'Tier 1 equivalent of `pensmith plan <N>`. Imports bin/cli/plan.ts default export.',
      inputSchema: {
        n: z.number().int().min(1),
        slug: z.string().optional(),
        revise: z.boolean().optional(),
        yolo: z.boolean().optional(),
      },
    },
    async ({ n, slug, revise, yolo }) => {
      const result = await runVerbDirect(
        () => import('../bin/cli/plan.js').then((m) => m.default),
        { n: String(n), slug: slug ?? '', revise: revise ?? false, yolo: yolo ?? false },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 8: pensmith_write — Tier 1 equivalent of `pensmith write [<N>]`.
  // n is optional: omit for wave-mode (all sections); provide for single-section.
  server.registerTool(
    'pensmith_write',
    {
      title: 'Draft section DRAFT.md(s)',
      description: 'Tier 1 equivalent of `pensmith write [<N>]`. Without n, schedules all planned sections into waves (Plan 04-03 wave-mode). With n, drafts a single section.',
      inputSchema: {
        n: z.number().int().min(1).optional(),
        slug: z.string().optional(),
        yolo: z.boolean().optional(),
        maxParallel: z.number().int().min(1).optional(),
      },
    },
    async ({ n, slug, yolo, maxParallel }) => {
      const args: Record<string, unknown> = { yolo: yolo ?? false };
      if (n !== undefined) {
        args['n'] = String(n);
        args['slug'] = slug ?? '';
      }
      if (maxParallel !== undefined) {
        args['maxParallel'] = String(maxParallel);
      }
      const result = await runVerbDirect(
        () => import('../bin/cli/write.js').then((m) => m.default),
        args,
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool 9: pensmith_verify — Tier 1 equivalent of `pensmith verify <N>`.
  server.registerTool(
    'pensmith_verify',
    {
      title: 'Verify a section DRAFT.md (deterministic Pass-1 + Pass-3)',
      description: 'Tier 1 equivalent of `pensmith verify <N>`. Imports bin/cli/verify.ts default export.',
      inputSchema: {
        n: z.number().int().min(1),
        slug: z.string().optional(),
        yolo: z.boolean().optional(),
      },
    },
    async ({ n, slug, yolo }) => {
      const result = await runVerbDirect(
        () => import('../bin/cli/verify.js').then((m) => m.default),
        { n: String(n), slug: slug ?? '', yolo: yolo ?? false },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
