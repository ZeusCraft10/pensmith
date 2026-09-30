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
 * The offsets of the double-quote marks Pandoc's smart-quote reader opens a
 * quote with, pairing left to right: outside a quote, `"` or `“` with a
 * non-space right after it opens one; inside, the next `"` or `”` closes it.
 * A blank line ends a paragraph and any quote left open in it.
 */
function pandocQuoteOpeners(md: string): Set<number> {
  const openers = new Set<number>();
  const blankLine = /\n[ \t]*\n/y;
  let inside = false;
  for (let i = 0; i < md.length; i++) {
    const c = md[i];
    blankLine.lastIndex = i;
    if (c === '\n' && blankLine.test(md)) {
      inside = false;
    } else if (!inside && (c === '"' || c === '“') && /\S/.test(md[i + 1] ?? ' ')) {
      openers.add(i);
      inside = true;
    } else if (inside && (c === '"' || c === '”')) {
      inside = false;
    }
  }
  return openers;
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
  //
  // A straight `"` is both an opening and a closing mark, so a match is only a
  // candidate pairing: the mark that closes a short "scare quote" pairs with
  // the OPENING mark of the next, real quote across the prose between them.
  // Only a quote with a citation right after it consumes both of its marks;
  // any other match resumes one character on, so its closing mark can still
  // open the next quote (Phase 19 review round 2 — else a cited quote after a
  // short quoted phrase never reaches Pass 3 or the GRND-14 check). A span
  // never crosses an opening `“`: that mark starts a quote of its own.
  const cites = findCitations(md);
  const openers = pandocQuoteOpeners(md);
  const inlineRe = /["“]([^"“”]{60,})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(md)) !== null) {
    const text = m[1] ?? '';
    const sized = text.length >= MIN_INLINE_CHARS && wordCount(text) >= MIN_WORDS;
    const close = m.index + m[0].length;
    const gap = /^\s*/.exec(md.slice(close))?.[0].length ?? 0;
    const following = sized ? cites.find((c) => c.start === close + gap) : undefined;
    if (following) {
      out.push(...perKey(stripCites(text), following.keys, 'inline'));
      continue;
    }
    inlineRe.lastIndex = m.index + 1;
    // A narrative citation claims only a pair Pandoc renders as a quote, so
    // the prose between two quotes (from the mark that closed the first to the
    // mark that opens the next) is never taken for a quote of the source that
    // introduced the first one.
    if (!sized || !openers.has(m.index)) continue;
    const narrative = introducingNarrative(md.slice(Math.max(0, m.index - 201), m.index));
    if (narrative) out.push(...perKey(stripCites(text), narrative.keys, 'inline'));
  }

  return out;
}
