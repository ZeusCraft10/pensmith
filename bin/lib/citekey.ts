// bin/lib/citekey.ts — Deterministic citekey generator per D-14 + REVIEWS amendment.
//
// Plan 04 Wave 3 / REVIEWS amendment.
//
// Citekey format: <surname><year> where:
//   - surname = firstAuthorSurname (Plan 01 author-normalize) further stripped
//               to ASCII-lowercase [a-z]+ only — particles' spaces and hyphens
//               disappear. Capped at 20 chars to keep filenames reasonable.
//   - year    = 4-digit integer year, or the literal 'noyear' when year is
//               undefined / null (still satisfies the D-14 regex
//               ^[a-z][a-z0-9_-]*$).
//
// Collision handling lives in bin/lib/bibtex-write.ts (suffix 'a','b','c',...
// using base-26 spreadsheet encoding for >26 collisions). This module is the
// PURE generator — same SourceCandidate -> same citekey, always.
//
// A corporate author, stored braced (`{The ENCODE Project Consortium}`, SRC-05
// / D-19-19), keys by the name's first significant word (`encode2012`) — its
// last word would give every consortium the same `consortium<year>` key.
//
// D-14 LOCKED citekey regex: ^[a-z][a-z0-9_-]*$. Every emit is asserted
// against the regex; a candidate whose surname is empty falls back to
// 'anon' so the first character is always a letter.
//
// Non-Latin surnames (review round 1 of the Phase 18/19 merge): a Cyrillic or
// Greek surname is transliterated (a fixed letter table, below) before the
// [a-z] filter, so `Эсенаманов, Байэл` keys as `esenamanov2025`, not
// `anon2025`. Latin letters are left as they were (a letter Unicode does not
// decompose — ł, ø, ß — is still dropped), so every key a Latin-script name
// produced before stays the same: recorded research runs (the e2e corpus's
// evaluator script) name candidates by these keys. A script with no table
// here (CJK, Arabic, Hebrew, …) still falls back to 'anon' — the key stays
// valid; only its readability suffers. Existing library keys never change
// (library.ts): this applies to new entries only.

import { firstAuthorSurname } from './author-normalize.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

/** D-14 LOCKED citekey regex — every citekey emitted by this module must match. */
export const CITEKEY_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Latin letters for Cyrillic (Russian, Ukrainian, Belarusian, Serbian,
 * Macedonian, Kazakh, Kyrgyz) and Greek, lower case and after the combining
 * marks are stripped (author-normalize.ts: й → и, ά → α). A simplified ISO 9 /
 * ELOT 743 romanisation — for a readable key, not a scholarly transliteration.
 */
const TRANSLITERATION: Readonly<Record<string, string>> = Object.freeze({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  є: 'ye', і: 'i', ґ: 'g', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz', ѕ: 'dz',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h',
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
});

/** Greek vowel pairs romanised as one sound (ELOT 743), applied before the letter table. */
const GREEK_DIGRAPHS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/ου/g, 'ou'],
  [/αυ/g, 'av'],
  [/ευ/g, 'ev'],
  [/ηυ/g, 'iv'],
  [/γγ/g, 'ng'],
] as const);

/** `s` with every letter the table knows replaced by its Latin spelling (other characters kept). */
export function transliterate(s: string): string {
  let t = s;
  for (const [re, latin] of GREEK_DIGRAPHS) t = t.replace(re, latin);
  let out = '';
  for (const ch of t) out += TRANSLITERATION[ch] ?? ch;
  return out;
}

/** Leading words a corporate name's key skips ("The ENCODE Project Consortium" → ENCODE). */
const CORPORATE_SKIP = /^(?:the|a|an|la|le|les|el|los|las|die|der|das)$/i;

/** The key word of a braced corporate author (`{The ENCODE Project Consortium}` → `ENCODE`), else null. */
function corporateKeyWord(author: string): string | null {
  const m = /^\{(.+)\}$/.exec(author.trim());
  if (!m) return null;
  const words = (m[1] ?? '').replace(/[{}]/g, ' ').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const word = words.find((w) => !CORPORATE_SKIP.test(w)) ?? words[0];
  return word ?? null;
}

/**
 * Generates a deterministic citekey from a SourceCandidate.
 *
 * Pure function — same input always yields same output, no I/O, no
 * stochastic salt. Collision resolution is the bibtex-write.ts caller's
 * job (this generator can and will return identical keys for two distinct
 * SourceCandidates that share surname + year).
 *
 * @example
 *   generateCitekey({ authors: ['Vaswani, A.'], year: 2017, ... })
 *   // -> 'vaswani2017'
 *
 *   generateCitekey({ authors: ['van den Berg, R.'], year: 2020, ... })
 *   // -> 'vandenberg2020'   (particles' spaces stripped)
 *
 *   generateCitekey({ authors: [], year: 2024, ... })
 *   // -> 'anon2024'         (empty-authors fallback)
 */
export function generateCitekey(c: Partial<SourceCandidate>): string {
  const firstAuthor = c.authors?.[0] ?? '';
  // firstAuthorSurname already nfkc-normalizes + lowercases + strips
  // combining diacritics. We just need to drop the non-ASCII-letter
  // residue (particle spaces, hyphens, apostrophes).
  let surname = transliterate(firstAuthorSurname(corporateKeyWord(firstAuthor) ?? firstAuthor)).replace(/[^a-z]/g, '').slice(0, 20);
  if (!surname) surname = 'anon';

  const year = c.year ?? 'noyear';
  const key = `${surname}${year}`;

  if (!CITEKEY_RE.test(key)) {
    throw new Error(
      `generateCitekey: produced invalid citekey "${key}" (D-14 regex /^[a-z][a-z0-9_-]*$/ failed). Input authors=${JSON.stringify(c.authors)}, year=${JSON.stringify(c.year)}`,
    );
  }
  return key;
}
