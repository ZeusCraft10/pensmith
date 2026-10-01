// bin/lib/plagiarism.ts — the free distinctive-phrase plagiarism check
// (DONE-02; Phase 21 EXP-19, EXP-20; D-21-22).
//
// A BASIC check, not a substitute for an institutional plagiarism service
// (README): the paper's most distinctive phrases are searched as exact quoted
// DuckDuckGo queries, and a result counts only when the phrase appears
// verbatim in its title or snippet. Advisory: it never blocks export — matches
// feed done's confirmation — and it never throws.
//
//   1. selectPlagiarismPhrases: 6–10-word windows of BODY paragraphs only —
//      never the title, a heading, a citation (every Pandoc form, removed by the
//      one grammar), a quoted passage, a block quote, a list item, a table, code
//      or a reference list — ranked by rarity against the shipped SCOWL word
//      tiers (plugin/templates/wordfreq/), at least one per paragraph, taken
//      round-robin across the sections so every section contributes, up to
//      `[verification] plagiarism_max_phrases` (default 30). Each carries its
//      location: `§<section> paragraph <k>`.
//   2. runPlagiarism: each phrase is one GET of the hard-coded
//      https://html.duckduckgo.com/html/ endpoint with q = the phrase in double
//      quotes (the only dynamic component, URL-encoded), through http.ts — its
//      per-host rate limits unchanged — ONE AT A TIME, 2.5–5 s apart (review
//      round 3: DuckDuckGo answers a burst with its bot challenge), every
//      section's first phrase before any section's second, a challenged phrase
//      asked again later (at most twice more, after a growing back-off).
//      plagiarismCoverage names the sections no answered phrase covers, and a
//      run where most queries got no answer is INCOMPLETE — never "0 found".
//      Offline / --dry-run send nothing and say `skipped (offline)` /
//      `(dry-run)` (RUN-03) — never a canned page.
//   3. parseDdgHtml: each organic result's title, snippet and REAL destination
//      — DuckDuckGo's `/l/?uddg=` redirect decoded (`&amp;` unescaped, then
//      URL-decoded); only http(s) destinations are kept. A bot-challenge page
//      ("anomaly") is a refused query, never "0 matches".
//   4. isVerbatimMatch: the phrase, normalised (case, punctuation, whitespace,
//      quote and dash spellings), appears contiguously in the normalised title
//      or snippet (`<b>` and every other tag stripped, entities decoded).
//
// SSRF (T-06-02-01): the DuckDuckGo host is hard-coded. HTML parsing
// (T-06-02-02) is regex/String only — no DOM, no eval — so malformed HTML
// yields no result, never a crash.

import { readFileSync } from 'node:fs';
import { fetch as httpFetch } from './http.js';
import { networkMode } from './http-mock.js';
import { replaceCitations } from './citation-token.js';
import { out } from './output-sink.js';
import { pluginTemplatePath } from './paths.js';
import { DEFAULT_PLAGIARISM_MAX_PHRASES } from './schemas/config.js';

// ============================================================
//   Public types
// ============================================================

/** One organic DuckDuckGo result: its real destination, title and snippet (tags stripped). */
export interface PlagiarismMatch {
  url: string;
  title?: string;
  snippet?: string;
}

/** Where a phrase is in the paper: the section (`2`, `1a`, or its position) and the body paragraph within it (1-based). */
export interface PhraseLocation {
  section: string;
  paragraph: number;
}

/** One queried phrase and the real URLs of the results that hold it verbatim. */
export interface PlagiarismResult {
  phrase: string;
  /** Destination URLs of the verbatim matches only (a topical result that does not hold the phrase is not a match). */
  matches: string[];
  /** Set when the phrase was not queried because the run is offline (RUN-03). */
  skipped?: 'offline' | 'dry-run';
  /** Where the phrase is in the paper. */
  location?: PhraseLocation;
  /** Why the query gave no answer (a transport error, DuckDuckGo's bot challenge). */
  error?: string;
}

