// bin/lib/schemas/compile-report.ts — COMPILE-REPORT.md zod frontmatter schema.
//
// D-14 LOCKED schema from 04-CONTEXT.md — authoritative. RESEARCH.md drifted
// and is WRONG where it conflicts. Use the D-14 schema here verbatim.
//
// ARCH-07 refuse-forward-incompat: strict zod (no passthrough, no catchall).
// An object carrying keys not in the D-14 reserved set (e.g. outline_hash or
// pandoc_target from RESEARCH.md drift) is REJECTED here. This prevents
// forward-incompat slippage: phases adding new keys must use the additive
// forward rule (content inside reserved body sections), not frontmatter keys.
//
// Pandoc-reserved keys (title/author/abstract) MUST be present even when
// empty — Phase 6 export reads them directly without defaulting.

import { z } from 'zod';

/**
 * Zod schema for COMPILE-REPORT.md frontmatter (schema v1, D-14 LOCKED).
 *
 * Reserved keys (exactly these — no others):
 *   schema_version: 1            (literal — rejects 2 and beyond)
 *   compiled_at:   ISO-8601      (z.string().datetime())
 *   sections_count: int ≥ 0
 *   stale_resolved_count: int ≥ 0
 *   refuse_reasons: string[]     (empty on success)
 *   title: ''                    (Pandoc-reserved; Phase 4 writes empty string)
 *   author: ''                   (Pandoc-reserved; Phase 4 writes empty string)
 *   abstract: ''                 (Pandoc-reserved; Phase 4 writes empty string)
 *
 * STRICT — no passthrough/catchall. outline_hash and pandoc_target are NOT
 * reserved keys and parsing an object that carries them will FAIL. This is
 * intentional and load-bearing per ARCH-07.
 */
export const CompileReportSchema = z.strictObject({
  schema_version: z.literal(1),
  compiled_at: z.string().datetime(),
  sections_count: z.number().int().nonnegative(),
  stale_resolved_count: z.number().int().nonnegative(),
  refuse_reasons: z.array(z.string()).default([]),
  title: z.string().default(''),
  author: z.string().default(''),
  abstract: z.string().default(''),
});

export type CompileReport = z.infer<typeof CompileReportSchema>;
