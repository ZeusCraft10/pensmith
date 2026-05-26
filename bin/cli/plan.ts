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

export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'Generate a per-section PLAN.md (one section at a time).',
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
      description: 'Revise an existing PLAN.md rather than create from scratch.',
      default: false,
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    // Phase 3 Tier-2 fallback: see Plan 07 amendment.
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith plan: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);
    const targetPath = sectionPlan(n, slug);
    await atomicWriteFile(targetPath, TIER2_PLAN);
    process.stdout.write(`pensmith plan: wrote Tier-2 placeholder PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default planCommand;
