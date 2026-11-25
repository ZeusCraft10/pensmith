// tests/pass3-quote-matching.test.ts — a quotation matches its source word for
// word, allowing standard quoting practice and PDF extraction noise, never a
// changed word.
//
// Pass 3 used a 0.95 character-level similarity: a 267-character quotation
// could absorb 13 edits, so an inserted "not", a changed number or an antonym
// passed as OK. The same matcher read an ellipsis, a bracketed insertion or an
// omitted reference marker as a mismatch and blocked faithful quotations, and
// it ran a full edit-distance table at every offset of the source, which took
// seconds to minutes per quotation on a long paper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPass3Unit } from '../bin/lib/verify/pass3.js';
import { matchQuote, prepareSource } from '../bin/lib/verify/quote-match.js';
import { extractPdfText } from '../bin/lib/pdf-text.js';

const verdict = (quote: string, source: string): string => runPass3Unit({ claimedQuote: quote, pdfText: source }).verdict;

const SOURCE =
  'Across all twelve cohorts, the treatment did not reduce mortality in patients over 65 years of age, ' +
  'although it shortened the hospital stay by 2.4 days on average [14]. The effect on younger patients was ' +
  'small but consistent, and no serious adverse events were reported during the follow-up period.';

// ---------------------------------------------------------------------------
// A changed word is never accepted
// ---------------------------------------------------------------------------

test('a one-word misquotation that reverses the meaning is NOT_FOUND', () => {
  const misquotes = [
    // the negation dropped
    'Across all twelve cohorts, the treatment did reduce mortality in patients over 65 years of age',
    // a negation added
    'The effect on younger patients was not small but consistent, and no serious adverse events were reported',
    // an antonym
    'The effect on younger patients was large but consistent, and no serious adverse events were reported',
    // a changed number
    'although it shortened the hospital stay by 4.2 days on average',
    'Across all twelve cohorts, the treatment did not reduce mortality in patients over 55 years of age',
    // one word replaced, one dropped, one added
    'Across all twelve cohorts, the drug did not reduce mortality in patients over 65 years of age',
    'Across all twelve cohorts, the treatment did not reduce mortality in patients 65 years of age',
    'Across all twelve cohorts, the new treatment did not reduce mortality in patients over 65 years of age',
    // spliced from both sentences without an ellipsis
    'the treatment did not reduce mortality and no serious adverse events were reported',
  ];
  for (const q of misquotes) assert.equal(verdict(q, SOURCE), 'NOT_FOUND', q);
});

test('a quotation made of a source that only shares letters is NOT_FOUND', () => {
  // A run-together word is accepted for PDF spacing noise, but never across a negation.
  assert.equal(verdict('the result was notable in every cohort we studied', 'In short, the result was not able in every cohort we studied.'), 'NOT_FOUND');
  assert.equal(verdict('the result was not able in every cohort we studied', 'In short, the result was notable in every cohort we studied.'), 'NOT_FOUND');
  assert.equal(verdict('a cure for the disease is now here, the authors said', 'A cure for the disease is nowhere, the authors said.'), 'NOT_FOUND');
});

