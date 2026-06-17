// bin/lib/citation-density.ts — COMP-05 citation density vs discipline target.
//
// Phase 4 Plan 04-05. PURE, deterministic — no LLM, no network, no I/O. Mirrors
// the structured-result-producer shape of bin/lib/verify/pass1.ts. WARN-ONLY:
// the report carries warnings; it NEVER throws and NEVER signals a block (COMP-05
// is advisory).
//
// D-14 §3 (LOCKED): the `## Citation Density` body carries per-section
// {citations_per_1000_words} plus paper-wide mean and stdev. COMP-05 adds the
// comparison of the paper-wide mean to the discipline preset target.
//
// Discipline preset target (COMP-05): the discipline chosen at intake drives the
// target citations-per-1000-words band. The discipline is currently surfaced in
// intake/outline prompts but is NOT yet persisted in a machine-readable config
// file (Phase 6 export will formalize that). So this module ships a small
// discipline→target lookup with a DOCUMENTED DEFAULT for any unknown/unset
// discipline. The caller (compile.ts) passes whatever discipline string it can
// resolve; the comparison degrades gracefully to the default when the discipline
// is unknown. The comparison is WARN-only and NEVER blocks compile.

import { CITATION_TOKEN_RE } from './citation-token.js';

export interface CitationDensitySectionEntry {
  n: number;
  slug: string;
  /** Number of `[@key]` citation markers in the section text. */
  citations: number;
  /** Number of whitespace-delimited tokens in the section text. */
  words: number;
  /** citations / words * 1000 (0 when the section has no words). */
  citations_per_1000_words: number;
}

export interface CitationDensityWarning {
  detail: string;
}

export interface CitationDensityReport {
  sections: CitationDensitySectionEntry[];
  /** Paper-wide mean of the per-section densities (0 when no sections). */
  mean: number;
  /** Paper-wide population stdev of the per-section densities (0 when <2). */
  stdev: number;
  /** The discipline whose target band was applied (resolved or 'default'). */
  discipline: string;
  /** The resolved target citations-per-1000-words (the band centre). */
  target: number;
  /** Where the paper-wide mean falls relative to the target band. */
  comparison: 'below' | 'within' | 'above';
  /** Advisory warnings (empty when the mean is within the band). NEVER blocks. */
  warnings: CitationDensityWarning[];
}

/**
 * Discipline → target citations-per-1000-words band centre. STEM disciplines
 * cite densely; humanities cite more sparsely. These are coarse defaults — the
 * comparison is advisory, so a rough band is sufficient. The `default` entry is
 * the documented fallback for an unknown / unset discipline.
 */
const DISCIPLINE_TARGETS: Readonly<Record<string, number>> = {
  cs: 20,
  bio: 25,
  psych: 22,
  econ: 18,
  history: 12,
  lit: 10,
  philosophy: 12,
  other: 15,
  // Documented fallback when the discipline is unknown or unset.
  default: 15,
};

/** ±50% of the target is treated as "within band" (advisory tolerance). */
const BAND_FRACTION = 0.5;

function resolveTarget(discipline: string): { discipline: string; target: number } {
  const key = (discipline ?? '').trim().toLowerCase();
  const target = DISCIPLINE_TARGETS[key];
  if (typeof target === 'number') return { discipline: key, target };
  return { discipline: 'default', target: DISCIPLINE_TARGETS['default'] as number };
}

/** Count whitespace-delimited tokens (citation markers count as tokens too). */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Count `[@key]` citation markers (occurrences, not distinct keys). */
function countCitations(text: string): number {
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  let count = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

/**
 * Compute per-section + paper-wide citation density and compare the paper-wide
 * mean to the discipline preset target (COMP-05). WARN-only; NEVER throws.
 *
 * @param sections the compiled sections ({ n, slug, text }).
 * @param discipline the discipline preset chosen at intake (any string;
 *   unknown values fall back to the documented default target).
 */
export function computeCitationDensity(
  sections: Array<{ n: number; slug: string; text: string }>,
  discipline: string,
): CitationDensityReport {
  const { discipline: resolvedDiscipline, target } = resolveTarget(discipline);
  const warnings: CitationDensityWarning[] = [];

  const entries: CitationDensitySectionEntry[] = (Array.isArray(sections) ? sections : []).map((s) => {
    const words = countWords(s.text ?? '');
    const citations = countCitations(s.text ?? '');
    const density = words > 0 ? (citations / words) * 1000 : 0;
    return { n: s.n, slug: s.slug, citations, words, citations_per_1000_words: density };
  });

  const densities = entries.map((e) => e.citations_per_1000_words);
  const mean = densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0;
  const variance =
    densities.length > 0
      ? densities.reduce((a, d) => a + (d - mean) * (d - mean), 0) / densities.length
      : 0;
  const stdev = Math.sqrt(variance);

  const lowBand = target * (1 - BAND_FRACTION);
  const highBand = target * (1 + BAND_FRACTION);
  let comparison: 'below' | 'within' | 'above';
  if (entries.length === 0) {
    comparison = 'within'; // no sections → nothing to warn about
  } else if (mean < lowBand) {
    comparison = 'below';
    warnings.push({
      detail: `paper-wide citation density mean ${mean.toFixed(1)}/1000 words is BELOW the ${resolvedDiscipline} target band (~${target}/1000, band ${lowBand.toFixed(1)}–${highBand.toFixed(1)})`,
    });
  } else if (mean > highBand) {
    comparison = 'above';
    warnings.push({
      detail: `paper-wide citation density mean ${mean.toFixed(1)}/1000 words is ABOVE the ${resolvedDiscipline} target band (~${target}/1000, band ${lowBand.toFixed(1)}–${highBand.toFixed(1)})`,
    });
  } else {
    comparison = 'within';
  }

  return { sections: entries, mean, stdev, discipline: resolvedDiscipline, target, comparison, warnings };
}

export default computeCitationDensity;
