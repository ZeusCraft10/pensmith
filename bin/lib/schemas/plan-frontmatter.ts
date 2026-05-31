// bin/lib/schemas/plan-frontmatter.ts — section PLAN.md frontmatter schema.
//
// Phase 3 Plan 03-03 Task 3.1 (D-04, D-08, D-10).
//
// PLAN.md is the source of truth for section state from v2 onward (D-08).
// This schema validates the YAML frontmatter of each per-section PLAN.md.
//
// Fields:
//   - section: 1-based section number.
//   - slug: kebab-case slug matching /^[a-z0-9-]+$/ (T-3-12 mitigation).
//   - title: human-readable title.
//   - depends_on: bare slugs (NOT directory basenames). Schema enforces
//                 no-self-reference (slug ∉ depends_on). No-cycles enforcement
//                 is runtime (in the plan loader / wave scheduler) since zod
//                 cannot cross-reference siblings during parse.
//   - assigned_sources: citekey strings (gen'd by bin/lib/citekey.ts).
//   - verified_against_draft_hash: string|null (D-10) — set by the verify
//     verb after Pass-3 OA PDF acceptance against this DRAFT.md's hash.
//   - status: section state enum, MIRRORS SectionStateSchema in state.ts
//             (D-08-AMENDED — includes 'unverifiable').
//   - last_verification: optional raw verdict object preserved by the v1→v2
//                        migration when sections carried embedded verdicts.
//   - was_current_at_migration: optional single-shot breadcrumb set by the
//                                v1→v2 migration when STATE.json had this
//                                section marked currentSection / currentSectionSlug.

import { z } from 'zod';

const SLUG = /^[a-z0-9-]+$/;

export const PlanFrontmatterSchema = z.object({
  section: z.number().int().min(1),
  slug: z.string().regex(SLUG),
  title: z.string(),
  depends_on: z.array(z.string().regex(SLUG)).default([]),
  assigned_sources: z.array(z.string()).default([]),
  wave: z.number().int().positive().optional(),
  verified_against_draft_hash: z.string().nullable().default(null),
  // D-08-AMENDED enum (mirrors SectionStateSchema in state.ts; HandoffSchema
  // imports SectionStateSchema directly to avoid a third lock-step copy).
  status: z.enum([
    'planned', 'writing', 'written', 'verifying', 'verified', 'failed', 'unverifiable',
  ]).default('planned'),
  // CYCLE-4 M-2: explicit optional field that admits the raw verdict object
  // written by the v1→v2 migration. z.unknown() (not .passthrough()) keeps
  // the rest of the schema strict-by-default while letting the forensics blob
  // round-trip through.
  last_verification: z.unknown().optional(),
  // CYCLE-5 M-1: sibling field. v1→v2 migration writes this boolean when the
  // v1 STATE.json marked the section as currentSection / currentSectionSlug.
  // Declared explicitly so strict-by-default zod parse does NOT silently
  // strip it on the next loadState round-trip.
  was_current_at_migration: z.boolean().optional(),
}).refine(
  (p) => !p.depends_on.includes(p.slug),
  { message: 'depends_on must not contain own slug (D-04 no-self-ref)' },
);
export type PlanFrontmatter = z.infer<typeof PlanFrontmatterSchema>;
