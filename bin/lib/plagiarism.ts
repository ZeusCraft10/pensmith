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

import { fetch as httpFetch } from './http.js';
import { isOfflineMode, loadCassetteFile } from './http-mock.js';
import { Semaphore } from './budget.js';

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

// ============================================================
//   Advisory debug helper (mirrors verify/freshness.ts)
// ============================================================
function debug(msg: string): void {
  if (process.env['PENSMITH_DEBUG'] === '1') {
    process.stderr.write(`[plagiarism] ${msg}\n`);
  }
}

// ============================================================
//   DuckDuckGo HTML query + parse
// ============================================================

// Hard-coded host (T-06-02-01 SSRF mitigation): the ONLY dynamic component of
// the query URL is the `q` param, which is encodeURIComponent-escaped below.
const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

// Browser-like headers reduce DDG's burst-blocking (06-RESEARCH Pitfall 5 /
// T-06-02-03). They are advisory hints only; a block still degrades to an empty
// match array, never a throw.
const DDG_HEADERS: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html',
};

const DDG_FAN_OUT = 5;

/**
 * Build the DDG HTML search URL for a phrase. Host is hard-coded; the phrase is
 * URL-encoded as the sole dynamic component (T-06-02-01 SSRF/injection
 * mitigation — no arbitrary host can be reached through this function).
 */
function ddgUrl(phrase: string): string {
  return `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(phrase)}`;
}

/**
 * Parse DuckDuckGo HTML into the list of organic result links. Pure function,
 * shared by BOTH the offline-cassette and the live-network branches so they
 * cannot diverge.
 *
 * Implementation is regex/String ONLY — no DOM, no eval, no innerHTML
 * (T-06-02-02 / V5 input validation). Matches the organic `result__a` anchor
 * class exactly so sponsored `result--ad__a` and snippet `result__snippet`
 * anchors are excluded. Malformed HTML simply yields zero matches.
 */
export function parseDdgHtml(html: string): PlagiarismMatch[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  const matches: PlagiarismMatch[] = [];
  // class="result__a" (exact token, not a prefix — excludes result__a-foo and
  // result--ad__a) with an href; capture the URL and the anchor text.
  const re = /<a\b[^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html)) !== null) {
    const url = (m[1] ?? '').trim();
    if (url.length === 0) continue;
    // Exclude the sponsored ad anchor class defensively (its class token is
    // result--ad__a, which the result__a word-boundary above already rejects;
    // this is belt-and-suspenders against attribute-order variance).
    if (/\bresult--ad__a\b/.test(m[0])) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const rawTitle = (m[2] ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    matches.push(rawTitle.length > 0 ? { url, title: rawTitle } : { url });
  }
  return matches;
}

/**
 * Read the duckduckgo cassette and return its response HTML string, or null when
 * no usable cassette entry exists. Prefers an entry whose path matches the live
 * query (`?q=<encoded-phrase>`); otherwise falls back to the single committed
 * entry for deterministic offline behavior.
 */
function offlineDdgHtml(phrase: string): string | null {
  const cassettes = loadCassetteFile('duckduckgo', 'html-search');
  if (!cassettes || cassettes.length === 0) return null;
  const wantQ = `q=${encodeURIComponent(phrase)}`;
  const match =
    cassettes.find((c) => typeof c.path === 'string' && c.path.includes(wantQ)) ??
    cassettes[0];
  if (!match || typeof match.response !== 'string') return null;
  return match.response;
}

/**
 * Query one phrase against DuckDuckGo (offline cassette or live http.ts), parse
 * the result anchors, and return the result URLs. Never throws — transport
 * errors are swallowed to DEBUG and yield an empty array for that phrase
 * (advisory contract, mirrors verify/freshness.ts).
 */
async function queryPhrase(phrase: string): Promise<string[]> {
  try {
    let html: string | null;
    if (isOfflineMode()) {
      // Offline branch MUST NOT touch the network.
      html = offlineDdgHtml(phrase);
      if (html === null) {
        debug(`no cassette entry for phrase=${JSON.stringify(phrase)} — empty matches`);
        return [];
      }
    } else {
      const resp = await httpFetch(ddgUrl(phrase), {
        source: 'generic',
        noCache: true,
        headers: DDG_HEADERS,
      });
      html = resp.body;
    }
    return parseDdgHtml(html).map((hit) => hit.url);
  } catch (err) {
    // Transport / parse error is scrape noise, NOT a plagiarism signal. Swallow
    // advisory — the check never throws and never blocks export by itself.
    debug(`phrase=${JSON.stringify(phrase)} transport error: ${String(err)} — swallowed`);
    return [];
  }
}

/**
 * Run the free distinctive-phrase plagiarism check over a compiled draft.
 *
 * Extracts distinctive phrases (extractDistinctivePhrases), queries DDG for each
 * under a Semaphore(5) fan-out cap (so the http.ts generic TokenBucket is not
 * overrun), and returns one PlagiarismResult per queried phrase (including
 * phrases with zero matches). Advisory by construction: never throws, never
 * blocks export — an empty `matches` array means no signal for that phrase.
 */
export async function runPlagiarism(
  draftMd: string,
  opts?: { maxPhrases?: number },
): Promise<PlagiarismResult[]> {
  const maxPhrases = opts?.maxPhrases ?? 10;
  const phrases = extractDistinctivePhrases(draftMd, 5, maxPhrases);
  if (phrases.length === 0) return [];
  const sem = new Semaphore(DDG_FAN_OUT);
  return Promise.all(
    phrases.map((phrase) =>
      sem.withLock(async () => ({ phrase, matches: await queryPhrase(phrase) })),
    ),
  );
}

/**
 * Render the `## Plagiarism Check (DONE-02)` section for VERIFICATION.md.
 * Deterministic, no LLM. Mirrors the verify/freshness.ts renderFreshnessTable
 * shape (06-PATTERNS). Carries a one-line advisory note: this check never blocks
 * export — it only feeds the DONE-09 export-confirmation gate.
 */
export function renderPlagiarismSection(
  results: ReadonlyArray<PlagiarismResult>,
): string {
  const lines = [
    '## Plagiarism Check (DONE-02)',
    '',
    'Advisory only — never blocks export; feeds the export-confirmation gate (DONE-09).',
    '',
    '| Phrase | Matches |',
    '|--------|---------|',
  ];
  if (results.length === 0) {
    lines.push('| _(none)_ | no distinctive phrases probed |');
    return lines.join('\n');
  }
  for (const r of results) {
    const cell =
      r.matches.length === 0
        ? '_(no matches)_'
        : r.matches.map((u) => `<${u}>`).join('<br>');
    // Escape pipes in the phrase so a literal `|` cannot break the table.
    const phraseCell = r.phrase.replace(/\|/g, '\\|');
    lines.push(`| ${phraseCell} | ${cell} |`);
  }
  return lines.join('\n');
}
