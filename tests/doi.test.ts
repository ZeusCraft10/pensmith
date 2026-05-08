// tests/doi.test.ts — spec tests for bin/lib/doi.ts (ARCH-15, D-15/D-17/D-18).
//
// Coverage targets:
//   - All 6 prefix forms strip correctly (D-15 step 1)
//   - All 10 trailing-punctuation chars strip in one pass (D-15 step 2)
//   - ASCII case-fold ([A-Z] → [a-z]) preserves non-ASCII bytes (D-15 step 3)
//   - Whitespace trimmed
//   - Garbage returns null (5+ adversarial cases)
//   - normalizeArxiv: new format, old format, garbage
//   - normalizePmid: bare digits, PMID: prefix (any case), garbage
//   - normalizePmcid: PMC prefix (any case), missing prefix → null
//   - All 4 typeguards mirror normalize* !== null
//
// The property test (tests/doi.property.test.ts) covers idempotence over
// 1000 fast-check iterations — see D-19. This file is the example-driven
// spec gate; the property test is the fuzz gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoi,
  normalizeArxiv,
  normalizePmid,
  normalizePmcid,
  isDoi,
  isArxiv,
  isPmid,
  isPmcid,
} from '../bin/lib/doi.js';

// ---------------------------------------------------------------------------
// normalizeDoi — D-15 spec (3 steps)
// ---------------------------------------------------------------------------

test('normalizeDoi: bare DOI passes through unchanged', () => {
  assert.equal(
    normalizeDoi('10.1038/s41586-021-03819-2'),
    '10.1038/s41586-021-03819-2',
  );
});

test('normalizeDoi: all 6 prefix forms strip (D-15 step 1)', () => {
  const target = '10.1038/s41586-021-03819-2';
  const prefixes = [
    'doi:',
    'DOI:',
    'https://doi.org/',
    'http://doi.org/',
    'https://dx.doi.org/',
    'http://dx.doi.org/',
  ];
  for (const p of prefixes) {
    assert.equal(normalizeDoi(p + target), target, `prefix ${p} should strip`);
  }
});

test('normalizeDoi: prefix match is case-insensitive on the prefix only', () => {
  // The prefix matcher should accept 'Doi:' / 'HTTPS://DOI.ORG/' etc.
  const target = '10.1038/s41586-021-03819-2';
  assert.equal(normalizeDoi('Doi:' + target), target);
  assert.equal(normalizeDoi('HTTPS://DOI.ORG/' + target), target);
  assert.equal(normalizeDoi('Https://Dx.Doi.Org/' + target), target);
});

test('normalizeDoi: all 10 trailing-punctuation chars strip (D-15 step 2)', () => {
  const target = '10.1038/s41586-021-03819-2';
  // The plan describes "8 forms" via 10 chars per the D-15 wording.
  const punct = ['.', ',', ';', ':', ')', ']', '}', '>', '"', "'"];
  for (const p of punct) {
    assert.equal(
      normalizeDoi(target + p),
      target,
      `trailing ${JSON.stringify(p)} should strip`,
    );
  }
});

test('normalizeDoi: trailing-punctuation strip is one-pass (multi-char run)', () => {
  // The TRAILING_PUNCT regex uses + so a run of mixed punct strips entirely.
  // This is correct because the spec says "strip in ONE pass" — the regex
  // greedily matches the run, but the regex itself only runs once.
  const target = '10.1038/s41586-021-03819-2';
  assert.equal(normalizeDoi(target + ').'), target);
  assert.equal(normalizeDoi(target + '.,;'), target);
  assert.equal(normalizeDoi(target + '")'), target);
});

test('normalizeDoi: prefix + trailing-punct combine', () => {
  const target = '10.1038/s41586-021-03819-2';
  assert.equal(
    normalizeDoi('https://doi.org/10.1038/s41586-021-03819-2,'),
    target,
  );
  assert.equal(
    normalizeDoi('http://dx.doi.org/10.1038/s41586-021-03819-2.'),
    target,
  );
  assert.equal(normalizeDoi('doi:10.1038/s41586-021-03819-2)'), target);
});

