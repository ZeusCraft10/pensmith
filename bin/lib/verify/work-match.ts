// bin/lib/verify/work-match.ts — does a bibliography entry describe the work a
// registry returned for its identifier?
//
// A DOI that resolves proves the DOI exists, not that the entry citing it is
// right: an entry can carry a real DOI with another paper's title, an invented
// co-author or the wrong year, and all of that is printed in the reference
// list. So Pass 1 compares the entry with the registry's record:
//
//   title    the same words in the same order, after markup, entities, case,
//            punctuation, hyphenation and British/US spelling are set aside;
//            a missing subtitle on either side is fine; every number and roman
//            numeral must match ("Part I" is not "Part II", "K-12" not "K-13");
//   authors  the first author is the record's first author, and every other
//            author the entry names is an author of the work; surnames are
//            compared without particles ("van der Walt" is "Walt"), and
//            corporate authors by their distinctive words;
//   year     within one year of a year the record gives (online-first and
//            print dates differ);
//   journal  for a journal article, the entry's journal shares a word or an
//            abbreviation with the record's.
//
// Raw string similarity was the wrong tool: Jaro-Winkler on whole titles let
// sibling papers that differ by one word through, and blocked real ones whose
// registry title carried <i> tags or whose surname had a particle.

import { nfkcNormalize } from '../normalize.js';
import type { WorkName, WorkRecord } from '../sources/work-record.js';

/** What a bibliography entry says about the work it cites. */
export interface ClaimedWork {
  title: string;
  /** The entry's authors, or its editors when it has no authors. */
  authors: WorkName[];
  year?: number;
  venue?: string;
}

export interface WorkMatch {
  ok: boolean;
  /** What does not match, one plain sentence each. */
  problems: string[];
  /** Notes that do not block (a check the record gave nothing to run against). */
  notes: string[];
  /** Share of the title's content words that matched, 0..1. */
  titleScore: number;
  /** Share of the entry's authors found among the work's authors, 0..1. */
  authorScore: number;
}

// ---------------------------------------------------------------------------
//   Text normalization
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  minus: '-', hellip: '...', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', thinsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_m, g: string) => {
    if (g.startsWith('#')) {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
    }
    return NAMED_ENTITIES[g.toLowerCase()] ?? ' ';
  });
}

/**
 * `s` without HTML, JATS or MathML tags, comments and entities. Crossref titles
 * carry `<i>Escherichia coli</i>` and whole `<mml:math>` blocks; citation-js
 * turns `\textit{}` into `<i>`. Only tag-shaped text is removed, so "p < 0.05"
 * keeps its words.
 */
export function stripMarkup(s: string): string {
  return decodeEntities(
    s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>/g, ' '),
  );
}

const GREEK: Readonly<Record<string, string>> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho',
  σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

