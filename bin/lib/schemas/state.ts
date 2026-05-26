// bin/lib/schemas/state.ts — state schema (Phase 1 foundation + Phase 3 amendments).
//
// Phase 1 scope (D-58): the state file at this stage is JUST a PROJECT.md
// scope marker — paperId + createdAt + the schema-version envelope.
//
// Phase 3 amendments (Plan 03-03 Task 3.1 / D-08 / D-09):
//   - CURRENT_STATE_VERSION bumped from 1 to 2.
//   - SectionEntrySchema slimmed to { n, slug } strict. Per-section state lives
//     in PLAN.md frontmatter from v2 onward (D-08). The slug field becomes
//     REQUIRED and must match /^[a-z0-9-]+$/ (T-3-12 path traversal mitigation).
//   - Top-level fields currentPhaseId / currentSection / currentSectionSlug
//     are no longer part of the schema — they are dropped by the v1→v2
//     migration (D-09).
//   - StateSchema.superRefine adds a refuse-forward guard: any disk-version
//     newer than CURRENT_STATE_VERSION (e.g. an unknown future v3) is rejected
//     with a clear message (ARCH-07).
//   - SectionStateSchema gains the 'unverifiable' literal (D-08-AMENDED — see
//     plan-frontmatter.ts and handoff.ts which mirror this enum).
//
// Per D-37 every persisted JSON file carries a top-level `$schemaVersion: number`.
// Per D-38 zod is the runtime-validation engine.
//
// The deprecated SectionStatusSchema and VerificationVerdictSchema are kept
// exported so the v1→v2 migration can reference them when mirroring v1 state
// into PLAN.md frontmatter.

import { z } from 'zod';

export const CURRENT_STATE_VERSION = 2;

// === Section state enum (D-08-AMENDED) ===
// Single source of truth for the section-state literal set. The
// 'unverifiable' value is set by the verify verb when Pass 3 cannot complete
// because no OA PDF could be fetched/parsed (distinct from 'failed' which
// means a fetched PDF's text did NOT match the quote).
//
// PlanFrontmatterSchema.status MIRRORS this enum (plan-frontmatter.ts);
// HandoffSchema.section_pointers[].state IMPORTS this enum (handoff.ts).
export const SectionStateSchema = z.enum([
  'planned', 'writing', 'written', 'verifying', 'verified', 'failed', 'unverifiable',
]);
export type SectionState = z.infer<typeof SectionStateSchema>;

// === Deprecated per-section status enum (Phase 1 carry-over) ===
// Kept for the v1→v2 migration to read v1 section entries. New code MUST NOT
// use this — section status lives in PLAN.md frontmatter from v2 onward.
export const SectionStatusSchema = z.enum([
  'pending', 'in-progress', 'blocked', 'done',
]);
export type SectionStatus = z.infer<typeof SectionStatusSchema>;

// === Deprecated verification verdict (Phase 1 carry-over) ===
// Same justification as SectionStatusSchema.
export const VerificationVerdictSchema = z.enum([
  'PASS', 'FAIL', 'PARTIAL', 'UNCLEAR',
]);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

// === SectionEntrySchema (v2 slim shape, D-08) ===
// Strict (no extra fields). Section state machinery (status / lastVerification)
// lives in the per-section PLAN.md frontmatter, NOT in STATE.json.
const SECTION_SLUG_RE = /^[a-z0-9-]+$/;
export const SectionEntrySchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().regex(SECTION_SLUG_RE).min(1),
}).strict();
export type SectionEntry = z.infer<typeof SectionEntrySchema>;

// === Core state schema ===
//
// We keep paperId / createdAt as REQUIRED (the Phase 1 contract). The
// $schemaVersion literal is bumped to CURRENT_STATE_VERSION (= 2).
//
// .passthrough() is intentional at the top level: the migration preserves
// extra top-level fields (per D-09 / property-test contract), and downstream
// plans may add typed fields without churning this base schema.
//
// Refuse-forward (ARCH-07): the loader (bin/lib/migrations/loader.ts) already
// throws ForwardIncompatError when diskVersion > currentVersion. We add a
// belt-and-suspenders schema-level guard via the literal($schemaVersion = 2)
// — any value other than 2 fails parse, and the loader's "missing migration"
// branch covers older-than-current versions before parse runs.
export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_STATE_VERSION),
  paperId: z.string().min(1),
  createdAt: z.string().datetime(),
  sections: z.array(SectionEntrySchema).optional(),
}).passthrough();

export type State = z.infer<typeof Schema>;

// === StatePatchSchema (derived, used by generic patch tools) ===
export const StatePatchSchema = Schema.partial();
export type StatePatch = z.infer<typeof StatePatchSchema>;
