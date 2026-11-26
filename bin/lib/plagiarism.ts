// bin/lib/plagiarism.ts — DONE-02 free distinctive-phrase plagiarism check.
//
// All HTTP through bin/lib/http.ts — ESLint chokepoint enforced. Advisory-only
// (DONE-02): warns, never blocks export, never throws — mirrors verify/freshness.ts.
//
// The check takes one distinctive phrase from each paragraph of the compiled
// draft, spread across the whole paper when there are more paragraphs than
// probes (deterministic, no LLM), searches each as an exact quoted phrase,
// word for word, on the DuckDuckGo HTML endpoint through the http.ts
// chokepoint, and renders the plagiarism section for
// VERIFICATION.md that states how many phrases were checked.
//
// A search that did not get a real answer is "not checked", never "no
// matches": DuckDuckGo's bot check (a non-200 status, or its anomaly
// challenge page), a page that is neither results nor "No results.", a
// transport error, a cassette miss, or offline mode. A check with any such
// phrase is incomplete, and the export confirmation says so.
//
// SSRF mitigation (T-06-02-01): the DDG host is hard-coded; the query is the only
// dynamic component and is encodeURIComponent-escaped. HTML parsing (T-06-02-02)
// is regex/String only — no eval, no innerHTML, no DOM — so malformed HTML yields
// an empty match array, never a crash. Burst protection (T-06-02-03): maxPhrases
// cap (10/paper) + Semaphore(5) + the http.ts generic TokenBucket (5 RPS) +
// browser-like headers.

import { fetch as httpFetch } from './http.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from './network-mode.js';
import { Semaphore } from './budget.js';
import { replaceCitations } from './citation-grammar.js';

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

/** Why a phrase was not checked (PlagiarismResult.skipped). */
export const PLAGIARISM_SKIPS = ['offline', 'blocked', 'no-answer'] as const;

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
  /**
   * Set when the phrase was not checked. Empty `matches` then means "not
   * checked", not "no match", and must be shown that way:
   *   - offline: the network is off (--offline / --dry-run);
   *   - blocked: DuckDuckGo answered with a non-200 status or its bot check;
   *   - no-answer: no usable answer (a transport error, no recording, a page
   *     that is neither results nor "No results.").
   */
  skipped?: (typeof PLAGIARISM_SKIPS)[number];
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

/** How many words a probe phrase has, when its sentence is that long. */
const PHRASE_WORDS = 8;

/**
 * The runs of plain words in a paragraph: citations (prefixes, keys and
 * locators included) and markdown are taken out, and a run ends at each
 * citation and each sentence end, so a phrase never spans text the reader
 * does not see as one stretch of words.
 */
function wordRuns(paragraph: string): string[][] {
  const plain = replaceCitations(paragraph, () => '\n')
    // markdown links keep their text; emphasis, code, heading, quote and table marks go
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/[[\]()"“”<>]/g, ' ');
  return plain
    .split(/\n|[.!?]+(?=\s|$)/)
    .map((run) => run.split(/\s+/).map((w) => w.replace(/^[,;:'‘’]+|[,;:'‘’]+$/g, '')).filter((w) => w.length > 0));
}

/** The first distinctive phrase of a paragraph, word for word, or null. */
function paragraphPhrase(paragraph: string, minWords: number): string | null {
  for (const words of wordRuns(paragraph)) {
    if (words.length < minWords) continue;
    const size = Math.min(PHRASE_WORDS, words.length);
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = words.slice(i, i + size).join(' ');
      if (isDistinctive(phrase)) return phrase;
    }
  }
  return null;
}

/** `n` items of `xs`, evenly spaced from the first to the last. */
function spread<T>(xs: readonly T[], n: number): T[] {
  if (xs.length <= n) return [...xs];
  if (n <= 1) return xs.slice(0, n);
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]!);
}

/**
 * The phrases the check searches for: one distinctive phrase (up to
 * PHRASE_WORDS words, at least `minWords`) from each paragraph, word for
 * word as the paper has it, short words included, so each can be searched
 * as an exact phrase. With more paragraphs than `maxPhrases`, the paragraphs
 * probed are spread evenly from the first to the last. Headings and code are
 * not probed. Deterministic: the same text always gives the same phrases.
 */
export function extractDistinctivePhrases(
  text: string,
  minWords = 5,
  maxPhrases = 10,
): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const paragraph of prose.split(/\n\s*\n/)) {
    if (/^\s*#{1,6}\s/.test(paragraph)) continue;
    const phrase = paragraphPhrase(paragraph, minWords);
    if (phrase === null || seen.has(phrase.toLowerCase())) continue;
    seen.add(phrase.toLowerCase());
    phrases.push(phrase);
  }
  return spread(phrases, maxPhrases);
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
  // Quoted: DuckDuckGo searches the exact phrase, not a bag of its words.
  return `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(`"${phrase}"`)}`;
}

/** The page a DuckDuckGo result link leads to: its `uddg` redirect target, decoded, when it has one. */
function resultTarget(href: string): string {
  const raw = href.replace(/&amp;/g, '&');
  try {
    const u = new URL(raw, 'https://duckduckgo.com');
    const target = u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/' ? u.searchParams.get('uddg') : null;
    return target ?? raw;
  } catch {
    return raw;
  }
}

