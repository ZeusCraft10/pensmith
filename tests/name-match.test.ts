// tests/name-match.test.ts — the real-world name / title / year match of Pass 1
// (Phase 20, VRFY-13, D-20-11): verify/name-match.ts.
//
// A unit table of every spelling the gap register saw produce a false block
// (particles, compound surnames, PubMed "Family INITIALS", U+2010 hyphens,
// diacritics, "et al.", consortia, non-Latin names, editors, subtitles,
// online-first years) — each must match — and the real mismatches that must
// still fail, with the failing field named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorSimilarity,
  foldText,
  mainTitle,
  matchWork,
  surnameForms,
  titleForms,
  titleSimilarity,
  YEAR_TOLERANCE,
  STRICT_TITLE_JW,
} from '../bin/lib/verify/name-match.js';
import { AUTHOR_JW_THRESHOLD, TITLE_JW_THRESHOLD } from '../bin/lib/fuzzy.js';

test('foldText: NFKD diacritics out, every Unicode dash to "-", lower case, whitespace collapsed; scripts kept', () => {
  assert.equal(foldText('Müller-Schmidt'), 'muller-schmidt');
  for (const dash of ['‐', '‑', '‒', '–', '—', '―', '−']) {
    assert.equal(foldText(`Aart${dash}van der Beek`), 'aart-van der beek', `U+${dash.codePointAt(0)!.toString(16)}`);
  }
  assert.equal(foldText('  Ｄeep\tLearning  '), 'deep learning');
  assert.equal(foldText('北本'), '北本', 'non-Latin text is kept as written (no transliteration)');
  assert.equal(foldText('Лебедев'), 'лебедев');
});

/** Every author pair here names the SAME person as a registrar and a bibliography spell them. */
const SAME_AUTHOR: ReadonlyArray<readonly [string, string, string]> = [
  ['van der Maaten, Ernst', 'van der Maaten, E.', 'particle surname, initials'],
  ['van der Maaten, Ernst', 'Maaten, Ernst van der', 'particle moved to the given part (BibTeX "von" form)'],
  ['Laurens van der Maaten', 'van der Maaten, Laurens', 'display name vs "Family, Given"'],
  ['Smith, J. A.', 'JA, Smith', 'a BibTeX parse of PubMed "Smith JA" (family JA, given Smith)'],
  ['Smith, J. A.', 'Smith JA', 'PubMed compact "Family INITIALS"'],
  ['Wu, J. Y.', 'JY, Wu', 'a BibTeX parse of PubMed "Wu JY"'],
  ['van den Berg, R.', 'van den Berg R', 'PubMed compact with a particle'],
  ['Annemarie B. van der Aart‐van der Beek', 'van der Aart-van der Beek, Annemarie B.', 'OpenAlex U+2010 compound particle surname'],
  ['Aart-van der Beek, A. B. van der', 'van der Aart‐van der Beek, Annemarie', 'the same, split differently'],
  ['Müller, K.', 'Muller, K.', 'diacritic stripped'],
  ['Müller, K.', 'Mueller, K.', 'diacritic transliterated'],
  ['García Márquez, Gabriel', 'Garcia Marquez, G.', 'compound surname, diacritics'],
  ['Sofie Van Landeghem', 'Van Landeghem, Sofie', 'capitalised particle'],
  ['Vaswani, Ashish', 'Vaswani et al.', '"et al." dropped'],
  ['Vaswani, Ashish', 'Vaswani, A., et al.', '"et al." after the initials'],
  ['{The ENCODE Project Consortium}', '{ENCODE Project Consortium}', 'a braced consortium compared whole (leading "The" dropped)'],
  ['Ines Montani', 'Montani, Ines', 'DataCite display name'],
  ['北本, 朝展', '北本, 朝展', 'a Japanese name, compared in its own script'],
  ['Лебедев, А. Н.', 'Лебедев, Алексей', 'a Cyrillic name, compared in its own script'],
  ['A. N. Gomez', 'Gomez, Aidan N.', 'initials before the family'],
  ['Reid Chassiakos, Yolanda (Linda)', 'Chassiakos, Yolanda Reid', 'a compound surname (Crossref) cited from a display name split at its last word (OpenAlex; live self-consistency)'],
  ['García Márquez, Gabriel', 'García, Gabriel', 'a Spanish compound surname cited by its first surname'],
];

test('VRFY-13: the same person spelled the ways registrars and bibliographies spell them — first-author score ≥ AUTHOR_JW_THRESHOLD', () => {
  for (const [a, b, why] of SAME_AUTHOR) {
    const s = authorSimilarity(a, b);
    assert.ok(s >= AUTHOR_JW_THRESHOLD, `${why}: ${JSON.stringify(a)} vs ${JSON.stringify(b)} scored ${s.toFixed(3)} (forms ${JSON.stringify(surnameForms(a))} / ${JSON.stringify(surnameForms(b))})`);
    assert.equal(authorSimilarity(b, a), s, 'symmetric');
  }
});