// Scripts written without spaces between words: each character is a token, so
// two titles in them are compared character by character.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** Lowercase word and number tokens of `s`, markup and punctuation removed. */
function tokens(s: string): string[] {
  let t = nfkcNormalize(stripMarkup(s)).toLowerCase();
  t = t.replace(/[αβγδεζηθικλμνξοπρσςτυφχψω]/g, (c) => ` ${GREEK[c] ?? c} `);
  t = t.replace(/&/g, ' and ').replace(/['’`]/g, '');
  const out: string[] = [];
  for (const word of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    if (UNSPACED.test(word)) {
      // Split runs of unspaced script into characters; keep Latin runs whole.
      for (const part of word.match(new RegExp(`${UNSPACED.source}|[^${UNSPACED.source.slice(1, -1)}]+`, 'gu')) ?? []) {
        out.push(part);
      }
    } else {
      out.push(word);
    }
  }
  return out;
}

const ROMAN = /^(?=[ivxl]+$)l?x{0,3}(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUE: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50 };

function romanToNumber(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VALUE[t[i]!]!;
    const next = ROMAN_VALUE[t[i + 1] ?? ''] ?? 0;
    n += v < next ? -v : v;
  }
  return n;
}

/**
 * The comparison key of a title word: roman numerals as numbers, and British
 * and US spellings and plurals folded together, so "Modelling tumours" and
 * "modeling tumor" agree while "increase" and "decrease" do not.
 */
function wordKey(word: string): string {
  const t = word === 'vs' ? 'versus' : word;
  if (ROMAN.test(t)) return String(romanToNumber(t));
  if (/^\d+$/.test(t) || UNSPACED.test(t)) return t;
  let k = t
    .replace(/our/g, 'or')
    .replace(/([iy])s(e|ed|es|ing|ation|ations|er|ers)$/, '$1z$2')
    .replace(/ll(ed|ing|er|ers)$/, 'l$1')
    .replace(/tre(s?)$/, 'ter$1')
    .replace(/ogue$/, 'og')
    .replace(/ae|oe/g, 'e');
  if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
  return k;
}

/** Optimal-string-alignment distance (Levenshtein plus adjacent swaps), capped at 2. */
function osa(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return Math.min(2, d[a.length]![b.length]!);
}

/** Two word keys name the same word: equal, or one typo apart in a long word. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b) || a.length < 7 || b.length < 7) return false;
  return osa(a, b) <= 1;
}

// Words a title can gain or lose without becoming another title.
const TITLE_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'to', 'with', 'by', 'from', 'as',
  'via', 'into', 'its', 'de', 'la', 'le', 'les', 'el', 'der', 'die', 'das', 'und', 'et', 'du', 'des',
]);

// ---------------------------------------------------------------------------
//   Titles
// ---------------------------------------------------------------------------

interface TitleAlignment {
  /** Content words on either side left without a counterpart. */
  unmatched: number;
  content: number;
}

/**
 * Align two titles word by word. Words match 1:1, or one word matches two
 * adjacent words joined ("pretraining" and "pre-training", "alphasynuclein"
 * and "alpha synuclein"). A stopword may go unmatched; a content word may not.
 */
function alignTitles(a: string[], b: string[]): TitleAlignment {
  const ka = a.map(wordKey);
  const kb = b.map(wordKey);
  const cost = (t: string): number => (TITLE_STOPWORDS.has(t) ? 0 : 1);
  const n = a.length;
  const m = b.length;
  // dp[i][j]: fewest unmatched content words aligning a[i..] with b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      let best = Infinity;
      if (i < n) best = Math.min(best, dp[i + 1]![j]! + cost(a[i]!));
      if (j < m) best = Math.min(best, dp[i]![j + 1]! + cost(b[j]!));
      if (i < n && j < m) {
        if (sameWord(ka[i]!, kb[j]!)) best = Math.min(best, dp[i + 1]![j + 1]!);
        if (j + 1 < m && sameWord(ka[i]!, wordKey(b[j]! + b[j + 1]!))) best = Math.min(best, dp[i + 1]![j + 2]!);
        if (i + 1 < n && sameWord(wordKey(a[i]! + a[i + 1]!), kb[j]!)) best = Math.min(best, dp[i + 2]![j + 1]!);
      }
      dp[i]![j] = best;
    }
  }
  const content = Math.max(a.filter((t) => cost(t)).length, b.filter((t) => cost(t)).length);
  return { unmatched: dp[0]![0]!, content };
}

/** The numbers a title states, roman numerals included, sorted. */
function titleNumbers(t: string[]): string {
  return t.map(wordKey).filter((k) => /^\d+$/.test(k)).sort().join(' ');
}

/** The part of a title before its subtitle separator, when it has one of at least `minWords` words. */
function mainTitle(title: string, minWords: number): string | null {
  const s = nfkcNormalize(stripMarkup(title));
  const m = /\s*:\s|\s+-\s+|[?!]\s+/.exec(s);
  if (!m || m.index === 0) return null;
  const main = s.slice(0, m.index);
  return tokens(main).length >= minWords ? main : null;
}

/**
 * How well `claimed` matches a registry title, 0..1, and whether it matches.
 * The title may lack its subtitle on either side, but two titles that share
 * only a main title before different subtitles are different works.
 */
