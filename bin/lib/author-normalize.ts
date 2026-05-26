// bin/lib/author-normalize.ts — First-author surname extraction (D-11 Pass-1 AND-gate).
//
// REVIEWS CONVERGENCE — first-author surname normalization (Codex MEDIUM,
// OpenCode consensus #4). D-11's Pass-1 AND-gate compares first-author
// surnames via jaroWinkler at AUTHOR_JW_THRESHOLD=0.85. Without a canonical
// surname extractor, the gate either over-rejects (false negatives — real
// citations rejected) or over-accepts (fabrications survive). This module
// is the single source of truth for "what is the surname of the first
// author of a citation?"
//
// Author-string forms the extractor must handle (per D-11 + 03-REVIEWS.md):
//   "Vaswani, A."         → "vaswani"        (comma-separated: surname-first)
//   "A. Vaswani"          → "vaswani"        (initials-prefix: last token is surname)
//   "Aidan N. Gomez"      → "gomez"          (multi-given-name: last non-initial token)
//   "van den Berg, R."    → "van den berg"   (Dutch particle, surname-first)
//   "R. van den Berg"     → "van den berg"   (particle in middle: detect + merge)
//   "Müller-Schmidt"      → "muller-schmidt" (hyphenated + diacritic strip)
//   "Wu, Y." / "Yuxin Wu" → "wu"             (cross-form consistency)
//
// Trust boundary: BibTeX author fields and Crossref/OpenAlex author payloads
// arrive through bin/lib/sources/* adapters and bin/lib/citations.ts. By the
// time they reach this module, they are zod-parsed strings — but the SHAPE
// is heterogeneous. We do not parse arbitrary user-supplied YAML/BibTeX
// here; we only canonicalize the surname.
//
// Zero third-party deps beyond local ./normalize.js (per RESEARCH.md
// Standard Stack).

import { nfkcNormalize } from './normalize.js';

/**
 * Particle list for surname detection. These tokens, when they appear
 * immediately before the surname token in "given-name-first" form, are
 * absorbed INTO the surname (so "R. van den Berg" → surname = "van den berg",
 * not just "berg").
 *
 * Sources cross-referenced:
 *   - Dutch:           van, von, der, den, ter, te
 *   - German:          von, zu, vom
 *   - French/Italian:  de, du, la, le, di, da, del, della, dei, dos, do
 *   - Spanish/Portug.: de la, del, dos, do, da, e
 *   - Iberian:         el
 *   - Arabic:          al, bin, ben, abu
 *   - Irish/Scottish:  o' / o, mac, mc
 *
 * Single-word particles only — compound particles like "de la" are absorbed
 * one token at a time by the backward-scan loop, so "Garcia de la Cruz" →
 * surname = "de la cruz". Tokens are matched case-insensitively after nfkc
 * normalization (which lowercases via the surname extractor's own .toLowerCase()).
 */
const PARTICLES = new Set([
  'van', 'von', 'de', 'den', 'der', 'la', 'le', 'di', 'da', 'del',
  'dos', 'do', 'du', 'el', 'al', 'bin', 'ben', 'mac', 'mc', "o'", 'ter',
  'zu', 'vom', 'te', 'della', 'dei', 'abu', 'e',
]);

/**
 * Detects whether a token is a pure initial (single letter, optionally with
 * trailing dot). Used to walk backwards past initials when extracting the
 * surname from "given-name-first" form like "Aidan N. Gomez" → surname = "gomez".
 *
 * Constraints: single letter only; "ph." would be a degree-suffix, not an
 * initial, and is left as-is. Apostrophe-containing tokens (e.g. "o'brien")
 * are caught by the PARTICLES check before reaching this predicate.
 */
function isInitial(token: string): boolean {
  return /^[a-z]\.?$/.test(token);
}

/**
 * Extracts the surname/family-name from a single author string, returning it
 * lowercased + NFKC-normalized + diacritic-stripped. For particled names
 * (van den Berg, de la Cruz), the FULL multi-word surname is returned with
 * a single space separator.
 *
 * Algorithm:
 *   1. nfkcNormalize + lowercase + trim. If empty → return "".
 *   2. If input contains a comma, treat as surname-first form: return the
 *      pre-comma substring (already lowercased + normalized). This handles
 *      both "Vaswani, A." and "van den Berg, R." correctly because the
 *      pre-comma substring already includes the full multi-word surname.
 *   3. Otherwise (given-name-first form): tokenize on whitespace.
 *      a. If single token → it IS the surname.
 *      b. Walk backwards from the last token, skipping pure initials
 *         (one-letter ± dot). The first non-initial from the right is the
 *         surname-tail start.
 *      c. Extend the surname-tail leftward through any consecutive PARTICLES
 *         (so "R. van den Berg" with last-non-initial="berg" extends through
 *         "den" and "van" → final surname = "van den berg").
 *      d. Return tokens[surnameStart..end].join(' ').
 *
 * @example
 * firstAuthorSurname("Vaswani, A.")     // → "vaswani"
 * firstAuthorSurname("A. Vaswani")      // → "vaswani"
 * firstAuthorSurname("Aidan N. Gomez")  // → "gomez"
 * firstAuthorSurname("van den Berg, R.") // → "van den berg"
 * firstAuthorSurname("R. van den Berg") // → "van den berg"
 * firstAuthorSurname("Müller-Schmidt") // → "muller-schmidt"
 * firstAuthorSurname("Wu, Y.")          // → "wu"
 * firstAuthorSurname("Yuxin Wu")        // → "wu"
 * firstAuthorSurname("")                // → ""
 */
export function firstAuthorSurname(authorString: string): string {
  const normalized = nfkcNormalize(authorString).toLowerCase().trim();
  if (!normalized) return '';

  // Comma form: "Surname, GivenName" or "Surname Particles, Initials".
  // The pre-comma substring IS the full surname (possibly multi-word for
  // particled names). Just trim trailing whitespace and return.
  if (normalized.includes(',')) {
    const before = normalized.split(',')[0];
    if (before === undefined) return '';
    return before.trim();
  }

  // Given-name-first form: tokenize, walk back past initials, extend through
  // particles.
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) {
    const only = tokens[0];
    return only ?? '';
  }

  // Find the rightmost non-initial token. That is the start of the surname
  // tail (a particled surname extends leftward from there).
  let surnameStart = tokens.length - 1;
  while (surnameStart > 0) {
    const tok = tokens[surnameStart];
    if (tok === undefined || !isInitial(tok)) break;
    surnameStart--;
  }

  // Extend leftward through consecutive particles. Stop at the first token
  // that is NEITHER a particle NOR a continuation of the surname.
  while (surnameStart > 0) {
    const prev = tokens[surnameStart - 1];
    if (prev === undefined) break;
    if (!PARTICLES.has(prev)) break;
    surnameStart--;
  }

  return tokens.slice(surnameStart).join(' ');
}

/**
 * Batch-normalize a list of author strings to their surnames. Used by
 * bin/lib/verify/pass1.ts (Wave 2+) when iterating candidate authors
 * against a single claimed author.
 *
 * @example
 * normalizeAuthorList(["Vaswani, A.", "Shazeer, N.", "Parmar, N."])
 * // → ["vaswani", "shazeer", "parmar"]
 */
export function normalizeAuthorList(authors: string[]): string[] {
  return authors.map(firstAuthorSurname);
}
