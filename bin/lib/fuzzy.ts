// bin/lib/fuzzy.ts — Hand-rolled Jaro-Winkler + Levenshtein primitives (D-11).
//
// This module is the SOLE source of truth for the Pass-1 / Pass-3 verifier
// fuzzy-match contract:
//
//   Pass 1 verdict (D-11 AND-gate):
//     jaroWinkler(actualTitle,  claimedTitle ) >= TITLE_JW_THRESHOLD  (0.92)
//   AND
//     jaroWinkler(actualAuthor, claimedAuthor) >= AUTHOR_JW_THRESHOLD (0.85)
//
//   BOTH must hold. DOI-resolves-200 is necessary but not sufficient (a
//   fabricated DOI may "resolve" to an unrelated paper; the AND-gate catches
//   that). First-author surname comparison runs through
//   bin/lib/author-normalize.ts before reaching jaroWinkler.
//
//   Pass 3 verdict (matchQuote, Phase 20 VRFY-19):
//     the normalized quote occurs verbatim in the normalized source text → PASS;
//     else its best match anywhere in the text (the smallest edit distance to
//     ANY substring, of any length) scores >= QUOTE_LEV_THRESHOLD (0.95) and
//     differs from it by no whole word (only slips inside words; a negator or
//     a number never differs) → FUZZY; else NOT_FOUND. A quote with elisions
//     (`…`, `...`, `[…]`) or editorial brackets is matched part by part, in
//     order, each part close to the one before (MAX_ELISION_GAP).
//
// Hand-rolled per RESEARCH.md "Standard Stack" — no npm dependency added.
// Algorithm is ~80 LOC for Jaro-Winkler + ~40 LOC for Levenshtein, fully
// testable, deterministic, no third-party version-skew risk. The only import
// is the local ./normalize.js (NFKC + diacritic strip + smart-quote/em-dash
// normalization), which is itself zero-dep.
//
// Threat model:
//   - T-3-DOS-01 (DoS via pathological Levenshtein input): the quote search
//     is Sellers' approximate substring match with Ukkonen's cut-off — O(k·n)
//     on the source text of n characters, k = ⌊|quote| × (1 − 0.95)⌋ — after
//     an O(n) verbatim check; a real paper (10⁵ characters) and a book (10⁶)
//     are searched in milliseconds. The best-match ratio reported for a quote
//     that is NOT found is bounded the same way (DIAGNOSTIC_CELLS).
//   - T-3-04 (accent-mark mismatch): nfkcNormalize is applied to BOTH inputs
//     of jaroWinkler and levenshteinSubstring BEFORE measurement; see Pitfall 5
//     in 03-RESEARCH.md.
//   - T-3-11 (threshold drift via copy-paste): TITLE_JW_THRESHOLD,
//     AUTHOR_JW_THRESHOLD, QUOTE_LEV_THRESHOLD are exported from THIS file as
//     named constants. Callers MUST import (not duplicate) — D-11's 0.92/0.85
//     AND-gate has exactly one source of truth.
//
// Aliases:
//   `normalizeForFuzzy` is exported as the NFKC + lowercase pre-step used
//   internally by jaroWinkler/levenshteinSubstring; tests/fuzzy.test.ts uses
//   it directly to apply consistent pre-normalization before calling JW on
//   title/author golden cases.

import { nfkcNormalize } from './normalize.js';

/**
 * Pass-1 title fuzzy-match threshold (D-11).
 * jaroWinkler(actualTitle, claimedTitle) MUST be >= this value to PASS.
 */
export const TITLE_JW_THRESHOLD = 0.92;

/**
 * Pass-1 author fuzzy-match threshold (D-11).
 * jaroWinkler(actualAuthor, claimedAuthor) MUST be >= this value to PASS.
 * First-author surname comparison only (D-11); see bin/lib/author-normalize.ts.
 */
export const AUTHOR_JW_THRESHOLD = 0.85;

/**
 * Pass-3 quote integrity threshold (D-11).
 * levenshteinSubstring(claimedQuote, extractedPdfText) MUST be >= this value
 * to PASS. Anything below = NOT_FOUND verdict (which blocks compile/export).
 */
