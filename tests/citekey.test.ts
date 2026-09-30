// tests/citekey.test.ts — Plan 04 Task 4.4 (REVIEWS amendment, Plan 00 Wave 0 sentinel).
//
// 6 cases:
//   1. simple surname
//   2. particle handling ("van den Berg")
//   3. diacritics + hyphen ("Müller-Schmidt")
//   4. empty authors -> 'anon' fallback
//   5. missing year -> 'noyear' suffix
//   6. idempotency under 100 invocations
//
// Plus an explicit D-14 regex check on every case to keep the citekey contract
// LOCKED in the test suite (not just in the runtime throw inside generateCitekey).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCitekey, CITEKEY_RE } from '../bin/lib/citekey.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

function fix(partial: Partial<SourceCandidate>): Partial<SourceCandidate> {
  return partial;
}

test('citekey 1: simple surname yields surname+year (vaswani2017)', () => {
  const k = generateCitekey(fix({ authors: ['Vaswani, A.'], year: 2017 }));
  assert.equal(k, 'vaswani2017');
  assert.match(k, CITEKEY_RE);
});

test('citekey 2: particle handling strips spaces (van den Berg, R. -> vandenberg2020)', () => {
  const k = generateCitekey(fix({ authors: ['van den Berg, R.'], year: 2020 }));
  assert.equal(k, 'vandenberg2020');
  assert.match(k, CITEKEY_RE);
});

test('citekey 3: diacritics + hyphen stripped (Müller-Schmidt -> mullerschmidt2019)', () => {
  const k = generateCitekey(fix({ authors: ['Müller-Schmidt'], year: 2019 }));
  assert.equal(k, 'mullerschmidt2019');
  assert.match(k, CITEKEY_RE);
});

test('citekey 4: empty authors fallback to anon (anon2024)', () => {
  const k = generateCitekey(fix({ authors: [], year: 2024 }));
  assert.equal(k, 'anon2024');
  assert.match(k, CITEKEY_RE);
});

test('citekey 5: missing year fallback to noyear (wunoyear)', () => {
  const k = generateCitekey(fix({ authors: ['Wu, Y.'] }));
  assert.equal(k, 'wunoyear');
  assert.match(k, CITEKEY_RE);
});

test('citekey 6: idempotency — 100 invocations all return identical string', () => {
  const input = fix({ authors: ['Vaswani, A.'], year: 2017 });
  const expected = generateCitekey(input);
  for (let i = 0; i < 100; i++) {
    assert.equal(generateCitekey(input), expected);
  }
});

test('citekey 7 (SRC-05 / D-19-19): a braced corporate author keys by its first significant word, not its last', () => {
  assert.equal(generateCitekey(fix({ authors: ['{The ENCODE Project Consortium}'], year: 2012 })), 'encode2012');
  assert.equal(generateCitekey(fix({ authors: ['{World Health Organization}'], year: 2020 })), 'world2020');
  assert.equal(generateCitekey(fix({ authors: ['{The 1000 Genomes Project Consortium}'], year: 2015 })), 'genomes2015', 'words without letters are skipped (D-14: a letter first)');
  // A person named "Consortium" is unaffected (no braces).
  assert.equal(generateCitekey(fix({ authors: ['Consortium, Ann'], year: 2012 })), 'consortium2012');
});

test('review round 1: a Cyrillic or Greek surname is transliterated — a named author never keys as anon', () => {
  assert.equal(generateCitekey(fix({ authors: ['Эсенаманов, Байэл'], year: 2025 })), 'esenamanov2025');
  assert.equal(generateCitekey(fix({ authors: ['Щербаков, Ю.'], year: 2019 })), 'shcherbakov2019');
  assert.equal(generateCitekey(fix({ authors: ['Шевченко, Тарас'], year: 1840 })), 'shevchenko1840');
  assert.equal(generateCitekey(fix({ authors: ['Παπαδόπουλος, Γιώργος'], year: 2020 })), 'papadopoulos2020');
  assert.equal(generateCitekey(fix({ authors: ['Łukasiewicz, Jan'], year: 1951 })), 'lukasiewicz1951');
  assert.equal(generateCitekey(fix({ authors: ['Straße, Anna'], year: 2001 })), 'strasse2001');
  assert.equal(generateCitekey(fix({ authors: ['Ødegaard, Ø.'], year: 2010 })), 'odegaard2010');
  // A script with no table keeps the valid fallback; an empty author list is anon too.
  assert.equal(generateCitekey(fix({ authors: ['王, 小明'], year: 2021 })), 'anon2021');
  assert.equal(generateCitekey(fix({ authors: [], year: 2024 })), 'anon2024');
});