export function matchTitle(claimed: string, record: Pick<WorkRecord, 'title' | 'subtitle' | 'altTitles'>): { ok: boolean; score: number } {
  const recordFull = record.subtitle ? [`${record.title}: ${record.subtitle}`, record.title] : [record.title];
  const recordTitles = [...recordFull, ...(record.altTitles ?? [])];
  // A one-word main title ("BERT") is too little to stand for a whole title
  // the entry cut short; the entry's own main title may be one word.
  const recordMains = recordTitles.map((t) => mainTitle(t, 2)).filter((t): t is string => t !== null);
  const claimedMain = mainTitle(claimed, 1);
  const pairs: Array<[string, string]> = [
    ...recordTitles.map((r): [string, string] => [claimed, r]),
    ...recordMains.map((r): [string, string] => [claimed, r]),
    ...(claimedMain ? recordTitles.map((r): [string, string] => [claimedMain, r]) : []),
  ];
  let best = 0;
  for (const [c, r] of pairs) {
    const tc = tokens(c);
    const tr = tokens(r);
    if (tc.length === 0 || tr.length === 0) continue;
    const { unmatched, content } = alignTitles(tc, tr);
    const score = content === 0 ? 1 : Math.max(0, 1 - unmatched / content);
    if (unmatched === 0 && titleNumbers(tc) === titleNumbers(tr)) return { ok: true, score: 1 };
    // A number mismatch caps the score: the words alone may all agree.
    best = Math.max(best, titleNumbers(tc) === titleNumbers(tr) ? score : Math.min(score, 0.5));
  }
  return { ok: false, score: best };
}

// ---------------------------------------------------------------------------
//   Names
// ---------------------------------------------------------------------------

const PARTICLES: ReadonlySet<string> = new Set([
  'van', 'von', 'de', 'den', 'der', 'del', 'della', 'dei', 'di', 'da', 'dos', 'do', 'du', 'la', 'le',
  'el', 'al', 'bin', 'ben', 'ter', 'te', 'zu', 'vom', 'zur', 'ten', 'y', 'e', 'st',
]);
const SUFFIXES: ReadonlySet<string> = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', '2nd', '3rd', 'phd', 'md']);

// Words that say a name is an organization, and that two organizations share
// without being the same one ("ATLAS Collaboration", "CMS Collaboration").
const ORG_WORDS: ReadonlySet<string> = new Set([
  'collaboration', 'collaborators', 'consortium', 'group', 'team', 'committee', 'organization',
  'organisation', 'association', 'society', 'institute', 'university', 'project', 'network',
  'contributors', 'council', 'agency', 'foundation', 'initiative', 'alliance', 'working', 'study',
  'investigators', 'board', 'office', 'department', 'centre', 'center', 'program', 'programme',
]);

interface NameKey {
  /** Distinctive tokens: surname parts for a person, telling words for an organization. */
  tokens: string[];
  /** Given-name tokens of a structured personal name, for a registry that swapped the parts. */
  given?: string[];
  corporate: boolean;
  shown: string;
}

/** Transliteration-insensitive form of a name token: "mueller" and "müller" agree. */
function foldName(t: string): string {
  return t.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
}

