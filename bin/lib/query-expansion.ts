// bin/lib/query-expansion.ts — the deterministic research query expansion
// (SRC-08, D-19-15).
//
// Research asks the topic-disambiguator model for 1–3 scopes of 5–10 focused
// queries each. This module is the model-free counterpart, used in three places:
//   1. the `topic-disambiguator` stub under PENSMITH_NO_LLM (and --dry-run),
//      disclosed on stdout and in RESEARCH.md as "deterministic expansion of
//      the intake topic";
//   2. padding a model scope that proposed fewer than MIN_QUERIES queries;
//   3. normalising every query a model proposed (whitespace, quotes, at most
//      MAX_QUERY_WORDS words, case-insensitive de-duplication) and clamping a
//      scope to MIN_QUERIES..MAX_QUERIES.
//
// Pure: no fs, no network, no clock. Same input → same output, always.
//
// The expansion starts with the topic phrase itself (the brief's own words are
// the most faithful query), then the topic's keywords with the discipline's
// name, each keyword group (the runs of keywords between stop words) with the
// discipline's name, the keywords with a few neutral research framings, and
// finally adjacent keyword pairs — until MAX_QUERIES distinct queries exist.
// The discipline's name comes from bin/lib/disciplines.ts (the only module that
// knows the presets); the fallback preset contributes no term.

import { FALLBACK_DISCIPLINE, isDisciplineSlug, normalizeDisciplineSlug, presetFor } from './disciplines.js';

/** Fewest queries a research scope runs (PRD §7.2: 5–10 focused queries). */
export const MIN_QUERIES = 5;
/** Most queries a research scope runs. */
export const MAX_QUERIES = 10;
/** Longest query, in words: adapter recall collapses on long natural-language strings. */
export const MAX_QUERY_WORDS = 8;

/**
 * English function words plus assignment boilerplate ("write a 1500-word essay
 * on …"). They never become keywords; they split the topic into keyword groups.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'across', 'after', 'against', 'all', 'also', 'among', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'being', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'during',
  'each', 'either', 'etc', 'for', 'from', 'had', 'has', 'have', 'having', 'how', 'however', 'if', 'in', 'into', 'is',
  'it', 'its', 'itself', 'may', 'might', 'more', 'most', 'must', 'my', 'neither', 'no', 'nor', 'not', 'of', 'on',
  'onto', 'or', 'other', 'our', 'over', 'own', 'per', 'same', 'shall', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'toward',
  'towards', 'under', 'until', 'upon', 'us', 'very', 'via', 'was', 'we', 'were', 'what', 'when', 'where', 'whether',
  'which', 'while', 'who', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'you', 'your',
  // Assignment boilerplate: a topic lifted from "Write a 1500-word essay on X".
  'write', 'writing', 'essay', 'essays', 'paper', 'papers', 'assignment', 'word', 'words', 'page', 'pages',
  'please', 'using', 'use', 'discuss', 'describe', 'explain', 'apa', 'mla', 'ieee', 'style', 'format',
]);

/** Neutral research framings appended to the keywords (never discipline-specific). */
const FRAMINGS: readonly string[] = ['review', 'recent research', 'theory', 'evidence', 'case study', 'debate'];

/** Collapse whitespace, drop surrounding quotes and trailing punctuation. */
function clean(text: string): string {
  let printable = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    printable += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  // Leading quotes and trailing quotes/punctuation in one pass each, so the
  // result is stable under a second clean (normalizeQuery is idempotent).
  return printable
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’`]+/, '')
    .replace(/[\s"'“”‘’`.,;:!?]+$/, '');
}

function words(text: string): string[] {
  return text.split(' ').filter((w) => w.length > 0);
}

/** A token as a keyword: letters and digits (any script), inner hyphens and apostrophes kept. */
function keywordToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[^\p{L}\p{N}'’-]+/gu, '');
}

/**
 * A query as research sends it: whitespace collapsed, quotes and trailing
 * punctuation removed, at most MAX_QUERY_WORDS words ('' when nothing is left).
 */
