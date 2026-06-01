/**
 * bin/lib/schemas/wave-graph.ts
 * 
 * Zod schemas for in-memory wave graph.
 */

import { z } from 'zod';

export const SectionNodeSchema = z.object({
  n: z.number().int().min(1),
  slug: z.string(),
  title: z.string(),
  depends_on: z.array(z.string()),
  wave_override: z.number().int().positive().optional(),
  computed_wave: z.number().int().positive(),
  status: z.enum(['pending', 'in_flight', 'done', 'failed', 'blocked']).default('pending')
});

export const WaveGraphSchema = z.object({
  nodes: z.map(z.string(), SectionNodeSchema)
});

export type SectionNode = z.infer<typeof SectionNodeSchema>;
export type WaveGraph = z.infer<typeof WaveGraphSchema>;
