// bin/cli/plan.ts — `pensmith plan <n>` verb entrypoint (PLAN-01).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `section-planner` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb writes a
// placeholder `.paper/sections/<NN>-<slug>/PLAN.md` so downstream
// `write`/`verify` verbs have something to read.
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.

import { defineCommand } from 'citty';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionPlan } from '../lib/paths.js';
import { runRevise, type ReviseSwapVars } from '../lib/revise.js';

const TIER2_PLAN = [
  '---',
  'phase: section',
  'plan: 01',
  'type: section',
  "status: 'planned'",
  '---',
  '',
  '# Section Plan (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM planning. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
].join('\n');

const DEFAULT_SLUG = 'placeholder';

/**
 * Tier-2 placeholder proposeSwap for the `plan --revise` chokepoint. Identical
 * to bin/cli/revise.ts's seam: deterministic `remove` (no model transport wired
 * yet). The hash-pinned `revise-swap` prompt + a real model client supersede
 * this in a later phase.
 */
function tier2ProposeSwap(vars: ReviseSwapVars): Promise<string> {
  return Promise.resolve(JSON.stringify({
    action: 'remove',
    flagged_citekey: vars.flagged_citekey,
    replacement_citekey: null,
    rationale: 'Tier-2 placeholder: no model transport wired; recommending mechanical removal of the flagged citation.',
    patch: { before_excerpt: `[@${vars.flagged_citekey}]`, after_excerpt: '' },
  }));
}

export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'Generate a per-section PLAN.md (one section at a time). --revise repairs a verifier-flagged citation.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder" in Tier-2 mode).',
    },
    revise: {
      type: 'boolean',
      description: 'Repair a verifier-flagged citation (PLAN-02 — delegates to bin/lib/revise.ts::runRevise).',
      default: false,
    },
    research: {
      type: 'string',
      description: 'Section-scoped additional research query (PLAN-03 / D-09).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith plan: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);

    // PLAN-02 / D-05: `pensmith plan <N> --revise` (and `--research`) is the
    // canonical revise surface. Both route through the single runRevise
    // chokepoint (D-06) — identical to bin/cli/revise.ts. This keeps the locked
    // UX-02 16-verb set intact (no new top-level verb) while shipping WRTE-02.
    const research = typeof args.research === 'string' && args.research.length > 0 ? args.research : undefined;
    if (args.revise === true || research) {
      const result = await runRevise({
        paperRoot: process.cwd(),
        n,
        slug,
        yolo: args.yolo === true,
        ...(research ? { research } : {}),
        proposeSwap: tier2ProposeSwap,
      });
      process.stdout.write(`pensmith plan --revise: ${result.message}\n`);
      return { ok: !result.retryExhausted, mode: 'revise', ...result };
    }

    // Phase 3 Tier-2 fallback: see Plan 07 amendment.
    const targetPath = sectionPlan(n, slug);
    await atomicWriteFile(targetPath, TIER2_PLAN);
    process.stdout.write(`pensmith plan: wrote Tier-2 placeholder PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default planCommand;
