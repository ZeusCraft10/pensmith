// bin/lib/verify/quote-match.ts — whether a direct quotation appears in the
// text of its source. Deterministic; no LLM.
//
// A quotation must appear word for word: every letter and digit of every
// quoted word, in order. The only differences accepted are the ones academic
// quoting and PDF text extraction make without changing a word:
//
//   - case, punctuation, quote marks, accents, ligatures and soft hyphens;
//   - a word hyphenated across a line break ("trans-\nformer");
//   - word spacing, a bounded number of times per quotation: pdf.js runs words
//     together ("isto findholesin") and splits them, but a difference that
//     joins or splits a negation ("not able" / "notable") is never accepted;
//   - a numeric reference marker ("[12]"), a superscript footnote marker, or a
//     footnote number pdf.js put on a line of its own, which the quotation may
//     leave out (a quotation that keeps a bracketed number or a superscript is
//     compared with them, so "[0, 2]" never matches "[0, 1]", nor "m³" "m²");
//   - an ellipsis, which leaves words out: the parts around it must appear in
//     order and close together, within one sentence unless both are long, and
//     it may not leave out a negation in the same clause as a quoted word
//     ("was ... safe" for "was not found to be safe"), only a whole clause set
//     off by punctuation that holds one;
//   - a bracketed insertion or replacement ("[the authors]", "[T]he", "[sic]"),
//     which may stand for a few source words, never a number, and holds a
//     negation only where those source words do. A bracket at the start or end
//     of the quotation is the author's own lead-in or close, checked against
//     nothing, like the words outside the quote marks.
//
// Both texts are folded to a key (the words' letters run together, a
// separator between anything else), so finding a quotation is an exact
// substring search on the source key followed by a check of word boundaries.
// That stays close to linear on a book-length source.

import { sentenceEnds } from '../citation-grammar.js';

/**
 * A quotation of fewer quoted words than this is a term, not a quotation, and
 * is not checked. Words in a spaced bracket are the author's, not quoted.
 */
export const MIN_SHORT_WORDS = 3;
/** Each part around an ellipsis needs this many quoted words, or it is found almost anywhere. */
const MIN_PART_WORDS = 2;
/** The most source text an ellipsis may stand for within one sentence. */
export const MAX_ELIDED_CHARS = 150;
/** The most source text an ellipsis between two long parts may stand for, across sentences. */
export const MAX_ELIDED_PASSAGE_CHARS = 1000;
/** Parts of at least this many words may have an ellipsis between them that crosses sentences. */
export const PASSAGE_PART_WORDS = 5;
/** The most source words a bracketed insertion may replace. */
export const MAX_BRACKET_WORDS = 3;
/** How many places in a run of N quoted words may differ in word spacing only: ceil(N / this). */
const WORDS_PER_SPACING_SLIP = 3;
/** Candidate placements tried per quotation before giving up, against pathological sources. */
const MAX_CANDIDATES = 200_000;

/**
 * Words a spacing difference may never join or split, because the joined and
 * split forms say opposite things ("not able" / "notable", "now here" /
 * "nowhere").
 */
const NEGATIONS: ReadonlySet<string> = new Set([
  'no', 'not', 'nor', 'never', 'none', 'nothing', 'nobody', 'nowhere', 'neither', 'non', 'cannot', 'without',
  'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'cant', 'couldnt', 'wont', 'wouldnt',
  'shouldnt', 'hasnt', 'havent', 'hadnt', 'neednt', 'mustnt',
]);

// ---------------------------------------------------------------------------
// Folding text into tokens
// ---------------------------------------------------------------------------