export function normalizeQuery(query: string): string {
  return clean(words(clean(query)).slice(0, MAX_QUERY_WORDS).join(' '));
}

/** The case-insensitive identity two queries share when they are the same query. */
function queryKey(query: string): string {
  return query.toLowerCase();
}

/**
 * The topic phrase without assignment boilerplate: an opening instruction verb
 * ("Write", "Discuss", …), a length ("1500-word", "10 page"), a paper type
 * followed by its preposition ("literature review on", "essay about") and a
 * trailing citation-style note (", APA style", "in MLA format"). The words that
 * name the subject are kept as written.
 */
export function topicPhrase(text: string): string {
  let t = clean(text);
  // A leading course code ("History 210:", "PSYC 101 -", "CS 4820A –").
  t = t.replace(/^[\p{L}][\p{L}&.]*(?:\s[\p{L}][\p{L}&.]*){0,3}\s\d{2,4}[A-Za-z]?\s*[:\-–—]\s+/u, '');
  t = t.replace(/^(?:please\s+)?(?:write|draft|compose|prepare|produce|discuss|analy[sz]e|examine|explore|describe|explain|review|argue|evaluate|assess|compare)\s+(?!(?:of|on|about|for|in|into|regarding)\b)/i, '');
  t = t.replace(/\b(?:a|an|the)\s+(?=\d)/gi, '');
  t = clean(t.replace(/\b\d+(?:[.,]\d+)?\s*[- ]?\s*(?:words?|pages?)\b/gi, ' '));
  t = t.replace(/^(?:(?:a|an|the)\s+)?(?:(?:short|brief|critical|systematic|scoping|narrative|argumentative|persuasive|analytical|expository)\s+)?(?:literature\s+review|research\s+(?:paper|report|essay)|term\s+paper|position\s+paper|essay|paper|report|review|analysis|study)\s+(?:on|about|of|regarding|examining|exploring|into)\s+/i, '');
  const styles = '(?:APA|MLA|IEEE|AMA|Harvard|Vancouver|Chicago)(?:\\s*\\d+)?';
  t = t.replace(new RegExp(`\\s*[,;]?\\s*(?:(?:in|using|with|following)\\s+)?${styles}\\s+(?:style|format|citations?|referencing)\\s*$`, 'i'), '');
  t = t.replace(new RegExp(`\\s*[,;]\\s*${styles}\\s*$`, 'i'), '');
  // Boilerplate only (nothing left): keep the words as written.
  return clean(t) || clean(text);
}

/**
 * The topic's keyword groups: the runs of non-stop-word tokens, in order
 * ("attention mechanisms in neural networks" → [["attention", "mechanisms"],
 * ["neural", "networks"]]). Numbers alone ("1500") are not keywords.
 */
