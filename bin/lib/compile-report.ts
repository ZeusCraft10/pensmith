// bin/lib/compile-report.ts — deterministic COMPILE-REPORT.md renderer (D-14 LOCKED).
//
// NO LLM call — pure template-literal narration, mirrors bin/cli/verify.ts
// narration pattern per CYCLE-2 H-4 / D-13 LOCKED INVARIANT.
//
// D-14 LOCKED body section order (04-CONTEXT.md D-14 — authoritative):
//   1. ## Transitions Changed
//   2. ## Cross-Section Consistency Flags
//   3. ## Citation Density
//   4. ## Compile-Staleness Resolved
//   5. ## Advisory Findings
//      Phase 4 writes the header + explicit empty marker when no advisory
//      entries are supplied. Phase 5 populates this slot.
//
// additive-forward rule (D-14):
//   Never bump schema_version for additive content. A version bump signals
//   a breaking change to a reserved key's SHAPE, not the addition of content
//   inside the fixed body sections.

import { CompileReportSchema, type CompileReport } from './schemas/compile-report.js';

// --------------------------------------------------------------------------
// Advisory entry type (REVIEW LOW — Gemini: retraction aggregation from
// Plan 02's FreshnessResult.retraction_warnings[]).
// --------------------------------------------------------------------------

export interface AdvisoryEntry {
  citekey: string;
  note: string;
}

// --------------------------------------------------------------------------
// Input type — superset of CompileReport, allows advisory entries and body
// section content that the schema doesn't model (schema covers frontmatter only).
// --------------------------------------------------------------------------

export interface CompileReportInput {
  schema_version: 1;
  compiled_at: string;
  sections_count: number;
  stale_resolved_count: number;
  refuse_reasons?: string[];
  title?: string;
  author?: string;
  abstract?: string;
  /** Content for ## Transitions Changed — one string per boundary entry. */
  transitions?: string[];
  /** Content for ## Cross-Section Consistency Flags — one string per flag. */
  consistency_flags?: string[];
  /** Content for ## Citation Density — one string per density line. */
  citation_density?: string[];
  /** Content for ## Compile-Staleness Resolved — one string per stale-section entry. */
  staleness_resolved?: string[];
  /** Structured advisory entries for ## Advisory Findings (Plan 05 populates). */
  advisory_entries?: AdvisoryEntry[];
}

// --------------------------------------------------------------------------
// YAML frontmatter builder (deterministic, no yaml library dependency)
// --------------------------------------------------------------------------

/**
 * Serialize a CompileReport-shape object as YAML frontmatter.
 *
 * Only the D-14 reserved keys are emitted. Order is fixed.
 * Arrays are emitted as YAML block lists (- item).
 * Strings that might need quoting are single-quoted.
 */
function buildFrontmatter(data: CompileReport): string {
  const lines: string[] = ['---'];

  lines.push(`schema_version: ${data.schema_version}`);
  lines.push(`compiled_at: '${data.compiled_at}'`);
  lines.push(`sections_count: ${data.sections_count}`);
  lines.push(`stale_resolved_count: ${data.stale_resolved_count}`);

  if (data.refuse_reasons.length === 0) {
    lines.push('refuse_reasons: []');
  } else {
    lines.push('refuse_reasons:');
    for (const r of data.refuse_reasons) {
      lines.push(`  - '${r.replace(/'/g, "''")}'`);
    }
  }

  // Pandoc-reserved keys — always present, even when empty (Phase 6 reads directly).
  lines.push(`title: '${data.title.replace(/'/g, "''")}'`);
  lines.push(`author: '${data.author.replace(/'/g, "''")}'`);
  lines.push(`abstract: '${data.abstract.replace(/'/g, "''")}'`);

  lines.push('---');
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Body section builders
// --------------------------------------------------------------------------

function sectionBlock(header: string, entries: string[], emptyMarker: string): string {
  const lines = [header, ''];
  if (entries.length === 0) {
    lines.push(emptyMarker);
  } else {
    lines.push(...entries);
  }
  lines.push('');
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Render a deterministic COMPILE-REPORT.md string from the given input.
 *
 * Validates the frontmatter portion via CompileReportSchema (strict — rejects
 * unknown keys). Emits the 5 D-14 body sections in fixed order. The
 * ## Advisory Findings section, when given no advisory_entries, emits the
 * explicit empty marker `_No advisory passes ran — Phase 5 will populate._`
 *
 * Pure function — no LLM call, no network, no disk I/O.
 */
export function renderCompileReport(input: CompileReportInput): string {
  // Validate and normalize frontmatter via CompileReportSchema.
  const frontmatter = CompileReportSchema.parse({
    schema_version: input.schema_version,
    compiled_at: input.compiled_at,
    sections_count: input.sections_count,
    stale_resolved_count: input.stale_resolved_count,
    refuse_reasons: input.refuse_reasons ?? [],
    title: input.title ?? '',
    author: input.author ?? '',
    abstract: input.abstract ?? '',
  });

  const parts: string[] = [];

  // 1. YAML frontmatter
  parts.push(buildFrontmatter(frontmatter));
  parts.push('');

  // 2. Body — 5 sections in D-14 fixed order

  // ## Transitions Changed
  parts.push(sectionBlock(
    '## Transitions Changed',
    input.transitions ?? [],
    '_No transition data — compile pipeline will populate._',
  ));

  // ## Cross-Section Consistency Flags
  parts.push(sectionBlock(
    '## Cross-Section Consistency Flags',
    input.consistency_flags ?? [],
    '_No consistency flags detected._',
  ));

  // ## Citation Density
  parts.push(sectionBlock(
    '## Citation Density',
    input.citation_density ?? [],
    '_No citation density data available._',
  ));

  // ## Compile-Staleness Resolved
  parts.push(sectionBlock(
    '## Compile-Staleness Resolved',
    input.staleness_resolved ?? [],
    '_No stale sections resolved._',
  ));

  // ## Advisory Findings (Phase 4 writes empty marker; Phase 5 populates)
  const advisoryLines = (input.advisory_entries ?? []).map(
    (e) => `- **${e.citekey}**: ${e.note}`,
  );
  parts.push(sectionBlock(
    '## Advisory Findings',
    advisoryLines,
    '_No advisory passes ran — Phase 5 will populate._',
  ));

  return parts.join('\n');
}
