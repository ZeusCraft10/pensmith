// bin/lib/schemas/handoff.ts — HANDOFF.json schema (D-17, D-18, ARCH-04;
// v2: PLUG-14, D-23a-16).
//
// HANDOFF.json is the small (≤ 5120-byte) crash-resilient pointer document the
// PreCompact hook writes to `.paper/` (bin/lib/hooks/pre-compact.ts). Its job
// is to let the next session pick up where the previous one left off — it
// carries POINTERS, never content (D-18). PLAN.md per section is the source of
// truth, and the router never reads HANDOFF (H4); `resume` and the SessionStart
// hook read it for a summary only.
//
// v2 (D-23a-16). v1's `phase` enum mixed paper stages with section stages
// (`plan`/`write`/`verify` next to `outline`/`compile`), and the hook took it
// from a STATE.json field that no longer exists, so it read `intake` almost
// always. v2 derives every position field from the router's decision:
//   - `phase`    the paper stage: intake, research, outline, sectioning (a
//                section's plan → write → verify), compile, export (done),
//                done (nothing left), attention (the router needs the user);
//   - `section`  the section id as `status` prints it ("2", "1a"), or null;
//   - `position` plan | write | verify inside `sectioning`, else null;
//   - `current_section` (the section's slug), `next_action` and
//     `section_pointers` as in v1.
// v1's `breadcrumbs` are gone (review round 1): the v1 reader expected them in
// `.paper/BREADCRUMBS.jsonl`, which nothing ever wrote, and nothing read them
// back, so every v1 file carried `"breadcrumbs": []`. The v1 schema keeps the
// field so an old file still parses; the migration drops it, and a v2 file
// that still has it (a 23a development build) parses too (unknown keys are
// stripped).
// `bin/lib/migrations/handoff/v1_to_v2.ts` upgrades a v1 file in memory, and
// `loadHandoff` (bin/lib/handoff.ts) ignores a file newer than v2 (S-20).
//
// Every string is bounded so the whole document stays under 5120 bytes.
// STATE.json slugs have no length bound, so the writer (handoff.ts
// assembleHandoff) is total: a current slug over the bound is recorded as
// null, a section pointer that fails its schema is dropped, and then pointers
// are dropped (verified ones first) until the document fits.
//
// SectionStateSchema is imported (not re-declared) from ./state.js so the
// section-state enum lives in ONE file. No import cycle: state.ts does not
// import handoff.ts.

import { z } from 'zod';
import { SectionStateSchema } from './state.js';
import { SECTION_ID_RE } from '../section-id.js';

export const HANDOFF_MAX_BYTES = 5120;

/** The current HANDOFF.json version (v1 files are migrated in memory). */
export const CURRENT_HANDOFF_VERSION = 2;

/** v2 `phase`: the paper stage the router's next step belongs to. */
export const HANDOFF_PHASES = [
  'intake', 'research', 'outline', 'sectioning', 'compile', 'export', 'done', 'attention',
] as const;
export type HandoffPhase = (typeof HANDOFF_PHASES)[number];

/** v2 `position`: the step inside a section (`sectioning` only). */
export const HANDOFF_POSITIONS = ['plan', 'write', 'verify'] as const;
export type HandoffPosition = (typeof HANDOFF_POSITIONS)[number];

/** v1 only: a breadcrumb record (nothing ever wrote one; v2 has no breadcrumbs). */
const BreadcrumbSchema = z.object({
  ts: z.string().datetime(),
  verb: z.string().max(40),
  section: z.string().max(40).nullable(),
  ok: z.boolean(),
});

/** The longest slug a HANDOFF records (`current_section`, a pointer's `slug`). */
export const HANDOFF_SLUG_MAX = 120;

export const SectionPointerSchema = z.object({
  slug: z.string().max(HANDOFF_SLUG_MAX),
  plan_path: z.string().max(400),
  draft_path: z.string().max(400).nullable(),
  verification_path: z.string().max(400).nullable(),
  state: SectionStateSchema,
});

const withinBudget = (h: unknown): boolean => Buffer.byteLength(JSON.stringify(h), 'utf8') <= HANDOFF_MAX_BYTES;
const BUDGET_MESSAGE = `HANDOFF serialized size must be <= ${HANDOFF_MAX_BYTES} bytes (D-17)`;

/** The v1 shape (D-17), read only to migrate it. */
export const HandoffV1Schema = z.object({
  schema_version: z.literal(1),
  last_updated: z.string().datetime(),
  current_section: z.string().nullable(),
  phase: z.enum([
    'intake', 'research', 'outline', 'plan',
    'write', 'verify', 'compile', 'done',
  ]),
  next_action: z.string().min(1).max(200),
  breadcrumbs: z.array(BreadcrumbSchema.extend({ verb: z.string(), section: z.string().nullable() })).max(5),
  section_pointers: z.array(SectionPointerSchema.extend({
    slug: z.string(),
    plan_path: z.string(),
    draft_path: z.string().nullable(),
    verification_path: z.string().nullable(),
  })),
}).refine(withinBudget, { message: BUDGET_MESSAGE });
export type HandoffV1 = z.infer<typeof HandoffV1Schema>;

/** The current shape (v2, D-23a-16). */
export const HandoffSchema = z.object({
  schema_version: z.literal(CURRENT_HANDOFF_VERSION),
  last_updated: z.string().datetime(),
  phase: z.enum(HANDOFF_PHASES),
  section: z.string().regex(SECTION_ID_RE).nullable(),
  position: z.enum(HANDOFF_POSITIONS).nullable(),
  current_section: z.string().max(HANDOFF_SLUG_MAX).nullable(),
  next_action: z.string().min(1).max(200),
  section_pointers: z.array(SectionPointerSchema),
})
  .refine((h) => (h.position !== null) === (h.phase === 'sectioning'), {
    message: 'position is set exactly when phase is "sectioning" (plan, write or verify of one section)',
    path: ['position'],
  })
  .refine(withinBudget, { message: BUDGET_MESSAGE });
export type Handoff = z.infer<typeof HandoffSchema>;
export type HandoffSectionPointer = Handoff['section_pointers'][number];
