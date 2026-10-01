// bin/lib/compile-report.ts — deterministic COMPILE-REPORT.md renderer (D-14;
// fully populated since Phase 21, EXP-13, D-21-17).
//
// Pure, no LLM, no network — template-literal narration only (mirrors the
// deterministic narration in bin/cli/verify.ts). The frontmatter is built from
// a CompileReportSchema-validated object (its `title` is the paper title —
// COMPILE-REPORT.md is never exported); the body is the 5 D-14 LOCKED
// sections in FIXED ORDER:
//   1. ## Transitions Changed       (each boundary: smoothed / rejected (why) /
//                                    skipped (why), with the before and after text)
//   2. ## Cross-Section Consistency Flags
//   3. ## Citation Density          (the discipline and the band, each with where
//                                    it came from; per section; out-of-band paragraphs)
//   4. ## Compile-Staleness Resolved
//   5. ## Advisory Findings         (per section: its Pass-2 rows that are not
//                                    SUPPORTED and its Pass-4 orphans, read from the
//                                    section's VERIFICATION.md — or that the passes
//                                    were not run on the current draft)
// then, D-14 additive, always present with an empty marker when there is
// nothing to list:
//   6. ## Accepted Quotes                   (Phase 20, VRFY-20)
//   7. ## Quotes Verified Against Your Files (Phase 20, VRFY-19)
//   8. ## Contradictions                    (Phase 21, EXP-11: `Contradictions
//                                            flagged: N (target 0)`, each pair with
//                                            both sections and sentences, the cleared
//                                            pairs, and why the model check was skipped)
//
// Every step that did not run names its mode: `skipped (dry-run)`, `skipped
// (no LLM)`, `skipped (offline)`, `skipped (--no-smooth)`, `skipped (config)`
// (S-15). schema_version is never bumped for additive body content (D-14).
//
// RUN-02 / D-17-08: when the compile ran offline (PENSMITH_OFFLINE=1, --dry-run,
// the test runner), the FIRST line of the body (right after the frontmatter) is
// the offline marker. The marker never reaches an export: exporters read
// DRAFT.md / FINAL.md, never COMPILE-REPORT.md.

import { CompileReportSchema, COMPILE_REPORT_SCHEMA_VERSION } from './schemas/compile-report.js';
import { offlineMarkerLine } from './http-mock.js';
import { bandLabel, type CitationDensityReport, type DensityStatus } from './citation-density.js';
import type { SectionAdvisory } from './done-gate.js';
import type { ContradictionReport } from './claim-consistency.js';

/** One boundary entry for the Transitions Changed section. */
export interface TransitionEntry {
  boundary: string; // e.g. '1→2'
  status: 'smoothed' | 'rejected' | 'skipped';
  /** Why a boundary was rejected or skipped (e.g. `citation set changed`, `no LLM`); absent when smoothed. */
  reason?: string;
  before_chars: number;
  after_chars: number;
  /** The boundary text as the sections hold it (the last paragraph of A, a blank line, the first of B). */
  before?: string;
  /** The smoothed boundary text (only for a smoothed boundary). */
  after?: string;
}

/** One cross-section consistency flag. */
export interface ConsistencyEntry {
  detail: string;
}

/** One paragraph outside the discipline's citation band (GRND-06). */
export interface CitationDensityParagraphEntry {
  index: number;
  citations: number;
  first_words: string;
}

/** One per-section citation-density measurement. */
export interface CitationDensityEntry {
  section: string;
  citations_per_1000_words: number;
  /** GRND-06: mean citations per prose paragraph (PRD §8 bands are per paragraph). */
  citations_per_paragraph?: number;
  paragraphs?: number;
  /** The band, e.g. "1–3". */
  band?: string;
  status?: DensityStatus;
  out_of_band?: CitationDensityParagraphEntry[];
}