export const QUOTE_LEV_THRESHOLD = 0.95;

/**
 * Pre-normalize a string for fuzzy comparison.
 *
 * NFKC + diacritic strip + smart-quote/em-dash normalization (delegated to
 * nfkcNormalize) + lowercase. This is the canonical pre-step for both
 * jaroWinkler and levenshteinSubstring — exported so callers can apply it
 * consistently across batched comparisons (e.g. running JW over 100 candidate
 * authors without re-normalizing the claimed-author string).
 *
 * @example
 * normalizeForFuzzy("Attention Is All You Need") // → "attention is all you need"
 * normalizeForFuzzy("Müller")                    // → "muller"
 */
export function normalizeForFuzzy(s: string): string {
  return nfkcNormalize(s).toLowerCase();
}

/**
 * Classic Jaro distance — matches + transpositions, no Winkler boost.
 * Returns 0 if either input is empty (except both-empty → 1, handled by
 * the caller `jaroWinkler`).
 *
 * Algorithm (per Jaro 1989, Winkler 1990):
 *   1. Matching window = floor(max(|A|, |B|) / 2) - 1, clamped at 0.
 *   2. Count m = matching chars within that window (one-pass left-to-right,
 *      consume each B position at most once).
 *   3. Count t = transpositions (half the number of out-of-order matches).
 *   4. Jaro = (m/|A| + m/|B| + (m - t) / m) / 3.
 *   5. If m === 0, Jaro = 0.
 *
 * Symmetric by construction: the matching window is max-of-lengths so the
 * window radius is identical when A and B are swapped; the match-and-mark
 * loop also produces the same `m` and `t` regardless of argument order
 * (within floating-point tolerance — see fuzzy.property.test.ts tolerance band).
 */
function jaro(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 && bLen === 0) return 1;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(bLen - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions: walk through aMatches in order, comparing to the
  // k-th matched char in b. Each mismatch contributes one half-transposition.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (
    matches / aLen +
    matches / bLen +
    (matches - transpositions) / matches
  ) / 3;
}

/**
 * Jaro-Winkler similarity in [0, 1] with prefix boost (D-11).
 *
 * Pre-normalizes both inputs via {@link normalizeForFuzzy} (NFKC + diacritic
 * strip + lowercase) so that "Müller" and "Mueller" no longer score below
 * the 0.85 author threshold (Pitfall 5 in 03-RESEARCH.md).
 *
 * Symmetry guarantee: implemented via a `< 1e-10` tolerance band in
 * tests/fuzzy.property.test.ts (Math.abs(JW(a,b) - JW(b,a)) < 1e-10),
 * NOT strict-equality, because IEEE-754 division ordering in the Jaro
 * formula can introduce sub-ulp drift. The algorithm IS mathematically
 * symmetric; only the floating-point representation is tolerance-bounded.
 *
 * @example
 * jaroWinkler("hello", "hello") // → 1
 * jaroWinkler("", "")           // → 1
 * jaroWinkler("", "x")          // → 0
 * jaroWinkler("Attention Is All You Need", "attention is all you need") // > 0.95
 */
export function jaroWinkler(a: string, b: string): number {
  // Strict-equality short-circuit on the RAW inputs. This guarantees the
  // fast-check property `jaroWinkler(a, a) === 1` for ALL non-empty strings,
  // including ones whose pre-normalized form is empty (e.g., soft-hyphen-only
  // input). Without this guard, the property would fail when normalizeForFuzzy
  // collapses the input to "" and jaro("","") returns 1 — which happens to be
  // correct here, but we want defense-in-depth.
  if (a === b) return 1;

  const A = normalizeForFuzzy(a);
  const B = normalizeForFuzzy(b);

  if (A === B) return 1;
  if (A.length === 0 || B.length === 0) return 0;

  const jaroScore = jaro(A, B);
  if (jaroScore === 0) return 0;

  // Winkler boost: scan common prefix up to length 4, +0.1 per matching char.
  let prefix = 0;
  const maxPrefix = Math.min(4, A.length, B.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (A[i] === B[i]) prefix++;
    else break;
  }

  const jw = jaroScore + prefix * 0.1 * (1 - jaroScore);

  // Clamp to [0, 1]; the formula above can theoretically drift above 1 by
  // sub-ulp amounts when jaroScore is very close to 1 and prefix > 0.
  if (jw > 1) return 1;
  if (jw < 0) return 0;
  return jw;
}

