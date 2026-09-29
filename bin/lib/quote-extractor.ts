// bin/lib/quote-extractor.ts — quote extraction from section DRAFT.md (Pass-3 input).
//
// REVIEWS amendment (Codex HIGH #4, OpenCode HIGH #4) — strict rules:
//   - Block quotes (lines starting with '> '): include if word count >= 10
//   - Inline quotes (text wrapped in "..." / "..." / '...' typographic):
//     include if >= 10 words AND >= 60 chars
//   - Multi-paragraph block quote (consecutive '> ' lines): treat as ONE
//     quote, summed word count
//   - Strip Pandoc citations BEFORE counting words
//   - Quote MUST be associated with the immediately-following citation
//     (within 200 chars; OR ~4 lines if extracted from a block).
//
// Citations are read in the BROAD Pandoc grammar (citation-token.ts
// findCitationClusters): `[@key]`, but also a mixed-case or punctuated key
// (`[@lecunDeepLearning2015]`, a Better BibTeX key or one from the user's own
// bib), a locator (`[@smith2020, p. 5]`) and a cluster (`[@a; @b]`, whose first
// key the quote is attributed to). A quote followed by a citation this module
// could not read would never reach Pass 3 — a quote-NOT_FOUND gate bypass — so
// the extractor reads every form Pass 1 does (fail closed).
//
// The thresholds (MIN_WORDS=10, MIN_INLINE_CHARS=60) are calibration knobs
// — Pass-3 only runs against quotes a human is likely to lift verbatim from
// a source. Short quoted phrases (≤9 words) are too noisy to verify and
// would generate false positives.

import { findCitationClusters, leadingCitationCluster, stripCitationClusters } from './citation-token.js';

export interface ExtractedQuote {
  /** The quoted text, with citation tokens stripped and whitespace collapsed. */
  text: string;
  /** The citekey associated with this quote (the `[@citekey]` immediately following). */
  citekey: string;
  /** Whether this was a markdown block quote (`> ...`) or an inline quote. */
  kind: 'block' | 'inline';
}

const MIN_WORDS = 10;
const MIN_INLINE_CHARS = 60;

function stripCites(s: string): string {
  return stripCitationClusters(s);
}

function wordCount(s: string): number {
  return stripCites(s).split(/\s+/).filter(Boolean).length;
}

/**
 * Extract verifiable quotes from a DRAFT.md.
 *
 * Returns an array of `{ text, citekey, kind }` entries. Each entry's `text`
 * is suitable for direct comparison with PDF-extracted source text via
 * `levenshteinSubstring`. Entries that lack a paired citekey (no
 * `[@citekey]` immediately following) are dropped — Pass-3 cannot verify
 * an unattributed quote.
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
      // Find first [@citekey] within ~4 lines after the block end.
      const lookAhead = lines.slice(blockEndIdx + 1, blockEndIdx + 5).join(' ');
      const citekey = findCitationClusters(lookAhead)[0]?.keys[0];
      if (citekey !== undefined) {
        out.push({ text: stripCites(text), citekey, kind: 'block' });
      }
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
  // closing quote, then (optional whitespace) a citation cluster.
  const inlineRe = /["“]([^"”]{60,})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(draftMd)) !== null) {
    const cluster = leadingCitationCluster(draftMd.slice(m.index + m[0].length));
    if (cluster === null) {
      // Not a cited quote: its closing mark may open the next one, so resume
      // one character on (what a single regex with the citation in it did).
      inlineRe.lastIndex = m.index + 1;
      continue;
    }
    const text = m[1] ?? '';
    const citekey = cluster.keys[0];
    if (!text || citekey === undefined) continue;
    if (text.length < MIN_INLINE_CHARS) continue;
    if (wordCount(text) < MIN_WORDS) continue;
    out.push({ text: stripCites(text), citekey, kind: 'inline' });
  }

  return out;
}
