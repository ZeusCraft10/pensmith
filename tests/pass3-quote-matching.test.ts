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
import { runPass3Unit, shortQuoteFound } from '../bin/lib/verify/pass3.js';
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
  assert.equal(shortQuoteFound('did not reduce mortality', SOURCE), true);
  assert.equal(shortQuoteFound('did reduce mortality', SOURCE), false);
  assert.equal(shortQuoteFound('by 2.4 days', SOURCE), true);
  assert.equal(shortQuoteFound('by 2.5 days', SOURCE), false);
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

/** About `pages` pages of deterministic, varied prose. */
function longText(pages: number): string {
  const words = ('the of and a to in is was for that on with as by at from this which be are were an have has not or ' +
    'cohort treatment effect patients mortality trial analysis results sample study model data control group risk ' +
    'outcome baseline estimate variance significant measure response follow-up survey participants evidence method').split(' ');
  let seed = 42;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const out: string[] = [];
  for (let p = 0; p < pages; p += 1) {
    for (let s = 0; s < 30; s += 1) {
      const n = 8 + (next() % 20);
      const sentence: string[] = [];
      for (let w = 0; w < n; w += 1) sentence.push(words[next() % words.length]!);
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
