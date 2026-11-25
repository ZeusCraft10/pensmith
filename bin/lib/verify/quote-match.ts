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
//     leave out. A bracketed number or a superscript the quotation keeps must
//     stand at the same place in the source, so "[0, 2]" never matches
//     "[0, 1]", nor "m³" "m²"; a kept superscript may be a plain digit there,
//     as pdf.js extracts a raised one;
//   - an ellipsis, which leaves words out: the parts around it must appear in
//     order and close together, within one sentence unless both are long, and
//     it may not leave out a negation in the same clause as a quoted word
//     ("was ... safe" for "was not found to be safe"), only a whole clause set
//     off by punctuation that holds one, or a whole "not only ... but";
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
// A line holding only a number or two: a footnote marker or page number pdf.js
// set apart from the running text.
const NUMBER_LINE = /^[ \t]*\d{1,3}(?:[ \t]*[,–-][ \t]*\d{1,3})*[ \t]*$/gm;

// Each marker becomes one token of its own in the cleaned text: its numbers
// spelled in private-use characters between two more, so that nothing that
// reads digits or punctuation (a word, a clause mark, a sentence end) sees
// them. The same characters in the text itself are read as spaces.
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK_ALPHABET = '0123456789,-';
const MARK_BASE = 0xe010;
const PRIVATE_MARK_CHARS = /[\uE000-\uE01B]/g;

/** A marker's numbers as a token: "[1; 3–5]" and "[1,3-5]" are the same marker. */
function markToken(numbers: string): string {
  const canonical = numbers.normalize('NFKC').replace(/\s+/g, '').replace(/;/g, ',').replace(/–/g, '-');
  let out = MARK_OPEN;
  for (const c of canonical) {
    const i = MARK_ALPHABET.indexOf(c);
    if (i >= 0) out += String.fromCharCode(MARK_BASE + i);
  }
  return out + MARK_CLOSE;
}

const markKey = (token: string): string =>
  [...token.slice(1, -1)].map((c) => MARK_ALPHABET[c.charCodeAt(0) - MARK_BASE]).join('');

// The cleaning done before superscripts are read, and counted.
const unbreak = (text: string): string =>
  text.replace(PRIVATE_MARK_CHARS, ' ').replace(SOFT_HYPHEN, '').replace(INVISIBLE, '').replace(SPACED_MARK, '');

/**
 * A text with its reference and superscript markers as marker tokens. For a
 * quotation, bit i of `plainDigits` reads its i-th superscript as the plain
 * digit pdf.js extracts instead ("m²" as "m2"), and a number on a line of its
 * own is left out, as it always was; in a source it is a marker.
 */
function clean(text: string, role: 'source' | 'quote', plainDigits = 0): string {
  let n = 0;
  return unbreak(text)
    .replace(SUPERSCRIPT_MARKER, (m) => ((plainDigits >> n++) & 1 ? m : markToken(m)))
    .normalize('NFKC')
    .replace(/−/g, '-')
    .replace(REFERENCE_MARKER, (m) => ` ${markToken(m.slice(1, -1))} `)
    .replace(NUMBER_LINE, (m) => (role === 'source' ? markToken(m) : ''));
}