test('normalizeDoi: lowercases ASCII suffix (D-15 step 3)', () => {
  assert.equal(
    normalizeDoi('10.1038/S41586-021-03819-2'),
    '10.1038/s41586-021-03819-2',
  );
  assert.equal(normalizeDoi('10.1038/AAA'), '10.1038/aaa');
  assert.equal(normalizeDoi('10.1038/AbCdEf'), '10.1038/abcdef');
});

test('normalizeDoi: preserves non-ASCII bytes verbatim (D-15 step 3)', () => {
  // Latin-1 supplement, combining marks, CJK, emoji — all preserved.
  assert.equal(normalizeDoi('10.1234/résumé'), '10.1234/résumé');
  assert.equal(normalizeDoi('10.1234/abç'), '10.1234/abç');
  assert.equal(normalizeDoi('10.1234/naïve'), '10.1234/naïve');
});

test('normalizeDoi: trims whitespace', () => {
  assert.equal(normalizeDoi('  10.1038/s41586  '), '10.1038/s41586');
  assert.equal(normalizeDoi('\t10.1038/s41586\n'), '10.1038/s41586');
});

test('normalizeDoi: prefix + url + trailing combinations from a real corpus', () => {
  // These mirror citation strings seen in the wild that the verifier MUST
  // collapse to the same canonical form.
  const canonical = '10.1038/s41586-021-03819-2';
  const variants = [
    '10.1038/s41586-021-03819-2',
    'doi:10.1038/s41586-021-03819-2',
    'DOI:10.1038/S41586-021-03819-2',
    'https://doi.org/10.1038/s41586-021-03819-2',
    'http://dx.doi.org/10.1038/s41586-021-03819-2,',
    '  https://doi.org/10.1038/S41586-021-03819-2.  ',
  ];
  for (const v of variants) {
    assert.equal(normalizeDoi(v), canonical, `variant ${JSON.stringify(v)}`);
  }
});

test('normalizeDoi: garbage returns null', () => {
  assert.equal(normalizeDoi(''), null);
  assert.equal(normalizeDoi('not-a-doi'), null);
  assert.equal(normalizeDoi('10.'), null); // no suffix
  assert.equal(normalizeDoi('10.123'), null); // no slash
  assert.equal(normalizeDoi('10.1/x'), null); // 1-digit registrant (need 4-9)
  assert.equal(normalizeDoi('10.12/x'), null); // 2 digits
  assert.equal(normalizeDoi('10.123/x'), null); // 3 digits
  assert.equal(normalizeDoi('foo/bar'), null);
  assert.equal(normalizeDoi('   '), null); // whitespace-only
});

test('normalizeDoi: rejects 10-digit registrant (upper bound is 9)', () => {
  // /^10\.\d{4,9}\/\S+$/ caps at 9 digits in the registrant slot.
  assert.equal(normalizeDoi('10.1234567890/x'), null);
});

// ---------------------------------------------------------------------------
// normalizeArxiv — D-17 spec
// ---------------------------------------------------------------------------

test('normalizeArxiv: new format YYMM.NNNNN', () => {
  assert.equal(normalizeArxiv('arXiv:2103.00020'), 'arxiv:2103.00020');
  assert.equal(normalizeArxiv('ARXIV:2103.00020'), 'arxiv:2103.00020');
  assert.equal(normalizeArxiv('arxiv:2103.00020'), 'arxiv:2103.00020');
  assert.equal(normalizeArxiv('2103.00020'), 'arxiv:2103.00020'); // bare body
});

test('normalizeArxiv: new format with version suffix', () => {
  assert.equal(normalizeArxiv('arXiv:2103.00020v2'), 'arxiv:2103.00020v2');
  assert.equal(normalizeArxiv('2103.00020v15'), 'arxiv:2103.00020v15');
});

