// bin/lib/schemas/wave-graph.ts — in-memory wave-graph zod schemas (Phase 4).
//
// Plan 04-01. These schemas guard the IN-MEMORY data structures the wave
// scheduler (bin/lib/scheduler.ts) builds from a parsed outline + PLAN.md
// frontmatter. They are NEVER serialized to disk (the scheduler is read-only
// per D-04 / ARCH-20), so there is deliberately NO `schema_version` envelope
// and NO migration story — these are dev-typo guards, not a persisted contract.
//
// Strict-by-default (ARCH-07): no `.passthrough()`, no `.catchall`. Optional
// fields use explicit `.optional()` (mirrors plan-frontmatter.ts).
//
// Shape per 04-RESEARCH §B:
//   SectionNode = { n, slug, title, depends_on[], wave_override?, computed_wave, status }
//   WaveGraph   = { nodes: Map<slug, SectionNode>, waves: SectionNode[][] }

import { z } from 'zod';

const SLUG = /^[a-z0-9-]+$/;

/** Lifecycle status of a section within a single scheduler run. */
export const SectionStatusSchema = z.enum([
  'pending',
  'in_flight',
  'done',
  'failed',
  'blocked',
]);
export type SectionStatus = z.infer<typeof SectionStatusSchema>;

export const SectionNodeSchema = z.object({
  /** 1-based outline (reader) order index. */
  n: z.number().int().positive(),
  /** Bare kebab-case slug — the graph's primary key. */
  slug: z.string().regex(SLUG),
  title: z.string(),
  /** Bare slugs this section depends on. */
  depends_on: z.array(z.string().regex(SLUG)),
  /** Optional PLAN.md `wave:` override (validated by the scheduler). */
  wave_override: z.number().int().positive().optional(),
  /** Kahn-computed wave (1-based), possibly promoted by a valid override. */
  computed_wave: z.number().int().positive(),
  status: SectionStatusSchema,
});
export type SectionNode = z.infer<typeof SectionNodeSchema>;

// WaveGraph holds a Map (not a plain object), which zod cannot validate as a
// record without copying. We model it structurally: `nodes` is a Map and
// `waves` is an array of node arrays. Validation of individual nodes happens
// via SectionNodeSchema at construction time in scheduler.ts.
export const WaveGraphSchema = z.object({
  nodes: z.map(z.string().regex(SLUG), SectionNodeSchema),
  waves: z.array(z.array(SectionNodeSchema)),
});
export type WaveGraph = z.infer<typeof WaveGraphSchema>;
