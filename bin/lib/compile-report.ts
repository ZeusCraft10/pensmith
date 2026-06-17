// bin/lib/compile-report.ts — deterministic COMPILE-REPORT.md renderer (D-14).
//
// Pure, no LLM, no network — template-literal narration only (mirrors the
// deterministic narration in bin/cli/verify.ts). The frontmatter is built from
// a CompileReportSchema-validated object; the body is the 5 D-14 LOCKED
// sections in FIXED ORDER:
//   1. ## Transitions Changed
//   2. ## Cross-Section Consistency Flags
//   3. ## Citation Density
//   4. ## Compile-Staleness Resolved
//   5. ## Advisory Findings   (Phase 4 writes the explicit empty marker)
//
// Body sections with no entries emit their own explicit empty marker so the
// reader can distinguish "ran, nothing to report" from "section omitted".
// schema_version is NEVER bumped for additive future fields (D-14
// additive-forward rule); Phase 5/6 populate the reserved slots in place.
//
// This renderer/schema is SUPPORTING infrastructure for Plan 05's COMP-07
// emission — it is NOT itself a canonical COMP requirement.

import { CompileReportSchema, COMPILE_REPORT_SCHEMA_VERSION } from './schemas/compile-report.js';

/** The Phase-4 empty marker for the Advisory Findings slot (D-14). */
export const ADVISORY_EMPTY_MARKER = '_No advisory passes ran — Phase 5 will populate._';

/** One smoothed-boundary entry for the Transitions Changed section. */
export interface TransitionEntry {
  boundary: string; // e.g. '1→2'
  status: 'smoothed' | 'rejected' | 'skipped';
  before_chars: number;
  after_chars: number;
}

/** One cross-section consistency flag. */
export interface ConsistencyEntry {
  detail: string;
}

/** One per-section citation-density measurement. */
export interface CitationDensityEntry {
  section: string;
  citations_per_1000_words: number;
}

/** One compile-staleness resolution entry. */
export interface StalenessEntry {
  section: string;
  prior_hash: string;
  new_hash: string;
  re_verify_passed: boolean;
}

export interface CompileReportInput {
  compiled_at: string;
  sections_count: number;
  stale_resolved_count: number;
  refuse_reasons?: string[];
  // Pandoc-reserved namespace — Phase 4 writes empty strings by default.
  title?: string;
  author?: string;
  abstract?: string;
  // Body entries (all optional — Phase 4 typically supplies none).
  transitions?: TransitionEntry[];
  consistency_flags?: ConsistencyEntry[];
  citation_density?: CitationDensityEntry[];
  staleness_resolved?: StalenessEntry[];
}

function yamlScalar(v: string): string {
  // Single-quote YAML scalars to keep empty strings explicit and to escape
  // any embedded single quotes. Reserved Pandoc keys are typically empty.
  return `'${v.replace(/'/g, "''")}'`;
}

function renderFrontmatter(input: CompileReportInput): string {
  // Validate the reserved-key set BEFORE serialization. This guarantees the
  // emitted frontmatter always round-trips through CompileReportSchema.parse.
  const parsed = CompileReportSchema.parse({
    schema_version: COMPILE_REPORT_SCHEMA_VERSION,
    compiled_at: input.compiled_at,
    sections_count: input.sections_count,
    stale_resolved_count: input.stale_resolved_count,
    refuse_reasons: input.refuse_reasons ?? [],
    title: input.title ?? '',
    author: input.author ?? '',
    abstract: input.abstract ?? '',
  });

  const refuse =
    parsed.refuse_reasons.length === 0
      ? '[]'
      : `[${parsed.refuse_reasons.map(yamlScalar).join(', ')}]`;

  return [
    '---',
    `schema_version: ${parsed.schema_version}`,
    `compiled_at: ${parsed.compiled_at}`,
    `sections_count: ${parsed.sections_count}`,
    `stale_resolved_count: ${parsed.stale_resolved_count}`,
    `refuse_reasons: ${refuse}`,
    `title: ${yamlScalar(parsed.title)}`,
    `author: ${yamlScalar(parsed.author)}`,
    `abstract: ${yamlScalar(parsed.abstract)}`,
    '---',
  ].join('\n');
}

function section(header: string, body: string[]): string {
  return [header, '', ...body].join('\n');
}

/**
 * Render a COMPILE-REPORT.md document deterministically. Output is:
 *   <YAML frontmatter>\n\n<5 body sections in D-14 fixed order>
 */
export function renderCompileReport(input: CompileReportInput): string {
  const transitions = input.transitions ?? [];
  const consistency = input.consistency_flags ?? [];
  const density = input.citation_density ?? [];
  const staleness = input.staleness_resolved ?? [];

  const transitionsBody = transitions.length
    ? transitions.map(
        (t) =>
          `- boundary ${t.boundary}: ${t.status} (before=${t.before_chars} chars, after=${t.after_chars} chars)`,
      )
    : ['_No boundaries smoothed._'];

  const consistencyBody = consistency.length
    ? consistency.map((c) => `- ${c.detail}`)
    : ['_No cross-section consistency flags._'];

  const densityBody = density.length
    ? density.map((d) => `- ${d.section}: ${d.citations_per_1000_words} citations/1000 words`)
    : ['_No citation-density data._'];

  const stalenessBody = staleness.length
    ? staleness.map(
        (s) =>
          `- ${s.section}: ${s.prior_hash} → ${s.new_hash} (re-verify ${s.re_verify_passed ? 'passed' : 'FAILED'})`,
      )
    : ['_No stale sections resolved._'];

  return [
    renderFrontmatter(input),
    '',
    section('## Transitions Changed', transitionsBody),
    '',
    section('## Cross-Section Consistency Flags', consistencyBody),
    '',
    section('## Citation Density', densityBody),
    '',
    section('## Compile-Staleness Resolved', stalenessBody),
    '',
    section('## Advisory Findings', [ADVISORY_EMPTY_MARKER]),
    '',
  ].join('\n');
}
