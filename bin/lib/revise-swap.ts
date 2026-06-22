// bin/lib/revise-swap.ts — shared proposeSwap factory (GEN-02 / Phase 11).
//
// D-06 LOCKED: both bin/cli/plan.ts (`plan --revise` path) and bin/cli/revise.ts
// import proposeSwap from this module. There is ONE real implementation that calls
// complete() with the hash-pinned 'revise-swap' prompt. The old per-file
// `tier2ProposeSwap` stubs (deterministic remove, no LLM) are deleted in Phase 11.
//
// Architecture:
//   - proposeSwap(vars) calls loadPrompt('revise-swap') + interpolate + complete()
//   - returns the raw model text (strict-JSON the revise-swap prompt asks for)
//   - runRevise (bin/lib/revise.ts) owns PARSING of that text + the membership guard
//     (T-04-14 / T-11-09 LLM-injection mitigations — no new citekeys ever enter DRAFT.md)
//
// The signature (vars: ReviseSwapVars) => Promise<string> matches the
// ReviseOptions.proposeSwap seam in bin/lib/revise.ts exactly.
//
// T-11-09 trust boundary: the returned text is UNTRUSTED model output. The
// caller (runRevise) must parse it with ReviseSwapSchema.safeParse and reject any
// replacement_citekey ∉ assigned_sources before applying any patch.
//
// No-leak property (T-11-12): the resolved API key VALUE is never logged here.
// complete() owns the no-leak header path; we never bind the key to any variable.

import { complete, isNoLlmMode } from './anthropic.js';
import { loadPrompt, interpolate } from './prompt-loader.js';
import type { ReviseSwapVars } from './revise.js';

/**
 * System prompt for the revise-swap LLM call.
 * The revise-swap prompt already contains a detailed role, constraints, and
 * output format — the system prompt frames the model's overall posture.
 */
const REVISE_SWAP_SYSTEM =
  'You are an academic citation repair assistant. You will receive a ' +
  'verifier-flagged citation and a list of available sources. Your output is ' +
  'strict JSON only — no prose, no markdown fences, no text outside the JSON ' +
  'object. Follow the schema exactly as specified in the prompt.';

/**
 * Real proposeSwap — loads the hash-pinned 'revise-swap' prompt, interpolates
 * vars, and calls complete(). Returns the raw model text (strict-JSON).
 *
 * CALLER RESPONSIBILITY: the returned string is raw LLM output. The caller
 * (runRevise in bin/lib/revise.ts) must parse with ReviseSwapSchema and enforce
 * the replacement_citekey ∈ assigned_sources membership guard (T-04-14 /
 * T-11-09) before applying any patch to DRAFT.md.
 *
 * Signature matches ReviseOptions.proposeSwap exactly:
 *   (vars: ReviseSwapVars) => Promise<string>
 */
export async function proposeSwap(vars: ReviseSwapVars): Promise<string> {
  // Offline short-circuit (PENSMITH_NO_LLM=1): return a deterministic valid
  // ReviseSwap JSON that recommends mechanical removal of the flagged citation.
  // This preserves the tier-contract parity test behavior: Tier-2 under
  // PENSMITH_NO_LLM=1 reaches the same terminal state (citation removed) as
  // it did with the old tier2ProposeSwap stub (D-06, D-24).
  // The real model path (below) is only reached when NOT in offline mode.
  if (isNoLlmMode()) {
    return JSON.stringify({
      action: 'remove',
      flagged_citekey: vars.flagged_citekey,
      replacement_citekey: null,
      rationale: 'Offline mode (PENSMITH_NO_LLM=1): deterministic mechanical removal of the flagged citation.',
      patch: {
        before_excerpt: `[@${vars.flagged_citekey}]`,
        after_excerpt: '',
      },
    });
  }

  const prompt = loadPrompt('revise-swap');
  // ReviseSwapVars keys match the {{...}} placeholders in the revise-swap prompt:
  //   {{flagged_citekey}}, {{verifier_reason}}, {{claim_context}},
  //   {{available_sources}}, {{voice_hint}}
  const interpolated = interpolate(prompt, vars as unknown as Record<string, string>);
  const result = await complete({
    system: REVISE_SWAP_SYSTEM,
    messages: [{ role: 'user', content: interpolated }],
    scope: 'task',
    scopeId: `revise-${vars.flagged_citekey}`,
  });
  // Return the raw text — runRevise owns parse + membership guard.
  return result.text;
}
