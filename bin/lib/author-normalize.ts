// bin/lib/author-normalize.ts — First-author surname extraction.
//
// The single answer to "what is the surname of the first author of a
// citation?", used to build citekeys and the drafter's source list. (Pass 1
// compares names itself, structured and particle-aware, in
// bin/lib/verify/work-match.ts.)
//
// Author-string forms the extractor must handle:
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
import type { CslName } from './schemas/source-candidate.js';

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

// ---------------------------------------------------------------------------
// Structured names (CSL-JSON) from the forms registries write them in.
// ---------------------------------------------------------------------------

/**
 * Words that mark a corporate author ("The ENCODE Project Consortium", "WHO
 * Working Group"). Such a name is kept whole as a CSL `literal`: splitting it
 * into given and family names would print "Consortium, T. E. P.".
 */
const CORPORATE = /\b(?:consortium|collaboration|group|committee|organi[sz]ation|association|institute|team|project|network|society|council|agency|foundation|university|department|initiative|alliance|investigators|developers|working party|task force)\b/i;

/** Generational suffixes written after a name ("Jr.", "III"). */
const SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;

/** Initials as PubMed writes them after a surname: "AJ", "S". */
const PUBMED_INITIALS = /^\p{Lu}{1,4}$/u;

function personName(family: string, given: string, suffix?: string): CslName {
  const out: CslName = { family };
  if (given) out.given = given;
  if (suffix) out.suffix = suffix;
  return out;
}

/**
 * A display name as OpenAlex, arXiv, Semantic Scholar and Zotero's single
 * field write it, as a CSL name. "Ashish Vaswani" is given then family;
 * "Vaswani, Ashish" is family first. Lowercase particles stay with the family
 * name ("Stéfan van der Walt" → family "van der Walt"), as Crossref writes it,
 * so the citekey and the sort order do not change with the source. A
 * corporate name is a `literal`. Null for an empty string.
 */
export function parseDisplayName(raw: string): CslName | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.includes(',')) {
    const [family = '', given = '', suffix = ''] = s.split(',').map((p) => p.trim());
    if (!family) return parseDisplayName(given);
    return personName(family, given, suffix || undefined);
  }
  if (CORPORATE.test(s)) return { literal: s };
  const tokens = s.split(' ');
  if (tokens.length === 1) return { family: s };
  let end = tokens.length;
  let suffix: string | undefined;
  if (end > 2 && SUFFIX.test(tokens[end - 1]!)) {
    suffix = tokens[end - 1];
    end -= 1;
  }
  // The family name is the last word, extended left through lowercase
  // particles; at least one word stays as the given name.
  let start = end - 1;
  while (start > 1 && PARTICLES.has(tokens[start - 1]!)) start -= 1;
  return personName(tokens.slice(start, end).join(' '), tokens.slice(0, start).join(' '), suffix);
}

/**
 * A PubMed author ("Wakefield AJ", "van der Walt S", "Smith JA Jr") as a CSL
 * name: the surname, then the initials as given names ("A. J."). A name with
 * no initials is a family name alone.
 */
export function parsePubmedName(raw: string): CslName | null {
  const tokens = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  let suffix: string | undefined;
  if (tokens.length > 2 && SUFFIX.test(tokens[tokens.length - 1]!)) suffix = tokens.pop();
  const last = tokens[tokens.length - 1]!;
  if (tokens.length > 1 && PUBMED_INITIALS.test(last)) {
    tokens.pop();
    return personName(tokens.join(' '), [...last].map((c) => `${c}.`).join(' '), suffix);
  }
  return personName(tokens.join(' '), '', suffix);
}

/** A CSL name from a registry's separate family and given fields, or its corporate `name`. */
export function nameFromParts(family: unknown, given: unknown, corporate?: unknown): CslName | null {
  const f = typeof family === 'string' ? family.trim() : '';
  const g = typeof given === 'string' ? given.trim() : '';
  if (f) return personName(f, g);
  const lit = typeof corporate === 'string' ? corporate.trim() : '';
  if (lit) return { literal: lit };
  // A registry that gives only a given name ("Plato" filed as given) is read as a display name.
  return g ? parseDisplayName(g) : null;
}

/** The display string research and the prompts use: "Family, Given", the family name alone, or the corporate name. */
export function displayName(n: CslName): string {
  if (n.literal) return n.literal;
  const family = [n['non-dropping-particle'], n.family].filter(Boolean).join(' ');
  const given = [n.given, n['dropping-particle']].filter(Boolean).join(' ');
  return given ? `${family}, ${given}` : family;
}

/** The names that are not null. */
export function presentNames(names: ReadonlyArray<CslName | null>): CslName[] {
  return names.filter((n): n is CslName => n !== null && Boolean(n.family || n.literal));
}
