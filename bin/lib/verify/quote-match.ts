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
//   - a numeric reference marker ("[12]"), or a footnote number pdf.js put on
//     a line of its own, which the quotation may leave out;
//   - an ellipsis, which leaves words out: the parts around it must appear in
//     order and close together, within one sentence unless both are long, and
//     it may not leave out a negation with only a word or two around it;
//   - a bracketed insertion or replacement ("[the authors]", "[T]he", "[sic]"),
//     which may stand for a few source words, never a negation or a number.
//
// Both texts are folded to a key (the words' letters run together, a
// separator between anything else), so finding a quotation is an exact
// substring search on the source key followed by a check of word boundaries.
// That stays close to linear on a book-length source.

import { sentenceEnds } from '../citation-grammar.js';
import { MIN_SHORT_WORDS } from '../quote-extractor.js';

/** The most source text an ellipsis may stand for within one sentence. */
export const MAX_ELIDED_CHARS = 150;
/** The most source text an ellipsis between two long parts may stand for, across sentences. */
export const MAX_ELIDED_PASSAGE_CHARS = 1000;
/** Parts of at least this many words may have an ellipsis between them that crosses sentences. */
export const PASSAGE_PART_WORDS = 5;
/** The most source words a bracketed insertion may replace. */
export const MAX_BRACKET_WORDS = 3;
/** An ellipsis leaving out this many words or fewer may not leave out a negation. */
const SHORT_OMISSION_WORDS = 3;
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
// A line holding only a number or two: a footnote marker or page number pdf.js
// set apart from the running text.
const NUMBER_LINE = /^[ \t]*\d{1,3}(?:[ \t]*[,–-][ \t]*\d{1,3})*[ \t]*$/gm;

function clean(text: string): string {
  return text
    .replace(SOFT_HYPHEN, '')
    .replace(INVISIBLE, '')
    .replace(SPACED_MARK, '')
    .replace(SUPERSCRIPT_MARKER, '')
    .normalize('NFKC')
    .replace(/−/g, '-')
    .replace(REFERENCE_MARKER, ' ')
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
  readonly text: string;
  readonly keyed: Keyed;
  /** The token starting and ending at each key offset, or -1. */
  readonly startAt: Int32Array;
  readonly endAt: Int32Array;
  sentenceEnds?: number[];
}

export function prepareSource(rawText: string): QuoteSource {
  const text = clean(rawText);
  const k = keyed(tokenize(text));
  const startAt = new Int32Array(k.key.length + 1).fill(-1);
  const endAt = new Int32Array(k.key.length + 1).fill(-1);
  for (let i = 0; i < k.tokens.length; i += 1) {
    startAt[k.kStart[i]!] = i;
    endAt[k.kEnd[i]!] = i;
  }
  return { text, keyed: k, startAt, endAt };
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

type Gap = { kind: 'bracket' } | { kind: 'ellipsis'; passage: boolean };

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

/** A quotation's pieces and the gaps between them, or why it cannot be checked. */
function planQuote(quote: string): Plan | string {
  const plan: Plan = { pieces: [], gaps: [], ellipsis: false, bracket: false };
  const parts: Array<{ pieces: Piece[]; words: number }> = [];
  for (const part of clean(quote).split(ELLIPSIS)) {
    // Split the part at each bracketed insertion. An editorial note ([sic])
    // goes; a bracket inside a word ([T]he, help[s]) keeps its letters.
    const segments: string[] = [];
    let cur = '';
    let last = 0;
    for (const m of part.matchAll(BRACKET)) {
      cur += part.slice(last, m.index);
      last = m.index + m[0].length;
      const before = part[m.index - 1];
      const after = part[last];
      if (EDITORIAL_NOTE.test(m[1]!)) cur += ' ';
      else if ((before !== undefined && WORDLIKE.test(before)) || (after !== undefined && WORDLIKE.test(after))) cur += m[1];
      else {
        segments.push(cur);
        cur = '';
        plan.bracket = true;
      }
    }
    segments.push(cur + part.slice(last));
    const pieces = segments.map((s) => tokenize(s)).filter((t) => t.length > 0).map((tokens): Piece => {
      const words = countWords(tokens);
      return { ...keyed(tokens), words, slips: Math.ceil(words / WORDS_PER_SPACING_SLIP) };
    });
    if (pieces.length > 0) parts.push({ pieces, words: pieces.reduce((n, p) => n + p.words, 0) });
  }
  plan.ellipsis = parts.length > 1;
  if (parts.reduce((n, p) => n + p.words, 0) < MIN_SHORT_WORDS) {
    return `too few quoted words outside brackets and ellipses to check (fewer than ${MIN_SHORT_WORDS})`;
  }
  if (plan.ellipsis && parts.some((p) => p.words < 2)) {
    return 'each part around an ellipsis needs two or more quoted words, or it is found almost anywhere';
  }
  parts.forEach((part, i) => {
    if (i > 0) {
      const passage = parts[i - 1]!.words >= PASSAGE_PART_WORDS && part.words >= PASSAGE_PART_WORDS;
      plan.gaps.push({ kind: 'ellipsis', passage });
    }
    part.pieces.forEach((p, j) => {
      if (j > 0) plan.gaps.push({ kind: 'bracket' });
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

/** Whether the source words between two pieces may be what a bracket stands for. */
function bracketFits(src: QuoteSource, prevLast: number, first: number): boolean {
  if (first - prevLast - 1 > MAX_BRACKET_WORDS) return false;
  for (let t = prevLast + 1; t < first; t += 1) {
    const tok = src.keyed.tokens[t]!;
    if (NEGATIONS.has(tok.key) || /\p{N}/u.test(tok.key)) return false;
  }
  return true;
}

/**
 * Whether an ellipsis may stand for the source words between two pieces. It
 * may leave out a clause that holds a negation, but not a negation and a word
 * or two around it: "is ... safe" for "is not safe" reverses the source.
 */
function ellipsisFits(src: QuoteSource, prevLast: number, first: number): boolean {
  if (first - prevLast - 1 > SHORT_OMISSION_WORDS) return true;
  for (let t = prevLast + 1; t < first; t += 1) if (NEGATIONS.has(src.keyed.tokens[t]!.key)) return false;
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
    for (let h = s.key.indexOf(piece.key, from); h !== -1 && h <= lastStart; h = s.key.indexOf(piece.key, h + 1)) {
      if (--budget < 0) return false;
      const at = placeAt(src, piece, h);
      if (!at) continue;
      const [first, last] = at;
      if (gap?.kind === 'bracket' && !bracketFits(src, prevLast, first)) continue;
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
  const plan = planQuote(quote);
  if (typeof plan === 'string') return { found: false, reason: plan };
  const src = typeof source === 'string' ? prepareSource(source) : source;
  if (matchPlan(src, plan)) return { found: true, reason: 'found word for word' };
  const rules: string[] = [];
  if (plan.ellipsis) {
    rules.push(
      `an ellipsis may leave out at most ${MAX_ELIDED_CHARS} characters of one sentence, or ${MAX_ELIDED_PASSAGE_CHARS} ` +
      `across sentences between parts of ${PASSAGE_PART_WORDS} or more words`,
    );
  }
  if (plan.bracket) rules.push(`a bracket may stand for at most ${MAX_BRACKET_WORDS} source words, never a negation or a number`);
  return { found: false, reason: `not found word for word${rules.length > 0 ? ` (${rules.join('; ')})` : ''}` };
}
