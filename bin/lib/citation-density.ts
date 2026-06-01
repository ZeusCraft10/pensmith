/**
 * bin/lib/citation-density.ts — COMP-05 citation density computation.
 *
 * Computes per-section citations_per_1000_words + paper-wide mean/stdev,
 * then compares the paper-wide mean to the discipline preset target.
 * WARN-only — never throws, never blocks, never refuses.
 *
 * Pure function — no I/O, no LLM, no network.
 * Discipline-target lookup table is defined in this module with a documented
 * default (RESEARCH.md §G / 04-CONTEXT.md D-14 §3).
 *
 * Discipline presets (citations per 1000 words, target band [min, max]):
 *   - stem:       [5, 20]   (STEM fields tend to be highly cited)
 *   - bio:        [8, 25]   (biology/life sciences — dense)
 *   - humanities: [2, 10]   (humanities — sparser)
 *   - social:     [4, 15]   (social sciences)
 *   - cs:         [5, 20]   (computer science — like STEM)
 *   - default:    [3, 20]   (fallback for unknown/empty discipline)
 */

import { extractCitekeys } from './citation-token.js';

// ---------------------------------------------------------------------------
// Discipline preset table
// ---------------------------------------------------------------------------

interface DisciplineTarget {
  min: number;   // lower bound (warn if below)
  max: number;   // upper bound (warn if above)
}

/** Discipline → target density band (citations per 1000 words). */
const DISCIPLINE_TARGETS: Record<string, DisciplineTarget> = {
  stem:       { min: 5,  max: 20 },
  bio:        { min: 8,  max: 25 },
  humanities: { min: 2,  max: 10 },
  social:     { min: 4,  max: 15 },
  cs:         { min: 5,  max: 20 },
  // Default fallback — used when discipline is unknown or not set.
  // Deliberately wide to minimize false-positive warns on novel disciplines.
  default:    { min: 3,  max: 20 },
};

const DEFAULT_TARGET = DISCIPLINE_TARGETS['default'] as DisciplineTarget;

function getTarget(discipline: string): DisciplineTarget {
  const normalized = (discipline ?? '').toLowerCase().trim();
  return DISCIPLINE_TARGETS[normalized] ?? DEFAULT_TARGET;
}

// ---------------------------------------------------------------------------
// Word counting
// ---------------------------------------------------------------------------

/**
 * Count words in markdown text (simple whitespace split).
 * Strips citation tokens and markdown syntax to count prose words only.
 * This is an approximation — exact word count varies by definition.
 */
function countPraseWords(text: string): number {
  // Remove citation tokens [@key] — they are not prose words
  const noCitations = text.replace(/\[@[a-z][a-z0-9_-]*\]/g, '');
  // Remove markdown headings, code fences, and HTML-ish tags
  const noMarkdown = noCitations
    .replace(/^#{1,6}\s+.*/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');
  // Split on whitespace and count non-empty tokens
  return noMarkdown.split(/\s+/).filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Per-section density entry. */
export interface SectionDensityEntry {
  n: number;
  slug: string;
  citation_count: number;
  word_count: number;
  citations_per_1000_words: number;
}

/** Discipline target comparison. */
export interface TargetComparison {
  discipline: string;
  target_min: number;
  target_max: number;
  paper_mean: number;
  status: 'below_target' | 'on_target' | 'above_target';
  warn: boolean;
  message: string;
}

/** Full citation density report (COMP-05). */
export interface CitationDensityReport {
  sections: SectionDensityEntry[];
  mean: number;
  stdev: number;
  target_comparison: TargetComparison;
  /** warn: true when paper-wide mean falls outside the discipline preset band. */
  warn: boolean;
}

/**
 * Compute citation density for all sections and compare to the discipline preset.
 *
 * @param sections Array of section descriptors with their draft text.
 * @param discipline The discipline preset key (e.g. 'stem', 'humanities').
 *   If empty/unknown, the 'default' target band is used.
 * @returns CitationDensityReport — always returns a valid report. Never throws. (COMP-05)
 */
export function computeCitationDensity(
  sections: Array<{ n: number; slug: string; text: string }>,
  discipline: string,
): CitationDensityReport {
  const target = getTarget(discipline);
  const sectionEntries: SectionDensityEntry[] = [];

  for (const sec of sections) {
    try {
      const citekeys = extractCitekeys(sec.text);
      const citationCount = citekeys.length;
      const wordCount = countPraseWords(sec.text);
      // Avoid division by zero for empty sections
      const density = wordCount > 0 ? (citationCount / wordCount) * 1000 : 0;
      sectionEntries.push({
        n: sec.n,
        slug: sec.slug,
        citation_count: citationCount,
        word_count: wordCount,
        citations_per_1000_words: Math.round(density * 100) / 100,  // 2 decimal places
      });
    } catch {
      // Fail-safe: if anything throws, add a zero-density entry so the report remains complete
      sectionEntries.push({
        n: sec.n,
        slug: sec.slug,
        citation_count: 0,
        word_count: 0,
        citations_per_1000_words: 0,
      });
    }
  }

  const densities = sectionEntries.map((e) => e.citations_per_1000_words);
  const paperMean = mean(densities);
  const paperStdev = stdev(densities, paperMean);

  // Discipline-target comparison (warn-only)
  let status: 'below_target' | 'on_target' | 'above_target';
  let warn = false;
  let message: string;

  const normDiscipline = (discipline ?? '').toLowerCase().trim() || 'default';
  const resolvedDiscipline = DISCIPLINE_TARGETS[normDiscipline] ? normDiscipline : 'default';

  if (paperMean < target.min) {
    status = 'below_target';
    warn = true;
    message = `Paper-wide citation density ${paperMean.toFixed(2)}/1000 words is BELOW the ${resolvedDiscipline} target band [${target.min}, ${target.max}]. Consider adding more citations to under-supported sections.`;
  } else if (paperMean > target.max) {
    status = 'above_target';
    warn = true;
    message = `Paper-wide citation density ${paperMean.toFixed(2)}/1000 words is ABOVE the ${resolvedDiscipline} target band [${target.min}, ${target.max}]. Consider whether all citations are necessary.`;
  } else {
    status = 'on_target';
    message = `Paper-wide citation density ${paperMean.toFixed(2)}/1000 words is within the ${resolvedDiscipline} target band [${target.min}, ${target.max}].`;
  }

  return {
    sections: sectionEntries,
    mean: Math.round(paperMean * 100) / 100,
    stdev: Math.round(paperStdev * 100) / 100,
    target_comparison: {
      discipline: resolvedDiscipline,
      target_min: target.min,
      target_max: target.max,
      paper_mean: Math.round(paperMean * 100) / 100,
      status,
      warn,
      message,
    },
    warn,
  };
}