/** The paper-wide line of the Citation Density section (GRND-06, EXP-12). */
export interface CitationDensitySummary {
  discipline: string;
  /** Where the discipline came from (EXP-12): `INTAKE.md`, `config.toml`, `--discipline`, `preset default`. */
  discipline_source?: string;
  band: string;
  /** Where the band came from (EXP-12): the preset, or `config.toml [verification] …`. */
  band_source?: string;
  mean_per_paragraph: number;
  comparison: DensityStatus;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The COMPILE-REPORT.md density entries and summary of a density report: per
 * section, citations per paragraph against the band, the paragraphs outside
 * it, and the D-14 citations per 1000 words. `sources` names where the
 * discipline and the band came from (EXP-12).
 */
export function citationDensityForReport(
  r: CitationDensityReport,
  sources: { readonly discipline?: string; readonly band?: string } = {},
): { entries: CitationDensityEntry[]; summary: CitationDensitySummary } {
  const band = bandLabel(r.band);
  return {
    entries: r.sections.map((d) => ({
      section: `${d.n}${d.suffix ?? ''} (${d.slug})`,
      citations_per_1000_words: round1(d.citations_per_1000_words),
      citations_per_paragraph: round1(d.citations_per_paragraph),
      paragraphs: d.paragraphs,
      band,
      status: d.status,
      out_of_band: d.out_of_band.map((p) => ({ index: p.index, citations: p.citations, first_words: p.firstWords })),
    })),
    summary: {
      discipline: r.discipline,
      ...(sources.discipline !== undefined ? { discipline_source: sources.discipline } : {}),
      band,
      ...(sources.band !== undefined ? { band_source: sources.band } : {}),
      mean_per_paragraph: round1(r.mean_per_paragraph),
      comparison: r.comparison,
    },
  };
}

/** A quote the user accepted although no source text could be checked (VRFY-20). */
export interface AcceptedQuoteEntry {
  /** The section (`1`, `1a`). */
  section: string;
  /** The quote's id in its section draft (`q1`). */
  id: string;
  citekey: string;
  excerpt: string;
  /** When the user accepted it (ISO-8601). */
  accepted_at: string;
  via: 'flag' | 'prompt';
}

/** A quote verified against the user's own PDF (VRFY-19). */
export interface LocalFileQuoteEntry {
  id: string;
  citekey: string;
  excerpt: string;
  /** The PDF (`sources/<file>`). */
  file: string;
}

/** The empty markers of the two quote sections (D-14 additive, Phase 20). */
export const ACCEPTED_QUOTES_EMPTY_MARKER = '_No quotes accepted without a source check._';
export const LOCAL_FILE_QUOTES_EMPTY_MARKER = '_No quotes verified against your own files._';
/** Advisory Findings with no registered section to read (EXP-13). */
export const ADVISORY_NO_SECTIONS_MARKER = '_No sections to report._';

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
  /** The paper title (the compiled DRAFT.md's `# <title>`). Pandoc-reserved keys default to ''. */
  title?: string;
  author?: string;
  abstract?: string;
  transitions?: TransitionEntry[];
  /**
   * Why the smoother did not run at all (`dry-run`, `no LLM`, `offline`,
   * `--no-smooth`, `--raw`, `config`, …), or undefined when it ran.
   */
  smoothing_skipped?: string;
  consistency_flags?: ConsistencyEntry[];
  citation_density?: CitationDensityEntry[];
  /** The paper-wide density line (discipline, band, mean per paragraph). */
  citation_density_summary?: CitationDensitySummary;
  staleness_resolved?: StalenessEntry[];
  /** Each registered section's advisory findings (done-gate.ts readSectionAdvisory). */
  advisory?: readonly SectionAdvisory[];
  /** Quotes accepted without a source check (VRFY-20; D-14 additive `## Accepted Quotes`). */
  accepted_quotes?: AcceptedQuoteEntry[];
  /** Quotes verified against the user's own PDFs (VRFY-19; `## Quotes Verified Against Your Files`). */
  local_file_quotes?: LocalFileQuoteEntry[];
  /** The cross-section contradiction check (EXP-11; `## Contradictions`). */
  contradictions?: ContradictionReport;
  /**
   * The offline marker line for the body (D-17-08). undefined → derived from the
   * current network mode (http-mock.ts offlineMarkerLine); null → no marker.
   */
  offline_marker?: string | null;
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
    title: (input.title ?? '').replace(/[\r\n]+/g, ' '),
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

const STATUS_WORD: Readonly<Record<DensityStatus, string>> = Object.freeze({ below: 'BELOW', within: 'within', above: 'ABOVE' });

/** One line of report text: newlines folded, double quotes made single. */
function quoted(s: string, max = 600): string {
  const t = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return `"${t.length <= max ? t : `${t.slice(0, max - 1)}…`}"`;
}

/**
 * The Citation Density body (GRND-06, EXP-12): the discipline and band with
 * their sources, then per section citations per paragraph against the band
 * (with the paragraphs outside it) and the D-14 citations per 1000 words.
 */
function renderDensity(density: readonly CitationDensityEntry[], summary: CitationDensitySummary | undefined): string[] {
  const out: string[] = [];
  if (summary) {
    const discipline = `${summary.discipline}${summary.discipline_source ? ` (from ${summary.discipline_source})` : ''}`;
    const band = `band ${summary.band} citations per paragraph${summary.band_source ? ` (from ${summary.band_source})` : ''}`;
    out.push(
      `Discipline: ${discipline} · ${band} · paper-wide ${summary.mean_per_paragraph} per paragraph (${STATUS_WORD[summary.comparison]})`,
      '',
    );
  }
  for (const d of density) {
    if (d.citations_per_paragraph === undefined || d.status === undefined) {
      out.push(`- ${d.section}: ${d.citations_per_1000_words} citations/1000 words`);
      continue;
    }
    out.push(
      `- ${d.section}: ${d.citations_per_paragraph} citations/paragraph over ${d.paragraphs ?? 0} paragraph(s) (${STATUS_WORD[d.status]} ${d.band ?? ''}); ${d.citations_per_1000_words} citations/1000 words`,
    );
    for (const p of d.out_of_band ?? []) {
      out.push(`  - paragraph ${p.index} (${p.citations} citation${p.citations === 1 ? '' : 's'}, band ${d.band ?? ''}): "${p.first_words.replace(/"/g, "'")}"`);
    }
  }
  return out;
}

/** Transitions Changed (EXP-10, EXP-13): every boundary with its status, reason and text. */
function renderTransitions(transitions: readonly TransitionEntry[], skipped: string | undefined): string[] {
  const out: string[] = [];
  if (skipped !== undefined) out.push(`_smoothing skipped (${skipped}) — every boundary keeps the section text as verified._`, '');
  if (transitions.length === 0) {
    out.push(skipped === undefined ? '_No boundaries (a single-section paper)._' : '_No boundaries smoothed._');
    return out;
  }
  for (const t of transitions) {
    const status = t.status === 'smoothed' ? 'smoothed' : `${t.status} (${t.reason ?? 'no reason recorded'})`;
    out.push(`- boundary ${t.boundary}: ${status} (before=${t.before_chars} chars, after=${t.after_chars} chars)`);
    if (t.before !== undefined) out.push(`  - before: ${quoted(t.before)}`);
    if (t.status === 'smoothed' && t.after !== undefined) out.push(`  - after: ${quoted(t.after)}`);
  }
  return out;
}

/** Advisory Findings (EXP-13): each section's Pass-2 rows that are not SUPPORTED and its Pass-4 orphans. */
function renderAdvisory(advisory: readonly SectionAdvisory[] | undefined): string[] {
  if (advisory === undefined || advisory.length === 0) return [ADVISORY_NO_SECTIONS_MARKER];
  const out: string[] = [];
  for (const a of advisory) {
    out.push(`- §${a.section} (${a.slug}):`);
    if (a.pass2 === 'not-run') out.push(`  - claim support (Pass 2): not run on the current draft — run \`pensmith verify ${a.section}\` to judge it`);
    else if (a.pass2 === 'absent') out.push('  - claim support (Pass 2): no record (the section has no Pass-2 section in its VERIFICATION.md)');
    else if (a.pass2Rows.length === 0) out.push('  - claim support (Pass 2): every judged claim SUPPORTED');
    else {
      out.push(`  - claim support (Pass 2): ${a.pass2Rows.length} claim(s) not SUPPORTED`);
      for (const r of a.pass2Rows) {
        out.push(`    - row ${r.row} [@${r.result.citekey}] ${r.result.verdict}: ${quoted(r.result.claimSentence, 240)} — ${r.result.rationale.replace(/[\r\n]+/g, ' ')}`);
      }
    }
    if (a.pass4 === 'not-run') out.push(`  - orphan claims (Pass 4): not run on the current draft — run \`pensmith verify ${a.section}\` to audit it`);
    else if (a.pass4 === 'absent') out.push('  - orphan claims (Pass 4): no record (the section has no Pass-4 section in its VERIFICATION.md)');
    else if (a.orphans.length === 0) out.push('  - orphan claims (Pass 4): none');
    else {
      out.push(`  - orphan claims (Pass 4): ${a.orphans.length}`);
      for (const o of a.orphans) out.push(`    - paragraph ${o.paragraph}: ${quoted(o.sentence, 240)}`);
    }
  }
  return out;
}

/** The Contradictions body (EXP-11, D-21-15). */
function renderContradictions(c: ContradictionReport | undefined): string[] {
  if (c === undefined) return ['Contradictions flagged: 0 (target 0)', '', '_The contradiction check did not run._'];
  const out = [`Contradictions flagged: ${c.flagged.length} (target 0)`, ''];
  const model = c.skipped.length > 0
    ? `model check ${c.skipped} — the deterministic heuristic ran alone`
    : `${c.judged} pair(s) judged by the claim-consistency model (cap ${c.cap})`;
  out.push(`Candidate pairs (cross-section claims sharing content terms): ${c.candidates}; ${model}.`, '');
  const side = (s: { section: string; title: string; text: string }): string => `§${s.section} (${s.title.replace(/[\r\n]+/g, ' ')}) ${quoted(s.text, 300)}`;
  for (const f of c.flagged) {
    out.push(`- ${side(f.pair.a)} ↔ ${side(f.pair.b)} — ${f.by === 'model' ? 'CONTRADICTS (model)' : `flagged by the heuristic (${f.pair.heuristic?.kind ?? 'negation'}; not judged by the model)`}: ${f.rationale.replace(/[\r\n]+/g, ' ')}`);
  }
  if (c.flagged.length === 0) out.push('_No contradictions flagged._');
  if (c.cleared.length > 0) {
    out.push('', 'Cleared (a heuristic flag the model judged CONSISTENT — not counted):');
    for (const x of c.cleared) out.push(`- ${side(x.pair.a)} ↔ ${side(x.pair.b)} — ${x.rationale.replace(/[\r\n]+/g, ' ')}`);
  }
  if (c.undecided.length > 0) {
    out.push('', 'Heuristic flags the model judged UNCLEAR (not counted — review them):');
    for (const x of c.undecided) out.push(`- ${side(x.pair.a)} ↔ ${side(x.pair.b)} — ${x.rationale.replace(/[\r\n]+/g, ' ')}`);
  }
  return out;
}

/** The `Contradictions flagged: N` count and the flagged lines of a COMPILE-REPORT.md (done's confirmation, EXP-11). Never throws. */
export function readReportContradictions(report: string): { count: number; lines: string[] } {
  const text = report.replace(/\r\n/g, '\n');
  const at = text.indexOf('\n## Contradictions\n');
  if (at === -1) return { count: 0, lines: [] };
  const rest = text.slice(at + '\n## Contradictions\n'.length);
  const end = rest.search(/\n## /);
  const body = end === -1 ? rest : rest.slice(0, end);
  const m = /^Contradictions flagged: (\d+) \(target 0\)$/m.exec(body);
  const count = m ? Number(m[1]) : 0;
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('Cleared ') || line.startsWith('Heuristic flags the model judged UNCLEAR')) break;
    if (line.startsWith('- §')) lines.push(line.slice(2));
  }
  return { count, lines };
}

