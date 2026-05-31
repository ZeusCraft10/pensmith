/**
 * bin/lib/consistency-scan.ts — COMP-04 cross-section claim-consistency scan.
 *
 * Produces ConsistencyWarning[] (FLAGS ONLY). This module:
 *   - NEVER throws on any input
 *   - NEVER edits the compiled text
 *   - NEVER signals a block or refuse
 *   - Is 100% deterministic (no LLM, no network, no I/O)
 *
 * Three heuristics (from 04-RESEARCH §G):
 *   1. Proper-noun divergence: phrases matching \b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b
 *      that appear in 2+ sections with different surface forms → one flag per group.
 *   2. Abbreviation collision: `(ABBR)` re-introduced across sections → flag.
 *   3. Heading-tense drift: only when opts.lintHeadings === true (OFF by default).
 */

/** Section boundary descriptor — start and end character offsets in compiled text. */
export interface SectionSpan {
  n: number;
  start: number;
  end: number;
}

/** Type-safe heuristic identifier. */
export type ConsistencyHeuristic = 'proper-noun-divergence' | 'abbreviation-collision' | 'heading-tense-drift';

/** A single consistency flag (COMP-04 — warning only, never blocking). */
export interface ConsistencyWarning {
  heuristic: ConsistencyHeuristic;
  message: string;
  sections: number[];
  /** The differing surface forms detected (for proper-noun and abbreviation heuristics). */
  forms?: string[];
}

/** Options for runConsistencyScan. */
export interface ConsistencyScanOpts {
  /** Enable the heading-tense-drift heuristic (OFF by default per COMP-04). */
  lintHeadings?: boolean;
}

// ---------------------------------------------------------------------------
// Heuristic 1: Proper-noun divergence
// Regex: \b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b — a run of at least 2 title-case words.
// Cross-section exact-equality check: if section A says "Bayesian Network" and
// section B says "Bayesian network", that is a surface-form divergence → flag.
// ---------------------------------------------------------------------------

const PROPER_NOUN_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

/**
 * Extract all proper-noun phrases from a text fragment.
 * Returns a Set of unique lowercase-normalized forms for deduplication,
 * along with the original (case-preserved) forms for the flag message.
 */
function extractProperNouns(text: string): Map<string, string> {
  // Map from lowercase canonical form → first observed surface form
  const found = new Map<string, string>();
  for (const match of text.matchAll(PROPER_NOUN_RE)) {
    const surface = match[0];
    const canonical = surface.toLowerCase();
    if (!found.has(canonical)) {
      found.set(canonical, surface);
    }
  }
  return found;
}