function nameTokens(s: string): string[] {
  return nfkcNormalize(s).toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function orgKey(name: string): NameKey {
  const all = nameTokens(name).filter((t) => !TITLE_STOPWORDS.has(t));
  const telling = all.filter((t) => !ORG_WORDS.has(t));
  return { tokens: (telling.length > 0 ? telling : all).map(foldName), corporate: true, shown: name };
}

function surnameKey(surname: string, shown: string): NameKey {
  const all = nameTokens(surname);
  // One-letter tokens are initials, except in scripts where a surname is one character.
  const core = all.filter((t) => !PARTICLES.has(t) && !SUFFIXES.has(t) && (t.length > 1 || UNSPACED.test(t)));
  return { tokens: (core.length > 0 ? core : all).map(foldName), corporate: false, shown };
}

function isEtAl(s: string): boolean {
  return /^(?:others|et\.?\s*al\.?)$/i.test(s.trim());
}

/** The comparison key of a name, or null for "others" / "et al." and empty names. */
function nameKey(n: WorkName): NameKey | null {
  if (n.literal) return isEtAl(n.literal) ? null : orgKey(n.literal);
  if (n.family) {
    if (isEtAl(n.family)) return null;
    const words = nameTokens(n.family).filter((t) => !PARTICLES.has(t));
    // A family name with no given name and several words ({World Health
    // Organization} in BibTeX) or an organization word is a corporate author.
    if (!n.given && !n.particle && (words.length >= 2 || words.some((w) => ORG_WORDS.has(w)))) return orgKey(n.family);
    const key = surnameKey([n.particle, n.family].filter(Boolean).join(' '), n.family);
    const given = n.given ? nameTokens(n.given).filter((t) => t.length > 1 || UNSPACED.test(t)).map(foldName) : [];
    return given.length > 0 ? { ...key, given } : key;
  }
  const text = n.text?.trim();
  if (!text || isEtAl(text)) return null;
  if (nameTokens(text).some((t) => ORG_WORDS.has(t))) return orgKey(text);
  const comma = text.indexOf(',');
  if (comma > 0) return surnameKey(text.slice(0, comma), text.slice(0, comma).trim());
  // A display name in unknown order ("Ashish Vaswani", "Vaswani A", "Li Wang"):
  // every word but initials may be the surname.
  const raw = text.split(/\s+/);
  const hasLower = raw.some((w) => /\p{Ll}/u.test(w));
  const kept = raw.filter((w) => !(hasLower && /^\p{Lu}{1,3}\.?$/u.test(w)) && !/^\p{L}\.$/u.test(w));
  return surnameKey(kept.join(' '), text);
}

function sameNameToken(a: string, b: string): boolean {
  return a === b || (a.length >= 6 && b.length >= 6 && osa(a, b) <= 1);
}

const within = (xs: string[], ys: string[]): boolean => xs.length > 0 && xs.every((x) => ys.some((y) => sameNameToken(x, y)));

/** Whether two names can be the same person or organization. */
function namesMatch(a: NameKey, b: NameKey): boolean {
  const shared = a.tokens.filter((t) => b.tokens.some((u) => sameNameToken(t, u))).length;
  // A registry may give family and given name the other way round (common
  // for Chinese, Japanese and Korean names): "Li, Wang" for "Wang, Li".
  if (shared === 0) return !a.corporate && !b.corporate && within(a.tokens, b.given ?? []) && within(b.tokens, a.given ?? []);
  if (!a.corporate && !b.corporate) return true;
  // Organizations: one name's telling words inside the other's, or most of them shared.
  const union = new Set([...a.tokens, ...b.tokens]).size;
  return shared >= Math.min(a.tokens.length, b.tokens.length) || shared / union >= 0.5;
}

function checkAuthors(claimed: WorkName[], record: WorkRecord, problems: string[], notes: string[]): number {
  const mine = claimed.map(nameKey).filter((k): k is NameKey => k !== null);
  const theirsRaw = record.authors.length > 0 ? record.authors : (record.editors ?? []);
  const theirs = theirsRaw.map(nameKey).filter((k): k is NameKey => k !== null);
  if (mine.length === 0) return 1;
  if (theirs.length === 0) {
    notes.push(`${record.registry} lists no authors to compare`);
    return 1;
  }
  const [first, ...rest] = mine as [NameKey, ...NameKey[]];
  const firstPerson = theirs.find((k) => !k.corporate);
  // A consortium is often listed after the people, so a corporate first author
  // may match any author; a person must be the record's first author.
  const firstOk = first.corporate
    ? theirs.some((k) => namesMatch(first, k))
    : namesMatch(first, theirs[0]!) || (firstPerson !== undefined && namesMatch(first, firstPerson));
  if (!firstOk) problems.push(`first author ${first.shown} is not the first author ${record.registry} lists (${theirs[0]!.shown})`);
  const strangers = rest.filter((k) => !theirs.some((t) => namesMatch(k, t)));
  if (strangers.length > 0) {
    const shown = strangers.slice(0, 3).map((k) => k.shown).join(', ') + (strangers.length > 3 ? ` and ${strangers.length - 3} more` : '');
    problems.push(`${shown} ${strangers.length === 1 ? 'is not an author' : 'are not authors'} of this work in ${record.registry}`);
  }
  return (mine.length - strangers.length - (firstOk ? 0 : 1)) / mine.length;
}

// ---------------------------------------------------------------------------
//   Journals
// ---------------------------------------------------------------------------

const VENUE_STOPWORDS: ReadonlySet<string> = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'for', 'de', 'la', 'und', 'fur', 'et']);
const VENUE_GENERIC: ReadonlySet<string> = new Set([
  'journal', 'journals', 'proceedings', 'international', 'conference', 'transactions', 'letters',
  'review', 'reviews', 'annals', 'bulletin', 'acta', 'research', 'studies', 'quarterly', 'magazine',
  'series', 'reports', 'advances', 'archives', 'communications', 'j', 'proc', 'trans', 'lett', 'rev',
]);

