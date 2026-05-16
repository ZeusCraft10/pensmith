// bin/lib/schemas/state.ts — foundation-slice state schema (D-58).
//
// Phase 1 scope (D-58): the state file at this stage is JUST a PROJECT.md
// scope marker — paperId + createdAt + the schema-version envelope. The
// section state machine, wave scheduler bookkeeping, and per-section status
// fields are added in Phase 2 via a forward migration (state v1→v2 ships
// a no-op skeleton in this wave to prove the registry mechanism).
//
// Per D-37 every persisted JSON file carries a top-level `$schemaVersion: number`.
// Per D-38 zod is the runtime-validation engine.
//
// Export convention (revision-locked): the version constant is named
// CURRENT_STATE_VERSION (not a bare CURRENT_VERSION) so a single consumer
// file can `import { CURRENT_STATE_VERSION } from '../schemas/state.js';
// import { CURRENT_LIBRARY_VERSION } from '../schemas/library.js';` without
// a re-alias dance.

import { z } from 'zod';

export const CURRENT_STATE_VERSION = 1;

// === Phase 2 section enums (D-13 / TIER-02) ===
// These enums drive the 4 state-mutation helpers in bin/lib/state.ts.
// They are defined here (NOT in state.ts) so mcp/tools.ts can import them
// without pulling in the full file-I/O stack, staying within the D-09
// thin-shim constraint.

export const SectionStateSchema = z.enum([
  'planned', 'writing', 'written', 'verifying', 'verified', 'failed',
]);
export type SectionState = z.infer<typeof SectionStateSchema>;

export const SectionStatusSchema = z.enum([
  'pending', 'in-progress', 'blocked', 'done',
]);
export type SectionStatus = z.infer<typeof SectionStatusSchema>;

export const VerificationVerdictSchema = z.enum([
  'PASS', 'FAIL', 'PARTIAL', 'UNCLEAR',
]);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

// === SectionEntrySchema ===
// Inline section entry used by the mutation helpers. Kept loose (.passthrough())
// so Phase 3 migrations can add fields without a schema bump here.
export const SectionEntrySchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().min(1).optional(),
  state: SectionStateSchema.default('planned'),
  status: SectionStatusSchema.default('pending'),
  lastVerification: VerificationVerdictSchema.optional(),
}).passthrough();
export type SectionEntry = z.infer<typeof SectionEntrySchema>;

// === Core state schema (D-58 foundation slice) ===
export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_STATE_VERSION),
  paperId: z.string().min(1),
  createdAt: z.string().datetime(),
  sections: z.array(SectionEntrySchema).optional(),
});

export type State = z.infer<typeof Schema>;

// === StatePatchSchema (derived, used by generic patch tools) ===
export const StatePatchSchema = Schema.partial();
export type StatePatch = z.infer<typeof StatePatchSchema>;
