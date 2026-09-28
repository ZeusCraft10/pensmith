// bin/lib/citation-density.ts — citation density against the discipline's
// per-paragraph band (COMP-05; GRND-06, PRD §8).
//
// PURE, deterministic — no LLM, no network, no I/O. WARN-ONLY: the report
// carries warnings; it NEVER throws and NEVER signals a block (COMP-05 is
// advisory).
//
// PRD §8 states citation density per PARAGRAPH (0.5–2 for the humanities, 1–3,
// 2–4 for the sciences). The band comes from the discipline preset through
// bin/lib/disciplines.ts densityBandFor() — the one place a discipline maps to
// a density (GRND-06; the old hard-coded per-1000-words table is gone). A
// paragraph is a block of prose between blank lines; headings, list items,
// block quotes, tables and code are not paragraphs. Each section's mean
// citations per paragraph is compared with the band, and the paragraphs
// outside it are listed (section, index, first words, count).
//
// D-14 §3 (LOCKED): the report still carries each section's
// citations_per_1000_words and the paper-wide mean and stdev of those.

import { countCitations as countCitationKeys } from './citation-token.js';
import { densityBandFor, normalizeDisciplineSlug } from './disciplines.js';

export type DensityStatus = 'below' | 'within' | 'above';

export interface DensityBand {
  readonly min: number;
  readonly max: number;
}

/** A prose paragraph whose citation count falls outside the band. */
export interface CitationDensityParagraph {
  /** 1-based index among the section's prose paragraphs. */
  readonly index: number;
  readonly citations: number;
  /** The paragraph's first words (≤ 8), for the report. */
  readonly firstWords: string;
  readonly status: Exclude<DensityStatus, 'within'>;
}

export interface CitationDensitySectionEntry {
  n: number;
  /** GRND-09: the section's letter (§1a); absent for a plain §N. */
  suffix?: string;
  slug: string;
  /** Number of `[@key]` citation markers in the section text. */
  citations: number;
  /** Number of whitespace-delimited tokens in the section text. */
  words: number;
  /** citations / words * 1000 (0 when the section has no words) — D-14. */
  citations_per_1000_words: number;
  /** Prose paragraphs in the section. */
  paragraphs: number;
  /** Mean citations per prose paragraph (0 when there is none). */
  citations_per_paragraph: number;
  /** The section's mean against the band ('within' for a section with no prose). */
  status: DensityStatus;
  /** Prose paragraphs outside the band. */
  out_of_band: CitationDensityParagraph[];
}

export interface CitationDensityWarning {
  detail: string;
}

export interface CitationDensityReport {
  sections: CitationDensitySectionEntry[];
  /** Paper-wide mean of the per-section citations_per_1000_words (0 when no sections) — D-14. */
  mean: number;
  /** Paper-wide population stdev of the per-section citations_per_1000_words (0 when < 2) — D-14. */
  stdev: number;
  /** The discipline preset slug whose band was applied. */
  discipline: string;
  /** The preset's citations-per-paragraph band. */
  band: DensityBand;
  /** The band centre (citations per paragraph). */
  target: number;
  /** Paper-wide mean citations per prose paragraph. */
  mean_per_paragraph: number;
  /** Where the paper-wide per-paragraph mean falls relative to the band. */
  comparison: DensityStatus;
  /** Advisory warnings (empty when every section is within the band). NEVER blocks. */
  warnings: CitationDensityWarning[];
}

/** Count whitespace-delimited tokens (citation markers count as tokens too). */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Count citations (occurrences, not distinct keys): every key of every
 * citation — `[@a]` counts 1, a cluster `[@a; @b]` counts 2.
 */
function countCitations(text: string): number {
  return countCitationKeys(text);
}

/** A line that is not prose: a heading, list item, block quote, table row, rule or HTML comment. */
function isNonProseLine(line: string): boolean {
  return /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<!--|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/.test(line);
}

/**
 * The prose paragraphs of a Markdown text: blocks separated by blank lines,
 * minus headings, list items, block quotes, tables and fenced code (CRLF-safe).
 */
