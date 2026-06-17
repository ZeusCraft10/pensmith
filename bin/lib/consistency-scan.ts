// bin/lib/consistency-scan.ts — COMP-04 cross-section claim-consistency (FLAGS ONLY).
//
// Phase 4 Plan 04-05. PURE, deterministic — no LLM, no network, no I/O. Mirrors
// the structured-result-producer shape of bin/lib/verify/pass1.ts: a pure
// function that returns a typed result array and NEVER throws on input and NEVER
// signals a block (COMP-04 is advisory — flags only, never edits, never refuses).
//
// Three heuristics (04-RESEARCH §G):
//   (1) proper-noun divergence — a multi-word Capitalized phrase that appears in
//       2+ sections with DIFFERING surface forms (case-insensitive grouping,
//       case-sensitive comparison) → one flag.
//   (2) abbreviation collision — an `(ABBR)` parenthetical introduced in one
//       section and re-introduced in a LATER section → one flag.
//   (3) heading-tense drift — OFF by default; emitted only when
//       opts.lintHeadings === true (low-confidence, opt-in via --lint-headings).
//
// The compiled markdown plus per-section spans (byte offsets into the compiled
// blob) are the inputs. A span tells the scanner which section each match belongs
// to so it can attribute a flag to a section pair.

/** A section's byte-span within the compiled markdown blob. */
export interface SectionSpan {
  /** 1-based outline order index. */
  n: number;
  /** Section slug (for flag attribution). */
  slug: string;
  /** Inclusive start offset into the compiled markdown. */
  start: number;
  /** Exclusive end offset into the compiled markdown. */
  end: number;
}

/** A single cross-section consistency flag (advisory — never blocks). */
export interface ConsistencyWarning {
  /** The heuristic that produced this flag. */
  kind: 'proper-noun' | 'abbreviation' | 'heading-tense';
  /** Human-readable, report-ready description (rendered into COMPILE-REPORT.md). */
  detail: string;
  /** The section slugs the flag spans (1-2 entries, in appearance order). */
  sections: string[];
}

export interface ConsistencyScanOpts {
  /** Enable the low-confidence heading-tense heuristic (off by default). */
  lintHeadings?: boolean;
}

/** Multi-word Capitalized phrase: two or more TitleCase words in a row. */
const PROPER_NOUN_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
/** Abbreviation parenthetical: `(ABBR)` where ABBR is 2+ uppercase letters. */
const ABBR_RE = /\(([A-Z]{2,})\)/g;
/** A markdown heading line (ATX `#`-prefixed). */
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;

/** Which section span (slug) does a byte offset fall inside? */
function slugAt(spans: SectionSpan[], offset: number): string | null {
  for (const s of spans) {
    if (offset >= s.start && offset < s.end) return s.slug;
  }
  return null;
}

/**
 * Cross-section claim-consistency scan (COMP-04 — FLAGS ONLY).
 *
 * @param compiledMd the full compiled manuscript markdown.
 * @param sectionSpans byte-spans locating each section in `compiledMd`.
 * @param opts optional flags (heading-tense heuristic is opt-in).
 * @returns a (possibly empty) array of advisory warnings. NEVER throws.
 */
export function runConsistencyScan(
  compiledMd: string,
  sectionSpans: SectionSpan[],
  opts: ConsistencyScanOpts = {},
): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];
  // Defensive: a non-string input must not throw — return no flags.
  if (typeof compiledMd !== 'string' || !Array.isArray(sectionSpans)) return warnings;

  // ---- (1) proper-noun divergence ----------------------------------------
  // Step 1: collect the canonical multi-word TitleCase phrases (the "proper
  // noun" candidates) and key them by their lowercased word-sequence.
  // Step 2: for each candidate phrase, search the WHOLE document
  // case-insensitively for the same word-sequence with ANY casing, so a variant
  // like "Bayesian network" (lowercased second word — which would NOT match the
  // strict TitleCase regex) is still grouped under "bayesian network". A key
  // seen in 2+ sections with 2+ distinct surface forms produces one flag.
  const candidateKeys = new Set<string>();
  for (const m of compiledMd.matchAll(PROPER_NOUN_RE)) {
    candidateKeys.add(m[0].toLowerCase());
  }

  for (const key of candidateKeys) {
    // Build a case-insensitive matcher for this exact word-sequence. Escape any
    // regex metacharacters; collapse the original single spaces to `\s+` so an
    // edited document with different whitespace still matches.
    const words = key.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const phraseRe = new RegExp(`\\b${words.join('\\s+')}\\b`, 'gi');
    const forms = new Set<string>();
    const slugs = new Set<string>();
    for (const pm of compiledMd.matchAll(phraseRe)) {
      const slug = slugAt(sectionSpans, pm.index ?? 0);
      if (slug === null) continue;
      forms.add(pm[0]);
      slugs.add(slug);
    }
    if (forms.size >= 2 && slugs.size >= 2) {
      const formList = [...forms];
      const slugList = [...slugs];
      warnings.push({
        kind: 'proper-noun',
        detail: `proper-noun surface divergence across [${slugList.join(', ')}]: ${formList.map((f) => `"${f}"`).join(' vs ')}`,
        sections: slugList,
      });
    }
  }

  // ---- (2) abbreviation collision ----------------------------------------
  // Track the FIRST section that introduces an (ABBR); a later section that
  // re-introduces the same (ABBR) parenthetical is a collision.
  const abbrFirstSlug = new Map<string, string>();
  for (const m of compiledMd.matchAll(ABBR_RE)) {
    const abbr = m[1];
    if (abbr === undefined) continue;
    const offset = m.index ?? 0;
    const slug = slugAt(sectionSpans, offset);
    if (slug === null) continue;
    const first = abbrFirstSlug.get(abbr);
    if (first === undefined) {
      abbrFirstSlug.set(abbr, slug);
    } else if (first !== slug) {
      warnings.push({
        kind: 'abbreviation',
        detail: `abbreviation "(${abbr})" introduced in [${first}] is re-introduced in [${slug}]`,
        sections: [first, slug],
      });
    }
  }

  // ---- (3) heading-tense drift (opt-in only) -----------------------------
  if (opts.lintHeadings === true) {
    // Collect the first content word's tense-shape per heading; a mixture of
    // gerund/past-participle vs bare-noun across headings is a low-confidence
    // drift signal. We emit one flag per heading that ends in -ed/-ing applied
    // to its leading word, attributed to the heading's section.
    const lines = compiledMd.split(/\r?\n/);
    let cursor = 0;
    for (const line of lines) {
      const lineStart = cursor;
      cursor += line.length + 1; // +1 for the consumed newline
      const hm = HEADING_RE.exec(line);
      if (!hm) continue;
      const headingText = hm[1] ?? '';
      const slug = slugAt(sectionSpans, lineStart);
      if (slug === null) continue;
      if (/\b\w+(ed|ing)\b/i.test(headingText)) {
        warnings.push({
          kind: 'heading-tense',
          detail: `heading tense (advisory) in [${slug}]: "${headingText}" uses a verbal form (-ed/-ing)`,
          sections: [slug],
        });
      }
    }
  }

  return warnings;
}

export default runConsistencyScan;