test('normalizeArxiv: old format subject-class/YYMMNNN', () => {
  assert.equal(normalizeArxiv('cs.CL/0301012'), 'cs.CL/0301012');
  assert.equal(normalizeArxiv('astro-ph/0301012'), 'astro-ph/0301012');
  assert.equal(normalizeArxiv('math.AG/9912345'), 'math.AG/9912345');
});

test('normalizeArxiv: old format strips arxiv: prefix but preserves class case', () => {
  assert.equal(normalizeArxiv('arxiv:cs.CL/0301012'), 'cs.CL/0301012');
  assert.equal(normalizeArxiv('arXiv:astro-ph/0301012'), 'astro-ph/0301012');
});

test('normalizeArxiv: garbage returns null', () => {
  assert.equal(normalizeArxiv(''), null);
  assert.equal(normalizeArxiv('garbage'), null);
  assert.equal(normalizeArxiv('cs.UNKNOWN/0301012'), null); // unknown class
  assert.equal(normalizeArxiv('cs/abc'), null); // body not 7 digits
  assert.equal(normalizeArxiv('cs/030101'), null); // body 6 digits
  assert.equal(normalizeArxiv('cs/03010122'), null); // body 8 digits
  assert.equal(normalizeArxiv('arxiv:'), null); // empty body
});

// ---------------------------------------------------------------------------
// normalizePmid — D-18 spec
// ---------------------------------------------------------------------------

test('normalizePmid: bare digits + PMID: prefix in any case', () => {
  assert.equal(normalizePmid('12345678'), '12345678');
  assert.equal(normalizePmid('PMID:12345678'), '12345678');
  assert.equal(normalizePmid('pmid:12345678'), '12345678');
  assert.equal(normalizePmid('Pmid:12345678'), '12345678');
  assert.equal(normalizePmid(' 12345678 '), '12345678'); // whitespace
});

test('normalizePmid: garbage returns null', () => {
  assert.equal(normalizePmid(''), null);
  assert.equal(normalizePmid('abc'), null);
  assert.equal(normalizePmid('1234567890'), null); // 10 digits — over PubMed's 9-digit limit
  assert.equal(normalizePmid('PMID:abc'), null);
  assert.equal(normalizePmid('12.34'), null); // dot not allowed
});

// ---------------------------------------------------------------------------
// normalizePmcid — D-18 spec
// ---------------------------------------------------------------------------

test('normalizePmcid: PMC + digits, prefix case-insensitive', () => {
  assert.equal(normalizePmcid('PMC1234567'), 'PMC1234567');
  assert.equal(normalizePmcid('pmc1234567'), 'PMC1234567');
  assert.equal(normalizePmcid('Pmc1234567'), 'PMC1234567');
  assert.equal(normalizePmcid(' PMC1234567 '), 'PMC1234567');
});

test('normalizePmcid: missing prefix returns null', () => {
  // Bare digits cannot be disambiguated from PMID; we require the PMC prefix.
  assert.equal(normalizePmcid('1234567'), null);
  assert.equal(normalizePmcid(''), null);
  assert.equal(normalizePmcid('PMCabc'), null); // body not all digits
});

// ---------------------------------------------------------------------------
// Typeguards mirror normalize* !== null
// ---------------------------------------------------------------------------

test('isDoi / isArxiv / isPmid / isPmcid mirror normalize* !== null', () => {
  // Positive
  assert.equal(isDoi('10.1038/x'), true);
  assert.equal(isArxiv('arXiv:2103.00020'), true);
  assert.equal(isArxiv('cs.CL/0301012'), true);
  assert.equal(isPmid('12345678'), true);
  assert.equal(isPmid('PMID:12345678'), true);
  assert.equal(isPmcid('PMC1234567'), true);

  // Negative
  assert.equal(isDoi('xyz'), false);
  assert.equal(isDoi(''), false);
  assert.equal(isArxiv('garbage'), false);
  assert.equal(isPmid('abc'), false);
  assert.equal(isPmcid('1234567'), false); // missing PMC prefix
});
