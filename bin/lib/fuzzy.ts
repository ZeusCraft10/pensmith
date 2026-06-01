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
//   Pass 3 verdict:
//     levenshteinSubstring(claimedQuote, extractedPdfText) >= QUOTE_LEV_THRESHOLD (0.95)
//
// Hand-rolled per RESEARCH.md "Standard Stack" — no npm dependency added.
// Algorithm is ~80 LOC for Jaro-Winkler + ~40 LOC for Levenshtein, fully
// testable, deterministic, no third-party version-skew risk. The only import
// is the local ./normalize.js (NFKC + diacritic strip + smart-quote/em-dash
// normalization), which is itself zero-dep.
//
// Threat model:
//   - T-3-DOS-01 (DoS via pathological Levenshtein input): classical 2-row DP
//     is O(|a|·|b|); for QUOTE_LEV_THRESHOLD=0.95 on quotes <= 500 chars and
//     PDF haystack <= 100KB, sliding-window cost is bounded by
//     |needle| * |haystack| chars * |needle| ops ≈ 500 * 100000 * 500 = 25M
//     operations worst case. Property test (numRuns: 100, maxLength: 50)
//     completes in <5s on commodity hardware. Ukkonen banding (O(|a|·k) where
//     k = ⌈|needle| * (1 - QUOTE_LEV_THRESHOLD)⌉) is documented as a future
//     optimization if profiling shows regression — not required for Plan 03-01.
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

/**
 * Best-match ratio of `needle` as a substring of `haystack`, in [0, 1].
 *
 * Slides a window of `needle.length` chars across `haystack`, computes
 * Levenshtein distance to `needle` at each window position, and returns
 * `1 - (minDist / needle.length)`.
 *
 * Pre-normalizes both inputs via {@link normalizeForFuzzy} (NFKC + diacritic
 * strip + lowercase) BEFORE the sliding-window scan, so that PDF distortion
 * artifacts (soft hyphens, ligatures, smart quotes) don't fool the matcher.
 *
 * Used by Pass-3 quote integrity: a quote that scores >= QUOTE_LEV_THRESHOLD
 * (0.95) anywhere in the source PDF passes; below = NOT_FOUND.
 *
 * Edge cases:
 *   - needle === haystack → 1 (perfect match).
 *   - needle === "" → 1 (vacuous match; same convention as jaroWinkler).
 *   - needle.length > haystack.length → 0 (can't fit).
 *
 * @example
 * levenshteinSubstring("attention is all you need", "we propose attention is all you need as a baseline") // > 0.99
 * levenshteinSubstring("hello", "world") // ≈ 0.2
 */
export function levenshteinSubstring(needle: string, haystack: string): number {
  // Strict-equality short-circuit on raw inputs.
  if (needle === haystack) return 1;

  const N = normalizeForFuzzy(needle);
  const H = normalizeForFuzzy(haystack);

  if (N === H) return 1;
  if (N.length === 0) return 1; // vacuous match per plan task 1.2 behavior contract
  if (N.length > H.length) return 0;

  const nLen = N.length;
  let minDist = nLen;

  // Sliding window: at each start position s in [0, H.length - nLen],
  // compute levenshtein(H.substring(s, s + nLen), N) and track the min.
  // Early-exit if we hit 0 (exact substring match).
  for (let s = 0; s <= H.length - nLen; s++) {
    const window = H.substring(s, s + nLen);
    const d = levenshtein(window, N);
    if (d < minDist) minDist = d;
    if (minDist === 0) break;
  }

  return 1 - minDist / nLen;
}