export interface PlagiarismOptions {
  /** `[verification] plagiarism_max_phrases` (default 30). */
  maxPhrases?: number;
  /** The section ids in the order of the draft's `## ` headings (default: their positions, 1, 2, …). */
  sectionIds?: readonly string[];
  /** How the queries are paced (default DDG_PACING); tests pass zero gaps. */
  pacing?: Partial<PlagiarismPacing>;
}

/**
 * How the DuckDuckGo queries are paced (review round 3): DuckDuckGo answers a
 * burst with its bot challenge, so the queries go ONE AT A TIME, `minGapMs` to
 * `maxGapMs` apart (jittered); a challenged phrase is asked again later, at
 * most `retries` more times, after a back-off of `backoffMs` times the number
 * of challenges in a row.
 */
export interface PlagiarismPacing {
  readonly minGapMs: number;
  readonly maxGapMs: number;
  readonly retries: number;
  readonly backoffMs: number;
}

/** The live pacing (measured: six queries 4 s apart got four answers; six in a five-wide burst got one). */
export const DDG_PACING: PlagiarismPacing = Object.freeze({ minGapMs: 2_500, maxGapMs: 5_000, retries: 2, backoffMs: 10_000 });

let pacingForTest: Partial<PlagiarismPacing> | null = null;

/** Test seam (like http.ts `_resetBucketsForTest`): the pacing of every run until reset with null. */
export function _setPlagiarismPacingForTest(p: Partial<PlagiarismPacing> | null): void {
  pacingForTest = p;
}

/** What a run checked: answered phrases, refused ones, and the sections no answered phrase covers. */
export interface PlagiarismCoverage {
  readonly queried: number;
  readonly answered: number;
  readonly unanswered: number;
  /** Sections (in paper order) with a probed phrase but none answered. */
  readonly unchecked: readonly string[];
  /** True when most queries got no answer: the run is no "0 found". */
  readonly incomplete: boolean;
}

/** The coverage of a run's results (skipped phrases are neither answered nor unanswered). Pure. */
export function plagiarismCoverage(results: ReadonlyArray<PlagiarismResult>): PlagiarismCoverage {
  const queried = results.filter((r) => r.skipped === undefined);
  const answered = queried.filter((r) => r.error === undefined);
  const sections: string[] = [];
  for (const r of queried) {
    const sec = r.location?.section;
    if (sec !== undefined && !sections.includes(sec)) sections.push(sec);
  }
  const unchecked = sections.filter((sec) => !answered.some((r) => r.location?.section === sec));
  return {
    queried: queried.length,
    answered: answered.length,
    unanswered: queried.length - answered.length,
    unchecked,
    incomplete: queried.length > 0 && (queried.length - answered.length) * 2 > queried.length,
  };
}

/** The one line naming what a run did not check, or null when every query was answered. */
export function plagiarismCoverageLine(results: ReadonlyArray<PlagiarismResult>): string | null {
  const c = plagiarismCoverage(results);
  if (c.unanswered === 0) return null;
  const head = c.incomplete ? `INCOMPLETE — ${c.unanswered} of ${c.queried} queries got no answer` : `${c.unanswered} of ${c.queried} queries got no answer`;
  const sections = c.unchecked.length > 0 ? `; not checked: ${c.unchecked.map((x) => `§${x}`).join(', ')}` : '';
  return `${head}${sections} — run \`pensmith plagiarism\` later to check again`;
}

// ============================================================
//   The word-frequency tiers (plugin/templates/wordfreq/)
// ============================================================

/** Rarity weight of each SCOWL tier (10 = the commonest words); a word in no tier weighs RARE. */
const TIER_WEIGHT: Readonly<Record<string, number>> = Object.freeze({ '10': 0, '20': 1, '35': 2, '40': 3, '50': 4 });
const RARE = 5;

let tiers: Map<string, number> | null = null;

/** word → rarity weight, from plugin/templates/wordfreq/scowl-tiers.txt (read once). An unreadable list weighs every word the same. */
function wordWeights(): Map<string, number> {
  if (tiers !== null) return tiers;
  const map = new Map<string, number>();
  try {
    let weight = RARE;
    for (const line of readFileSync(pluginTemplatePath('wordfreq', 'scowl-tiers.txt'), 'utf8').split(/\r?\n/)) {
      if (line.length === 0 || line.startsWith('#')) continue;
      if (line.startsWith('@')) {
        weight = TIER_WEIGHT[line.slice(1)] ?? RARE;
        continue;
      }
      if (!map.has(line)) map.set(line, weight);
    }
  } catch {
    // no list: every window ranks equally (the selection still stratifies)
  }
  tiers = map;
  return map;
}

