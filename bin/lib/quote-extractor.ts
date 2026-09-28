// bin/lib/quote-extractor.ts — quote extraction from section DRAFT.md (Pass-3 input).
//
// REVIEWS amendment (Codex HIGH #4, OpenCode HIGH #4) — strict rules:
//   - Block quotes (lines starting with '> '): include if word count >= 10
//   - Inline quotes (text wrapped in "..." / "..." / '...' typographic):
//     include if >= 10 words AND >= 60 chars
//   - Multi-paragraph block quote (consecutive '> ' lines): treat as ONE
//     quote, summed word count
//   - Strip Pandoc citations (`[@citekey]`, `[@a; @b]`, `[@a, p. 5]`) BEFORE
//     counting words
//   - Quote MUST be associated with the immediately-following citation
//     (within 200 chars; OR ~4 lines if extracted from a block). A citation
//     CLUSTER after a quote attributes the quote to EVERY key in it (one entry
//     per key), so each cited source must contain it — fail closed: a quote
//     followed by `[@real; @fabricated]` is checked against both, never
//     skipped as "unattributed" (AUDIT-FINDINGS #2/#3). An author-suppressed
//     `[-@k]` or a narrative `@k` right after the quote attributes it the same
//     way.
//   - A quote with no citation after it is attributed to a NARRATIVE citation
//     that introduces it in the same sentence (`As @k wrote, "…"`) or, for a
//     block quote, in the lead-in line (`@k puts it this way:` then `> …`).
//     Every Pandoc citation form is read through citation-token.ts.
//
// The thresholds (MIN_WORDS=10, MIN_INLINE_CHARS=60) are calibration knobs
// — Pass-3 only runs against quotes a human is likely to lift verbatim from
// a source. Short quoted phrases (≤9 words) are too noisy to verify and
// would generate false positives.

import { findCitations, findNarrativeCitations, firstCitation, stripCitationClusters, type CitationCluster } from './citation-token.js';

export interface ExtractedQuote {
  /** The quoted text, with citation tokens stripped and whitespace collapsed. */
  text: string;
  /** The citekey associated with this quote (a key of the citation immediately following). */
  citekey: string;
  /** Whether this was a markdown block quote (`> ...`) or an inline quote. */
  kind: 'block' | 'inline';
}

const MIN_WORDS = 10;
const MIN_INLINE_CHARS = 60;

function stripCites(s: string): string {
  return stripCitationClusters(s).replace(/\s+/g, ' ').trim();
}

/** One entry per distinct key of `keys` (a cluster's keys, in order). */
function perKey(text: string, keys: readonly string[], kind: ExtractedQuote['kind']): ExtractedQuote[] {
  return [...new Set(keys)].map((citekey) => ({ text, citekey, kind }));
}

function wordCount(s: string): number {
  return stripCites(s).split(/\s+/).filter(Boolean).length;
}

/**
 * The narrative citation that introduces the text that follows `lead`: the
 * last narrative `@key` in `lead` whose sentence runs on to the end of `lead`
 * (no sentence end and no blank line after it), at most 200 chars back.
 */
function introducingNarrative(lead: string): CitationCluster | null {
  // The last 200 chars; a word the cut splits is dropped (never a false `@key`).
  const window = lead.length > 200 ? lead.slice(-200).replace(/^\S*/, '') : lead;
  const cites = findNarrativeCitations(window);
  const last = cites[cites.length - 1];
  if (!last) return null;
  // A locator right after the citation (`@k [p. 3] wrote`) is not a sentence end.
  const after = window.slice(last.end).replace(/\[[^[\]]*\]/g, '');
  if (/[.!?](?=\s|$)/.test(after) || /\n[ \t]*\n/.test(after)) return null;
  return last;
}

/**
 * Extract verifiable quotes from a DRAFT.md.
 *
 * Returns an array of `{ text, citekey, kind }` entries. Each entry's `text`
 * is suitable for direct comparison with PDF-extracted source text via
 * `levenshteinSubstring`. A quote followed by a cluster yields one entry per
 * key. Quotes with no citation immediately following and no narrative citation
 * introducing them are dropped — Pass-3 cannot verify an unattributed quote
 * (Pass 4 reports the uncited claim).
 */
export function extractQuotes(draftMd: string): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];
  const md = draftMd.replace(/\r\n?/g, '\n');

  // ---- Block quotes ('> ' line runs) ----------------------------------
  const lines = md.split('\n');
  let blockBuf: string[] = [];
  let blockStartIdx = -1;
  let blockEndIdx = -1;

  const flushBlock = (): void => {
    if (blockBuf.length === 0) return;
    const text = blockBuf.join(' ');
    if (wordCount(text) >= MIN_WORDS) {
      // The first citation (a cluster or a narrative one) within ~4 lines after
      // the block end; else a narrative citation in the lead-in line(s).
      const lookAhead = lines.slice(blockEndIdx + 1, blockEndIdx + 5).join(' ');
      const cite = firstCitation(lookAhead) ?? introducingNarrative(lines.slice(Math.max(0, blockStartIdx - 2), blockStartIdx).join('\n').replace(/\n[ \t]*$/, ''));
      if (cite) out.push(...perKey(stripCites(text), cite.keys, 'block'));
    }
    blockBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('> ')) {
      if (blockBuf.length === 0) blockStartIdx = i;
      blockBuf.push(line.slice(2));
      blockEndIdx = i;
    } else {
      flushBlock();
    }
  }
  // Tail flush in case the draft ends with a block quote.
  flushBlock();

  // ---- Inline quotes ("..." or "...") --------------------------------
  // An opening quote (" or “), >=60 chars of non-quote content, a closing
  // quote; then the citation that starts right after it (whitespace only
  // between) — a bare `[@key]`, a cluster (`[@a; @b]`, `[@a, p. 5]`,
  // `[see @a]`, `[-@a]`) or a narrative `@a` — else the narrative citation that
  // introduces the quote in the same sentence. Read with the one grammar.
  const cites = findCitations(md);
  const inlineRe = /["“]([^"”]{60,})["”]/g;
  for (const m of md.matchAll(inlineRe)) {
    const text = m[1] ?? '';
    if (!text) continue;
    if (text.length < MIN_INLINE_CHARS) continue;
    if (wordCount(text) < MIN_WORDS) continue;
    const close = m.index + m[0].length;
    const gap = /^\s*/.exec(md.slice(close))?.[0].length ?? 0;
    const following = cites.find((c) => c.start === close + gap);
    const cite = following ?? introducingNarrative(md.slice(Math.max(0, m.index - 201), m.index));
    if (!cite) continue;
    out.push(...perKey(stripCites(text), cite.keys, 'inline'));
  }

  return out;
}
