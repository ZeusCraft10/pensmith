// bin/lib/revise-swap.ts — shared proposeSwap factory (GEN-02 / Phase 11).
//
// D-06 LOCKED: both bin/cli/plan.ts (`plan --revise` path) and bin/cli/revise.ts
// import proposeSwap from this module. There is ONE real implementation that calls
// complete() with the hash-pinned 'revise-swap' prompt. The old per-file
// `tier2ProposeSwap` stubs (deterministic remove, no LLM) are deleted in Phase 11.
//
// Architecture:
//   - proposeSwap(vars) calls loadPrompt('revise-swap') + interpolate + complete(),
//     with ReviseSwapSchema as the answer's JSON Schema (structured output)
//   - returns the raw model text (the JSON the revise-swap prompt asks for)
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
import { ReviseSwapSchema, type ReviseSwapVars } from './revise.js';
import { modelJsonSchema } from './schemas/model-json.js';
import { promptFenced, promptText } from './untrusted-fence.js';

/**
 * System prompt for the revise-swap LLM call.
 * The revise-swap prompt already contains a detailed role, constraints, and
 * output format — the system prompt frames the model's overall posture.
 */
const REVISE_SWAP_SYSTEM =
  'You are an academic citation repair assistant. You will receive a ' +
  'verifier-flagged citation and the sources the section may cite, and you ' +
  'answer with the JSON object the prompt describes.';

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
 *   (vars: ReviseSwapVars, paperRoot?: string) => Promise<string>
 * The call's cost is capped and recorded on `paperRoot` (the cwd when absent).
 */
export async function proposeSwap(vars: ReviseSwapVars, paperRoot?: string): Promise<string> {
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

  // The citing sentence is the draft's text, written by a model that read
  // third-party abstracts, so it goes in fenced like the sources (which
  // runRevise rendered fenced already); the other values are stripped of
  // anything that could pass for a fence marker.
  const interpolated = interpolate(loadPrompt('revise-swap'), {
    flagged_citekey: promptText(vars.flagged_citekey),
    verifier_reason: promptText(vars.verifier_reason),
    claim_context: promptFenced(vars.claim_context),
    available_sources: vars.available_sources,
    voice_hint: promptText(vars.voice_hint),
  });
  const result = await complete({
    system: REVISE_SWAP_SYSTEM,
    messages: [{ role: 'user', content: interpolated }],
    role: 'revise',
    scope: 'task',
    scopeId: `revise-${vars.flagged_citekey}`,
    jsonSchema: modelJsonSchema(ReviseSwapSchema),
    ...(paperRoot !== undefined ? { paperRoot } : {}),
  });
  // Return the raw text — runRevise owns parse + membership guard.
  return result.text;
}