// A soft hyphen marks where a word may break; with the line break after it,
// it joins the two halves.
const SOFT_HYPHEN = /­\s*/g;
const INVISIBLE = /[​-‍⁠﻿]/g;
// pdf.js puts a space between a letter and the accent above it ("Recam ́an").
const SPACED_MARK = /(?<=\p{L})[ \t]+(?=\p{M})/gu;
// A superscript footnote marker after a word or its punctuation ("effective.¹²").
const SUPERSCRIPT_MARKER = /(?<=[\p{L}.,;:!?)\]'"’”])[¹²³⁰⁴-⁹]+/gu;
// A numeric reference marker: [3], [1, 4], [5–7].
const REFERENCE_MARKER = /\[\s*\d{1,3}(?:\s*[-–,;]\s*\d{1,3})*\s*\]/g;
// A quotation that keeps one of these is compared with them: the same form
// may be a bound ("the interval [0, 1]") or a unit ("m²"), not a marker.
const KEPT_MARKER = /\[\s*\d{1,3}(?:\s*[-–,;]\s*\d{1,3})*\s*\]|[¹²³⁰⁴-⁹]/u;
// A line holding only a number or two: a footnote marker or page number pdf.js
// set apart from the running text.
const NUMBER_LINE = /^[ \t]*\d{1,3}(?:[ \t]*[,–-][ \t]*\d{1,3})*[ \t]*$/gm;

/** Whether reference markers and superscripts are dropped from a text, or kept as its numbers. */
type Markers = 'drop' | 'keep';

/** How a quotation's markers are read: kept when it keeps one, so the source's are kept too. */
const markersOf = (quote: string): Markers => (KEPT_MARKER.test(quote) ? 'keep' : 'drop');

function clean(text: string, markers: Markers): string {
  const plain = text.replace(SOFT_HYPHEN, '').replace(INVISIBLE, '').replace(SPACED_MARK, '');
  return (markers === 'drop' ? plain.replace(SUPERSCRIPT_MARKER, '') : plain)
    .normalize('NFKC')
    .replace(/−/g, '-')
    .replace(REFERENCE_MARKER, (m) => (markers === 'drop' ? ' ' : ` ${m.slice(1, -1)} `))
    .replace(NUMBER_LINE, '');
}

// Chinese and Japanese are written without spaces, so each character is a word.
const CJK = String.raw`\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}`;
// A word (letters, with any combining marks), a number (with a sign when it
// does not follow a letter or digit, and with its decimal or thousands
// separators), or a symbol whose loss changes a statement (50% / 50, p < .05).
const TOKEN = new RegExp(
  String.raw`[${CJK}]|(?:(?![${CJK}])\p{L})(?:(?![${CJK}])[\p{L}\p{M}])*` +
  String.raw`|(?:(?<![\p{L}\p{N}])[-+])?\p{N}+(?:[.,]\p{N}+)*` +
  '|[%‰<>=≤≥≠≈±×÷$€£¥°&]',
  'gu',
);
// What lies between two halves of a word hyphenated at a line break.
const LINE_BREAK_HYPHEN = /^[-‐][ \t]*\r?\n\s*$/;

interface Token {
  /** The folded form compared: lower case, accents removed. */
  key: string;
  word: boolean;
  /** Offsets in the cleaned text. */
  start: number;
  end: number;
  /** True when a hyphen at a line break joins this word to the one before. */
  soft: boolean;
}

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const word = /^\p{L}/u.test(raw);
    const prev = out[out.length - 1];
    const soft = word && prev !== undefined && prev.word && LINE_BREAK_HYPHEN.test(text.slice(prev.end, m.index));
    out.push({ key: word ? fold(raw) : raw, word, start: m.index, end: m.index + raw.length, soft });
  }
  return out;
}

