// bin/lib/schemas/compile-inputs.ts — `.paper/COMPILE-INPUTS.json` v2 (review
// round 2 of Phase 18; v2 Phase 20, VRFY-27, D-20-23).
//
// compile records which sections it compiled and the sha256 of each section's
// DRAFT.md and VERIFICATION.md as they were when it wrote `.paper/DRAFT.md`.
// The router decides whether the compiled draft is stale from these CONTENT
// hashes — not from file mtimes, which a git checkout, a sync client or the
// --dry-run workspace seed can reorder (bin/lib/compile-inputs.ts).
//
// v2 adds what done checks before it exports (VRFY-27): the sha256 of the
// DRAFT.md compile wrote (`compiled_draft_sha256`; a hand edit of the compiled
// draft is stale) and, per section, the `verified_against_draft_hash` the
// section had when it was compiled. The v1 → v2 migration
// (migrations/compile-inputs/v1_to_v2.ts) sets both null, which done reads as
// stale ("recompile").
//
// `$schemaVersion`, strict. Adding a field is a migration plus a version bump
// (S-20).

import { z } from 'zod';

export const COMPILE_INPUTS_SCHEMA_VERSION = 2;

const SHA256_OR_EMPTY = /^(?:[0-9a-f]{64})?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const CompileInputsSectionSchema = z
  .object({
    /** `1`, `1a` — the section id (GRND-09). */
    id: z.string().regex(/^[1-9][0-9]?[a-z]?$/),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    /** sha256 of the section's DRAFT.md bytes ('' when it had none). */
    draft_sha256: z.string().regex(SHA256_OR_EMPTY),
    /** sha256 of the section's VERIFICATION.md bytes ('' when it had none). */
    verification_sha256: z.string().regex(SHA256_OR_EMPTY),
    /** The section's verified_against_draft_hash when compiled (null: recorded by a v1 compile — stale). */
    verified_against_draft_hash: z.string().regex(SHA256).nullable(),
  })
  .strict();

export const CompileInputsSchema = z
  .object({
    $schemaVersion: z.literal(COMPILE_INPUTS_SCHEMA_VERSION),
    compiled_at: z.string().datetime(),
    /** sha256 of the `.paper/DRAFT.md` bytes compile wrote (null: recorded by a v1 compile — stale). */
    compiled_draft_sha256: z.string().regex(SHA256).nullable(),
    /** The compiled sections in (n, suffix) order. */
    sections: z.array(CompileInputsSectionSchema),
  })
  .strict();

export type CompileInputs = z.infer<typeof CompileInputsSchema>;
export type CompileInputsSection = z.infer<typeof CompileInputsSectionSchema>;