// DuckDuckGo's answer to a client it takes for a bot: the "anomaly" modal and
// its challenge form, served with HTTP 202 (and sometimes 200).
const CHALLENGE_PAGE = /anomaly-modal|challenge-form|\/anomaly\.js/i;
// Its page for a search that found nothing.
const NO_RESULTS_PAGE = /class=["'][^"']*\bno-results\b/i;

/**
 * Parse DuckDuckGo HTML into the list of organic result links. Pure function.
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
    const target = resultTarget(url);
    if (seen.has(target)) continue;
    seen.add(target);
    const rawTitle = (m[2] ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    matches.push(rawTitle.length > 0 ? { url: target, title: rawTitle } : { url: target });
  }
  return matches;
}

/**
 * Search one phrase on DuckDuckGo through http.ts and return its result URLs,
 * or why it was not checked. Never throws: an answer that is not a results
 * page (a bot check, an error, nothing) leaves the phrase not checked.
 */
async function queryPhrase(phrase: string): Promise<Pick<PlagiarismResult, 'matches' | 'skipped'>> {
  try {
    const resp = await httpFetch(ddgUrl(phrase), {
      source: 'generic',
      noCache: true,
      headers: DDG_HEADERS,
    });
    if (resp.status !== 200 || CHALLENGE_PAGE.test(resp.body)) {
      debug(`phrase=${JSON.stringify(phrase)} status=${resp.status}: blocked — not checked`);
      return { matches: [], skipped: 'blocked' };
    }
    const matches = parseDdgHtml(resp.body).map((hit) => hit.url);
    if (matches.length === 0 && !NO_RESULTS_PAGE.test(resp.body)) {
      debug(`phrase=${JSON.stringify(phrase)}: a page that is neither results nor "No results." — not checked`);
      return { matches: [], skipped: 'no-answer' };
    }
    return { matches };
  } catch (err) {
    // Transport error, offline refusal or no recording: not a "no matches".
    debug(`phrase=${JSON.stringify(phrase)} transport error: ${String(err)} — not checked`);
    return { matches: [], skipped: isOfflineMode() ? 'offline' : 'no-answer' };
  }
}

/**
 * Run the free distinctive-phrase plagiarism check over a compiled draft.
 *
 * Extracts one phrase per paragraph (extractDistinctivePhrases), searches each
 * under a Semaphore(5) fan-out cap (so the http.ts generic TokenBucket is not
 * overrun), and returns one PlagiarismResult per phrase. Advisory by
 * construction: never throws, never blocks export. Empty `matches` with no
 * `skipped` means the search answered and found nothing.
 */
export async function runPlagiarism(
  draftMd: string,
  opts?: { maxPhrases?: number },
): Promise<PlagiarismResult[]> {
  const maxPhrases = opts?.maxPhrases ?? 10;
  const phrases = extractDistinctivePhrases(draftMd, 5, maxPhrases);
  if (phrases.length === 0) return [];
  // Offline: report every phrase as not searched rather than as "no matches".
  if (isOfflineMode()) {
    return phrases.map((phrase) => ({ phrase, matches: [], skipped: 'offline' as const }));
  }
  const sem = new Semaphore(DDG_FAN_OUT);
  return Promise.all(
    phrases.map((phrase) => sem.withLock(async () => ({ phrase, ...(await queryPhrase(phrase)) }))),
  );
}

/** What a phrase that was not checked shows instead of its matches. */
const NOT_CHECKED: Readonly<Record<NonNullable<PlagiarismResult['skipped']>, string>> = {
  offline: OFFLINE_SKIP_NOTE,
  blocked: 'not checked: DuckDuckGo refused the search (bot check)',
  'no-answer': 'not checked: no usable answer from DuckDuckGo',
};

/** The Matches cell of one probed phrase. */
function matchesCell(r: PlagiarismResult): string {
  if (r.skipped) return NOT_CHECKED[r.skipped];
  return r.matches.length === 0 ? '_(no matches)_' : r.matches.map((u) => `<${u}>`).join('<br>');
}

/** How much the check covered, in one sentence. */
export function plagiarismCoverage(results: ReadonlyArray<PlagiarismResult>): string {
  const unchecked = results.filter((r) => r.skipped).length;
  const checked = results.length - unchecked;
  const scope = `${checked} of ${results.length} phrase${results.length === 1 ? '' : 's'} checked (one per paragraph, searched as exact phrases on DuckDuckGo)`;
  return unchecked > 0
    ? `${scope}. The check is incomplete: ${unchecked} phrase${unchecked === 1 ? ' was' : 's were'} not searched, so no match there means nothing.`
    : `${scope}. Only these phrases were searched, not the whole paper.`;
}

/**
 * Render the `## Plagiarism Check (DONE-02)` section for VERIFICATION.md.
 * Deterministic, no LLM. States its coverage, and shows a phrase that was not
 * checked as such, never as "no matches". Advisory: this check never blocks
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
  ];
  if (results.length > 0) lines.push(plagiarismCoverage(results), '');
  lines.push('| Phrase | Matches |', '|--------|---------|');
  if (results.length === 0) {
    lines.push('| _(none)_ | no distinctive phrases probed |');
    return lines.join('\n');
  }
  for (const r of results) {
    // Escape pipes in the phrase so a literal `|` cannot break the table.
    const phraseCell = r.phrase.replace(/\|/g, '\\|');
    lines.push(`| ${phraseCell} | ${matchesCell(r)} |`);
  }
  return lines.join('\n');
}
