// bin/cli/revise.ts — `pensmith revise --section N` verb (WRTE-02, PLAN-02/03).
//
// THIN ORCHESTRATOR: this verb delegates 100% to bin/lib/revise.ts::runRevise
// (the single Tier-1/Tier-2 chokepoint, D-06). No business logic lives here.
//
// Surface note (Plan 04-04): `revise` is NOT one of the locked UX-02 16 verbs
// (those are owned by bin/lib/verbs.ts and gated by tests/cli-verbs.test.ts +
// tests/workflows-keyequal.test.ts at exactly 16, bijective with workflows/).
// The canonical user-facing revise surface is `pensmith plan <N> --revise`
// (PLAN-02; workflows/plan.md step 7; the MCP pensmith_plan `revise` arg) which
// also delegates to runRevise — so both the standalone command exported here
// and the `plan --revise` path share the identical chokepoint. This file exists
// so the chokepoint has a citty CommandDef surface (and so future top-level
// promotion is a one-line dispatcher edit) without expanding the locked 16.
//
// LLM seam: bin/lib has no model-transport client yet (Tier-2 placeholder era —
// same stance as bin/cli/{plan,write}.ts). Under PENSMITH_NO_LLM (or when no
// transport is wired) the verb supplies a DETERMINISTIC Tier-2 proposeSwap that
// recommends `action: "remove"` — always membership-valid (no replacement
// needed) and reproducible, so both tiers reach the same terminal state. When a
// real model client lands, it replaces this seam with loadPrompt('revise-swap')
// + interpolate + the model call (the prompt is hash-pinned and ready).

import { defineCommand } from 'citty';
import { runRevise, type ReviseSwapVars } from '../lib/revise.js';

const DEFAULT_SLUG = 'placeholder';

/**
 * Tier-2 placeholder proposeSwap. Recommends a mechanical `remove` of the
 * flagged citation — deterministic and always membership-valid. The hash-pinned
 * `revise-swap` prompt + a real model transport supersede this in a later phase.
 */
function tier2ProposeSwap(vars: ReviseSwapVars): Promise<string> {
  return Promise.resolve(JSON.stringify({
    action: 'remove',
    flagged_citekey: vars.flagged_citekey,
    replacement_citekey: null,
    rationale: 'Tier-2 placeholder: no model transport wired; recommending mechanical removal of the flagged citation.',
    patch: {
      before_excerpt: `[@${vars.flagged_citekey}]`,
      after_excerpt: '',
    },
  }));
}

export const reviseCommand = defineCommand({
  meta: {
    name: 'revise',
    description: 'Swap or remove a verifier-flagged citation in one section (approval-gated).',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based). Alias: --section.',
      required: false,
      valueHint: '3',
    },
    section: {
      type: 'string',
      description: 'Section number (alias of the positional <n>).',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder").',
    },
    research: {
      type: 'string',
      description: 'Section-scoped additional research query (PLAN-03 / D-09).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate and auto-accept (retry cap 2 → RETRY_EXHAUSTED).',
      default: false,
    },
  },
  async run({ args }) {
    const rawN = (args.n ?? args.section) as string | number | undefined;
    const n = Number(rawN);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith revise: <n> (or --section) must be a positive integer; got ${JSON.stringify(rawN)}`);
    }
    const slug = args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG;
    const research = typeof args.research === 'string' && args.research.length > 0 ? args.research : undefined;

    const result = await runRevise({
      paperRoot: process.cwd(),
      n,
      slug,
      yolo: args.yolo === true,
      ...(research ? { research } : {}),
      // Tier-2 placeholder transport (PENSMITH_NO_LLM / no model client yet).
      proposeSwap: tier2ProposeSwap,
    });

    process.stdout.write(`pensmith revise: ${result.message}\n`);
    return { ok: !result.retryExhausted, ...result };
  },
});

export default reviseCommand;