/**
 * Classical Levenshtein edit distance — integer count of insertions,
 * deletions, and substitutions needed to transform `a` into `b`.
 *
 * Implementation: 2-row dynamic programming, O(|a|·|b|) time, O(min(|a|,|b|))
 * space. Returns the bare integer distance (NOT a normalized ratio); callers
 * that want a ratio use {@link levenshteinSubstring}.
 *
 * Properties (exercised by tests/fuzzy.property.test.ts):
 *   - levenshtein(a, a) === 0 for all a
 *   - Symmetric: levenshtein(a, b) === levenshtein(b, a)
 *   - Triangle inequality: levenshtein(a, c) <= levenshtein(a, b) + levenshtein(b, c)
 *
 * Note: this is NOT pre-normalized. It operates on raw character codes so
 * the property tests work over arbitrary fc.string inputs (including
 * non-printable chars, surrogates, etc.). Callers that want NFKC-normalized
 * distance must call nfkcNormalize themselves first.
 *
 * @example
 * levenshtein("hello", "hello")     // → 0
 * levenshtein("kitten", "sitting")  // → 3
 * levenshtein("", "abc")            // → 3
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure b is the shorter string for O(min) space.
  let s1 = a;
  let s2 = b;
  if (s1.length < s2.length) {
    const tmp = s1;
    s1 = s2;
    s2 = tmp;
  }

  const m = s1.length;
  const n = s2.length;
  // Uint32Array gives O(1) zero-fill + dense layout; max edit distance is
  // bounded by max(|a|, |b|), well within 2^32. Non-null assertions on
  // indexed access are safe here: every access j is in [0, n] and we
  // allocated n + 1 slots; TypeScript's noUncheckedIndexedAccess can't
  // see this invariant statically.
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const s1c = s1[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = s1c === s2[j - 1] ? 0 : 1;
      // min(deletion, insertion, substitution)
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      const sub = prev[j - 1]! + cost;
      let best = del < ins ? del : ins;
      if (sub < best) best = sub;
      curr[j] = best;
    }
    // Swap rows.
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n]!;
}

// ---------------------------------------------------------------------------
// Approximate substring search (Pass 3).
// ---------------------------------------------------------------------------

/**
 * The smallest edit distance between `p` and any substring of `t` (Sellers'
 * semi-global alignment: the match may start and end anywhere in `t`), when it
 * is at most `maxDist`; else null. Ukkonen's cut-off keeps only the rows that
 * can still end at or under `maxDist` active, so a search costs O(maxDist·|t|)
 * on text. Stops early at an exact occurrence.
 */
export function substringDistance(p: string, t: string, maxDist: number): number | null {
  const m = p.length;
  if (m === 0) return 0;
  const k = Math.max(0, Math.floor(maxDist));
  if (k >= m) return bestAlignmentFull(p, t);
  // C[i]: the edit distance of p[0..i) against the best substring of t ending
  // at the current position; C[0] is always 0 (the match may start anywhere).
  const C = new Uint32Array(m + 1);
  for (let i = 0; i <= m; i += 1) C[i] = i;
  let lact = Math.min(k + 1, m); // the last row that can still be <= k
  let best: number | null = null;
  for (let j = 0; j < t.length; j += 1) {
    const tc = t.charCodeAt(j);
    let pC = 0; // C[i-1] of the previous column
    let nC = 0; // C[i-1] of this column
    for (let i = 1; i <= lact; i += 1) {
      const old = C[i]!;
      if (p.charCodeAt(i - 1) === tc) {
        nC = pC;
      } else {
        if (pC < nC) nC = pC;
        if (old < nC) nC = old;
        nC += 1;
      }
      pC = old;
      C[i] = nC;
    }
    while (lact > 0 && C[lact]! > k) lact -= 1;
    if (lact === m) {
      const d = C[m]!;
      if (best === null || d < best) best = d;
      if (best === 0) return 0;
    } else {
      lact += 1;
    }
  }
  return best;
}