/** How rare a word is (0 = among the commonest; RARE = in no tier). */
export function wordRarity(word: string): number {
  const w = word.toLowerCase().replace(/[’']s$/, '').replace(/[^a-z]/g, '');
  if (w.length <= 1) return 0;
  const weights = wordWeights();
  if (weights.size === 0) return 1;
  return weights.get(w) ?? RARE;
}

// ============================================================
//   Phrase selection
// ============================================================

/** The shortest and longest window. */
export const PHRASE_MIN_WORDS = 6;
export const PHRASE_MAX_WORDS = 10;
/** The preferred window length (shorter when the run of prose is shorter). */
const PHRASE_WORDS = 8;

/** A candidate window of one body paragraph. */
interface Window {
  readonly phrase: string;
  readonly score: number;
  readonly location: PhraseLocation;
  readonly order: number;
}

/** True for a line that is not body prose: a heading, list item, block quote, table row, rule, code fence or HTML. */
function nonProseLine(line: string): boolean {
  return /^\s{0,3}(?:#{1,6}(?:\s|$)|[-*+]\s|\d+[.)]\s|>|\||<|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*$|\[\^)/.test(line);
}

/** Double-quoted spans (straight and curly) become breaks: a quoted passage is never probed. */
function dropQuoted(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|«[^»\n]*»/g, ' | ');
}

/** The runs of plain words of a paragraph: citations, quotes, emphasis and links handled; sentence ends and removed spans break a run. */
function wordRuns(paragraph: string): string[][] {
  const text = dropQuoted(replaceCitations(paragraph, () => ' | '))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/`[^`]*`/g, ' | ')
    .replace(/[*_~]+/g, '')
    .replace(/(^|\s)@[\w:.-]+/g, ' | ');
  const runs: string[][] = [];
  for (const piece of text.split(/[.!?;:|()[\]{}]+(?:\s|$)|\s[|]\s|[()[\]{}|]/)) {
    const words = piece.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => /[\p{L}]/u.test(w));
    if (words.length >= PHRASE_MIN_WORDS) runs.push(words);
  }
  return runs;
}

/** The windows of one paragraph, best first (mean rarity, then position). */
function paragraphWindows(paragraph: string, location: PhraseLocation, base: number): Window[] {
  const out: Window[] = [];
  let order = base;
  for (const run of wordRuns(paragraph)) {
    const len = Math.min(PHRASE_MAX_WORDS, Math.max(PHRASE_MIN_WORDS, Math.min(PHRASE_WORDS, run.length)));
    for (let i = 0; i + len <= run.length; i += 1) {
      const words = run.slice(i, i + len);
      const score = words.reduce((a, w) => a + wordRarity(w), 0) / len;
      out.push({ phrase: words.join(' '), score, location, order });
      order += 1;
    }
  }
  return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

/** The body paragraphs of each `## ` section of the compiled draft (the title, headings, non-prose lines and a reference list excluded). */
function bodyParagraphs(draftMd: string, sectionIds: readonly string[] | undefined): Array<{ section: string; paragraphs: string[] }> {
  const lines = draftMd.replace(/\r\n?/g, '\n').split('\n');
  const sections: Array<{ section: string; paragraphs: string[] }> = [];
  let current: { section: string; paragraphs: string[] } | null = null;
  let buf: string[] = [];
  let fence = false;
  let references = false;
  let position = 0;
  const flush = (): void => {
    const p = buf.join(' ').trim();
    if (p.length > 0 && current !== null && !references) current.paragraphs.push(p);
    buf = [];
  };
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      // A reference list is only a heading that IS one (`## References`);
      // a section titled "Sources and Methods" is a section (review round 3).
      references = /^(?:references|bibliography|works cited|literature cited)$/i.test((heading[2] ?? '').replace(/\s+#+\s*$/, '').trim());
      // Every `## ` heading is one of compile's sections — it always takes the
      // next section id, so the later sections keep their own ids.
      if ((heading[1] ?? '').length === 2) {
        position += 1;
        current = { section: sectionIds?.[position - 1] ?? String(position), paragraphs: [] };
        sections.push(current);
      }
      continue;
    }
    if (line.trim().length === 0 || nonProseLine(line)) {
      flush();
      continue;
    }
    // A draft with no `## ` heading (a single section) is one section.
    if (current === null) {
      position += 1;
      current = { section: sectionIds?.[0] ?? '1', paragraphs: [] };
      sections.push(current);
    }
    buf.push(line.trim());
  }
  flush();
  return sections;
}

/**
 * The phrases to probe (see the header): each body paragraph's most
 * distinctive window, taken round-robin across the sections (every section's
 * 1st paragraph, then every section's 2nd, …) so each section contributes,
 * up to `maxPhrases`; any budget left takes the next-best windows. Returned in
 * paper order. Deterministic: the same draft gives the same phrases.
 */
export function selectPlagiarismPhrases(draftMd: string, opts: PlagiarismOptions = {}): Array<{ phrase: string; location: PhraseLocation }> {
  const max = Math.max(0, Math.floor(opts.maxPhrases ?? DEFAULT_PLAGIARISM_MAX_PHRASES));
  if (typeof draftMd !== 'string' || max === 0) return [];
  const sections = bodyParagraphs(draftMd, opts.sectionIds);
  const perParagraph: Window[][][] = sections.map((s, si) => s.paragraphs.map((p, pi) => paragraphWindows(p, { section: s.section, paragraph: pi + 1 }, si * 1_000_000 + pi * 1_000)));
  const chosen: Window[] = [];
  const taken = new Set<string>();
  const take = (w: Window | undefined): void => {
    if (w === undefined || chosen.length >= max) return;
    const key = w.phrase.toLowerCase();
    if (taken.has(key)) return;
    taken.add(key);
    chosen.push(w);
  };
  const deepest = Math.max(0, ...perParagraph.map((s) => s.length));
  for (let k = 0; k < deepest && chosen.length < max; k += 1) {
    for (const s of perParagraph) take(s[k]?.[0]);
  }
  if (chosen.length < max) {
    // Further windows that do not overlap a chosen one's words, best first.
    const rest = perParagraph.flat().flatMap((ws) => ws.slice(1)).sort((a, b) => b.score - a.score || a.order - b.order);
    for (const w of rest) {
      if (chosen.length >= max) break;
      const overlaps = chosen.some((c) => c.location.section === w.location.section && c.location.paragraph === w.location.paragraph && (c.phrase.includes(w.phrase.split(' ')[0] ?? '') && w.phrase.includes(c.phrase.split(' ').slice(-1)[0] ?? '')));
      if (!overlaps) take(w);
    }
  }
  return chosen.sort((a, b) => a.order - b.order).map((w) => ({ phrase: w.phrase, location: w.location }));
}

// ============================================================
//   DuckDuckGo: query, parse, match
// ============================================================

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

const DDG_HEADERS: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html',
};


/** The quoted exact-phrase query URL (the host is hard-coded; the quoted phrase is the one, URL-encoded, dynamic part). */
export function ddgQueryUrl(phrase: string): string {
  return `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(`"${phrase.replace(/"/g, '')}"`)}`;
}

