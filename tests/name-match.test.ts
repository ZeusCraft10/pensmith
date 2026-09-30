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
  isCorporateAuthor,
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
  ['Qi, Lin', 'Lin, Qi', 'family and given deposited the other way round (Crossref, live e2e recording: 10.1109/SSITCON66133.2025.11342115)'],
  ['Xiulian, Du', 'Du, Xiulian', 'the same swap (10.1109/PEEEC67807.2025.00045)'],
  ['Qi, Lin', 'Lin, Q.', 'the swap cited with an initial'],
  ['Qi, Lin', 'Lin Qi', 'the swap against a display name'],
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
    // A swap matches only when BOTH parts match crosswise.
    ['Qi, Lin', 'Lin, Wei'],
    ['Qi, Lin', 'Wang, Qi'],
    ['Qi, Lin', 'Lin, M.'],
    // Two initials never match crosswise: a different person (the second author cited as first).
    ['Smith, J.', 'Jones, S.'],
    ['Wang, L.', 'Li, W.'],
    ['Wang L', 'Li W'],
  ] as const) {
    assert.ok(authorSimilarity(a, b) < AUTHOR_JW_THRESHOLD, `${a} vs ${b}: ${authorSimilarity(a, b)}`);
  }
  assert.deepEqual(surnameForms('et al.'), []);
  assert.equal(authorSimilarity('', 'Smith, J.'), 0);
});