export function proseParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const p = cur.join(' ').trim();
    if (p.length > 0) out.push(p);
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    if (isNonProseLine(line)) {
      flush();
      continue;
    }
    cur.push(line.trim());
  }
  flush();
  return out;
}

function statusOf(value: number, band: DensityBand): DensityStatus {
  if (value < band.min) return 'below';
  if (value > band.max) return 'above';
  return 'within';
}

function firstWords(p: string): string {
  const words = p.replace(/\[@[^\]]*\]/g, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 8).join(' ') + (words.length > 8 ? ' …' : '');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "1–3" for a band. */
export function bandLabel(band: DensityBand): string {
  return `${fmt(band.min)}–${fmt(band.max)}`;
}

/**
 * Compute each section's citations per paragraph against the discipline's
 * band (plus the D-14 per-1000-words figures). WARN-only; NEVER throws.
 *
 * @param sections the compiled sections ({ n, suffix?, slug, text }).
 * @param discipline a preset slug, name or alias (anything unknown gets the
 *   fallback preset's band).
 */
export function computeCitationDensity(
  sections: Array<{ n: number; suffix?: string | undefined; slug: string; text: string }>,
  discipline: string,
): CitationDensityReport {
  const slug = normalizeDisciplineSlug(discipline ?? '');
  const preset = densityBandFor(slug);
  const band: DensityBand = { min: preset.min, max: preset.max };
  const warnings: CitationDensityWarning[] = [];
  let allParagraphs = 0;
  let allParagraphCitations = 0;

  const entries: CitationDensitySectionEntry[] = (Array.isArray(sections) ? sections : []).map((s) => {
    const text = s.text ?? '';
    const words = countWords(text);
    const citations = countCitations(text);
    const paras = proseParagraphs(text);
    const counts = paras.map(countCitations);
    const paraCitations = counts.reduce((a, b) => a + b, 0);
    allParagraphs += paras.length;
    allParagraphCitations += paraCitations;
    const perParagraph = paras.length > 0 ? paraCitations / paras.length : 0;
    const outOfBand: CitationDensityParagraph[] = [];
    counts.forEach((c, i) => {
      const st = statusOf(c, band);
      if (st !== 'within') outOfBand.push({ index: i + 1, citations: c, firstWords: firstWords(paras[i] as string), status: st });
    });
    const status = paras.length > 0 ? statusOf(perParagraph, band) : 'within';
    const suffix = typeof s.suffix === 'string' && s.suffix.length > 0 ? s.suffix : undefined;
    if (status !== 'within') {
      warnings.push({
        detail: `§${s.n}${suffix ?? ''} (${s.slug}): ${fmt(perParagraph)} citations per paragraph is ${status.toUpperCase()} the ${slug} band ${bandLabel(band)} (${paras.length} paragraph(s), ${outOfBand.length} outside the band)`,
      });
    }
    return {
      n: s.n,
      ...(suffix !== undefined ? { suffix } : {}),
      slug: s.slug,
      citations,
      words,
      citations_per_1000_words: words > 0 ? (citations / words) * 1000 : 0,
      paragraphs: paras.length,
      citations_per_paragraph: perParagraph,
      status,
      out_of_band: outOfBand,
    };
  });

  const densities = entries.map((e) => e.citations_per_1000_words);
  const mean = densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0;
  const variance = densities.length > 0 ? densities.reduce((a, d) => a + (d - mean) * (d - mean), 0) / densities.length : 0;
  const meanPerParagraph = allParagraphs > 0 ? allParagraphCitations / allParagraphs : 0;
  const comparison: DensityStatus = allParagraphs === 0 ? 'within' : statusOf(meanPerParagraph, band);

  return {
    sections: entries,
    mean,
    stdev: Math.sqrt(variance),
    discipline: slug,
    band,
    target: (band.min + band.max) / 2,
    mean_per_paragraph: meanPerParagraph,
    comparison,
    warnings,
  };
}

export default computeCitationDensity;