/** Decode the five predefined entities, numeric references and &nbsp;. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Tags stripped (`<b>` included), entities decoded, whitespace collapsed. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * The real destination of a DuckDuckGo result link: the `uddg` parameter of
 * its `/l/?uddg=…` redirect (`&amp;` unescaped, then URL-decoded), else the
 * link itself. Only an http(s) URL is returned; anything else is null.
 */
export function decodeDdgLink(href: string): string | null {
  let raw = href.trim().replace(/&amp;/g, '&');
  if (raw.startsWith('//')) raw = `https:${raw}`;
  let url: URL;
  try {
    url = new URL(raw, 'https://duckduckgo.com');
  } catch {
    return null;
  }
  if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname === '/l/') {
    const target = url.searchParams.get('uddg');
    if (target === null) return null;
    try {
      url = new URL(target);
    } catch {
      return null;
    }
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
}

/** True when the page is DuckDuckGo's bot challenge (it answers 202 with an "anomaly" form). */
export function isDdgChallenge(html: string): boolean {
  return /anomaly-modal|anomaly\.js|challenge-form/i.test(html) && !/class=["'][^"']*\bresult__a\b/.test(html);
}

/**
 * Parse DuckDuckGo HTML into its organic results — title, snippet and the
 * decoded destination (sponsored `result--ad__a` anchors excluded, each URL
 * once). Pure, regex/String only; malformed HTML yields fewer results, never a throw.
 */
export function parseDdgHtml(html: string): PlagiarismMatch[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  const anchors: Array<{ at: number; end: number; href: string; title: string }> = [];
  const re = /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    if (/\bresult--ad__a\b/.test(attrs)) continue;
    const href = /\bhref=["']([^"']+)["']/.exec(attrs)?.[1];
    if (href === undefined) continue;
    anchors.push({ at: m.index, end: re.lastIndex, href, title: plainText(m[2] ?? '') });
  }
  const results: PlagiarismMatch[] = [];
  const seen = new Set<string>();
  anchors.forEach((a, i) => {
    const url = decodeDdgLink(a.href);
    if (url === null || seen.has(url)) return;
    seen.add(url);
    const region = html.slice(a.end, anchors[i + 1]?.at ?? html.length);
    const snip = /<(?:a|div|td)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(region)?.[1];
    results.push({ url, ...(a.title.length > 0 ? { title: a.title } : {}), ...(snip !== undefined ? { snippet: plainText(snip) } : {}) });
  });
  return results;
}

