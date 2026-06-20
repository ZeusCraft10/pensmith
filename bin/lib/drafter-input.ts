// bin/lib/drafter-input.ts — Strict drafter-input contract (WRTE-01, WRTE-04, T-3-10).
//
// The drafter prompt receives ONLY this exact shape — any extra field
// throws to prevent opportunistic information leakage into the model's
// context (T-3-10 mitigation, WRTE-04 chokepoint).
//
// CYCLE-2 H-2 REVIEWS CONVERGENCE (D-14 author shape lock):
// The optional `authors` field is `z.array(z.string())`, NEVER
// `z.array(z.object({ family, given }))`. This matches SourceCandidate.authors
// (Plan 03-03 Task 3.1) and every adapter toCandidate (Plan 03-04 Task 4.2/4.3).
// firstAuthorSurname from Plan 01's bin/lib/author-normalize.ts parses each
// "Family, Given" string back into surname for matching.
//
// Wave 0 contract — `tests/drafter-input.test.ts` exercises the minimum
// allowed top-level fields: { planPath, sources, wordTarget, voiceHint }.
// The Phase 3 plan adds richer optional context (sectionNumber, sectionSlug,
// sectionTitle, brief, assignedSources, outlinePrev, outlineNext, authors)
// that flesh out the drafter-input contract for the section-drafter prompt
// without breaking the Wave 0 schema. `.strict()` guards against the
// chokepoint: any caller-injected field outside the allow-list throws.

import { z } from 'zod';

/**
 * Strict drafter-input schema.
 *
 * Allowed top-level fields (every other field => throws):
 *   - planPath:        path to the section PLAN.md the drafter is implementing
 *   - sources:         array of citekeys (string identifiers) assigned to this section
 *   - wordTarget:      positive integer word-count goal
 *   - voiceHint:       freeform style hint (formal / informal / discipline-keyed)
 *
 * Optional richer fields (Phase 3 plan additions — all schema-validated):
 *   - sectionNumber:   1-based section index
 *   - sectionSlug:     bare lowercase-kebab slug matching /^[a-z0-9-]+$/
 *   - sectionTitle:    human-readable title
 *   - brief:           1-2 sentence section purpose summary
 *   - assignedSources: per-source metadata (citekey + title + authors + year + doi)
 *   - outlinePrev:     OPTIONAL previous-section outline context
 *   - outlineNext:     OPTIONAL next-section outline context
 *   - authors:         D-14 LOCKED author shape — z.array(z.string()) of "Family, Given"
 *   - styleProfilePath: STYL-03 (08-05) — ADDITIVE path to the paper's STYLE.json
 *                       (supplementary; voiceHint is the load-bearing signal)
 *
 * `.strict()` is the load-bearing chokepoint: it converts extra top-level
 * fields from a silent no-op (Zod default for unknown keys is "strip") into
 * a parse-time throw. T-3-10 mitigation = "drafter never sees fields the
 * caller did not explicitly contract for".
 */
export const DrafterInputSchema = z.object({
  planPath: z.string().min(1),
  sources: z.array(z.string()),
  wordTarget: z.number().int().positive(),
  voiceHint: z.string(),
  // Optional Phase 3 richer-context fields (validated when present):
  sectionNumber: z.number().int().min(1).optional(),
  sectionSlug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  sectionTitle: z.string().optional(),
  brief: z.string().optional(),
  assignedSources: z.array(z.object({
    citekey: z.string(),
    title: z.string(),
    // CYCLE-2 H-2 D-14 author shape lock — authors: z.array(z.string()),
    // NEVER z.array(z.object({family, given})). Matches SourceCandidate.authors.
    authors: z.array(z.string()),
    year: z.number().int().nullable(),
    doi: z.string().nullable(),
  })).optional(),
  outlinePrev: z.string().optional(),
  outlineNext: z.string().optional(),
  // D-14 LOCKED — authors: z.array(z.string()), NEVER z.array(z.object({family, given})).
  authors: z.array(z.string()).optional(),
  // STYL-03 (Phase 8 / 08-05) — ADDITIVE optional path to the paper's
  // STYLE.json. voiceHint remains the LOAD-BEARING style signal the drafter
  // consumes; styleProfilePath is supplementary, letting a capable Tier-1
  // drafter fetch the raw pure-stats profile JSON when it wants more than the
  // rendered hint. No existing field is touched and `.strict()` still throws on
  // any unknown field (T-08-05-01 — the WRTE-04 / T-3-10 chokepoint is intact).
  styleProfilePath: z.string().optional(),
}).strict();

export type DrafterInput = z.infer<typeof DrafterInputSchema>;

/**
 * Validate a drafter input. THROWS on:
 *   - extra top-level fields (`.strict()` chokepoint — WRTE-04, T-3-10)
 *   - missing required field
 *   - wrong type
 *
 * Closes T-3-10: prevents wider scope info from leaking into the drafter
 * via opportunistic field-passing.
 *
 * @throws {ZodError} with a path that names the offending field.
 */
export function assertDrafterInput(input: unknown): asserts input is DrafterInput {
  DrafterInputSchema.parse(input);
}