test('VRFY-13: different people still fail', () => {
  for (const [a, b] of [
    ['LeCun, Yann', 'Hinton, Geoffrey'],
    ['Zhu, Na', 'Wu, Fan'],
    ['{The ENCODE Project Consortium}', '{1000 Genomes Project Consortium}'],
    ['北本, 朝展', '山田, 太郎'],
    ['van der Maaten, Ernst', 'Spiecker, Heinrich'],
    ['Reid Chassiakos, Yolanda', 'Radesky, Jenny S.'],
    ['García Márquez, Gabriel', 'Vargas Llosa, Mario'],
  ] as const) {
    assert.ok(authorSimilarity(a, b) < AUTHOR_JW_THRESHOLD, `${a} vs ${b}: ${authorSimilarity(a, b)}`);
  }
  assert.deepEqual(surnameForms('et al.'), []);
  assert.equal(authorSimilarity('', 'Smith, J.'), 0);
});

test('VRFY-13: a title is compared whole and without its subtitle (":", " - ", " – ", " — ", ". "); a record\'s separate subtitle is joined back', () => {
  assert.equal(mainTitle('The Elements of Statistical Learning: Data Mining, Inference, and Prediction'), 'The Elements of Statistical Learning');
  assert.equal(mainTitle('Deep learning — a review'), 'Deep learning');
  assert.equal(mainTitle('Deep learning - a review'), 'Deep learning');
  assert.equal(mainTitle('Deep learning. A review'), 'Deep learning');
  assert.equal(mainTitle('Deep learning'), null);
  assert.deepEqual(titleForms('[Translated title].'), ['translated title'], 'PubMed brackets and the final period');
  // The ESL book cited with its subtitle; Crossref keeps the subtitle apart.
  assert.equal(titleSimilarity({ title: 'The Elements of Statistical Learning', subtitle: 'Data Mining, Inference, and Prediction' }, 'The Elements of Statistical Learning: Data Mining, Inference, and Prediction'), 1);
  assert.equal(titleSimilarity({ title: 'The Elements of Statistical Learning' }, 'The Elements of Statistical Learning: Data Mining, Inference, and Prediction'), 1);
  // Registrar markup and U+2010 / en dashes are not differences.
  assert.equal(titleSimilarity({ title: 'Oxygen <i>in vivo</i> ‐ a study' }, 'Oxygen in vivo - a study'), 1);
  assert.equal(titleSimilarity({ title: 'Medical Image Computing and Computer-Assisted Intervention – MICCAI 2015' }, 'Medical Image Computing and Computer-Assisted Intervention - MICCAI 2015'), 1);
  // A different title stays below the threshold.
  assert.ok(titleSimilarity({ title: 'Deep learning' }, 'Deep reinforcement learning for robotics') < TITLE_JW_THRESHOLD);
});

test('VRFY-13: the year must be within ±1 when both carry one (online-first vs issue year); a larger gap is MIS-CITED (year)', () => {
  const record = { title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 };
  assert.equal(YEAR_TOLERANCE, 1);
  assert.equal(matchWork({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 }, record).ok, true);
  const online = matchWork({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 2014 }, record);
  assert.equal(online.ok, true);
  assert.match(online.detail, /^D-11 AND-gate passed \(year 2014, record 2015: within 1\)$/);
  const wrong = matchWork({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 1999 }, record);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.failing, ['year']);
  assert.equal(wrong.detail, 'mismatch: year (claimed 1999, record 2015)');
  // No year on one side: the year is not compared.
  assert.equal(matchWork({ title: 'Deep learning', authors: ['LeCun, Yann'], year: null }, record).ok, true);
});

test('VRFY-13: a mismatch names every failing field', () => {
  const m = matchWork(
    { title: 'A new coronavirus associated with human respiratory disease in China', authors: ['Wu, Fan'], year: 2018 },
    { title: 'A Novel Coronavirus from Patients with Pneumonia in China, 2019', authors: ['Zhu, Na'], year: 2020 },
  );
  assert.deepEqual(m.failing, ['title', 'first author', 'year']);
  assert.match(m.detail, /^mismatch: title \(0\.\d\d < 0\.92\), first author \(0\.\d\d < 0\.85\), year \(claimed 2018, record 2020\)$/);
});

test('VRFY-13 / D-20-10: an editor-only work (an edited volume) compares its first editor', () => {
  const record = { title: 'Medical Image Computing and Computer-Assisted Intervention – MICCAI 2015', authors: ['Navab, Nassir'], editors: ['Navab, Nassir', 'Hornegger, Joachim'], year: 2015 };
  const ok = matchWork({ title: 'Medical Image Computing and Computer-Assisted Intervention -- MICCAI 2015', authors: [], editors: ['Navab, N.'], year: 2015 }, record);
  assert.equal(ok.ok, true, ok.detail);
  const bad = matchWork({ title: 'Medical Image Computing and Computer-Assisted Intervention -- MICCAI 2015', authors: [], editors: ['Frangi, Alejandro'], year: 2015 }, record);
  assert.deepEqual(bad.failing, ['first author']);
});

test('D-20-11: the metadata search\'s strict title threshold is stricter than the D-11 gate', () => {
  assert.ok(STRICT_TITLE_JW > TITLE_JW_THRESHOLD);
  const near = matchWork({ title: 'Measured movement', authors: ['Aspelmeyer, M.'], year: 2009 }, { title: 'Measured measurement', authors: ['Aspelmeyer, Markus'], year: 2009 }, { titleThreshold: STRICT_TITLE_JW });
  assert.deepEqual(near.failing, ['title']);
});