function section(header: string, body: string[]): string {
  return [header, '', ...body].join('\n');
}

/**
 * Render a COMPILE-REPORT.md document deterministically. Output is:
 *   <YAML frontmatter>\n\n<the 8 body sections in order>
 */
export function renderCompileReport(input: CompileReportInput): string {
  const consistency = input.consistency_flags ?? [];
  const density = input.citation_density ?? [];
  const staleness = input.staleness_resolved ?? [];

  const consistencyBody = consistency.length
    ? consistency.map((c) => `- ${c.detail}`)
    : ['_No cross-section consistency flags._'];

  const densityBody = density.length ? renderDensity(density, input.citation_density_summary) : ['_No citation-density data._'];

  const stalenessBody = staleness.length
    ? staleness.map(
        (s) =>
          `- ${s.section}: ${s.prior_hash} → ${s.new_hash} (re-verify ${s.re_verify_passed ? 'passed' : 'FAILED'})`,
      )
    : ['_No stale sections resolved._'];

  const marker = input.offline_marker !== undefined ? input.offline_marker : offlineMarkerLine();

  const quoteText = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  const acceptedBody = (input.accepted_quotes ?? []).length
    ? (input.accepted_quotes ?? []).map(
        (a) => `- section ${a.section} ${a.id} [@${a.citekey}] "${quoteText(a.excerpt)}" — accepted ${a.accepted_at} (${a.via === 'flag' ? '--accept-quote' : 'at the prompt'})`,
      )
    : [ACCEPTED_QUOTES_EMPTY_MARKER];
  const localBody = (input.local_file_quotes ?? []).length
    ? (input.local_file_quotes ?? []).map((q) => `- ${q.id} [@${q.citekey}] "${quoteText(q.excerpt)}…" — verified against your local file ${q.file}`)
    : [LOCAL_FILE_QUOTES_EMPTY_MARKER];

  return [
    renderFrontmatter(input),
    '',
    ...(marker !== null ? [marker, ''] : []),
    section('## Transitions Changed', renderTransitions(input.transitions ?? [], input.smoothing_skipped)),
    '',
    section('## Cross-Section Consistency Flags', consistencyBody),
    '',
    section('## Citation Density', densityBody),
    '',
    section('## Compile-Staleness Resolved', stalenessBody),
    '',
    section('## Advisory Findings', renderAdvisory(input.advisory)),
    '',
    section('## Accepted Quotes', acceptedBody),
    '',
    section('## Quotes Verified Against Your Files', localBody),
    '',
    section('## Contradictions', renderContradictions(input.contradictions)),
    '',
  ].join('\n');
}
