// bin/cli/plan.ts — `pensmith plan <n>` verb entrypoint (PLAN-01).
//
// Phase 11 (GEN-02 / GEN-06): Wired to the Tier-2 LLM transport.
//   - The local deterministic-remove proposeSwap stub is REMOVED.
//   - The placeholder PLAN.md constant is REMOVED.
//   - A fail-loud probe fires at the top of run(): MissingApiKeyError →
//     stderr banner + exitCode=1 + ok:false. Never ok:true on missing key.
//   - The normal plan path calls complete() with the 'section-planner' prompt
//     (D-12 LOCKED slug) and writes the model output as a real PLAN.md.
//   - The --revise path imports the shared proposeSwap from bin/lib/revise-swap.ts
//     (ONE implementation; no duplication with revise.ts — GEN-02).
//
// D-12 LOCKED prompt slug: 'section-planner'.
// D-06 LOCKED chokepoint: --revise delegates to runRevise (bin/lib/revise.ts).
// T-11-09: runRevise's membership guard rejects replacement_citekey ∉ assigned_sources.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionPlan } from '../lib/paths.js';
import { runRevise } from '../lib/revise.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';

const DEFAULT_SLUG = 'placeholder';

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

    // GEN-06 fail-loud probe: assert a key is configured before doing any LLM work.
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
            `pensmith plan: ERROR — no LLM key configured.\n` +
            `Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n` +
            `Run inside Claude Code (Tier 1) for key-free operation.\n`,
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

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
        // Real shared proposeSwap from bin/lib/revise-swap.ts (GEN-02).
        // runRevise owns parsing the returned JSON + the membership guard that
        // rejects any replacement_citekey ∉ assigned_sources (T-04-14 / T-11-09).
        proposeSwap,
      });
      process.stdout.write(`pensmith plan --revise: ${result.message}\n`);
      return { ok: !result.retryExhausted, mode: 'revise', ...result };
    }

    // Normal plan path: call complete() with the 'section-planner' prompt
    // (D-12 LOCKED slug). The prompt expects {{section}}, {{candidateSources}},
    // {{topic}}, {{discipline}}, and {{upstreamPlans}}.
    // Phase 12 / GEN-03 will wire these vars from the real LIBRARY.json + OUTLINE.md.
    // For now (Phase 11 scope fence) we supply placeholder values that let complete()
    // succeed with the offline mock (PENSMITH_NO_LLM=1) and produce a real output
    // file (not a placeholder constant) that downstream verbs can read.
    const planPrompt = loadPrompt('section-planner');
    // Provide minimal var values; Phase 12 will populate from LIBRARY.json + OUTLINE.md.
    const interpolatedPlan = interpolate(planPrompt, {
      section: JSON.stringify({ number: n, slug, title: slug, depends_on: [], estimated_word_count: 400 }),
      candidateSources: '(no sources loaded yet — wire via Phase 12 / GEN-03)',
      topic: '(topic from INTAKE.md — wire via Phase 12)',
      discipline: 'other',
      upstreamPlans: '[]',
    });
    const targetPath = sectionPlan(n, slug);
    const result = await complete({
      system:
        'You are an academic section planner. Generate a PLAN.md document in the ' +
        'exact YAML frontmatter + ## Brief format specified in the prompt. ' +
        'Your output is the PLAN.md file content only — no prose outside the document.',
      messages: [{ role: 'user', content: interpolatedPlan }],
      scope: 'section',
      scopeId: `plan-${n}`,
    });
    await atomicWriteFile(targetPath, result.text);
    process.stdout.write(`pensmith plan: wrote PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath };
  },
});

export default planCommand;