/** The smallest edit distance between `p` and any substring of `t`, with no cut-off (O(|p|·|t|)). */
function bestAlignmentFull(p: string, t: string): number {
  const m = p.length;
  let prev = new Uint32Array(m + 1);
  let curr = new Uint32Array(m + 1);
  for (let i = 0; i <= m; i += 1) prev[i] = i;
  let best = prev[m]!;
  for (let j = 0; j < t.length; j += 1) {
    const tc = t.charCodeAt(j);
    curr[0] = 0;
    for (let i = 1; i <= m; i += 1) {
      const cost = p.charCodeAt(i - 1) === tc ? 0 : 1;
      const sub = prev[i - 1]! + cost;
      const del = prev[i]! + 1;
      const ins = curr[i - 1]! + 1;
      curr[i] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    if (curr[m]! < best) best = curr[m]!;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return best;
}

/**
 * Best-match ratio of `needle` as a substring of `haystack`, in [0, 1]:
 * `1 − d / |needle|`, where d is the smallest edit distance between the
 * needle and ANY substring of the haystack (both pre-normalized via
 * {@link normalizeForFuzzy}: NFKC, diacritics, smart quotes, dashes,
 * lowercase). An exact occurrence is 1; an empty needle is 1 (vacuous match,
 * as jaroWinkler).
 *
 * @example
 * levenshteinSubstring("attention is all you need", "we propose attention is all you need as a baseline") // 1
 * levenshteinSubstring("hello", "world") // 0.2
 */
export function levenshteinSubstring(needle: string, haystack: string): number {
  if (needle === haystack) return 1;
  const N = normalizeForFuzzy(needle);
  const H = normalizeForFuzzy(haystack);
  if (N.length === 0 || H.includes(N)) return 1;
  return 1 - bestAlignmentFull(N, H) / N.length;
}

// ---------------------------------------------------------------------------
// Quote matching (Pass 3, VRFY-19).
// ---------------------------------------------------------------------------

/**
 * A source text or a quote as Pass 3 compares them: normalizeForFuzzy (NFKC
 * — ligatures —, soft hyphens removed, smart quotes straightened, dashes to
 * `-`, `…` to `...`, diacritics stripped, whitespace collapsed, lowercase),
 * spaced dots `. . .` read as `...`, and a word a PDF broke across a line
 * (`trans- former`) joined.
 */
export function normalizeForQuote(s: string): string {
  return normalizeForFuzzy(s)
    .replace(/\.(?:\s*\.){2}/g, '...')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2');
}

/** A source text normalized once for many quotes. */
export interface PreparedText {
  readonly normalized: string;
}

export function prepareQuoteText(text: string): PreparedText {
  return { normalized: normalizeForQuote(text) };
}

export interface QuoteMatch {
  /** True when the normalized quote (every segment of an elided one) occurs verbatim, its parts close together. */
  readonly verbatim: boolean;
  /**
   * 1 − (edit distance / quote length) of the best match found, in [0, 1].
   * A quote that is not found reports the best match within the diagnostic
   * bound (0 when no passage comes close).
   */
  readonly ratio: number;
  /**
   * Why the closest passage is still not the quote although it scores at or
   * above QUOTE_LEV_THRESHOLD — whole words differ (an inserted "not", a
   * changed number or name), or an elided quote's parts lie too far apart in
   * the source. Absent when the match stands.
   */
  readonly refused?: string;
}

/** True when a match is a found quote: verbatim, or close enough with no whole-word change (the FUZZY case). */
export function quoteMatched(m: QuoteMatch): boolean {
  return m.verbatim || (m.ratio >= QUOTE_LEV_THRESHOLD && m.refused === undefined);
}

/** Cells (quote length × text length) the diagnostic ratio of an unmatched quote may cost. */
const DIAGNOSTIC_CELLS = 60_000_000;

/**
 * Where a quote is split into parts matched one after another: an elision
 * mark (`...` — from `…` too — optionally in brackets) or an editorial
 * insertion in square brackets (`[the model]`, `[sic]`).
 */
const SEGMENT_BREAK_RE = /\s*\[?\s*\.\.\.\s*\]?\s*|\s*\[[^\]]{1,60}\]\s*/g;

/** The most normalized characters between two consecutive parts of an elided quote (about a paragraph). */
export const MAX_ELISION_GAP = 600;
/** The most characters between a one-word part and its neighbours. */
const ONE_WORD_GAP = 100;
/** How many exact places the first part of an elided quote is tried at. */
const MAX_ANCHORS = 400;
/** How many approximate places (each a scan of the rest of the text): the best one for a quote in one part, a few for an elided one. */
const MAX_APPROX_ANCHORS_ONE_PART = 1;
const MAX_APPROX_ANCHORS = 8;

/**
 * A quote's parts and what stands between them: `breaks[k]` is the text of
 * the quote between part k-1 and part k (breaks[0] before the first part,
 * breaks[parts.length] after the last) — elision marks, editorial brackets,
 * and punctuation.
 */
function splitQuote(needle: string): { segments: string[]; breaks: string[] } {
  const raw: Array<{ start: number; end: number }> = [];
  let at = 0;
  for (const m of needle.matchAll(SEGMENT_BREAK_RE)) {
    raw.push({ start: at, end: m.index });
    at = m.index + m[0].length;
  }
  raw.push({ start: at, end: needle.length });
  const segments: string[] = [];
  const breaks: string[] = [];
  let prevEnd = 0;
  for (const r of raw) {
    const seg = core(needle.slice(r.start, r.end));
    if (!/[\p{L}\p{N}]/u.test(seg)) continue;
    // Where the core sits inside the raw part (its trimmed punctuation belongs to the break).
    const offset = needle.indexOf(seg, r.start);
    breaks.push(needle.slice(prevEnd, offset));
    segments.push(seg);
    prevEnd = offset + seg.length;
  }
  breaks.push(needle.slice(prevEnd));
  return { segments, breaks };
}

/** True for a word that negates (NEGATORS, or a `n't` form). */
function isNegator(w: string): boolean {
  return NEGATORS.has(w) || /n['’]t$/u.test(w);
}

/** The editorial insertions of a break: the text of each `[…]` that is not an elision mark. */
function bracketTexts(brk: string): string[] {
  return [...brk.matchAll(/\[([^\]]{1,60})\]/g)].map((m) => m[1] as string).filter((t) => !/^\s*\.\.\.\s*$/.test(t));
}

/**
 * The part of a skipped source span that belongs to the sentences the quote's
 * parts are in: up to its first sentence end and from its last one (a whole
 * sentence elided in between reports nothing about the parts).
 */
function adjoiningFragments(span: string): string {
  const ends = [...span.matchAll(/[.!?]["')\]]*\s/g)];
  if (ends.length === 0) return span;
  const first = ends[0]!;
  const last = ends[ends.length - 1]!;
  return `${span.slice(0, first.index + first[0].length)} ${span.slice(last.index + last[0].length)}`;
}

/**
 * Why an elided or bracketed quote says something its source does not
 * (review round 3), or null: an editorial bracket that adds a negation ("the
 * trial [did not] show") or a number absent from the source text it stands
 * in for, a bracket that stands in for a negation it drops, and an elision
 * that skips a negation of the sentence ("the trial ... show" over "the trial
 * do not show"). A leading or trailing bracket is compared with the source
 * right before the first part or after the last.
 */
function elisionChange(hay: string, parts: readonly PartMatch[], breaks: readonly string[]): string | null {
  const numbers = (s: string): string[] => tokensOf(s).filter((w) => /\p{N}/u.test(w));
  const negations = (s: string): string[] => tokensOf(s).filter(isNegator);
  for (let k = 0; k <= parts.length; k += 1) {
    const brk = breaks[k] ?? '';
    const inserted = bracketTexts(brk);
    const edge = k === 0 || k === parts.length;
    if (edge && inserted.length === 0) continue; // a leading or trailing elision cuts nothing out of the quote
    const span =
      k === 0
        ? hay.slice(Math.max(0, parts[0]!.start - 80), parts[0]!.start)
        : k === parts.length
          ? hay.slice(parts[k - 1]!.end, parts[k - 1]!.end + 80)
          : hay.slice(parts[k - 1]!.end, parts[k]!.start);
    const near = edge ? (k === 0 ? (span.split(/[.!?]\s/).pop() ?? span) : (span.split(/[.!?]\s/)[0] ?? span)) : adjoiningFragments(span);
    const bracketNeg = inserted.flatMap(negations);
    const sourceNeg = negations(near);
    if (bracketNeg.length > 0 && sourceNeg.length === 0) {
      return `the editorial bracket "[${inserted.join('] [')}]" adds "${bracketNeg[0]}", which the source does not say there`;
    }
    if (!edge && sourceNeg.length > 0 && bracketNeg.length === 0) {
      return inserted.length > 0
        ? `the editorial bracket "[${inserted.join('] [')}]" stands in for "${sourceNeg[0]}" in the source`
        : `its elision drops "${sourceNeg[0]}" from the source`;
    }
    const sourceNums = new Set(numbers(span));
    const addedNum = inserted.flatMap(numbers).find((n) => !sourceNums.has(n));
    if (addedNum !== undefined) return `the editorial bracket "[${inserted.join('] [')}]" adds the number ${addedNum}, which the source does not have there`;
  }
  return null;
}

/** The quote's matchable core: leading and trailing punctuation dropped (a quote's own `.` or `,`). */
function core(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const wordCount = (s: string): number => s.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The first end offset (exclusive) in `t` of a substring within `dist` of `p`, at or after `fromEnd`. */
function firstEndAt(p: string, t: string, dist: number, fromEnd = 0): number {
  const m = p.length;
  const C = new Uint32Array(m + 1);
  for (let i = 0; i <= m; i += 1) C[i] = i;
  let lact = Math.min(dist + 1, m);
  for (let j = 0; j < t.length; j += 1) {
    const tc = t.charCodeAt(j);
    let pC = 0;
    let nC = 0;
    for (let i = 1; i <= lact; i += 1) {
      const old = C[i]!;
      if (p.charCodeAt(i - 1) === tc) nC = pC;
      else {
        if (pC < nC) nC = pC;
        if (old < nC) nC = old;
        nC += 1;
      }
      pC = old;
      C[i] = nC;
    }
    while (lact > 0 && C[lact]! > dist) lact -= 1;
    if (lact === m) {
      if (j + 1 >= fromEnd) return j + 1;
    } else lact += 1;
  }
  return t.length;
}

/** The start of the substring of `t` ending at `end` whose edit distance to `p` is `dist` (the latest such start). */
function startFor(p: string, t: string, end: number, dist: number): number {
  const lo = Math.max(0, end - p.length - dist);
  const window = t.slice(lo, end);
  // Align reversed: the first end in the reversed window is the latest start.
  const rp = [...p].reverse().join('');
  const rw = [...window].reverse().join('');
  return end - firstEndAt(rp, rw, dist);
}

// ---- Whole-word check (VRFY-19): FUZZY absorbs character slips, never a changed word.

/** Words whose change inverts or voids a claim; they must match exactly. */
const NEGATORS: ReadonlySet<string> = new Set([
  'not', 'no', 'never', 'none', 'nor', 'neither', 'nothing', 'nobody', 'nowhere', 'cannot', 'without', 'hardly', 'barely', 'scarcely',
]);

function tokensOf(s: string): string[] {
  return s
    .split(/\s+/u)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length > 0);
}

/** True when two words differ only by a slip a copy or a PDF introduces (a letter or two), never in meaning-bearing ways. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\p{N}/u.test(a) || /\p{N}/u.test(b)) return false; // numbers, years, versions: exactly
  const neg = (w: string): boolean => NEGATORS.has(w) || /n['’]t$/u.test(w);
  if (neg(a) || neg(b)) return false;
  if (a[0] !== b[0]) return false; // increase / decrease, ever / never
  const d = levenshtein(a, b);
  const L = Math.max(a.length, b.length);
  return d <= (L >= 8 ? 2 : 1) && d / L <= 0.25;
}

/**
 * The first word pair that keeps `seg` from being a copy of `src` word for
 * word (each quote word one source word, or one word split in two / two
 * joined, the first and last words of `src` possibly cut by the match), or
 * null when the words line up.
 */
function wordMismatch(seg: string, src: string): string | null {
  const q = tokensOf(seg);
  const s = tokensOf(src);
  const n = q.length;
  const m = s.length;
  if (n === 0) return null;
  // reach[i][j]: q[0..i) aligned with s[0..j).
  const reach: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(m + 1).fill(false));
  reach[0]![0] = true;
  const edge = (qi: number, sj: number, w: string, x: string): boolean =>
    sameWord(w, x) || (qi === 0 && sj === 0 && x.endsWith(w)) || (qi === n - 1 && sj === m - 1 && x.startsWith(w)) || (n === 1 && m === 1 && x.includes(w));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!reach[i]![j]) continue;
      if (edge(i, j, q[i]!, s[j]!)) reach[i + 1]![j + 1] = true;
      if (j + 1 < m && sameWord(q[i]!, s[j]! + s[j + 1]!)) reach[i + 1]![j + 2] = true;
      if (i + 1 < n && sameWord(q[i]! + q[i + 1]!, s[j]!)) reach[i + 2]![j + 1] = true;
    }
  }
  if (reach[n]![m]) return null;
  return firstWordEdit(q, s);
}