const APOSTROPHE = /^['’]$/;

/** Whether `tokens[i]` of `text` is a negation: "not", "never" ..., or the "t" of "didn't". */
function isNegation(tokens: readonly Token[], i: number, text: string): boolean {
  const t = tokens[i]!;
  if (NEGATIONS.has(t.key)) return true;
  const prev = tokens[i - 1];
  return t.key === 't' && prev !== undefined && prev.key.endsWith('n') && APOSTROPHE.test(text.slice(prev.end, t.start));
}

/** Whether any of `tokens[from..to)` of `text` is a negation. */
function hasNegation(tokens: readonly Token[], from: number, to: number, text: string): boolean {
  for (let i = from; i < to; i += 1) if (isNegation(tokens, i, text)) return true;
  return false;
}

const SEP = '\u0001';

/** A text as tokens, with their keys run together (words with nothing between them). */
interface Keyed {
  tokens: Token[];
  key: string;
  /** Where each token starts and ends in `key`. */
  kStart: Int32Array;
  kEnd: Int32Array;
  /** `key` offsets where two words meet with a space or punctuation between them, ascending. */
  wordBreaks: Int32Array;
  /** `key` offsets where two words meet at a line-break hyphen, ascending. */
  softBreaks: Int32Array;
}

function keyed(tokens: Token[]): Keyed {
  const n = tokens.length;
  const kStart = new Int32Array(n);
  const kEnd = new Int32Array(n);
  const parts: string[] = [];
  const wordBreaks: number[] = [];
  const softBreaks: number[] = [];
  let off = 0;
  for (let i = 0; i < n; i += 1) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];
    if (prev && !(prev.word && t.word)) {
      parts.push(SEP);
      off += 1;
    } else if (prev) {
      (t.soft ? softBreaks : wordBreaks).push(off);
    }
    kStart[i] = off;
    parts.push(t.key);
    off += t.key.length;
    kEnd[i] = off;
  }
  return { tokens, key: parts.join(''), kStart, kEnd, wordBreaks: Int32Array.from(wordBreaks), softBreaks: Int32Array.from(softBreaks) };
}

/** Index of the first value of ascending `a` greater than `x`. */
function upperBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The values of ascending `a` strictly between `lo` and `hi`. */
function between(a: Int32Array, lo: number, hi: number): Int32Array {
  return a.subarray(upperBound(a, lo), upperBound(a, hi - 1));
}

