// bin/lib/plagiarism.ts — DONE-02 free distinctive-phrase plagiarism check.
//
// All HTTP through bin/lib/http.ts — ESLint chokepoint enforced. Advisory-only
// (DONE-02): warns, never blocks export, never throws — mirrors verify/freshness.ts.
//
// The check extracts distinctive 5+-word n-grams from the compiled draft
// (deterministic, no LLM), queries the DuckDuckGo HTML endpoint through the
// http.ts chokepoint (offline cassette in CI), parses result links, and renders
// a `## Plagiarism Check (DONE-02)` section for VERIFICATION.md. It is advisory
// by construction: there is no blocking verdict, transport errors are swallowed
// to DEBUG as noise, and an empty result array == no plagiarism signal. Only the
// DONE-09 export-confirmation gate (06-05) may pause on a hit, and only with the
// user's confirmation.
//
// SSRF mitigation (T-06-02-01): the DDG host is hard-coded; the query is the only
// dynamic component and is encodeURIComponent-escaped. HTML parsing (T-06-02-02)
// is regex/String only — no eval, no innerHTML, no DOM — so malformed HTML yields
// an empty match array, never a crash. Burst protection (T-06-02-03): maxPhrases
// cap (10/paper) + Semaphore(5) + the http.ts generic TokenBucket (5 RPS) +
// browser-like headers; rate-limit / transport errors are swallowed advisory.

// ============================================================
//   Public types
// ============================================================

/**
 * A single DuckDuckGo result link parsed from the HTML response. `title` is the
 * anchor text when present. Exported so Wave-2 done.ts / the DONE-09 gate can
 * consume richer hit metadata even though the locked runPlagiarism contract
 * surfaces only the URLs (see PlagiarismResult).
 */
export interface PlagiarismMatch {
  url: string;
  title?: string;
}

/**
 * One queried distinctive phrase plus the result URLs that came back for it.
 *
 * NOTE (executor reconciliation, Rule 1): the locked Wave-0 RED contract in
 * tests/plagiarism.test.ts (and the DONE-09 gate input in tests/export-gate.test.ts)
 * types `matches` as `string[]` — the raw result URLs. We honor that locked test
 * shape here rather than the plan's draft `PlagiarismMatch[]`; the richer
 * PlagiarismMatch type is still exported (it is what parseDdgHtml returns) for
 * downstream consumers, and runPlagiarism maps `.url` into this string array.
 */
export interface PlagiarismResult {
  phrase: string;
  matches: string[];
}

// ============================================================
//   Distinctive-phrase extraction (deterministic, no LLM)
// ============================================================

// Common short/function words: a window made entirely of these carries no
// lexical specificity and would only generate scrape noise. Used by the
// isDistinctive heuristic together with the >4-char specificity floor.
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
  'her', 'was', 'one', 'our', 'out', 'his', 'has', 'had', 'how', 'its',
  'who', 'did', 'yes', 'his', 'she', 'him', 'this', 'that', 'with', 'from',
  'they', 'them', 'were', 'been', 'have', 'into', 'than', 'then', 'when',
  'what', 'your', 'will', 'would', 'there', 'their', 'which', 'these', 'those',
  'such', 'only', 'also', 'over', 'upon', 'each',
]);

/**
 * A phrase is "distinctive" when it carries enough lexical specificity to be a
 * useful plagiarism probe. Heuristic (deterministic, no LLM): reject windows
 * that are entirely stop-words, and require at least two words longer than four
 * characters so generic boilerplate ("for all of the and") is filtered out.
 */
function isDistinctive(phrase: string): boolean {
  const words = phrase.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return false;
  const lowered = words.map((w) => w.toLowerCase());
  if (lowered.every((w) => STOP_WORDS.has(w))) return false;
  const specific = words.filter((w) => w.length > 4).length;
  return specific >= 2;
}

/**
 * Strip `[@citekey]` / `[@a; @b]` citation tokens and surrounding markdown
 * punctuation from a chunk of draft text so citation keys are never searched as
 * plagiarism phrases (behavior block), then collapse whitespace. Deterministic.
 */
function stripCitationsAndMarkdown(text: string): string {
  return text
    // bracketed pandoc citations: [@key], [@a; @b, p. 4]
    .replace(/\[@[^\]]*\]/g, ' ')
    // stray inline @citekey tokens (no brackets)
    .replace(/(^|\s)@[A-Za-z0-9_:-]+/g, ' ')
    // markdown emphasis / code / heading / link punctuation → space
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    // drop residual brackets / parens / quotes
    .replace(/[[\]()"'<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract distinctive >=minWords-word n-grams from `text` (06-RESEARCH Pattern 4).
 *
 * Splits on terminal punctuation + whitespace into sentences; for each sentence
 * with >= minWords words, slides overlapping minWords-length windows; filters via
 * isDistinctive; dedupes via a Set preserving first-seen order; returns at most
 * maxPhrases phrases. Strips [@citekey] tokens and markdown before windowing.
 *
 * Deterministic: identical input always yields identical ordered output (no
 * Math.random, no Date).
 */
export function extractDistinctivePhrases(
  text: string,
  minWords = 5,
  maxPhrases = 10,
): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const cleaned = stripCitationsAndMarkdown(text);
  // Split into sentences on terminal punctuation followed by whitespace, then
  // also handle a trailing sentence with no terminal punctuation.
  const sentences = cleaned.split(/[.!?]+\s+/);
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const sentence of sentences) {
    // Drop residual terminal punctuation and tokenize; keep words with >2 chars
    // so single-letter / stray tokens do not pad a window (06-RESEARCH algo).
    const words = sentence
      .replace(/[.!?,;:]+$/g, '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (words.length < minWords) continue;
    for (let i = 0; i <= words.length - minWords; i++) {
      const phrase = words.slice(i, i + minWords).join(' ');
      if (!isDistinctive(phrase)) continue;
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push(phrase);
      if (phrases.length >= maxPhrases) return phrases;
    }
  }
  return phrases;
}
