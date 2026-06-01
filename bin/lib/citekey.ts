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
// D-14 LOCKED citekey regex: ^[a-z][a-z0-9_-]*$. Every emit is asserted
// against the regex; a candidate whose surname is empty falls back to
// 'anon' so the first character is always a letter.

import { firstAuthorSurname } from './author-normalize.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

/** D-14 LOCKED citekey regex — every citekey emitted by this module must match. */
export const CITEKEY_RE = /^[a-z][a-z0-9_-]*$/;

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
  let surname = firstAuthorSurname(firstAuthor).replace(/[^a-z]/g, '').slice(0, 20);
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
