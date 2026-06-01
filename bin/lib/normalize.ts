// bin/lib/normalize.ts — Deterministic Unicode normalization for Pass-3 quote integrity.
//
// Spec (D-11, VRFY-04 — Phase 3):
//
//   nfkcNormalize(s) ──→ string
//     Used by:
//       - bin/lib/fuzzy.ts::jaroWinkler   (D-11 Pass-1 AND-gate pre-normalize)
//       - bin/lib/fuzzy.ts::levenshteinSubstring (Pass-3 quote integrity)
//       - bin/lib/author-normalize.ts     (Pass-1 first-author surname normalize)
//
//     Steps (applied in strict order; each is idempotent on its own output):
//       1. String.prototype.normalize('NFKC')        — collapses compatibility
//                                                      forms (ligatures ﬁ→fi,
//                                                      full-width digits, etc.)
//       2. Strip U+00AD SOFT HYPHEN                  — PDF tools insert these
//                                                      as line-break hints; they
//                                                      must not survive into
//                                                      quote-match strings.
//       3. Curly quotes → straight                   — U+2018/U+2019 → '
//                                                      U+201C/U+201D → "
//       4. En/em-dash → hyphen                       — U+2013/U+2014 → -
//       5. Horizontal ellipsis U+2026 → '...'        — PDF typography artifact.
//       6. NFD + strip U+0300..U+036F (combining
//          diacritical marks) + back to NFC          — "naïve" → "naive",
//                                                      "Müller" → "Muller" so
//                                                      that JW vs "Mueller"
//                                                      scores ≥ 0.85 (Pitfall 5).
//       7. Collapse whitespace runs to single space  — Pitfall 7: PDF kerning
//                                                      sometimes emits double
//                                                      spaces inside quotes.
//       8. Trim leading/trailing whitespace.
//
//   Idempotency: nfkcNormalize(nfkcNormalize(x)) === nfkcNormalize(x) for all x.
//   The fast-check property test in tests/fuzzy.property.test.ts implicitly
//   exercises this via JW pre-normalize chaining; tests/normalize.test.ts
//   exercises the five distortion fixtures directly.
//
// Threat model (T-3-04 accent-mark mismatch, T-3-DOS-01 ReDoS):
//   - All regexes are LINEAR (no nested quantifiers, no catastrophic
//     backtracking). The character-class strips are O(n) in input length.
//   - Pure function: no IO, no global state, no async, no third-party imports.
//     Hand-rolled per RESEARCH.md "Standard Stack" — zero npm dependency cost.
//
// Aliases:
//   `normalizeText` is exported as an alias to satisfy tests/normalize.test.ts
//   (Wave 0 scaffold) which imports under the historical name. Downstream
//   modules SHOULD import `nfkcNormalize` (the canonical name in the plan).

/**
 * NFKC-normalize a string and strip PDF/typography distortion artifacts.
 *
 * Used at every trust boundary where untrusted text (PDF extract, BibTeX
 * author field, Crossref title) must be compared against another string.
 *
 * @example
 * nfkcNormalize('ﬁnal')         // → 'final'         (NFKC ligature)
 * nfkcNormalize('trans­former') // → 'transformer'   (soft hyphen)
 * nfkcNormalize('“attention”') // → '"attention"'  (smart quotes)
 * nfkcNormalize('end—to—end')  // → 'end-to-end'   (em-dash)
 * nfkcNormalize('naïve')   // → 'naive'         (diacritic strip)
 * nfkcNormalize('…')           // → '...'           (ellipsis)
 */
export function nfkcNormalize(s: string): string {
  // 1. NFKC: ligatures, fullwidth, compatibility forms.
  let out = s.normalize('NFKC');

  // 2. Strip soft hyphen (U+00AD) — PDF line-break hint, must not survive.
  out = out.replace(/­/g, '');

  // 3. Smart quotes → straight.
  //    U+2018 LEFT SINGLE QUOTATION MARK, U+2019 RIGHT SINGLE QUOTATION MARK.
  //    U+201C LEFT DOUBLE QUOTATION MARK, U+201D RIGHT DOUBLE QUOTATION MARK.
  out = out.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  // 4. En-dash (U+2013) and em-dash (U+2014) → hyphen-minus.
  out = out.replace(/[–—]/g, '-');

  // 5. Horizontal ellipsis (U+2026) → three dots.
  out = out.replace(/…/g, '...');

  // 6. NFD + strip combining marks (U+0300..U+036F) + back to NFC.
  //    Decomposes "naïve" → "naïve" → "naive"; "Müller" → "Muller".
  //    Uses an explicit hex-escaped character class (NOT a literal combining
  //    mark in the source) so the regex survives copy-paste and editor
  //    re-encoding without becoming malformed.
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

  // 7. Collapse whitespace runs (Pitfall 7: PDF kerning emits double spaces).
  out = out.replace(/\s+/g, ' ');

  // 8. Trim leading/trailing whitespace.
  return out.trim();
}

/**
 * Historical alias for {@link nfkcNormalize}. Preserved for tests/normalize.test.ts
 * (Wave 0 scaffold) which imports `normalizeText`. New code SHOULD prefer
 * `nfkcNormalize` (the canonical name per Plan 03-01).
 */
export const normalizeText = nfkcNormalize;