/** The first whole-word edit between the quote's words and the source's (a word-level edit script), for the row. */
function firstWordEdit(q: readonly string[], s: readonly string[]): string {
  const n = q.length;
  const m = s.length;
  const D: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      D[i]![j] = Math.min(D[i - 1]![j]! + 1, D[i]![j - 1]! + 1, D[i - 1]![j - 1]! + (sameWord(q[i - 1]!, s[j - 1]!) ? 0 : 1));
    }
  }
  // Walk the script from the end; keep the earliest edit.
  let i = n;
  let j = m;
  let first = 'its words do not line up with the source';
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sameWord(q[i - 1]!, s[j - 1]!) && D[i]![j] === D[i - 1]![j - 1]) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && D[i]![j] === D[i - 1]![j - 1]! + 1) {
      first = `"${q[i - 1]}" where the source has "${s[j - 1]}"`;
      i -= 1;
      j -= 1;
    } else if (i > 0 && D[i]![j] === D[i - 1]![j]! + 1) {
      first = `"${q[i - 1]}" is not in the source`;
      i -= 1;
    } else {
      first = `the source has "${s[j - 1]}" there`;
      j -= 1;
    }
  }
  return first;
}

/** One part's best match in `text[from, to)`: its distance, where it starts and ends, and a word mismatch (null when the words line up). */
interface PartMatch {
  readonly dist: number;
  readonly start: number;
  readonly end: number;
  readonly mismatch: string | null;
}

