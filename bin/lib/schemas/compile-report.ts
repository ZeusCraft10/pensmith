// bin/lib/schemas/compile-report.ts — COMPILE-REPORT.md frontmatter schema v1.
//
// SOURCE OF TRUTH: 04-CONTEXT.md D-14 (LOCKED). The reserved-key set is EXACTLY:
//   schema_version, compiled_at, sections_count, stale_resolved_count,
//   refuse_reasons, title, author, abstract
//
// 04-RESEARCH §F DRIFTED and proposed `outline_hash` / `pandoc_target` — those
// are NOT D-14 reserved keys. This schema is STRICT (no .passthrough() /
// .catchall), so any object carrying a non-reserved key — including the
// RESEARCH-drift keys — is REJECTED (ARCH-07 refuse-forward-incompat).
//
// `schema_version: z.literal(1)` is the contract (D-14). Phase 5 (advisory
// passes) and Phase 6 (export) populate the reserved BODY slots without bumping
// the version; a version bump is reserved for a breaking change to a reserved
// key's SHAPE, never for additive content (D-14 additive-forward rule).
//
// The Pandoc-reserved keys (title / author / abstract) MUST be present even
// when empty so Phase 6 export reads them directly. They default to '' so a
// Phase-4 caller can omit them.

import { z } from 'zod';

export const COMPILE_REPORT_SCHEMA_VERSION = 1;

export const CompileReportSchema = z
  .object({
    schema_version: z.literal(1),
    compiled_at: z.string().datetime(),
    sections_count: z.number().int().nonnegative(),
    stale_resolved_count: z.number().int().nonnegative(),
    refuse_reasons: z.array(z.string()).default([]),
    // Pandoc-reserved namespace (Phase 6 export reads these directly).
    title: z.string().default(''),
    author: z.string().default(''),
    abstract: z.string().default(''),
  })
  .strict();

export type CompileReport = z.infer<typeof CompileReportSchema>;
