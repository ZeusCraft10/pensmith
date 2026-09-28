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
// Phase 11 (GEN-02 / GEN-06): the local deterministic-remove proposeSwap stub is REMOVED.
// The shared real proposeSwap from bin/lib/revise-swap.ts calls complete() with
// the hash-pinned 'revise-swap' prompt. A fail-loud probe fires BEFORE runRevise:
// assertLlmConfigured('revise') (RUN-07) throws a one-line MissingApiKeyError
// ('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure a local
// endpoint)') that the dispatcher prints before exiting non-zero; runRevise is
// never called. Under PENSMITH_NO_LLM=1 the probe is a no-op and complete()
// returns the deterministic stub. The membership guard in runRevise
// (T-04-14 / T-11-09) is untouched.

import { defineCommand } from 'citty';
import { runRevise } from '../lib/revise.js';
import { runSectionResearch } from '../lib/section-research.js';
import { projectRoot } from '../lib/paths.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { assertLlmConfigured } from '../lib/anthropic.js';
import { resolveSectionArg } from '../lib/section-slug.js';

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
      description: 'Section slug (lowercase-kebab; defaults to the outline\'s slug for <n>).',
    },
    research: {
      type: 'string',
      description: 'Search for more sources for this section and add the ones you approve to its assigned sources (GRND-17).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate and auto-accept (retry cap 2 → RETRY_EXHAUSTED).',
      default: false,
    },
  },
  async run({ args }) {
    const rawN = (args.n ?? args.section) as string | number | undefined;
    // RUN-09: the same <n>/--slug validation as plan/write/verify (EXIT_USAGE),
    // and the slug comes from OUTLINE.md — 'placeholder' only with no outline.
    const { n, slug } = resolveSectionArg('revise', projectRoot(), rawN, args.slug);
    const research = typeof args.research === 'string' && args.research.trim().length > 0 ? args.research : undefined;

    // GRND-17 / D-19-18: `--research <query>` is the section-scoped research
    // pass `plan N --research` runs (bin/lib/section-research.ts): real hits,
    // added to section N only. A research-only call stops there.
    if (research) {
      return { mode: 'research', ...(await runSectionResearch({ root: projectRoot(), n, slug, query: research, yolo: args.yolo === true, verb: 'revise' })) };
    }

    // GEN-06 / RUN-07 fail-loud probe: assert an LLM is configured BEFORE calling runRevise.
    await assertLlmConfigured('revise');

    const result = await runRevise({
      paperRoot: projectRoot(),
      n,
      slug,
      yolo: args.yolo === true,
      // Real proposeSwap from bin/lib/revise-swap.ts (GEN-02).
      // runRevise owns parsing the returned JSON + the membership guard that
      // rejects any replacement_citekey ∉ assigned_sources (T-04-14 / T-11-09).
      proposeSwap,
    });

    process.stdout.write(`pensmith revise: ${result.message}\n`);
    return { ok: !result.retryExhausted, ...result };
  },
});

export default reviseCommand;
