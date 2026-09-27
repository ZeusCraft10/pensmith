// bin/lib/schemas/plan-frontmatter.ts — section PLAN.md frontmatter schema.
//
// Phase 3 Plan 03-03 Task 3.1 (D-04, D-08, D-10).
//
// PLAN.md is the source of truth for section state from v2 onward (D-08).
// This schema validates the YAML frontmatter of each per-section PLAN.md.
//
// Fields:
//   - schema_version: frontmatter version (CONF-04; CURRENT_PLAN_FRONTMATTER_VERSION).
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

/**
 * The PLAN.md frontmatter version this build writes and reads (CONF-04,
 * D-17-38). A file without `schema_version` is v0 and is migrated by
 * bin/lib/migrations/plan/v0_to_v1.ts through loadFrontmatterDoc
 * (bin/lib/frontmatter.ts); a newer file is refused with "upgrade pensmith".
 * Adding a field bumps this and ships vN_to_vN+1.ts in the same change (S-20).
 */
export const CURRENT_PLAN_FRONTMATTER_VERSION = 1;

export const PlanFrontmatterSchema = z.object({
  // CONF-04: the frontmatter version. Every writer stamps it
  // (updatePlanFrontmatter), and the loader migrates older files before this
  // schema sees them — the default only covers in-memory objects.
  schema_version: z.literal(CURRENT_PLAN_FRONTMATTER_VERSION).default(CURRENT_PLAN_FRONTMATTER_VERSION),
  section: z.number().int().min(1),
  slug: z.string().regex(SLUG),
  title: z.string(),
  depends_on: z.array(z.string().regex(SLUG)).default([]),
  assigned_sources: z.array(z.string()).default([]),
  // Phase 4 PLAN-02 / D-01: optional per-section wave override. When present,
  // the wave scheduler (bin/lib/scheduler.ts) validates it against
  // max(deps.computed_wave)+1 (PLAN-03) and promotes computed_wave to it.
  // NO default — `undefined` means "compute the wave via Kahn topo-sort".
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
