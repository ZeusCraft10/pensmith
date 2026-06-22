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
// if no API key is configured (and PENSMITH_NO_LLM=1 is not set), the verb
// prints a banner to stderr + sets exitCode=1 + returns ok:false without calling
// runRevise. The membership guard in runRevise (T-04-14 / T-11-09) is untouched.
//
// Key ordering (Pitfall 6): isNoLlmMode() inside complete() fires BEFORE
// getProviderApiKey — so PENSMITH_NO_LLM=1 bypasses MissingApiKeyError.
// The fail-loud probe here uses the same try/catch idiom as the other wired verbs
// (intake.ts, outline.ts, write.ts — Phase 11 plan 11-03).

import { defineCommand } from 'citty';
import { runRevise } from '../lib/revise.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';

const DEFAULT_SLUG = 'placeholder';

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

    // GEN-06 fail-loud probe: assert a key is configured BEFORE calling runRevise.
    // CRITICAL ordering (Pitfall 6): isNoLlmMode() inside complete() fires BEFORE
    // getProviderApiKey. When PENSMITH_NO_LLM=1 is set, complete() short-circuits to
    // the offline mock — MissingApiKeyError is never thrown. The probe here is ONLY
    // for the non-offline case: if no key and no offline mode, we fail loud.
    // NEVER log the resolved key value — T-11-12 / T-01-07.
    const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
    if (!noLlm) {
      try {
        // CR-01: resolve provider ID dynamically so OpenAI-only configs don't
        // false-positive with "no config for 'anthropic'". resolveProviderId()
        // is the single source of truth (shared with complete()).
        const providerId = await resolveProviderId();
        await getProviderApiKey(providerId);
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          process.stderr.write(
            `pensmith revise: ERROR — no LLM key configured.\n` +
            `Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n` +
            `Run inside Claude Code (Tier 1) for key-free operation.\n`,
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

    const result = await runRevise({
      paperRoot: process.cwd(),
      n,
      slug,
      yolo: args.yolo === true,
      ...(research ? { research } : {}),
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