function scanProperNounDivergence(
  compiledMd: string,
  boundaries: SectionSpan[],
): ConsistencyWarning[] {
  if (boundaries.length < 2) return [];

  // For each section, collect canonical → surface mappings
  const sectionNouns: Array<Map<string, string>> = boundaries.map((b) => {
    const text = compiledMd.slice(b.start, b.end);
    return extractProperNouns(text);
  });

  // Collect ALL canonical forms from ALL sections (for cross-section comparison)
  const allCanonicals = new Set<string>();
  for (const sectionMap of sectionNouns) {
    for (const canonical of sectionMap.keys()) {
      allCanonicals.add(canonical);
    }
  }

  // For each canonical form found in any section as title-case, also check
  // if the same lowercase phrase appears in other sections (case divergence).
  // Build a map from canonical → all actual surface forms seen + their sections.
  const canonicalToSurfaces = new Map<string, Map<string, number[]>>();

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const n = b?.n ?? i + 1;
    const text = compiledMd.slice(b?.start ?? 0, b?.end ?? compiledMd.length);

    // Find any occurrence (including lowercase variants) of each known canonical form
    for (const canonical of allCanonicals) {
      // Escape canonical for regex use
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match case-insensitively to find all surface forms
      const caseInsensitiveRE = new RegExp(`\\b${escaped}\\b`, 'gi');
      for (const match of text.matchAll(caseInsensitiveRE)) {
        const surface = match[0];
        if (!canonicalToSurfaces.has(canonical)) {
          canonicalToSurfaces.set(canonical, new Map());
        }
        const surfMap = canonicalToSurfaces.get(canonical)!;
        const existing = surfMap.get(surface) ?? [];
        if (!existing.includes(n)) existing.push(n);
        surfMap.set(surface, existing);
      }
    }
  }

  // Find canonical forms that appear in 2+ sections with DIFFERENT surface forms
  const warnings: ConsistencyWarning[] = [];

  for (const [canonical, surfaceForms] of canonicalToSurfaces.entries()) {
    // If more than one distinct surface form exists → divergence
    if (surfaceForms.size > 1) {
      const forms = Array.from(surfaceForms.keys());
      const sectionNumbers = Array.from(surfaceForms.values()).flat().sort((a, b) => a - b);
      const uniqueSections = [...new Set(sectionNumbers)].sort((a, b) => a - b);
      warnings.push({
        heuristic: 'proper-noun-divergence',
        message: `Proper noun "${canonical}" appears in sections ${uniqueSections.join(', ')} with different surface forms: ${forms.map((f) => `"${f}"`).join(', ')}`,
        sections: uniqueSections,
        forms,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Heuristic 2: Abbreviation collision
// Pattern: `(ABBR)` where ABBR is 2–8 uppercase letters.
// An abbreviation introduced in section K and re-introduced in a later section
// (i.e., the expansion appears again in parentheses) → flag.
// ---------------------------------------------------------------------------

const ABBR_RE = /\(([A-Z]{2,8})\)/g;

function scanAbbreviationCollisions(
  compiledMd: string,
  boundaries: SectionSpan[],
): ConsistencyWarning[] {
  if (boundaries.length < 2) return [];

  // Map from abbreviation → first section where it was introduced
  const firstIntroduced = new Map<string, number>();
  const warnings: ConsistencyWarning[] = [];

  for (const b of boundaries) {
    const text = compiledMd.slice(b.start, b.end);
    const n = b.n;

    for (const match of text.matchAll(ABBR_RE)) {
      const abbr = match[1];
      if (!abbr) continue;
      const firstSec = firstIntroduced.get(abbr);
      if (firstSec === undefined) {
        // First introduction — record it
        firstIntroduced.set(abbr, n);
      } else if (firstSec !== n) {
        // Re-introduction in a later section → flag
        // Only flag once per abbreviation (avoid duplicate warnings)
        const alreadyFlagged = warnings.some(
          (w) => w.heuristic === 'abbreviation-collision' && w.forms?.includes(abbr),
        );
        if (!alreadyFlagged) {
          warnings.push({
            heuristic: 'abbreviation-collision',
            message: `Abbreviation "(${abbr})" first introduced in section ${firstSec} is re-introduced in section ${n}`,
            sections: [firstSec, n],
            forms: [abbr],
          });
        }
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Heuristic 3: Heading-tense drift (OFF by default — only with lintHeadings: true)
// Detect headings that mix past and present tense.
// This is a best-effort heuristic with inherent false-positive risk;
// hence it is opt-in only.
// ---------------------------------------------------------------------------

// Simple tense markers in headings
const PAST_TENSE_RE = /\b(was|were|had|explored|used|presented|showed|demonstrated|applied|identified|found|conducted|examined)\b/i;
const PRESENT_TENSE_RE = /\b(is|are|has|explore|use|present|show|demonstrate|apply|identify|find|conduct|examine)\b/i;

function scanHeadingTenseDrift(
  compiledMd: string,
  boundaries: SectionSpan[],
): ConsistencyWarning[] {
  const headingRE = /^#{1,6}\s+(.+)$/gm;
  const past: Array<{ heading: string; section: number }> = [];
  const present: Array<{ heading: string; section: number }> = [];

  for (const b of boundaries) {
    const text = compiledMd.slice(b.start, b.end);
    for (const match of text.matchAll(headingRE)) {
      const heading = match[1] ?? '';
      if (PAST_TENSE_RE.test(heading)) {
        past.push({ heading, section: b.n });
      } else if (PRESENT_TENSE_RE.test(heading)) {
        present.push({ heading, section: b.n });
      }
    }
  }

  if (past.length > 0 && present.length > 0) {
    const pastSections = [...new Set(past.map((h) => h.section))].sort((a, b) => a - b);
    const presentSections = [...new Set(present.map((h) => h.section))].sort((a, b) => a - b);
    return [
      {
        heuristic: 'heading-tense-drift',
        message: `Heading tense drift detected: past-tense headings in sections ${pastSections.join(', ')} and present-tense headings in sections ${presentSections.join(', ')}`,
        sections: [...new Set([...pastSections, ...presentSections])].sort((a, b) => a - b),
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the cross-section claim-consistency scan.
 *
 * @param compiledMd The full compiled draft text (all sections concatenated).
 * @param sectionBoundaries Start/end offsets for each section in compiledMd.
 * @param opts Optional configuration; only `lintHeadings` is supported.
 * @returns ConsistencyWarning[] — flags only. The array may be empty. Never throws.
 *   Never edits, never blocks, never refuses.
 */
export function runConsistencyScan(
  compiledMd: string,
  sectionBoundaries: SectionSpan[],
  opts?: ConsistencyScanOpts,
): ConsistencyWarning[] {
  try {
    const warnings: ConsistencyWarning[] = [];

    // Heuristic 1: proper-noun divergence
    warnings.push(...scanProperNounDivergence(compiledMd, sectionBoundaries));

    // Heuristic 2: abbreviation collision
    warnings.push(...scanAbbreviationCollisions(compiledMd, sectionBoundaries));

    // Heuristic 3: heading-tense drift (opt-in only)
    if (opts?.lintHeadings === true) {
      warnings.push(...scanHeadingTenseDrift(compiledMd, sectionBoundaries));
    }

    return warnings;
  } catch {
    // Fail-safe: if any heuristic throws (e.g., malformed regex match),
    // return an empty array rather than propagating the error. The scan is
    // advisory and must never block compile.
    return [];
  }
}
