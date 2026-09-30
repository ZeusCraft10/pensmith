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
//     ANY substring, of any length) scores >= QUOTE_LEV_THRESHOLD (0.95) → FUZZY;
//     else NOT_FOUND. A quote with elisions (`…`, `...`, `[…]`) is matched
//     segment by segment, in order.
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
  /** True when the normalized quote (every segment of an elided one) occurs verbatim. */
  readonly verbatim: boolean;
  /**
   * 1 − (edit distance / quote length) of the best match found, in [0, 1].
   * A quote that is not found reports the best match within the diagnostic
   * bound (0 when no passage comes close).
   */
  readonly ratio: number;
}

/** Cells (quote length × text length) the diagnostic ratio of an unmatched quote may cost. */
const DIAGNOSTIC_CELLS = 60_000_000;

/** An elision mark in a normalized quote: `...` (from `…` too), optionally in brackets. */
const ELISION_RE = /\s*\[?\s*\.\.\.\s*\]?\s*/g;

/** The quote's matchable core: leading and trailing punctuation dropped (a quote's own `.` or `,`). */
function core(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** One segment's best match at or after `from`: its distance (null when none within `maxDist`) and where it ends. */
function segmentMatch(seg: string, text: string, from: number, maxDist: number): { dist: number | null; end: number } {
  const at = text.indexOf(seg, from);
  if (at !== -1) return { dist: 0, end: at + seg.length };
  const rest = text.slice(from);
  const dist = substringDistance(seg, rest, maxDist);
  if (dist === null) return { dist: null, end: from };
  // Where the best match ends: the first end position at that distance.
  const end = firstEndAt(seg, rest, dist);
  return { dist, end: from + end };
}

/** The first end offset (exclusive) in `t` of a substring within `dist` of `p`. */
function firstEndAt(p: string, t: string, dist: number): number {
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
    if (lact === m) return j + 1;
    lact += 1;
  }
  return t.length;
}

/**
 * How well `quote` matches the source `text` (a prepared text is normalized
 * once for all of a source's quotes). Verbatim after normalization is the
 * PASS case; `ratio >= QUOTE_LEV_THRESHOLD` the FUZZY case; below it the
 * quote is NOT_FOUND. A quote with elisions matches when each of its
 * segments does, in order.
 */
export function matchQuote(quote: string, text: string | PreparedText): QuoteMatch {
  const hay = typeof text === 'string' ? normalizeForQuote(text) : text.normalized;
  const needle = normalizeForQuote(quote);
  const segments = needle
    .split(ELISION_RE)
    .map(core)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  if (segments.length === 0) return { verbatim: true, ratio: 1 };
  let from = 0;
  let total = 0;
  let distSum = 0;
  let verbatim = true;
  let found = true;
  for (const seg of segments) {
    total += seg.length;
    const maxDist = Math.floor(seg.length * (1 - QUOTE_LEV_THRESHOLD));
    const m = segmentMatch(seg, hay, from, maxDist);
    if (m.dist === null) {
      found = false;
      break;
    }
    if (m.dist > 0) verbatim = false;
    distSum += m.dist;
    from = m.end;
  }
  if (found) return { verbatim, ratio: total === 0 ? 1 : 1 - distSum / total };
  // Not found: the best whole-quote match within the diagnostic bound, for the row.
  const whole = segments.join(' ');
  if (whole.length * hay.length > DIAGNOSTIC_CELLS) return { verbatim: false, ratio: 0 };
  const d = substringDistance(whole, hay, Math.floor(whole.length * 0.5));
  return { verbatim: false, ratio: d === null ? 0 : Math.max(0, 1 - d / whole.length) };
}