function partMatch(seg: string, text: string, from: number, to: number): PartMatch | null {
  const at = text.indexOf(seg, from);
  if (at !== -1 && at + seg.length <= to) return { dist: 0, start: at, end: at + seg.length, mismatch: null };
  const maxDist = Math.floor(seg.length * (1 - QUOTE_LEV_THRESHOLD));
  const window = text.slice(from, to);
  const dist = substringDistance(seg, window, maxDist);
  if (dist === null) return null;
  const end = firstEndAt(seg, window, dist);
  const start = startFor(seg, window, end, dist);
  // The matched passage out to whole words, for the word check.
  let ws = start;
  while (ws > 0 && /[\p{L}\p{N}]/u.test(window[ws - 1] ?? '')) ws -= 1;
  let we = end;
  while (we < window.length && /[\p{L}\p{N}]/u.test(window[we] ?? '')) we += 1;
  const cut = window.slice(ws, we);
  return { dist, start: from + start, end: from + end, mismatch: dist === 0 ? null : wordMismatch(seg, cut) };
}

/** Every place the first part matches (exact occurrences, else the best approximate ones, at most `approx`). */
function anchors(seg: string, text: string, approx: number): PartMatch[] {
  const out: PartMatch[] = [];
  for (let at = text.indexOf(seg); at !== -1 && out.length < MAX_ANCHORS; at = text.indexOf(seg, at + 1)) {
    out.push({ dist: 0, start: at, end: at + seg.length, mismatch: null });
  }
  if (out.length > 0) return out;
  let from = 0;
  while (out.length < approx) {
    const m = partMatch(seg, text, from, text.length);
    if (m === null) break;
    out.push(m);
    from = m.end;
  }
  return out;
}

