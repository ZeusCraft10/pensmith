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
//     skipped as "unattributed" (AUDIT-FINDINGS #2/#3).
//
// The thresholds (MIN_WORDS=10, MIN_INLINE_CHARS=60) are calibration knobs
// — Pass-3 only runs against quotes a human is likely to lift verbatim from
// a source. Short quoted phrases (≤9 words) are too noisy to verify and
// would generate false positives.

import { CITATION_CLUSTER_RE_SOURCE, firstCitationCluster, stripCitationClusters } from './citation-token.js';

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
 * Extract verifiable quotes from a DRAFT.md.
 *
 * Returns an array of `{ text, citekey, kind }` entries. Each entry's `text`
 * is suitable for direct comparison with PDF-extracted source text via
 * `levenshteinSubstring`. A quote followed by a cluster yields one entry per
 * key. Quotes with no citation immediately following are dropped — Pass-3
 * cannot verify an unattributed quote (Pass 4 reports the uncited claim).
 */
export function extractQuotes(draftMd: string): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];

  // ---- Block quotes ('> ' line runs) ----------------------------------
  const lines = draftMd.split('\n');
  let blockBuf: string[] = [];
  let blockEndIdx = -1;

  const flushBlock = (): void => {
    if (blockBuf.length === 0) return;
    const text = blockBuf.join(' ');
    if (wordCount(text) >= MIN_WORDS) {
      // Find the first citation (bare or cluster) within ~4 lines after the block end.
      const lookAhead = lines.slice(blockEndIdx + 1, blockEndIdx + 5).join(' ');
      const cluster = firstCitationCluster(lookAhead);
      if (cluster) out.push(...perKey(stripCites(text), cluster.keys, 'block'));
    }
    blockBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('> ')) {
      blockBuf.push(line.slice(2));
      blockEndIdx = i;
    } else {
      flushBlock();
    }
  }
  // Tail flush in case the draft ends with a block quote.
  flushBlock();

  // ---- Inline quotes ("..." or "...") --------------------------------
  // Matches: opening quote (" or "), >=60 chars of non-quote content,
  // closing quote, optional whitespace, then a citation — a bare `[@key]` or a
  // cluster (`[@a; @b]`, `[@a, p. 5]`, `[see @a]`), read with the one grammar.
  const inlineRe = new RegExp(`["“]([^"”]{60,})["”]\\s*(${CITATION_CLUSTER_RE_SOURCE})`, 'g');
  for (const m of draftMd.matchAll(inlineRe)) {
    const text = m[1] ?? '';
    const cluster = firstCitationCluster(m[2] ?? '');
    if (!text || !cluster) continue;
    if (text.length < MIN_INLINE_CHARS) continue;
    if (wordCount(text) < MIN_WORDS) continue;
    out.push(...perKey(stripCites(text), cluster.keys, 'inline'));
  }

  return out;
}
