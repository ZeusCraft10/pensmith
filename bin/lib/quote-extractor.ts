// bin/lib/quote-extractor.ts — the direct quotations Pass 3 checks.
//
// The quotations and their citations come from the citation grammar
// (findQuotes): straight, curly and single quote marks and block quotes,
// attributed to the citation after them, inside them, or before them in the
// same sentence, in any Pandoc form (`[@key, p. 12]`, `[@a; @b]`, `@key`).
//
// A quotation attributed to a cluster is checked against every work the
// cluster cites. One of at least MIN_WORDS words is matched with the fuzzy
// matcher; a shorter one (MIN_SHORT_WORDS or more) must appear exactly, since
// a fuzzy threshold on a few words accepts a changed word. One or two quoted
// words are usually a term, not a quotation, and are left alone. An ellipsis
// is not a word. A quotation of MIN_WORDS or more with no citation at all
// cannot be checked against anything, so it is reported as unattributed and
// blocks.

import { findQuotes } from './citation-grammar.js';

export interface ExtractedQuote {
  /** The quoted text, with citations removed and whitespace collapsed. */
  text: string;
  /** The citekey the quotation is checked against; '' when it cites nothing. */
  citekey: string;
  /** Whether this was a markdown block quote (`> ...`) or an inline quote. */
  kind: 'block' | 'inline';
  /** True for a short quotation, which must appear verbatim. */
  exact: boolean;
  /** True for a long quotation with no citation. */
  unattributed: boolean;
}

/** A quotation this long is checked with the fuzzy matcher, or blocks when it cites nothing. */
export const MIN_WORDS = 10;
/** A shorter quotation of at least this many words is checked for an exact match. */
export const MIN_SHORT_WORDS = 3;

/** The words in `s`: an ellipsis (`...`, `…`, `[...]`) or a lone dash is not one. */
export function wordCount(s: string): number {
  return s.split(/\s+|\[?(?:\.{3,}|…)\]?/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Extract the quotations Pass 3 checks from a DRAFT.md: one entry per
 * (quotation, cited key) pair, plus one unattributed entry for each long
 * quotation that cites nothing.
 */
export function extractQuotes(draftMd: string): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];
  for (const q of findQuotes(draftMd)) {
    const words = wordCount(q.text);
    if (!q.citation) {
      if (words >= MIN_WORDS) out.push({ text: q.text, citekey: '', kind: q.kind, exact: false, unattributed: true });
      continue;
    }
    if (words < MIN_SHORT_WORDS) continue;
    const keys = [...new Set(q.citation.items.map((i) => i.key))];
    for (const citekey of keys) {
      out.push({ text: q.text, citekey, kind: q.kind, exact: words < MIN_WORDS, unattributed: false });
    }
  }
  return out;
}