test('a quotation must start and end on whole words of the source', () => {
  assert.equal(verdict('he treatment did not reduce mortality in patients', SOURCE), 'NOT_FOUND');
  assert.equal(verdict('the treatment did not reduce mortality in patient', SOURCE), 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Standard quoting practice is accepted
// ---------------------------------------------------------------------------

test('a faithful quotation is OK, ignoring case, punctuation and quote marks', () => {
  assert.equal(verdict('across all twelve cohorts the treatment did not reduce mortality in patients over 65 years of age', SOURCE), 'OK');
  assert.equal(verdict('The effect on younger patients was “small but consistent,” and no serious adverse events were reported', SOURCE), 'OK');
});

test('an ellipsis leaves out words within a sentence; each part must appear in order', () => {
  assert.equal(verdict('Across all twelve cohorts, the treatment did not reduce mortality ... although it shortened the hospital stay', SOURCE), 'OK');
  assert.equal(verdict('The effect on younger patients was small … and no serious adverse events were reported', SOURCE), 'OK');
  assert.equal(verdict('The effect on younger patients was small [...] and no serious adverse events were reported', SOURCE), 'OK');
  // Parts in the wrong order, or one part changed.
  assert.equal(verdict('no serious adverse events were reported ... The effect on younger patients was small', SOURCE), 'NOT_FOUND');
  assert.equal(verdict('The effect on younger patients was small ... and serious adverse events were reported', SOURCE), 'NOT_FOUND');
});

test('an ellipsis may not leave out a negation with only a word or two around it', () => {
  // "did ... reduce" for "did not reduce" reverses the source.
  assert.equal(verdict('Across all twelve cohorts, the treatment did ... reduce mortality in patients over 65 years of age', SOURCE), 'NOT_FOUND');
  assert.equal(verdict('The effect on younger patients was small but consistent, and ... serious adverse events were reported', SOURCE), 'NOT_FOUND');
  // A clause that happens to hold a negation may be left out.
  const clause = 'The vaccine, which was not tested in children under five at any of the sites, proved safe for adults.';
  assert.equal(verdict('The vaccine ... proved safe for adults', clause), 'OK');
});

test('an ellipsis between longer parts may leave out a sentence, but not a whole page', () => {
  // Five or more quoted words on each side: the omission may cross a sentence end.
  assert.equal(verdict('the treatment did not reduce mortality in patients over 65 years of age ... The effect on younger patients was small but consistent', SOURCE), 'OK');
  const far = `${SOURCE} ${'Further cohorts were recruited at three new sites during the second year. '.repeat(30)}The final analysis confirmed the earlier estimate.`;
  assert.equal(verdict('the treatment did not reduce mortality in patients over 65 years of age ... The final analysis confirmed the earlier estimate', far), 'NOT_FOUND');
});

test('a bracketed insertion or replacement, [sic] and a capital in brackets are accepted', () => {
  assert.equal(verdict('Across all twelve cohorts, the treatment [a beta blocker] did not reduce mortality in patients over 65', SOURCE), 'OK');
  assert.equal(verdict('[The trial] shortened the hospital stay by 2.4 days on average', SOURCE), 'OK');
  assert.equal(verdict('[T]he effect on younger patients was small but consistent', SOURCE), 'OK');
  assert.equal(verdict('The effect on younger patients was small [sic] but consistent, and no serious adverse events', SOURCE), 'OK');
  assert.equal(verdict('The effect on [them] was small but consistent, and no serious adverse events were reported', SOURCE), 'OK');
  // A bracket may stand for a few words, never for a negation or a number, and not for a clause.
  assert.equal(verdict('Across all twelve cohorts, the treatment [did] reduce mortality in patients over 65 years of age', SOURCE), 'NOT_FOUND');
  assert.equal(verdict('the treatment did not reduce mortality in patients over [70] years of age', SOURCE), 'NOT_FOUND');
  assert.equal(verdict('the treatment did not reduce mortality [overall], although it shortened the hospital stay', SOURCE), 'NOT_FOUND');
});

// A bracketed number list and a superscript were dropped from both texts as
// reference and footnote markers, so a changed bound ("[0, 2]" for "[0, 1]")
// or unit ("m³" for "m²") passed. A quotation that keeps them is now compared
// with them.
test('a quotation that keeps a bracketed number list or a superscript must match it', () => {
  const interval = 'We show that the solution lies in the interval [0, 1] for every input.';
  assert.equal(verdict('the solution lies in the interval [0, 2] for every input', interval), 'NOT_FOUND');
  assert.equal(verdict('the solution lies in the interval [0, 1] for every input', interval), 'OK');
  assert.equal(verdict('the tank holds 10 m³ of water at most', 'The tank holds 10 m² of water at most.'), 'NOT_FOUND');
  assert.equal(verdict('the tank holds 10 m² of water at most', 'The tank holds 10 m² of water at most.'), 'OK');
  // pdf.js extracts a raised digit as a plain one.
  assert.equal(verdict('the tank holds 10 m² of water at most', 'The tank holds 10 m2 of water at most.'), 'OK');
  assert.equal(verdict('the tank holds 10 m2 of water at most', 'The tank holds 10 m3 of water at most.'), 'NOT_FOUND');
});

// A quotation that kept one marker was compared with every marker of the
// source, so leaving out another reference marker, as quoting allows, read
// NOT_FOUND. Each marker the quotation keeps must stand at the same place in
// the source; the source's others may still be left out.
test('a quotation that keeps one marker may leave out the others', () => {
  const interval = 'We prove that the function maps [0, 1] onto itself [7] and is continuous on its domain.';
  assert.equal(verdict('the function maps [0, 1] onto itself and is continuous', interval), 'OK');
  assert.equal(verdict('the function maps [0, 1] onto itself [7] and is continuous', interval), 'OK');
  assert.equal(verdict('the function maps [0, 2] onto itself and is continuous', interval), 'NOT_FOUND');
  // A kept number must be the one at that place, not one found elsewhere.
  assert.equal(verdict('the function maps [7] onto itself and is continuous', interval), 'NOT_FOUND');
  assert.equal(verdict('the function maps onto itself [0, 1] and is continuous', interval), 'NOT_FOUND');

  const cited = 'The drug works well in adults [3] and is safe in children [4].';
  assert.equal(verdict('the drug works well in adults and is safe in children [4]', cited), 'OK');
  assert.equal(verdict('the drug works well in adults [3] and is safe in children', cited), 'OK');
  assert.equal(verdict('the drug works well in adults and is safe in children [3]', cited), 'NOT_FOUND');

  const tank = 'The tank holds 10 m² of water.² It leaks slowly.';
  assert.equal(verdict('the tank holds 10 m² of water. It leaks slowly', tank), 'OK');
  assert.equal(verdict('the tank holds 10 m² of water.² It leaks slowly', tank), 'OK');
  assert.equal(verdict('the tank holds 10 m³ of water. It leaks slowly', tank), 'NOT_FOUND');

  // pdf.js put the footnote number on a line of its own, or ran it into the text.
  assert.equal(verdict('The drug works well in adults.¹ It is safe in children', 'The drug works well in adults.\n1\nIt is safe in children.'), 'OK');
  assert.equal(verdict('The drug works well in adults.¹ It is safe in children', 'The drug works well in adults.1 It is safe in children.'), 'OK');
  assert.equal(verdict('The drug works well in adults.² It is safe in children', 'The drug works well in adults.\n1\nIt is safe in children.'), 'NOT_FOUND');

  // The reason no longer says the kept number is missing when it is there.
  const r = matchQuote('the function maps [0, 1] onto itself and is not continuous', interval);
  assert.equal(r.found, false);
  assert.match(r.reason, /must stand at the same place in the source/);
});

// "not only A but also B" says B; an ellipsis that leaves out the whole "not
// only A but also" reverses nothing. A negation the quotation needs is still
// refused, and the reason names it.
test('an ellipsis may leave out "not only ... but also", and the reason names a negation it may not leave out', () => {
  const both = 'The intervention not only reduced pain but also improved quality of life.';
  assert.equal(verdict('The intervention ... improved quality of life', both), 'OK');
  assert.equal(verdict('The intervention ... reduced pain', both), 'NOT_FOUND');
  assert.equal(verdict('The intervention ... only reduced pain but also improved quality of life', both), 'NOT_FOUND');
  assert.equal(
    verdict('The drug ... improved quality of life', 'The drug not only failed to reduce pain but did not improve quality of life.'),
    'NOT_FOUND',
  );
  // A restrictive "with no" stays refused: "Patients treated ... improved" for
  // "Patients treated with no drug improved" says the opposite.
  assert.equal(verdict('Patients treated ... improved within a week', 'Patients treated with no drug improved within a week.'), 'NOT_FOUND');

  const r = matchQuote('The vaccine was ... safe for adults', 'The vaccine was not found to be safe for adults.');
  assert.equal(r.found, false);
  assert.match(r.reason, /would leave out "not"/);
  const c = matchQuote('The treatment ... reduce mortality in patients', "The treatment didn't reduce mortality in patients.");
  assert.match(c.reason, /would leave out "didn't"/);
});

// A bracket is the author's words, so a "[not]" the source lacks reverses it.
// An ellipsis that leaves out a negation in the same clause as a quoted part
// reverses it too, however many words it leaves out; a whole clause set off by
// commas or parentheses may go.
test('a bracketed negation, or an ellipsis that leaves out a negation in a quoted clause, is NOT_FOUND', () => {
  assert.equal(verdict('The treatment did [not] reduce mortality in patients', 'The treatment did reduce mortality in patients over 65.'), 'NOT_FOUND');
  assert.equal(verdict('The vaccine was ... safe for adults', 'The vaccine was not found to be safe for adults.'), 'NOT_FOUND');
  assert.equal(verdict('It is ... effective in adults', 'It is not, in our view, effective in adults.'), 'NOT_FOUND');
  assert.equal(verdict('The treatment ... reduce mortality in patients', "The treatment didn't reduce mortality in patients."), 'NOT_FOUND');
  assert.equal(verdict('The treatment [did] reduce mortality in patients', "The treatment didn't reduce mortality in patients."), 'NOT_FOUND');
  // A clause that holds a negation, set off on both sides, may be left out.
  assert.equal(verdict('The effect was small ... and consistent across sites', 'The effect was small, not large, and consistent across sites.'), 'OK');
  assert.equal(verdict('It is ... effective in adults', 'It is, not surprisingly, effective in adults.'), 'OK');
  assert.equal(verdict('The vaccine ... proved safe for adults', 'The vaccine (not yet tested in children) proved safe for adults.'), 'OK');
});

test('a reference marker the quotation leaves out, or keeps, is accepted', () => {
  assert.equal(verdict('although it shortened the hospital stay by 2.4 days on average. The effect on younger patients was small', SOURCE), 'OK');
  assert.equal(verdict('although it shortened the hospital stay by 2.4 days on average [14]. The effect on younger patients was small', SOURCE), 'OK');
  // A footnote number pdf.js put on a line of its own.
  const footnoted = 'the treatment did not reduce\n3\nmortality in patients over 65 years of age.';
  assert.equal(verdict('the treatment did not reduce mortality in patients over 65 years of age', footnoted), 'OK');
});

test('PDF extraction noise is accepted: hyphenation, ligatures, soft hyphens, run-together words, spaced accents', () => {
  const extracted =
    'Across all twelve co-\nhorts, the treat­ment did not reduce mortality in pa-\ntients over 65 years of age, alﬁne ' +
    'butwe found that self-\nattention helps. Recam ́an asked whether the eﬀect is robust.';
  assert.equal(verdict('Across all twelve cohorts, the treatment did not reduce mortality in patients over 65 years', extracted), 'OK');
  assert.equal(verdict('but we found that self-attention helps', extracted), 'OK');
  assert.equal(verdict('Recamán asked whether the effect is robust', extracted), 'OK');
});

test('short quotations follow the same rules', () => {
  assert.equal(matchQuote('did not reduce mortality', SOURCE).found, true);
  assert.equal(matchQuote('did reduce mortality', SOURCE).found, false);
  assert.equal(matchQuote('by 2.4 days', SOURCE).found, true);
  assert.equal(matchQuote('by 2.5 days', SOURCE).found, false);
});

// ---------------------------------------------------------------------------
// The text of a real PDF
// ---------------------------------------------------------------------------

const PDF = fileURLToPath(new URL('./fixtures/cassettes/oa-pdf/arxiv-2109.00022.pdf', import.meta.url));

test('quotations of a real PDF, which pdf.js extracts with words run together and accents spaced out', async () => {
  const text = await extractPdfText(readFileSync(PDF));
  assert.equal(verdict('The famous Big-line Big-clique Conjecture, introduced by Kára, Pór, and Wood [3], states that', text), 'OK');
  assert.equal(verdict('The famous Big-line Big-clique Conjecture, introduced by Kára, Pór, and Wood, states that', text), 'OK');
  assert.equal(verdict('However, a famous construction due to Horton shows that this is false', text), 'OK');
  assert.equal(verdict('In this paper, we study a relaxed version of this question by replacing holes with visible islands', text), 'OK');
  assert.equal(verdict('In this paper, we study a relaxed version of this question by replacing islands with visible holes', text), 'NOT_FOUND');
  assert.equal(verdict('However, a famous construction due to Horton shows that this is true', text), 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/** About `pages` pages of deterministic, varied prose; with `every`, "of the" once per that many words. */
function longText(pages: number, every = 0): string {
  const words = ('the of and a to in is was for that on with as by at from this which be are were an have has not or ' +
    'cohort treatment effect patients mortality trial analysis results sample study model data control group risk ' +
    'outcome baseline estimate variance significant measure response follow-up survey participants evidence method').split(' ');
  let seed = 42;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const out: string[] = [];
  let count = 0;
  for (let p = 0; p < pages; p += 1) {
    for (let s = 0; s < 30; s += 1) {
      const n = 8 + (next() % 20);
      const sentence: string[] = [];
      for (let w = 0; w < n; w += 1) {
        count += 1;
        sentence.push(every > 0 && count % every === 0 ? 'of the' : words[next() % words.length]!);
      }
      out.push(`${sentence.join(' ')}.`);
    }
    out.push(`\n${p + 1}\n\n`);
  }
  return out.join(' ');
}

test('a 400-page source text is matched in well under a second per quotation', () => {
  const text = `${longText(400)} ${SOURCE}`;
  assert.ok(text.length > 1_000_000, `long enough (${text.length} chars)`);
  const quotes: Array<[string, string]> = [
    ['The effect on younger patients was small but consistent, and no serious adverse events were reported during the follow-up period', 'OK'],
    ['The effect on younger patients was large but consistent, and no serious adverse events were reported during the follow-up period', 'NOT_FOUND'],
    ['the treatment effect was significant in every cohort and the trial results were robust to the choice of baseline model', 'NOT_FOUND'],
    ['Across all twelve cohorts, the treatment did not reduce mortality ... although it shortened the hospital stay', 'OK'],
  ];
  for (const [q, expected] of quotes) {
    const t0 = performance.now();
    assert.equal(verdict(q, text), expected, q);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms for: ${q}`);
  }
});

// A part after an ellipsis or a bracket can only lie close to the part before
// it. It used to be searched for to the end of the source once per placement
// of the part before, so a quotation that starts with a common phrase took
// seconds on a long source.
test('a quotation whose first part is common is matched in well under a second on a 400-page source', () => {
  const text = `${longText(400, 25)} In the largest of the trials, the treatment did not reduce mortality in patients over 65 years of age.`;
  assert.ok(text.split('of the').length > 7000, 'the first part is common');
  const src = prepareSource(text);
  const repeated = prepareSource('The cohorts differed in age and baseline risk across the sites. '.repeat(20000));
  const cases: Array<[string, typeof src, boolean]> = [
    ['of the ... did not reduce mortality', src, true],
    ['of the ... did not reduce hospital stays', src, false],
    ['of the [x] reduce mortality', src, false],
    ['The cohorts differed ... baseline mortality', repeated, false],
    ['The cohorts differed [in] age and baseline mortality', repeated, false],
  ];
  for (const [q, source, found] of cases) {
    const t0 = performance.now();
    assert.equal(matchQuote(q, source).found, found, q);
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${ms.toFixed(0)} ms for: ${q}`);
  }
});