test('VRFY-13: a record whose authors are "Wang, L." and "Li, W." cited with "Li, W." first is MIS-CITED (first author), not OK crosswise', () => {
  const m = matchWork({ title: 'Deep learning', authors: ['Jones, S.'], year: 2015 }, { title: 'Deep learning', authors: ['Smith, J.'], year: 2015 });
  assert.equal(m.ok, false);
  assert.deepEqual(m.failing, ['first author']);
  const w = matchWork({ title: 'A study', authors: ['Li, W.', 'Wang, L.'], year: 2020 }, { title: 'A study', authors: ['Wang, L.', 'Li, W.'], year: 2020 });
  assert.deepEqual(w.failing, ['first author']);
  // A spelled-out given name on one side still reads crosswise.
  assert.equal(matchWork({ title: 'A study', authors: ['Lin, Q.'], year: 2020 }, { title: 'A study', authors: ['Qi, Lin'], year: 2020 }).ok, true);
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
  // Crossref deposits the ESL book's main title only (no subtitle anywhere): a BOOK record may omit it.
  assert.equal(titleSimilarity({ title: 'The Elements of Statistical Learning', type: 'book' }, 'The Elements of Statistical Learning: Data Mining, Inference, and Prediction'), 1);
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

test('VRFY-13 (review round 2): a subtitle the citation adds must be the record\'s — the claimed title is compared whole, except against a book record with no subtitle; the metadata search always compares it whole', () => {
  // An invented subtitle on a journal / conference record: MIS-CITED (title).
  const invented = matchWork({ title: 'Attention Is All You Need: Why Recurrence Still Wins', authors: ['Vaswani, Ashish'], year: 2017 }, { title: 'Attention is all you need', authors: ['Vaswani, Ashish'], year: 2017, type: 'paper-conference' });
  assert.equal(invented.ok, false);
  assert.deepEqual(invented.failing, ['title']);
  assert.equal(titleSimilarity({ title: 'Deep learning' }, 'Deep learning: a review'), titleSimilarity({ title: 'Deep learning' }, 'Deep learning: a review', true), 'no record type: whole');
  assert.ok(titleSimilarity({ title: 'Deep learning' }, 'Deep learning: a review') < TITLE_JW_THRESHOLD);
  // The record's subtitle may be left out by the citation (the record's main title counts).
  assert.equal(matchWork({ title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 }, { title: 'Deep learning: a review', authors: ['LeCun, Yann'], year: 2015 }).ok, true);
  // A record that carries its own subtitle: the claimed title is compared whole against it.
  assert.equal(matchWork({ title: 'Deep learning: a review', authors: ['LeCun, Yann'], year: 2015 }, { title: 'Deep learning', subtitle: 'a review', authors: ['LeCun, Yann'], year: 2015 }).ok, true);
  assert.equal(matchWork({ title: 'Deep learning: a fake subtitle about bananas', authors: ['LeCun, Yann'], year: 2015 }, { title: 'Deep learning', subtitle: 'a review', authors: ['LeCun, Yann'], year: 2015, type: 'book' }).ok, false, 'a book record WITH a subtitle: the claimed one must be it');
  // The metadata search (no identifier anchors it): "Introduction: …" never matches a record titled "Introduction".
  const intro = matchWork(
    { title: 'Introduction: The Politics of Climate Adaptation in Coastal Cities', authors: ['Smith, John'], year: 2019 },
    { title: 'Introduction', authors: ['Smith, John'], year: 2020, type: 'book' },
    { titleThreshold: STRICT_TITLE_JW, strictTitle: true },
  );
  assert.equal(intro.ok, false);
  assert.deepEqual(intro.failing, ['title']);
});

test('VRFY-13 (review round 2): a consortium cited as the journal prints it — matched against every group the record lists, or, when the record lists persons only, by a strict title and the year', () => {
  const persons = Array.from({ length: 40 }, (_, i) => `Person${i}, A.`);
  // LIGO: Crossref lists the collaboration after 1,011 people.
  const ligo = matchWork(
    { title: 'Observation of Gravitational Waves from a Binary Black Hole Merger', authors: ['{LIGO Scientific Collaboration and Virgo Collaboration}'], year: 2016 },
    { title: 'Observation of Gravitational Waves from a Binary Black Hole Merger', authors: ['Abbott, B. P.', ...persons, '{LIGO Scientific Collaboration and Virgo Collaboration}'], year: 2016 },
  );
  assert.equal(ligo.ok, true, ligo.detail);
  assert.ok(ligo.authorJW >= 0.99);
  // CMS / ATLAS / GBD 2019: persons only at Crossref — the strict title and the year.
  for (const [who, title, year] of [
    ['{CMS Collaboration}', 'Observation of a new boson at a mass of 125 GeV with the CMS experiment at the LHC', 2012],
    ['Collaboration, CMS', 'Observation of a new boson at a mass of 125 GeV with the CMS experiment at the LHC', 2012],
    ['{ATLAS Collaboration}', 'Observation of a new particle in the search for the Standard Model Higgs boson with the ATLAS detector at the LHC', 2012],
    ['{GBD 2019 Diseases and Injuries Collaborators}', 'Global burden of 369 diseases and injuries in 204 countries and territories, 1990–2019: a systematic analysis for the Global Burden of Disease Study 2019', 2020],
  ] as const) {
    const m = matchWork({ title, authors: [who], year }, { title, authors: ['Chatrchyan, S.', ...persons], year });
    assert.equal(m.ok, true, `${who}: ${m.detail}`);
    assert.match(m.detail, /a consortium author, and the record lists its members only: title and year matched strictly/);
  }
  // Still MIS-CITED: another group, a wrong year, a looser title, a person's name.
  const other = matchWork({ title: 'A title', authors: ['{ATLAS Collaboration}'], year: 2012 }, { title: 'A title', authors: ['Aad, G.', '{CMS Collaboration}'], year: 2012 });
  assert.deepEqual(other.failing, ['first author'], 'the record names another group');
  const year = matchWork({ title: 'A long enough title of a physics paper', authors: ['{CMS Collaboration}'], year: 2015 }, { title: 'A long enough title of a physics paper', authors: persons, year: 2012 });
  assert.deepEqual(year.failing, ['first author', 'year']);
  const loose = matchWork({ title: 'Observation of a new boson at the LHC', authors: ['{CMS Collaboration}'], year: 2012 }, { title: 'Observation of a new boson at a mass of 125 GeV with the CMS experiment at the LHC', authors: persons, year: 2012 });
  assert.ok(loose.failing.includes('first author'), 'below the strict title: the group claim is not taken on trust');
  assert.equal(matchWork({ title: 'A title', authors: ['Nobody, Nora'], year: 2012 }, { title: 'A title', authors: persons, year: 2012 }).ok, false, 'a person\'s name never passes by title');
  assert.equal(isCorporateAuthor('{The ENCODE Project Consortium}'), true);
  assert.equal(isCorporateAuthor('Smith, John'), false);
});
