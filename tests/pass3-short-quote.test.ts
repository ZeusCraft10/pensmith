// tests/pass3-short-quote.test.ts — a short quotation (three to nine words)
// must appear word for word in the source, and an ellipsis marks words left
// out of one sentence.
//
// The exact check compared the whole quotation, ellipsis included, so a
// faithful `"the effect ... is robust"` was NOT_FOUND. Then the parts around
// an ellipsis were looked for anywhere later in the source, so parts of two
// distant sentences passed as one quotation that reversed the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortQuoteFound } from '../bin/lib/verify/pass3.js';
import { extractQuotes } from '../bin/lib/quote-extractor.js';

const SOURCE = 'In every cohort we studied, the effect of the treatment is robust to the choice of baseline.';

test('short quote: found word for word, ignoring case', () => {
  assert.equal(shortQuoteFound('The effect of the treatment', SOURCE), true);
});

test('short quote: one changed word is not found', () => {
  assert.equal(shortQuoteFound('the effect of the drug', SOURCE), false);
});

test('short quote: an ellipsis, in any spelling, joins parts that appear in order', () => {
  for (const q of ['the effect ... is robust', 'the effect … is robust', 'the effect [...] is robust', 'the effect...is robust']) {
    assert.equal(shortQuoteFound(q, SOURCE), true, q);
  }
});

test('short quote: parts around an ellipsis in the wrong order, or one changed, are not found', () => {
  assert.equal(shortQuoteFound('is robust ... the effect', SOURCE), false);
  assert.equal(shortQuoteFound('the effect ... is weak', SOURCE), false);
});

// An ellipsis may only stand for a few words of the same sentence. Matched
// anywhere after the last part, two parts taken from distant sentences read
// as one quotation that says the opposite of the source.
const SPLICE_SOURCE = 'We found the treatment effective in most cohorts. ' +
  'The cohorts differed in age and baseline risk. '.repeat(240) +
  'Earlier work reported that the placebo was ineffective.';

test('short quote: parts around an ellipsis far apart in the source are not found', () => {
  assert.equal(shortQuoteFound('the treatment ... was ineffective', SPLICE_SOURCE), false);
  // Far apart with no full stop between them, as in text extracted from a
  // table or a page without punctuation.
  const runOn = 'the treatment ' + 'and the cohorts and the sites '.repeat(8) + 'was ineffective';
  assert.equal(shortQuoteFound('the treatment ... was ineffective', runOn), false);
  const close = 'the treatment ' + 'and the cohorts and the sites '.repeat(2) + 'was ineffective';
  assert.equal(shortQuoteFound('the treatment ... was ineffective', close), true);
});

test('short quote: parts around an ellipsis taken from different sentences are not found', () => {
  const near = 'We found the treatment effective. The placebo was ineffective.';
  assert.equal(shortQuoteFound('the treatment ... was ineffective', near), false);
  assert.equal(shortQuoteFound('the treatment … was ineffective', near), false);
});

test('short quote: a one-word part around an ellipsis is too little to place', () => {
  const src = 'Nothing about the drug was conclusive; it is unclear whether any of it is safe.';
  assert.equal(shortQuoteFound('the drug ... is ... safe', src), false);
});

test('short quote: parts match whole words only', () => {
  assert.equal(shortQuoteFound('he effect of the', SOURCE), false);
  assert.equal(shortQuoteFound('the effect of the treat', SOURCE), false);
  assert.equal(shortQuoteFound('he effect ... is robust', SOURCE), false);
});

test('short quote: an ellipsis is not a word, so two words around one are too few', () => {
  assert.equal(shortQuoteFound('effect ... robust', SOURCE), false);
  assert.equal(shortQuoteFound('... is robust ...', SOURCE), false);
});

test('short quote: a faithful ellipsis within one sentence is still found', () => {
  // `e.g.` and `Fig.` are not sentence ends.
  const src = 'The effect, as e.g. Smith and Lee showed in Fig. 2 across three sites, is robust to the choice of baseline.';
  assert.equal(shortQuoteFound('the effect ... is robust', src), true);
  assert.equal(shortQuoteFound('... is robust to the choice', src), true);
  // Punctuation the omission left behind does not count against the quote.
  assert.equal(shortQuoteFound('the effect, ... is robust', src), true);
});

test('short quote: the quotation Pass 3 checks exactly is not found when spliced', () => {
  const [q] = extractQuotes('As reported, "the treatment ... was ineffective" [@smith2020, p. 4].');
  assert.equal(q?.citekey, 'smith2020');
  assert.equal(q?.exact, true);
  assert.equal(shortQuoteFound(q!.text, SPLICE_SOURCE), false);
});

test('short quote: an ellipsis is not counted as a quoted word', () => {
  // Nine words and one ellipsis: a short quotation, checked part by part.
  const [q] = extractQuotes('They found "the effect ... is robust to the choice of baseline" [@k].');
  assert.equal(q?.exact, true);
});