/**
 * How well `quote` matches the source `text` (a prepared text is normalized
 * once for all of a source's quotes). Verbatim after normalization is the
 * PASS case; `ratio >= QUOTE_LEV_THRESHOLD` with no `refused` reason the FUZZY
 * case (quoteMatched); anything else is NOT_FOUND. A close match is refused
 * when a whole word differs — FUZZY absorbs the slips a copy or a PDF
 * introduces (a letter or two in a word), never an inserted "not", a changed
 * number or a different word. A quote with elisions or editorial brackets
 * matches when each part does, in order, each within MAX_ELISION_GAP
 * characters of the one before (a one-word part within ONE_WORD_GAP of its
 * neighbours), and one part has at least three words: fragments stitched
 * from far apart in the source are not a quotation. Nor may a bracket or an
 * elision change what the source says: a bracket that adds a negation or a
 * number, or stands in for a negation, and an elision that skips a negation
 * of the parts' sentences are refused, naming it (review round 3).
 */
export function matchQuote(quote: string, text: string | PreparedText): QuoteMatch {
  const hay = typeof text === 'string' ? normalizeForQuote(text) : text.normalized;
  const needle = normalizeForQuote(quote);
  const { segments, breaks } = splitQuote(needle);
  if (segments.length === 0) return { verbatim: true, ratio: 1 };
  const total = segments.reduce((n, s) => n + s.length, 0);
  let refused: string | undefined;
  let bestRatio = -1;

  if (segments.length > 1 && Math.max(...segments.map(wordCount)) < 3) {
    refused = 'its elided parts are each a word or two — fragments, not a quotation';
  } else {
    // Try each place the first part occurs; the rest must follow within the gap.
    for (const first of anchors(segments[0]!, hay, segments.length === 1 ? MAX_APPROX_ANCHORS_ONE_PART : MAX_APPROX_ANCHORS)) {
      const parts: PartMatch[] = [first];
      let failure: string | null = null;
      for (let k = 1; k < segments.length; k += 1) {
        const prev = parts[k - 1]!;
        const oneWord = wordCount(segments[k]!) < 2 || wordCount(segments[k - 1]!) < 2;
        const gap = oneWord ? ONE_WORD_GAP : MAX_ELISION_GAP;
        const m = partMatch(segments[k]!, hay, prev.end, Math.min(hay.length, prev.end + gap + segments[k]!.length + Math.floor(segments[k]!.length * (1 - QUOTE_LEV_THRESHOLD))));
        if (m === null || m.start - prev.end > gap) {
          failure = `its elided parts are not within ${gap} characters of each other in the source`;
          break;
        }
        parts.push(m);
      }
      if (failure !== null) {
        refused ??= failure;
        continue;
      }
      const dist = parts.reduce((d, p) => d + p.dist, 0);
      const ratio = total === 0 ? 1 : 1 - dist / total;
      // An editorial bracket or an elision must not change what the source
      // says (review round 3): no negation or number added, none dropped.
      const changed = elisionChange(hay, parts, breaks);
      if (changed !== null) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          refused = changed;
        }
        continue;
      }
      const mismatch = parts.find((p) => p.mismatch !== null)?.mismatch ?? null;
      if (mismatch === null && dist === 0) return { verbatim: true, ratio: 1 };
      if (mismatch === null) return { verbatim: false, ratio };
      if (ratio > bestRatio) {
        bestRatio = ratio;
        refused = `the closest passage differs by a whole word: ${mismatch}`;
      }
    }
  }
  if (bestRatio >= 0) return { verbatim: false, ratio: bestRatio, ...(refused !== undefined ? { refused } : {}) };
  // Not found: the best whole-quote match within the diagnostic bound, for the row.
  const whole = segments.join(' ');
  let ratio = 0;
  if (whole.length * hay.length <= DIAGNOSTIC_CELLS) {
    const d = substringDistance(whole, hay, Math.floor(whole.length * 0.5));
    ratio = d === null ? 0 : Math.max(0, 1 - d / whole.length);
  }
  return { verbatim: false, ratio, ...(refused !== undefined ? { refused } : {}) };
}