export function keywordGroups(text: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const raw of words(clean(text))) {
    const tok = keywordToken(raw);
    const isKeyword = tok.length > 1 && !STOP_WORDS.has(tok) && !/^\d+(?:-\w+)?$/.test(tok);
    if (isKeyword) {
      current.push(tok);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** The topic's keywords in order, each once. */
export function topicKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of keywordGroups(text)) {
    for (const k of g) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

/**
 * The discipline's name as a search term ("computer science", "biology"), or
 * '' for the fallback preset. Free text is normalised to a preset first.
 */
export function disciplineTerm(discipline: string): string {
  const slug = isDisciplineSlug(discipline) ? discipline : normalizeDisciplineSlug(discipline);
  if (slug === FALLBACK_DISCIPLINE) return '';
  const name = presetFor(slug).name.split('/')[0] ?? '';
  return words(clean(name.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' '))).join(' ');
}

/**
 * `keywords` cut so that `keywords + suffix` fits MAX_QUERY_WORDS (the suffix is
 * kept whole). A keyword the suffix already says is dropped ("intellectual
 * history" + "history" → "intellectual history", never "… history history"),
 * and nothing is returned when no keyword is left (the suffix alone is not a
 * query about the topic).
 */
function withSuffix(keywords: readonly string[], suffix: string): string {
  const tail = words(suffix);
  const inTail = new Set(tail.map((w) => w.toLowerCase()));
  const own = keywords.filter((k) => !inTail.has(k.toLowerCase()));
  if (own.length === 0) return '';
  const room = Math.max(1, MAX_QUERY_WORDS - tail.length);
  return [...own.slice(0, room), ...tail].slice(0, MAX_QUERY_WORDS).join(' ');
}

/** Append `q` to `out` unless it is empty or already there. */
function pushQuery(out: string[], seen: Set<string>, q: string): void {
  const n = normalizeQuery(q);
  if (!n) return;
  const key = queryKey(n);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(n);
}

/**
 * The deterministic expansion of a topic: up to MAX_QUERIES distinct queries of
 * at most MAX_QUERY_WORDS words. A topic with at least one keyword always
 * yields at least MIN_QUERIES. Returns [] for a topic with no keyword at all.
 */
export function expandTopicQueries(topic: string, discipline: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const phrase = topicPhrase(topic);
  const kw = topicKeywords(phrase);
  if (kw.length === 0) return out;
  const term = disciplineTerm(discipline);
  const full = (): boolean => out.length >= MAX_QUERIES;

  pushQuery(out, seen, phrase);
  if (term) pushQuery(out, seen, withSuffix(kw, term));
  for (const g of keywordGroups(phrase)) {
    if (full()) break;
    pushQuery(out, seen, term ? withSuffix(g, term) : g.join(' '));
  }
  for (const framing of FRAMINGS) {
    if (full()) break;
    pushQuery(out, seen, withSuffix(kw, framing));
  }
  for (let i = 0; i + 1 < kw.length && !full(); i += 1) {
    const pair = [kw[i] as string, kw[i + 1] as string];
    pushQuery(out, seen, term ? withSuffix(pair, term) : pair.join(' '));
  }
  for (const framing of FRAMINGS) {
    if (full()) break;
    if (term) pushQuery(out, seen, withSuffix(kw, `${framing} ${term}`));
  }
  return out.slice(0, MAX_QUERIES);
}

export interface ClampResult {
  /** The queries research runs (normalised, distinct, at most the cap). */
  readonly queries: string[];
  /** How many the scope proposed (after normalisation and de-duplication). */
  readonly proposed: number;
  /** How many were dropped because the scope proposed more than the cap. */
  readonly dropped: number;
  /** How many came from the deterministic expansion because the scope proposed fewer than MIN_QUERIES. */
  readonly padded: number;
}

/**
 * Clamp a scope's queries to MIN_QUERIES..`cap` (cap ≤ MAX_QUERIES): normalise
 * and de-duplicate them, keep the first `cap`, and pad a short list with the
 * deterministic expansion of `topic` (skipping duplicates). A topic without
 * keywords cannot pad, so the result may then hold fewer than MIN_QUERIES.
 */
export function clampQueries(proposed: readonly string[], topic: string, discipline: string, cap: number = MAX_QUERIES): ClampResult {
  const limit = Math.min(MAX_QUERIES, Math.max(MIN_QUERIES, Math.trunc(cap)));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of proposed) pushQuery(out, seen, q);
  const distinct = out.length;
  const kept = out.slice(0, limit);
  const keptSeen = new Set(kept.map(queryKey));
  let padded = 0;
  if (kept.length < MIN_QUERIES) {
    for (const q of expandTopicQueries(topic, discipline)) {
      if (kept.length >= MIN_QUERIES) break;
      const key = queryKey(q);
      if (keptSeen.has(key)) continue;
      keptSeen.add(key);
      kept.push(q);
      padded += 1;
    }
  }
  return { queries: kept, proposed: distinct, dropped: Math.max(0, distinct - limit), padded };
}

/** A kebab-case scope label for a topic (its first keywords), `research-topic` when it has none. */
export function topicLabel(topic: string): string {
  return topicKeywords(topicPhrase(topic)).slice(0, 4).join('-').replace(/[^\p{L}\p{N}-]+/gu, '') || 'research-topic';
}
