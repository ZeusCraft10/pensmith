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
// Every query stays about the topic (review round 3): each one holds the
// topic's ANCHOR — the keyword group (a run of keywords between stop words)
// that names its subject (topicAnchor: the most non-framing words, then proper
// nouns, then length), e.g. "french revolution" in "the causes of the French
// Revolution" — so no query is a lone generic word ("causes", "ethics") that
// pulls in unrelated work. The expansion starts with the topic
// phrase itself (the brief's own words are the most faithful query; a phrase
// longer than MAX_QUERY_WORDS is replaced by its keywords), then all
// the keywords with the discipline's name, the anchor with each other keyword
// group (with the discipline's name), and all the keywords with a few neutral
// research framings (then with the discipline's name too) — until MAX_QUERIES
// distinct queries exist (the same words in another order are the same
// query). Nothing narrower than the anchor plus another part of the topic is
// ever sent: never a lone keyword, never the anchor alone. The discipline's
// name comes from bin/lib/disciplines.ts (the only module that knows the
// presets); the fallback preset contributes no term.

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

/** The words of a query as a set (lower case, sorted): the same words in another order are the same query. */
function bagKey(query: string): string {
  return words(query.toLowerCase()).sort().join(' ');
}

/** Append `q` to `out` unless it is empty or the same words are already there. */
function pushQuery(out: string[], seen: Set<string>, q: string): void {
  const n = normalizeQuery(q);
  if (!n) return;
  const key = bagKey(n);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(n);
}

/**
 * Framing words that say what KIND of question a topic asks, not what it is
 * about ("the causes of …", "a critical examination of …"). They never make a
 * keyword group the topic's anchor on their own.
 */
const FRAMING_WORDS: ReadonlySet<string> = new Set([
  'analysis', 'analyses', 'approach', 'approaches', 'aspect', 'aspects', 'assessing', 'benefits', 'cause', 'causes',
  'challenges', 'comparative', 'comparing', 'comparison', 'consequence', 'consequences', 'critical', 'current',
  'development', 'different', 'drawing', 'effect', 'effects', 'evaluating', 'evolution', 'examination', 'examining',
  'exploring', 'factor', 'factors', 'implications', 'importance', 'impact', 'impacts', 'influence', 'influences',
  'investigating', 'issues', 'key', 'major', 'modern', 'nature', 'new', 'origins', 'overview', 'perspective',
  'perspectives', 'recent', 'relationship', 'relationships', 'risks', 'role', 'roles', 'significance', 'studies',
  'study', 'understanding', 'various',
]);

/**
 * The topic's anchor — the keyword group that names its subject, which every
 * expanded query keeps (see the header): the group with the most words that
 * are not FRAMING_WORDS, then the most words written with a capital inside the
 * phrase (a proper noun: "French Revolution"), then the longest; the first of
 * equals.
 */
export function topicAnchor(text: string): string[] {
  const phrase = topicPhrase(text);
  return anchorOf(keywordGroups(phrase), phrase);
}

/** The anchor of `groups` (topicAnchor) — the same array, not a copy — or []. */
function anchorOf(groups: readonly string[][], phrase: string): string[] {
  const capitalised = new Set<string>();
  words(clean(phrase)).forEach((raw, i) => {
    if (i > 0 && /^[^\p{L}]*\p{Lu}/u.test(raw)) capitalised.add(keywordToken(raw));
  });
  const score = (g: readonly string[]): [number, number, number] => [
    g.filter((w) => !FRAMING_WORDS.has(w)).length,
    g.filter((w) => capitalised.has(w)).length,
    g.length,
  ];
  let anchor: string[] = [];
  let best: [number, number, number] = [-1, -1, -1];
  for (const g of groups) {
    const sc = score(g);
    if (sc[0] > best[0] || (sc[0] === best[0] && (sc[1] > best[1] || (sc[1] === best[1] && sc[2] > best[2])))) {
      anchor = g;
      best = sc;
    }
  }
  return anchor;
}

/**
 * The deterministic expansion of a topic: up to MAX_QUERIES distinct queries of
 * at most MAX_QUERY_WORDS words, each holding the topic's anchor (the header).
 * A topic with at least one keyword always yields at least MIN_QUERIES.
 * Returns [] for a topic with no keyword at all.
 */
export function expandTopicQueries(topic: string, discipline: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const phrase = topicPhrase(topic);
  const groups = keywordGroups(phrase);
  const kw = topicKeywords(phrase);
  if (kw.length === 0) return out;
  const anchor = anchorOf(groups, phrase);
  const term = disciplineTerm(discipline);
  const full = (): boolean => out.length >= MAX_QUERIES;
  // Keywords + suffix with the anchor kept whole: when the word cap would cut
  // an anchor word, the anchor's words go first.
  const fit = (keywords: readonly string[], suffix: string): string => {
    const build = (ks: readonly string[]): string => (suffix ? withSuffix(ks, suffix) : ks.slice(0, MAX_QUERY_WORDS).join(' '));
    const q = build(keywords);
    return anchor.every((a) => words(q).includes(a)) ? q : build([...anchor, ...keywords.filter((k) => !anchor.includes(k))]);
  };

  // The phrase as written, unless the word cap would cut it (a long phrase cut
  // at MAX_QUERY_WORDS can lose its subject): then its keywords, anchor first.
  pushQuery(out, seen, words(clean(phrase)).length <= MAX_QUERY_WORDS ? phrase : fit(kw, ''));
  pushQuery(out, seen, fit(kw, term));
  for (const g of groups) {
    if (full()) break;
    if (g === anchor) continue;
    pushQuery(out, seen, fit([...anchor, ...g.filter((k) => !anchor.includes(k))], term));
  }
  for (const framing of FRAMINGS) {
    if (full()) break;
    pushQuery(out, seen, fit(kw, framing));
  }
  for (const framing of FRAMINGS) {
    if (full()) break;
    if (term) pushQuery(out, seen, fit(kw, `${framing} ${term}`));
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
  const keptSeen = new Set(kept.map(bagKey));
  let padded = 0;
  if (kept.length < MIN_QUERIES) {
    // Padding comes only from the anchored expansion: never a lone keyword.
    for (const q of expandTopicQueries(topic, discipline)) {
      if (kept.length >= MIN_QUERIES) break;
      const key = bagKey(q);
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
