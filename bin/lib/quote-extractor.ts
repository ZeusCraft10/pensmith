// bin/lib/quote-extractor.ts — the direct quotations Pass 3 checks.
//
// The quotations and their citations come from the citation grammar
// (findQuotes): straight, curly and single quote marks and block quotes,
// attributed to the citation after them, inside them, or before them in the
// same sentence, in any Pandoc form (`[@key, p. 12]`, `[@a; @b]`, `@key`).
//
// A quotation attributed to a cluster is checked against every work the
// cluster cites, word for word (bin/lib/verify/quote-match.ts), whatever its
// length. One or two quoted words are usually a term, not a quotation, and
// are left alone; the words of a spaced bracket ("[the authors]") are the
// author's, not quoted, and an ellipsis is not a word. A quotation of
// MIN_WORDS or more with no citation at all cannot be checked against
// anything: it is reported as unattributed, which leaves the section
// unverifiable, and every verb that reads it warns.

import { findCitations, findQuotes, type Citation } from './citation-grammar.js';
import { checkedWordCount, MIN_SHORT_WORDS } from './verify/quote-match.js';

export interface ExtractedQuote {
  /** The quoted text, with citations removed and whitespace collapsed. */
  text: string;
  /** The citekey the quotation is checked against; '' when it cites nothing. */
  citekey: string;
  /** Whether this was a markdown block quote (`> ...`) or an inline quote. */
  kind: 'block' | 'inline';
  /** True for a long quotation with no citation. */
  unattributed: boolean;
}

/** A quotation this long that cites nothing is reported as unattributed. */
export const MIN_WORDS = 10;

// An ellipsis marking words left out: `...`, `…` or `[...]`.
const WORD_BREAK = /\s+|\[?(?:\.{3,}|…)\]?/;

/** The words in `s`: an ellipsis (`...`, `…`, `[...]`) or a lone dash is not one. */
function wordCount(s: string): number {
  return s.split(WORD_BREAK).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Extract the quotations Pass 3 checks from a DRAFT.md: one entry per
 * (quotation, cited key) pair, plus one unattributed entry for each long
 * quotation that cites nothing.
 */
export function extractQuotes(draftMd: string, cites: readonly Citation[] = findCitations(draftMd)): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];
  for (const q of findQuotes(draftMd, cites)) {
    if (!q.citation) {
      if (wordCount(q.text) >= MIN_WORDS) out.push({ text: q.text, citekey: '', kind: q.kind, unattributed: true });
      continue;
    }
    if (checkedWordCount(q.text) < MIN_SHORT_WORDS) continue;
    const keys = [...new Set(q.citation.items.map((i) => i.key))];
    for (const citekey of keys) out.push({ text: q.text, citekey, kind: q.kind, unattributed: false });
  }
  return out;
}
