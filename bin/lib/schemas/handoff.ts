// bin/lib/schemas/handoff.ts — HANDOFF.json schema (D-17, D-18, ARCH-04).
//
// Phase 3 Plan 03-03 Task 3.1.
//
// The HANDOFF.json file is the small (≤ 5120-byte) crash-resilient pointer
// document written by hooks/pre-compact.ts. Its job is to let a new shell
// pick up where the previous session left off — it carries POINTERS, never
// content (D-18). PLAN.md per-section is the source of truth.
//
// D-17 LOCKED shape (CYCLE-3 reviews convergence): snake_case fields, literal
// numeric schema_version, breadcrumbs capped at 5, every string field bounded
// at 200 chars so JSON.stringify cannot blow past 5120 bytes.
//
// SectionStateSchema is imported (not re-declared) from ./state.js so future
// amendments to the section-state enum touch ONE file. No import cycle:
// state.ts does not import handoff.ts.

import { z } from 'zod';
import { SectionStateSchema } from './state.js';

export const HANDOFF_MAX_BYTES = 5120;

export const HandoffSchema = z.object({
  schema_version: z.literal(1),
  last_updated: z.string().datetime(),
  current_section: z.string().nullable(),
  phase: z.enum([
    'intake', 'research', 'outline', 'plan',
    'write', 'verify', 'compile', 'done',
  ]),
  next_action: z.string().min(1).max(200),
  breadcrumbs: z.array(z.object({
    ts: z.string().datetime(),
    verb: z.string(),
    section: z.string().nullable(),
    ok: z.boolean(),
  })).max(5),
  section_pointers: z.array(z.object({
    slug: z.string(),
    plan_path: z.string(),
    draft_path: z.string().nullable(),
    verification_path: z.string().nullable(),
    state: SectionStateSchema,
  })),
}).refine(
  (h) => Buffer.byteLength(JSON.stringify(h), 'utf8') <= HANDOFF_MAX_BYTES,
  { message: `HANDOFF serialized size must be <= ${HANDOFF_MAX_BYTES} bytes (D-17)` },
);
export type Handoff = z.infer<typeof HandoffSchema>;
