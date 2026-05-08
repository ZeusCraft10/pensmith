// tests/fixtures/doi-corpus.ts
// fast-check generators for DOI / arXiv / PMID corpus testing.
// Used by the Wave 4 property test (D-19) AND reused in Phase 3
// verifier tests. Keep the generators pure / deterministic-seeded.
//
// NOTE: tests/fixtures/ is excluded from tsconfig (Phase 0 D-13), so this
// file is not type-checked by `tsc --noEmit`. It IS however consumed as
// real TypeScript by Wave 4's DOI property test, so types are kept honest.
// We deliberately do NOT use `@ts-nocheck` here (the typescript-eslint
// `ban-ts-comment` rule would flag it; and this file's types are sound).

import * as fc from 'fast-check';

// Valid bare DOI (per /^10\.\d{4,9}\/[^\s]+$/)
export const validDoi = fc.tuple(
  fc.integer({ min: 1000, max: 999999999 }),
  fc.string({ minLength: 1, maxLength: 50 }).filter(s => !/\s/.test(s)),
).map(([reg, suffix]) => `10.${reg}/${suffix}`);

// DOI with one of the eight trailing-punctuation forms (D-15 step 2)
export const doiWithTrailingPunct = fc.tuple(
  validDoi,
  fc.constantFrom('.', ',', ';', ':', ')', ']', '}', '>', '"', "'"),
).map(([doi, punct]) => doi + punct);

// DOI with one of the six prefix forms (D-15 step 1)
export const doiWithPrefix = fc.tuple(
  validDoi,
  fc.constantFrom(
    'doi:', 'DOI:', 'https://doi.org/', 'http://doi.org/',
    'https://dx.doi.org/', 'http://dx.doi.org/',
  ),
).map(([doi, prefix]) => prefix + doi);

// arXiv new format (per D-17): YYMM.NNNNN[vV]
export const arxivNew = fc.tuple(
  fc.integer({ min: 1, max: 99 }),         // year (post-2007 = 07-99)
  fc.integer({ min: 1, max: 12 }),         // month
  fc.integer({ min: 1, max: 99999 }),      // sequence
  fc.option(fc.integer({ min: 1, max: 9 })), // optional version
).map(([year, month, seq, version]) => {
  const ym = `${String(year).padStart(2, '0')}${String(month).padStart(2, '0')}`;
  const seqStr = String(seq).padStart(5, '0');
  const v = version !== null ? `v${version}` : '';
  return `arXiv:${ym}.${seqStr}${v}`;
});

// arXiv old format (per D-17): subject-class/YYMMNNN
export const arxivOld = fc.tuple(
  fc.constantFrom('cs', 'cs.CL', 'math', 'math.AG', 'physics', 'astro-ph'),
  fc.integer({ min: 1, max: 99 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 999 }),
).map(([cls, year, month, seq]) => {
  const ymN = `${String(year).padStart(2, '0')}${String(month).padStart(2, '0')}${String(seq).padStart(3, '0')}`;
  return `${cls}/${ymN}`;
});

// PMID (per D-18): digits-only or with PMID: prefix
export const pmid = fc.tuple(
  fc.integer({ min: 1, max: 99999999 }),
  fc.boolean(),
).map(([n, withPrefix]) => withPrefix ? `PMID:${n}` : String(n));

// PMCID (per D-18): always carries PMC prefix
export const pmcid = fc.integer({ min: 1, max: 99999999 })
  .map(n => `PMC${n}`);

// Garbage strings that must normalize to null
export const garbage = fc.oneof(
  fc.string({ maxLength: 20 }).filter(s => !s.startsWith('10.')),
  fc.constant(''),
  fc.constant('not a doi'),
  fc.constant('10.'),
  fc.constant('10.123'),  // missing slash + suffix
  fc.constant('foo/bar'),
);

// Mixed-case ASCII DOI (D-15 step 3)
export const doiMixedCase = validDoi.map(d => {
  // randomize case on the suffix only
  return d.split('').map(c => Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()).join('');
});

// Non-ASCII bytes preserved (D-15 step 3)
export const doiNonAscii = fc.tuple(
  fc.integer({ min: 1000, max: 9999 }),
  fc.constantFrom('abç', 'naïve', 'résumé', 'über'),
).map(([reg, body]) => `10.${reg}/${body}`);