/** Case, punctuation, whitespace, quote and dash spellings folded: letters and digits separated by single spaces. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when the normalised phrase appears, as whole words, in the result's normalised title or snippet. */
export function isVerbatimMatch(phrase: string, result: PlagiarismMatch): boolean {
  const p = ` ${normalizeForMatch(phrase)} `;
  if (p.trim().length === 0) return false;
  return [result.title, result.snippet].some((t) => t !== undefined && ` ${normalizeForMatch(t)} `.includes(p));
}

/** Debug only (PENSMITH_DEBUG=1). */
function debug(msg: string): void {
  if (process.env['PENSMITH_DEBUG'] === '1') process.stderr.write(`[plagiarism] ${msg}\n`);
}

/** One quoted query: the verbatim matches' URLs, or why there is no answer. Never throws. */
async function queryPhrase(phrase: string): Promise<{ matches: string[]; error?: string; challenged?: true }> {
  try {
    const resp = await httpFetch(ddgQueryUrl(phrase), { source: 'generic', noCache: true, headers: DDG_HEADERS });
    if (isDdgChallenge(resp.body)) return { matches: [], error: 'DuckDuckGo refused the query (its bot challenge) — retry later', challenged: true };
    if (resp.status !== 200) return { matches: [], error: `DuckDuckGo answered HTTP ${resp.status}` };
    return { matches: parseDdgHtml(resp.body).filter((r) => isVerbatimMatch(phrase, r)).map((r) => r.url) };
  } catch (err) {
    debug(`phrase=${JSON.stringify(phrase)} transport error: ${String(err)}`);
    return { matches: [], error: `query failed (${(err as Error).message.split('\n')[0] ?? 'transport error'})` };
  }
}

/**
 * Run the check over the compiled draft (see the header): one result per
 * probed phrase with its location. Offline / --dry-run: every phrase
 * `skipped`, nothing sent. Never throws.
 */