// Chinese and Japanese are written without spaces, so each character is a word.
const CJK = String.raw`\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}`;
// A word (letters, with any combining marks), a number (with a sign when it
// does not follow a letter or digit, and with its decimal or thousands
// separators), or a symbol whose loss changes a statement (50% / 50, p < .05).
const TOKEN = new RegExp(
  String.raw`\uE000[\uE010-\uE01B]*\uE001|` +
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

/** A marker's numbers, and the index of the token it stands before (the token count: after the last). */
interface Mark {
  at: number;
  key: string;
}

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** A cleaned text's tokens, and its markers apart from them. */
function tokenize(text: string): { tokens: Token[]; marks: Mark[] } {
  const tokens: Token[] = [];
  const marks: Mark[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    if (raw.startsWith(MARK_OPEN)) {
      marks.push({ at: tokens.length, key: markKey(raw) });
      continue;
    }
    const word = /^\p{L}/u.test(raw);
    const prev = tokens[tokens.length - 1];
    const soft = word && prev !== undefined && prev.word &&
      LINE_BREAK_HYPHEN.test(text.slice(prev.end, m.index).replace(PRIVATE_MARK_CHARS, ''));
    tokens.push({ key: word ? fold(raw) : raw, word, start: m.index, end: m.index + raw.length, soft });
  }
  return { tokens, marks };
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
  readonly text: string;
  readonly keyed: Keyed;
  /** The token starting and ending at each key offset, or -1. */
  readonly startAt: Int32Array;
  readonly endAt: Int32Array;
  /**
   * The markers before each token, by token index (the token count: after the
   * last). They are not in `keyed`, so a quotation may leave any of them out.
   */
  readonly marks: ReadonlyMap<number, readonly string[]>;
  sentenceEnds?: number[];
}

export function prepareSource(rawText: string): QuoteSource {
  const text = clean(rawText, 'source');
  const { tokens, marks: found } = tokenize(text);
  const k = keyed(tokens);
  const startAt = new Int32Array(k.key.length + 1).fill(-1);
  const endAt = new Int32Array(k.key.length + 1).fill(-1);
  for (let i = 0; i < k.tokens.length; i += 1) {
    startAt[k.kStart[i]!] = i;
    endAt[k.kEnd[i]!] = i;
  }
  const marks = new Map<number, string[]>();
  for (const m of found) {
    const here = marks.get(m.at);
    if (here) here.push(m.key);
    else marks.set(m.at, [m.key]);
  }
  return { text, keyed: k, startAt, endAt, marks };
}

function sentenceEndBetween(src: QuoteSource, from: number, to: number): boolean {
  // A marker token is read as the spaces it replaced: "water.² It" ends a sentence.
  src.sentenceEnds ??= sentenceEnds(src.text.replace(PRIVATE_MARK_CHARS, ' '));
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
  /**
   * The markers it keeps, in order, each before its token `at`. A piece of
   * markers alone, after a bracket, has no tokens and an empty key.
   */
  marks: Mark[];
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
function quoteParts(cleaned: string): { parts: Part[]; bracket: boolean } {
  const parts: Part[] = [];
  let bracket = false;
  for (const text of cleaned.split(ELLIPSIS)) {
    const part: Part = { pieces: [], brackets: [], words: 0 };
    // What the brackets since the last piece hold; one between two pieces is a gap.
    let held = '';
    const addPiece = (segment: string): void => {
      const { tokens, marks } = tokenize(segment);
      // Markers alone are kept only after a piece: before the first, they lie
      // in the author's lead-in, like a bracket there.
      if (tokens.length === 0 && (marks.length === 0 || part.pieces.length === 0)) return;
      const words = countWords(tokens);
      if (part.pieces.length > 0) part.brackets.push(held);
      held = '';
      part.pieces.push({ ...keyed(tokens), words, slips: Math.ceil(words / WORDS_PER_SPACING_SLIP), marks });
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
  return quoteParts(clean(quote, 'quote')).parts.reduce((n, p) => n + p.words, 0);
}

/** A quotation's pieces and the gaps between them, or why it cannot be checked. */
function planQuote(cleaned: string): Plan | string {
  const { parts, bracket } = quoteParts(cleaned);
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
        const { tokens } = tokenize(held);
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

// The words that make a "not" one half of "not only A but (also) B".
const NOT_ONLY = new Set(['only', 'just', 'merely', 'simply']);

/** Whether `tokens[t]` is the "not" of a "not only ... but" whose "but" lies before `first`. */
function notOnlyBut(tokens: readonly Token[], t: number, first: number): boolean {
  if (tokens[t]!.key !== 'not' || t + 1 >= first || !NOT_ONLY.has(tokens[t + 1]!.key)) return false;
  for (let u = t + 2; u < first; u += 1) if (tokens[u]!.key === 'but') return true;
  return false;
}

/**
 * The negation an ellipsis between two pieces would leave out wrongly, as a
 * token index, or -1 when it may stand for those words. A negation it leaves
 * out must be in a clause of its own, set off by punctuation from both quoted
 * parts: "The vaccine, which was not tested in children, proved safe" may lose
 * its middle clause, but "was ... safe" for "was not found to be safe"
 * reverses the source. A "not only" left out with its "but" negates nothing
 * the quotation keeps: "The intervention ... improved quality of life" for
 * "The intervention not only reduced pain but also improved quality of life".
 */
function elidedNegation(src: QuoteSource, prevLast: number, first: number): number {
  const tokens = src.keyed.tokens;
  for (let t = prevLast + 1; t < first; t += 1) {
    if (!isNegation(tokens, t, src.text) || notOnlyBut(tokens, t, first)) continue;
    const before = src.text.slice(tokens[prevLast]!.end, tokens[t]!.start);
    const after = src.text.slice(tokens[t]!.end, tokens[first]!.start);
    if (!CLAUSE_MARK.test(before) || !CLAUSE_MARK.test(after)) return t;
  }
  return -1;
}

/** How the negation `tokens[t]` reads in the source: "not", or "didn't" for the "t" of a contraction. */
function negationText(src: QuoteSource, t: number): string {
  const tokens = src.keyed.tokens;
  const tok = tokens[t]!;
  return src.text.slice(NEGATIONS.has(tok.key) ? tok.start : tokens[t - 1]!.start, tok.end);
}

/**
 * Whether each marker `piece` keeps stands at the same place in the source,
 * with the piece placed at key offset `h` and ending at source token `last`.
 * The source may have other markers there too: the quotation left them out.
 */
function marksFit(src: QuoteSource, piece: Piece, h: number, last: number): boolean {
  const marks = piece.marks;
  let i = 0;
  while (i < marks.length) {
    const at = marks[i]!.at;
    const b = at < piece.tokens.length ? src.startAt[h + piece.kStart[at]!]! : last + 1;
    const have = b < 0 ? undefined : src.marks.get(b);
    if (!have) return false;
    // The markers kept before one token must be among the source's there, in order.
    let k = 0;
    for (; i < marks.length && marks[i]!.at === at; i += 1) {
      while (k < have.length && have[k] !== marks[i]!.key) k += 1;
      if (k === have.length) return false;
      k += 1;
    }
  }
  return true;
}

/** Whether a plan matches, and the first negation an ellipsis was refused for leaving out. */
function matchPlan(src: QuoteSource, plan: Plan): { found: boolean; leftOut?: string } {
  const s = src.keyed;
  const n = s.tokens.length;
  let budget = MAX_CANDIDATES;
  let leftOut: string | undefined;
  const place = (i: number, prevLast: number): boolean => {
    if (i === plan.pieces.length) return true;
    const piece = plan.pieces[i]!;
    const gap = i > 0 ? plan.gaps[i - 1]! : null;
    if (piece.tokens.length === 0) {
      // Markers alone follow a bracket: they stand right after the source
      // words the bracket stands for.
      if (gap?.kind !== 'bracket') return false;
      for (let b = prevLast + 1; b <= Math.min(n, prevLast + 1 + MAX_BRACKET_WORDS); b += 1) {
        if (bracketFits(src, prevLast, b, gap) && marksFit(src, piece, 0, b - 1) && place(i + 1, b - 1)) return true;
      }
      return false;
    }
    let from = 0;
    let lastStart = s.key.length;
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
      if (gap?.kind === 'ellipsis') {
        // A later placement lies further on, past the same sentence end.
        if (!gap.passage && sentenceEndBetween(src, s.tokens[prevLast]!.end, s.tokens[first]!.start)) break;
        const negation = elidedNegation(src, prevLast, first);
        if (negation >= 0) {
          leftOut ??= negationText(src, negation);
          continue;
        }
      }
      if (!marksFit(src, piece, h, last)) continue;
      if (place(i + 1, last)) return true;
    }
    return false;
  };
  const found = place(0, -1);
  return found || leftOut === undefined ? { found } : { found, leftOut };
}

export interface QuoteMatch {
  found: boolean;
  /** Why, in a few words, for the verdict row. */
  reason: string;
}

/** At most this many superscripts of a quotation are each read both ways; beyond, all one way or all the other. */
const MAX_SUPERSCRIPT_READINGS = 4;

/**
 * The quotation cleaned each way its superscript markers may be read: as
 * markers first, then as the plain digits pdf.js extracts for a raised one.
 */
function quoteReadings(quote: string): string[] {
  const count = unbreak(quote).match(SUPERSCRIPT_MARKER)?.length ?? 0;
  const masks = count === 0 ? [0]
    : count <= MAX_SUPERSCRIPT_READINGS ? Array.from({ length: 2 ** count }, (_, m) => m)
    : [0, -1];
  return masks.map((m) => clean(quote, 'quote', m));
}

/** Whether `quote` appears in `source` (a prepared source, or its raw text). */
export function matchQuote(quote: string, source: QuoteSource | string): QuoteMatch {
  const plans = quoteReadings(quote).map((q) => planQuote(q));
  const plan = plans[0]!;
  if (typeof plan === 'string') return { found: false, reason: plan };
  const src = typeof source === 'string' ? prepareSource(source) : source;
  let leftOut: string | undefined;
  for (const p of plans) {
    if (typeof p === 'string') continue;
    const r = matchPlan(src, p);
    if (r.found) return { found: true, reason: 'found word for word' };
    leftOut ??= r.leftOut;
  }
  const rules: string[] = [];
  if (plan.ellipsis) {
    rules.push(
      `an ellipsis may leave out at most ${MAX_ELIDED_CHARS} characters of one sentence, or ${MAX_ELIDED_PASSAGE_CHARS} ` +
      `across sentences between parts of ${PASSAGE_PART_WORDS} or more words, and a negation only in a clause ` +
      'set off by punctuation',
    );
  }
  if (leftOut !== undefined) rules.push(`here the ellipsis would leave out "${leftOut}", in a clause it quotes`);
  if (plan.bracket) {
    rules.push(`a bracket may stand for at most ${MAX_BRACKET_WORDS} source words, never a number, and holds a negation only where they do`);
  }
  if (plan.pieces.some((p) => p.marks.length > 0)) {
    rules.push('a bracketed number or a superscript the quotation keeps must stand at the same place in the source');
  }
  return { found: false, reason: `not found word for word${rules.length > 0 ? ` (${rules.join('; ')})` : ''}` };
}