function venueTokens(s: string): string[] {
  const raw = tokens(s);
  // "U.S.A." arrives as u, s, a: rejoin runs of single letters.
  const out: string[] = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1 && /\p{L}/u.test(t)) { run += t; continue; }
    if (run) { out.push(run); run = ''; }
    out.push(t);
  }
  if (run) out.push(run);
  return out.filter((t) => !VENUE_STOPWORDS.has(t));
}

function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (const c of long) if (c === short[i]) i++;
  return i === short.length;
}

/** "phys" and "physical", "natl" and "national": one is an abbreviation of the other. */
function abbreviates(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 3 && s[0] === l[0] && isSubsequence(s, l);
}

function initials(t: string[]): string {
  return t.map((w) => w[0] ?? '').join('');
}

/** Whether a bibliography's journal name can be the registry's. */
export function venuesMatch(claimed: string, registry: string): boolean {
  const c = venueTokens(claimed);
  const r = venueTokens(registry);
  if (c.length === 0 || r.length === 0) return true;
  const telling = (t: string[]): string[] => {
    const x = t.filter((w) => !VENUE_GENERIC.has(w));
    return x.length > 0 ? x : t;
  };
  const tc = telling(c);
  const tr = telling(r);
  if (tc.some((a) => tr.some((b) => abbreviates(a, b)))) return true;
  // An acronym for the other name: PNAS, JAMA, NEJM, JACS.
  const acronym = (one: string[], other: string[]): boolean =>
    one.length === 1 && one[0]!.length >= 2 && one[0]!.length <= 8 && one[0] === initials(other);
  return acronym(c, r) || acronym(r, c);
}

const PREPRINT_VENUE = /\b(?:arxiv|biorxiv|medrxiv|chemrxiv|psyarxiv|ssrn|research square|preprints?)\b/i;

// ---------------------------------------------------------------------------
//   The whole match
// ---------------------------------------------------------------------------

/** Compare a bibliography entry with the record a registry returned for its identifier. */
export function matchWork(claimed: ClaimedWork, record: WorkRecord): WorkMatch {
  const problems: string[] = [];
  const notes: string[] = [];

  const title = matchTitle(claimed.title, record);
  if (!title.ok) {
    const theirs = nfkcNormalize(stripMarkup(record.subtitle ? `${record.title}: ${record.subtitle}` : record.title));
    problems.push(`the title is not the one ${record.registry} gives ("${theirs}")`);
  }

  const authorScore = checkAuthors(claimed.authors, record, problems, notes);

  if (claimed.year !== undefined && record.years.length > 0 && !record.years.some((y) => Math.abs(y - claimed.year!) <= 1)) {
    problems.push(`the year ${claimed.year} is not within a year of ${record.years.join(' or ')}, the year ${record.registry} gives`);
  }

  const venue = claimed.venue?.trim();
  if (venue && record.journalArticle && record.venues.length > 0 && !PREPRINT_VENUE.test(venue)
    && !record.venues.some((v) => venuesMatch(venue, v))) {
    problems.push(`the journal "${venue}" is not "${nfkcNormalize(stripMarkup(record.venues[0]!))}", the journal ${record.registry} gives`);
  }

  return { ok: problems.length === 0, problems, notes, titleScore: title.score, authorScore };
}
