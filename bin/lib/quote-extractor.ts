// bin/lib/quote-extractor.ts — quote extraction from section DRAFT.md (Pass-3 input).
//
// REVIEWS amendment (Codex HIGH #4, OpenCode HIGH #4) — strict rules:
//   - Block quotes (lines starting with '> '): include if word count >= 10
//   - Inline quotes (text wrapped in "..." / "..." / '...' typographic):
//     include if >= 10 words AND >= 60 chars
//   - Multi-paragraph block quote (consecutive '> ' lines): treat as ONE
//     quote, summed word count
//   - Strip Pandoc tokens `[@citekey]` BEFORE counting words
//   - Quote MUST be associated with the immediately-following [@citekey]
//     (within 200 chars; OR ~4 lines if extracted from a block).
//
// The thresholds (MIN_WORDS=10, MIN_INLINE_CHARS=60) are calibration knobs
// — Pass-3 only runs against quotes a human is likely to lift verbatim from
// a source. Short quoted phrases (≤9 words) are too noisy to verify and
// would generate false positives.

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
  return s.replace(/\[@[a-z][a-z0-9_-]*\]/g, '').replace(/\s+/g, ' ').trim();
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
      const m = lookAhead.match(/\[@([a-z][a-z0-9_-]*)\]/);
      if (m && m[1]) {
        out.push({ text: stripCites(text), citekey: m[1], kind: 'block' });
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
  // closing quote, optional whitespace, [@citekey]
  const inlineRe = /["“]([^"”]{60,})["”]\s*\[@([a-z][a-z0-9_-]*)\]/g;
  for (const m of draftMd.matchAll(inlineRe)) {
    const text = m[1] ?? '';
    const citekey = m[2] ?? '';
    if (!text || !citekey) continue;
    if (text.length < MIN_INLINE_CHARS) continue;
    if (wordCount(text) < MIN_WORDS) continue;
    out.push({ text: stripCites(text), citekey, kind: 'inline' });
  }

  return out;
}
