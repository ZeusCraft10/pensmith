// bin/lib/schemas/compile-inputs.ts — `.paper/COMPILE-INPUTS.json` v1 (review
// round 2 of Phase 18).
//
// compile records which sections it compiled and the sha256 of each section's
// DRAFT.md and VERIFICATION.md as they were when it wrote `.paper/DRAFT.md`.
// The router decides whether the compiled draft is stale from these CONTENT
// hashes — not from file mtimes, which a git checkout, a sync client or the
// --dry-run workspace seed can reorder (bin/lib/compile-inputs.ts).
//
// A new persisted file: `$schemaVersion` 1, strict. Adding a field is a
// migration plus a version bump (S-20).

import { z } from 'zod';

export const COMPILE_INPUTS_SCHEMA_VERSION = 1;

const SHA256_OR_EMPTY = /^(?:[0-9a-f]{64})?$/;

export const CompileInputsSectionSchema = z
  .object({
    /** `1`, `1a` — the section id (GRND-09). */
    id: z.string().regex(/^[1-9][0-9]?[a-z]?$/),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    /** sha256 of the section's DRAFT.md bytes ('' when it had none). */
    draft_sha256: z.string().regex(SHA256_OR_EMPTY),
    /** sha256 of the section's VERIFICATION.md bytes ('' when it had none). */
    verification_sha256: z.string().regex(SHA256_OR_EMPTY),
  })
  .strict();

export const CompileInputsSchema = z
  .object({
    $schemaVersion: z.literal(COMPILE_INPUTS_SCHEMA_VERSION),
    compiled_at: z.string().datetime(),
    /** The compiled sections in (n, suffix) order. */
    sections: z.array(CompileInputsSectionSchema),
  })
  .strict();

export type CompileInputs = z.infer<typeof CompileInputsSchema>;
export type CompileInputsSection = z.infer<typeof CompileInputsSectionSchema>;
