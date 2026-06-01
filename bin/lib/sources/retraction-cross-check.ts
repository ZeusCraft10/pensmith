// bin/lib/sources/retraction-cross-check.ts — D-15 surface-twice helper.
//
// CR-02 fix (REVIEW.md Phase 3): every primary adapter constructs
// SourceCandidate with `retracted: false` hard-coded. The research workflow
// documents a "cross-check via Retraction Watch → set retracted: true" pass,
// but no module did the mutation. As a result, retracted DOIs flowed through
// to bin/lib/bibtex-write.ts which only emits `note = "RETRACTED"` when
// `c.retracted === true` — silently dropping retraction-status between
// research and verify.
//
// This module closes that loop. The research orchestrator
// (bin/cli/research.ts) calls `crossCheckRetractions(candidates)` AFTER the
// adapter discovery pass and BEFORE LIBRARY.json is persisted. For each
// candidate with a DOI, we call `sources['retraction-watch'].fetchById(doi)`.
// A non-null result means the DOI is on the Retraction Watch list — we
// mutate the candidate to set `retracted: true` and copy across
// `retraction_details` (per the D-14 schema field).
//
// D-15 LOCKED: we MUST call fetchById only. retraction-watch's index module
// intentionally exposes no `search` export; eslint backstops the rule.

import { sources } from './index.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

/**
 * Optional dependency injection seam — the production path uses the real
 * retraction-watch adapter; tests can inject a fake to avoid hitting the
 * network or relying on a specific cassette. Matches the signature of
 * `sources['retraction-watch'].fetchById`.
 */
export interface RetractionLookup {
  fetchById: (doi: string) => Promise<SourceCandidate | null>;
}

/**
 * For every candidate with a DOI, ask the retraction-watch adapter whether
 * that DOI is on the retraction list. If so, mutate the candidate to set
 * `retracted: true` and (when available) `retraction_details`.
 *
 * Mutates in place AND returns the same array for chainability.
 *
 * Failures from the retraction lookup are swallowed per-candidate — a
 * single transport hiccup must not lose the entire candidate batch.
 *
 * D-15: never calls `.search()` — retraction-watch is fetchById-only.
 */
export async function crossCheckRetractions(
  candidates: SourceCandidate[],
  lookup: RetractionLookup = sources['retraction-watch'],
): Promise<SourceCandidate[]> {
  for (const c of candidates) {
    if (!c.doi) continue;
    try {
      const hit = await lookup.fetchById(c.doi);
      if (hit && hit.retracted === true) {
        // Mutate the original candidate so the writer (bibtex-write.ts) and
        // the persisted LIBRARY.json both see `retracted: true`.
        (c as { retracted: boolean }).retracted = true;
        if (hit.retraction_details && !c.retraction_details) {
          (c as { retraction_details?: string }).retraction_details =
            hit.retraction_details;
        }
      }
    } catch {
      // Lookup failed for this DOI — leave the candidate untouched.
      // The verify-time Pass-1 has its own retraction recheck as the
      // last line of defense.
    }
  }
  return candidates;
}