/** The tokens of `k` that contain key offset `x` or end or start there. */
function tokensAt(k: Keyed, x: number): Token[] {
  const i = upperBound(k.kStart, x) - 1;
  const out: Token[] = [];
  if (i >= 0 && k.kEnd[i]! >= x) out.push(k.tokens[i]!);
  if (i >= 1 && k.kEnd[i - 1] === x) out.push(k.tokens[i - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** A source text prepared for matching; prepare it once and match every quotation of it. */
export interface QuoteSource {
  readonly raw: string;
  readonly text: string;
  readonly keyed: Keyed;
  /** The token starting and ending at each key offset, or -1. */
  readonly startAt: Int32Array;
  readonly endAt: Int32Array;
  sentenceEnds?: number[];
  /** The same source with its markers kept, prepared when a quotation keeps one. */
  kept?: QuoteSource;
}

export function prepareSource(rawText: string, markers: Markers = 'drop'): QuoteSource {
  const text = clean(rawText, markers);
  const k = keyed(tokenize(text));
  const startAt = new Int32Array(k.key.length + 1).fill(-1);
  const endAt = new Int32Array(k.key.length + 1).fill(-1);
  for (let i = 0; i < k.tokens.length; i += 1) {
    startAt[k.kStart[i]!] = i;
    endAt[k.kEnd[i]!] = i;
  }
  return { raw: rawText, text, keyed: k, startAt, endAt };
}

function sentenceEndBetween(src: QuoteSource, from: number, to: number): boolean {
  src.sentenceEnds ??= sentenceEnds(src.text);
  const i = upperBound(src.sentenceEnds, from - 1);
  return i < src.sentenceEnds.length && src.sentenceEnds[i]! < to;
}

// ---------------------------------------------------------------------------
// The quotation
// ---------------------------------------------------------------------------

/** A run of quoted words with no ellipsis or bracket in it. */
interface Piece extends Keyed {
  words: number;
  /** How many spacing differences it may have. */
  slips: number;
}

/** `negation`: the bracket holds one, so the source words it stands for must too. */
type Gap = { kind: 'bracket'; negation: boolean } | { kind: 'ellipsis'; passage: boolean };

interface Plan {
  pieces: Piece[];
  /** gaps[i] lies between pieces[i] and pieces[i + 1]. */
  gaps: Gap[];
  ellipsis: boolean;
  bracket: boolean;
}

const ELLIPSIS = /\[\s*(?:\.\s*){3,}\]|(?:\.\s*){3,}/;
const BRACKET = /\[([^[\]]*)\]/g;
const EDITORIAL_NOTE = /^\s*(?:sic!?|original emphasis|(?:emphasis|italics)(?: (?:added|mine|in original|original))?)\s*$/i;
const WORDLIKE = /[\p{L}\p{N}]/u;

const countWords = (tokens: readonly Token[]): number => tokens.filter((t) => t.word || /\p{N}/u.test(t.key)).length;

interface Part {
  pieces: Piece[];
  /** brackets[j] is what the bracket before pieces[j + 1] holds. */
  brackets: string[];
  words: number;
}

/**
 * A quotation's parts between ellipses, each split into pieces at its
 * bracketed insertions, and whether it has a bracket that stands for source
 * words. An editorial note ([sic]) goes; a bracket inside a word ([T]he,
 * help[s]) keeps its letters.
 */
function quoteParts(quote: string, markers: Markers): { parts: Part[]; bracket: boolean } {
  const parts: Part[] = [];
  let bracket = false;
  for (const text of clean(quote, markers).split(ELLIPSIS)) {
    const part: Part = { pieces: [], brackets: [], words: 0 };
    // What the brackets since the last piece hold; one between two pieces is a gap.
    let held = '';
    const addPiece = (segment: string): void => {
      const tokens = tokenize(segment);
      if (tokens.length === 0) return;
      const words = countWords(tokens);
      if (part.pieces.length > 0) part.brackets.push(held);
      held = '';
      part.pieces.push({ ...keyed(tokens), words, slips: Math.ceil(words / WORDS_PER_SPACING_SLIP) });
      part.words += words;
    };
    let cur = '';
    let last = 0;
    for (const m of text.matchAll(BRACKET)) {
      cur += text.slice(last, m.index);
      last = m.index + m[0].length;
      const before = text[m.index - 1];
      const after = text[last];
      if (EDITORIAL_NOTE.test(m[1]!)) cur += ' ';
      else if ((before !== undefined && WORDLIKE.test(before)) || (after !== undefined && WORDLIKE.test(after))) cur += m[1];
      else {
        addPiece(cur);
        cur = '';
        held += ` ${m[1]!}`;
        bracket = true;
      }
    }
    addPiece(cur + text.slice(last));
    if (part.pieces.length > 0) parts.push(part);
  }
  return { parts, bracket };
}

/**
 * How many quoted words of `quote` the matcher checks: those outside a spaced
 * bracket ("[the authors]") or an editorial note ("[sic]"). An ellipsis is
 * not a word.
 */
export function checkedWordCount(quote: string): number {
  return quoteParts(quote, markersOf(quote)).parts.reduce((n, p) => n + p.words, 0);
}

/** A quotation's pieces and the gaps between them, or why it cannot be checked. */
function planQuote(quote: string, markers: Markers): Plan | string {
  const { parts, bracket } = quoteParts(quote, markers);
  const plan: Plan = { pieces: [], gaps: [], ellipsis: parts.length > 1, bracket };
  if (parts.reduce((n, p) => n + p.words, 0) < MIN_SHORT_WORDS) {
    return `cannot be checked: fewer than ${MIN_SHORT_WORDS} quoted words outside brackets and ellipses`;
  }
  if (plan.ellipsis && parts.some((p) => p.words < MIN_PART_WORDS)) {
    return 'cannot be checked: a one-word part around an ellipsis is found almost anywhere — keep ' +
      'two or more quoted words on each side of the ellipsis, or paraphrase that part';
  }
  parts.forEach((part, i) => {
    if (i > 0) {
      const passage = parts[i - 1]!.words >= PASSAGE_PART_WORDS && part.words >= PASSAGE_PART_WORDS;
      plan.gaps.push({ kind: 'ellipsis', passage });
    }
    part.pieces.forEach((p, j) => {
      if (j > 0) {
        const held = part.brackets[j - 1]!;
        const tokens = tokenize(held);
        plan.gaps.push({ kind: 'bracket', negation: hasNegation(tokens, 0, tokens.length, held) });
      }
      plan.pieces.push(p);
    });
  });
  return plan;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The first and last source tokens of `piece` placed at key offset `h`, or
 * null when it does not fit there: it must start and end on whole source
 * words, and its word spacing may differ from the source's in at most
 * `piece.slips` places, none of them at a negation.
 */
function placeAt(src: QuoteSource, piece: Piece, h: number): [number, number] | null {
  const s = src.keyed;
  const first = src.startAt[h]!;
  if (first < 0 || s.tokens[first]!.soft) return null;
  const end = h + piece.key.length;
  const last = src.endAt[end]!;
  if (last < 0 || s.tokens[last + 1]?.soft) return null;

  const srcBreaks = between(s.wordBreaks, h, end);
  const srcSoft = between(s.softBreaks, h, end);
  const quoteBreaks = piece.wordBreaks;
  let slips = 0;
  const slip = (x: number): boolean => {
    slips += 1;
    if (slips > piece.slips) return false;
    return ![...tokensAt(s, x), ...tokensAt(piece, x - h)].some((t) => NEGATIONS.has(t.key));
  };
  // Walk both ascending lists of word breaks; a break in only one is a slip,
  // unless the source breaks there at a line-break hyphen.
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < quoteBreaks.length || j < srcBreaks.length) {
    const q = i < quoteBreaks.length ? quoteBreaks[i]! + h : Infinity;
    const r = j < srcBreaks.length ? srcBreaks[j]! : Infinity;
    if (q === r) {
      i += 1;
      j += 1;
    } else if (q < r) {
      while (k < srcSoft.length && srcSoft[k]! < q) k += 1;
      if (!(k < srcSoft.length && srcSoft[k] === q) && !slip(q)) return null;
      i += 1;
    } else {
      if (!slip(r)) return null;
      j += 1;
    }
  }
  return [first, last];
}

/**
 * Whether the source words between two pieces may be what a bracket stands
 * for: a few words, no number, and a negation exactly when the bracket holds
 * one ("did [not] reduce" for "did reduce" reverses the source).
 */
function bracketFits(src: QuoteSource, prevLast: number, first: number, gap: { negation: boolean }): boolean {
  if (first - prevLast - 1 > MAX_BRACKET_WORDS) return false;
  const tokens = src.keyed.tokens;
  for (let t = prevLast + 1; t < first; t += 1) if (/\p{N}/u.test(tokens[t]!.key)) return false;
  return hasNegation(tokens, prevLast + 1, first, src.text) === gap.negation;
}

// Punctuation that sets a clause off: a comma, a semicolon, a colon, a dash, a
// parenthesis or a sentence end.
const CLAUSE_MARK = /[,;:()–—.!?]/;

/**
 * Whether an ellipsis may stand for the source words between two pieces. A
 * negation it leaves out must be in a clause of its own, set off by
 * punctuation from both quoted parts: "The vaccine, which was not tested in
 * children, proved safe" may lose its middle clause, but "was ... safe" for
 * "was not found to be safe" reverses the source.
 */
function ellipsisFits(src: QuoteSource, prevLast: number, first: number): boolean {
  const tokens = src.keyed.tokens;
  for (let t = prevLast + 1; t < first; t += 1) {
    if (!isNegation(tokens, t, src.text)) continue;
    const before = src.text.slice(tokens[prevLast]!.end, tokens[t]!.start);
    const after = src.text.slice(tokens[t]!.end, tokens[first]!.start);
    if (!CLAUSE_MARK.test(before) || !CLAUSE_MARK.test(after)) return false;
  }
  return true;
}

function matchPlan(src: QuoteSource, plan: Plan): boolean {
  const s = src.keyed;
  const n = s.tokens.length;
  let budget = MAX_CANDIDATES;
  const place = (i: number, prevLast: number): boolean => {
    if (i === plan.pieces.length) return true;
    const piece = plan.pieces[i]!;
    let from = 0;
    let lastStart = s.key.length;
    const gap = i > 0 ? plan.gaps[i - 1]! : null;
    if (gap) {
      const next = prevLast + 1;
      if (next >= n) return false;
      from = s.kStart[next]!;
      if (gap.kind === 'bracket') {
        lastStart = s.kStart[Math.min(next + MAX_BRACKET_WORDS, n - 1)]!;
      } else {
        // The next part may start no further than the ellipsis allows.
        const limit = s.tokens[prevLast]!.end + (gap.passage ? MAX_ELIDED_PASSAGE_CHARS : MAX_ELIDED_CHARS);
        let lo = next;
        let hi = n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (s.tokens[mid]!.start <= limit) lo = mid + 1;
          else hi = mid;
        }
        if (lo === next) return false;
        lastStart = s.kStart[lo - 1]!;
      }
    }
    // Search only as far as a placement can count. Searching on to the end of
    // the source for each placement of the piece before would cost a scan of
    // the whole source per candidate, when the piece before is common.
    const hay = gap ? s.key.slice(0, Math.min(s.key.length, lastStart + piece.key.length)) : s.key;
    for (let h = hay.indexOf(piece.key, from); h !== -1; h = hay.indexOf(piece.key, h + 1)) {
      if (--budget < 0) return false;
      const at = placeAt(src, piece, h);
      if (!at) continue;
      const [first, last] = at;
      if (gap?.kind === 'bracket' && !bracketFits(src, prevLast, first, gap)) continue;
      if (gap?.kind === 'ellipsis' && !ellipsisFits(src, prevLast, first)) continue;
      // A later placement lies further on, past the same sentence end.
      if (gap?.kind === 'ellipsis' && !gap.passage && sentenceEndBetween(src, s.tokens[prevLast]!.end, s.tokens[first]!.start)) break;
      if (place(i + 1, last)) return true;
    }
    return false;
  };
  return place(0, -1);
}

export interface QuoteMatch {
  found: boolean;
  /** Why, in a few words, for the verdict row. */
  reason: string;
}

/** Whether `quote` appears in `source` (a prepared source, or its raw text). */
export function matchQuote(quote: string, source: QuoteSource | string): QuoteMatch {
  const markers = markersOf(quote);
  const plan = planQuote(quote, markers);
  if (typeof plan === 'string') return { found: false, reason: plan };
  const src = typeof source === 'string' ? prepareSource(source, markers)
    : markers === 'keep' ? (source.kept ??= prepareSource(source.raw, 'keep')) : source;
  if (matchPlan(src, plan)) return { found: true, reason: 'found word for word' };
  const rules: string[] = [];
  if (plan.ellipsis) {
    rules.push(
      `an ellipsis may leave out at most ${MAX_ELIDED_CHARS} characters of one sentence, or ${MAX_ELIDED_PASSAGE_CHARS} ` +
      `across sentences between parts of ${PASSAGE_PART_WORDS} or more words, and a negation only in a clause ` +
      'set off by punctuation',
    );
  }
  if (plan.bracket) {
    rules.push(`a bracket may stand for at most ${MAX_BRACKET_WORDS} source words, never a number, and holds a negation only where they do`);
  }
  if (markers === 'keep') rules.push('a bracketed number or a superscript the quotation keeps must be in the source');
  return { found: false, reason: `not found word for word${rules.length > 0 ? ` (${rules.join('; ')})` : ''}` };
}
