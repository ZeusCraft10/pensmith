// bin/lib/revise-swap.ts — shared proposeSwap factory (GEN-02 / Phase 11).
//
// D-06 LOCKED: both bin/cli/plan.ts (`plan --revise` path) and bin/cli/revise.ts
// import proposeSwap from this module. There is ONE real implementation that calls
// complete() with the hash-pinned 'revise-swap' prompt. The old per-file
// `tier2ProposeSwap` stubs (deterministic remove, no LLM) are deleted in Phase 11.
//
// Architecture:
//   - proposeSwap(vars) builds the request with buildPromptRequest (D-18-03):
//     the fixed template as the system prompt (the cacheable prefix, RUN-26)
//     and one data message — `flag`, `voice`, then the fenced
//     `available_sources` (the section's assigned sources with their library
//     title, authors and year) and the fenced `claim` (FEED-05) — and calls
//     complete(). Under PENSMITH_NO_LLM complete() answers with the revise-swap
//     text stub (llm-text-stubs.ts): a valid mechanical-removal recommendation
//     for the flagged citekey, so Tier 2 without a model reaches the same
//     terminal state (citation removed) as before (D-06, D-24).
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

import { complete } from './anthropic.js';
import { buildPromptRequest, requestHints, type PromptJson, type PromptRequest } from './prompt-request.js';
import { tryLoadLibrary, type LibraryEntry } from './library.js';
import { projectRoot } from './paths.js';
import type { ReviseSwapVars } from './revise.js';

/**
 * The assigned citekeys of `vars.available_sources` (runRevise renders them one
 * per line as `- <citekey>`), in order, deduplicated.
 */
export function availableCitekeys(availableSources: string): string[] {
  const out: string[] = [];
  for (const line of availableSources.split(/\r?\n/)) {
    const m = /^\s*-\s*([^\s—]+)/.exec(line);
    const key = m?.[1];
    if (key !== undefined && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * The revise-swap request (18-PLAN.md §3.3). `library` supplies each assigned
 * source's title, authors (at most five) and year, built field by field so the
 * bytes are deterministic; a citekey the library does not hold is sent with
 * nulls (the membership guard, not the metadata, decides what may be swapped in).
 */
export function reviseSwapRequest(vars: ReviseSwapVars, library: readonly LibraryEntry[]): PromptRequest {
  const byKey = new Map(library.map((e) => [e.citekey, e]));
  const available: PromptJson[] = availableCitekeys(vars.available_sources).map((citekey) => {
    const e = byKey.get(citekey);
    return { citekey, title: e?.title ?? null, authors: (e?.authors ?? []).slice(0, 5), year: e?.year ?? null };
  });
  return buildPromptRequest('revise-swap', {
    flag: { flagged_citekey: vars.flagged_citekey, verifier_reason: vars.verifier_reason },
    voice: vars.voice_hint,
    available_sources: available,
    claim: vars.claim_context,
  });
}

/** The paper's library entries, or none when it has no (readable) LIBRARY.json. */
async function libraryEntries(): Promise<LibraryEntry[]> {
  try {
    return (await tryLoadLibrary(projectRoot()))?.entries ?? [];
  } catch {
    // An unreadable library only costs the model the titles; the swap is still
    // guarded by assigned_sources membership in runRevise.
    return [];
  }
}

/**
 * Real proposeSwap — builds the revise-swap request and calls complete().
 * Returns the raw model text (strict-JSON).
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
  const request = reviseSwapRequest(vars, await libraryEntries());
  const result = await complete({
    slug: 'revise-swap',
    system: request.system,
    messages: request.messages,
    stubHint: requestHints(request),
  });
  // Return the raw text — runRevise owns parse + membership guard.
  return result.text;
}