export async function runPlagiarism(draftMd: string, opts: PlagiarismOptions = {}): Promise<PlagiarismResult[]> {
  const phrases = selectPlagiarismPhrases(draftMd, opts);
  if (phrases.length === 0) return [];
  const mode = networkMode();
  if (mode.sourcesOffline) {
    const skipped = mode.dryRun ? 'dry-run' : 'offline';
    out(`pensmith: plagiarism check skipped (${skipped}) — ${phrases.length} distinctive phrase(s) not queried.\n`);
    return phrases.map((p) => ({ phrase: p.phrase, matches: [], skipped, location: p.location }));
  }
  const pace: PlagiarismPacing = { ...DDG_PACING, ...(pacingForTest ?? {}), ...(opts.pacing ?? {}) };
  out(`pensmith: plagiarism check: ${phrases.length} distinctive phrase(s), one query at a time (DuckDuckGo refuses bursts) — about ${Math.max(1, Math.round((phrases.length * (pace.minGapMs + pace.maxGapMs)) / 2 / 60_000))} min\n`);
  // Coverage first: every section's first phrase, then every section's
  // second, … — so a run cut short by refusals still checked each section.
  const bySection = new Map<string, number[]>();
  phrases.forEach((p, i) => {
    const list = bySection.get(p.location.section) ?? [];
    list.push(i);
    bySection.set(p.location.section, list);
  });
  const queue: Array<{ index: number; attempt: number }> = [];
  for (let k = 0; queue.length < phrases.length; k += 1) {
    for (const list of bySection.values()) {
      const i = list[k];
      if (i !== undefined) queue.push({ index: i, attempt: 0 });
    }
  }
  const results: PlagiarismResult[] = phrases.map((p) => ({ phrase: p.phrase, matches: [], location: p.location }));
  let streak = 0;
  for (let n = 0; n < queue.length; n += 1) {
    const item = queue[n] as { index: number; attempt: number };
    if (n > 0) await sleep(streak > 0 ? pace.backoffMs * streak : jitter(pace.minGapMs, pace.maxGapMs));
    const p = phrases[item.index] as { phrase: string; location: PhraseLocation };
    const r = await queryPhrase(p.phrase);
    const challenged = r.challenged === true;
    streak = challenged ? streak + 1 : 0;
    if (challenged && item.attempt < pace.retries) {
      queue.push({ index: item.index, attempt: item.attempt + 1 });
      continue;
    }
    results[item.index] = { phrase: p.phrase, matches: r.matches, location: p.location, ...(r.error !== undefined ? { error: r.error } : {}) };
  }
  return results;
}

/** A wait of `ms` (none for 0). */
function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** A uniformly jittered gap in [min, max]. */
function jitter(min: number, max: number): number {
  return Math.max(0, Math.round(min + Math.random() * Math.max(0, max - min)));
}

/** `§2 paragraph 3`. */
export function locationLabel(l: PhraseLocation | undefined): string {
  return l === undefined ? '—' : `§${l.section} paragraph ${l.paragraph}`;
}

/**
 * The `## Plagiarism Check (DONE-02)` section of `.paper/VERIFICATION.md`:
 * each probed phrase with its location and its verbatim matches (real URLs),
 * or the line saying why the check was skipped.
 */
export function renderPlagiarismSection(results: ReadonlyArray<PlagiarismResult>, opts: { skipped?: string } = {}): string {
  const lines = [
    '## Plagiarism Check (DONE-02)',
    '',
    'A basic check, not a substitute for an institutional plagiarism service: distinctive phrases of the paper searched as exact quotes on DuckDuckGo; a result counts only when it holds the phrase verbatim. Advisory only — never blocks export; matches feed the export confirmation (DONE-09).',
    '',
  ];
  if (opts.skipped !== undefined) {
    lines.push(`plagiarism check skipped (${opts.skipped})`);
    return lines.join('\n');
  }
  const coverage = plagiarismCoverageLine(results);
  if (coverage !== null) lines.push(`Coverage: ${coverage}.`, '');
  lines.push('| Location | Phrase | Matches |', '|----------|--------|---------|');
  if (results.length === 0) {
    lines.push('| — | _(none)_ | no body paragraph long enough to probe |');
    return lines.join('\n');
  }
  for (const r of results) {
    const cell =
      r.skipped !== undefined
        ? `_(skipped (${r.skipped}) — not queried)_`
        : r.error !== undefined
          ? `_(${r.error.replace(/\|/g, '/')})_`
          : r.matches.length === 0
            ? '_(no verbatim match)_'
            : r.matches.map((u) => `<${u}>`).join('<br>');
    lines.push(`| ${locationLabel(r.location)} | ${r.phrase.replace(/\|/g, '\\|')} | ${cell} |`);
  }
  return lines.join('\n');
}
