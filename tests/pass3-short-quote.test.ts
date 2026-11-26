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
import { extractQuotes } from '../bin/lib/quote-extractor.js';
import { matchQuote } from '../bin/lib/verify/quote-match.js';

const SOURCE = 'In every cohort we studied, the effect of the treatment is robust to the choice of baseline.';

test('short quote: found word for word, ignoring case', () => {
  assert.equal(matchQuote('The effect of the treatment', SOURCE).found, true);
});

test('short quote: one changed word is not found', () => {
  assert.equal(matchQuote('the effect of the drug', SOURCE).found, false);
});

test('short quote: an ellipsis, in any spelling, joins parts that appear in order', () => {
  for (const q of ['the effect ... is robust', 'the effect … is robust', 'the effect [...] is robust', 'the effect...is robust']) {
    assert.equal(matchQuote(q, SOURCE).found, true, q);
  }
});

test('short quote: parts around an ellipsis in the wrong order, or one changed, are not found', () => {
  assert.equal(matchQuote('is robust ... the effect', SOURCE).found, false);
  assert.equal(matchQuote('the effect ... is weak', SOURCE).found, false);
});

// An ellipsis may only stand for a few words of the same sentence. Matched
// anywhere after the last part, two parts taken from distant sentences read
// as one quotation that says the opposite of the source.
const SPLICE_SOURCE = 'We found the treatment effective in most cohorts. ' +
  'The cohorts differed in age and baseline risk. '.repeat(240) +
  'Earlier work reported that the placebo was ineffective.';

test('short quote: parts around an ellipsis far apart in the source are not found', () => {
  assert.equal(matchQuote('the treatment ... was ineffective', SPLICE_SOURCE).found, false);
  // Far apart with no full stop between them, as in text extracted from a
  // table or a page without punctuation.
  const runOn = 'the treatment ' + 'and the cohorts and the sites '.repeat(8) + 'was ineffective';
  assert.equal(matchQuote('the treatment ... was ineffective', runOn).found, false);
  const close = 'the treatment ' + 'and the cohorts and the sites '.repeat(2) + 'was ineffective';
  assert.equal(matchQuote('the treatment ... was ineffective', close).found, true);
});

test('short quote: parts around an ellipsis taken from different sentences are not found', () => {
  const near = 'We found the treatment effective. The placebo was ineffective.';
  assert.equal(matchQuote('the treatment ... was ineffective', near).found, false);
  assert.equal(matchQuote('the treatment … was ineffective', near).found, false);
});

// In text extracted from a numeric-citation paper (Vancouver, IEEE), a full
// stop is often followed by its reference marker, and a heading stands
// between paragraphs with no full stop. Each still ends a sentence.
test('short quote: a sentence end before a reference marker or a heading still splits the parts', () => {
  const quote = 'the treatment ... was ineffective';
  for (const src of [
    'We found the treatment effective.[12] The placebo was ineffective.',
    'We found the treatment effective.12,13 The placebo was ineffective.',
    'We found the treatment effective.12-14 The placebo was ineffective.',
    'We found the treatment effective.(12) The placebo was ineffective.',
    'We found the treatment effective\n\nResults\n\nThe placebo was ineffective.',
    'We found the treatment effective\r\n\r\nThe placebo was ineffective.',
  ]) {
    assert.equal(matchQuote(quote, src).found, false, JSON.stringify(src));
  }
  // Numbers inside a sentence, a page break inside one, and a full stop after
  // an abbreviation or a number end nothing.
  for (const src of [
    'We found the treatment, at 2.5 mg daily, was ineffective.',
    'We found the treatment (see Section 3.2 Results) was ineffective.',
    'We found the treatment given daily\n\nwas ineffective.',
    'We found the treatment (cf. Fig.3 Top) was ineffective.',
  ]) {
    assert.equal(matchQuote(quote, src).found, true, JSON.stringify(src));
  }
});

test('short quote: a long run of blank lines or brackets in the source is read in linear time', () => {
  // A PDF of empty pages extracts as a long run of newlines; a damaged one
  // can hold a long run of any character.
  for (const run of ['\n'.repeat(200_000), `a${')'.repeat(200_000)}. The end`]) {
    const src = `We found the treatment, given daily, was ineffective.${run} and so on`;
    const t0 = performance.now();
    assert.equal(matchQuote('the treatment ... was ineffective', src).found, true);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
  }
});

test('short quote: a one-word part around an ellipsis is too little to place', () => {
  const src = 'Nothing about the drug was conclusive; it is unclear whether any of it is safe.';
  assert.equal(matchQuote('the drug ... is ... safe', src).found, false);
});

test('short quote: parts match whole words only', () => {
  assert.equal(matchQuote('he effect of the', SOURCE).found, false);
  assert.equal(matchQuote('the effect of the treat', SOURCE).found, false);
  assert.equal(matchQuote('he effect ... is robust', SOURCE).found, false);
});

test('short quote: an ellipsis is not a word, so two words around one are too few', () => {
  assert.equal(matchQuote('effect ... robust', SOURCE).found, false);
  assert.equal(matchQuote('... is robust ...', SOURCE).found, false);
});

test('short quote: a faithful ellipsis within one sentence is still found', () => {
  // `e.g.` and `Fig.` are not sentence ends.
  const src = 'The effect, as e.g. Smith and Lee showed in Fig. 2 across three sites, is robust to the choice of baseline.';
  assert.equal(matchQuote('the effect ... is robust', src).found, true);
  assert.equal(matchQuote('... is robust to the choice', src).found, true);
  // Punctuation the omission left behind does not count against the quote.
  assert.equal(matchQuote('the effect, ... is robust', src).found, true);
});

test('short quote: the quotation Pass 3 checks is not found when spliced', () => {
  const [q] = extractQuotes('As reported, "the treatment ... was ineffective" [@smith2020, p. 4].');
  assert.equal(q?.citekey, 'smith2020');
  assert.equal(matchQuote(q!.text, SPLICE_SOURCE).found, false);
});

test('short quote: an ellipsis is not counted as a quoted word', () => {
  // Nine words and one ellipsis: checked part by part when cited, and short of
  // the ten words that make an uncited quotation unattributed.
  const [q] = extractQuotes('They found "the effect ... is robust to the choice of baseline" [@k].');
  assert.equal(q?.citekey, 'k');
  assert.equal(matchQuote(q!.text, SOURCE).found, true);
  assert.deepEqual(extractQuotes('They found "the effect ... is robust to the choice of baseline".'), []);
  // Two words and an ellipsis are too few to check.
  assert.deepEqual(extractQuotes('They found "effect ... robust" [@k].'), []);
});

// The matcher checks only the quoted words outside a spaced bracket: the
// bracket is the author's own words. "[The drug] reduced mortality" quotes two
// words, like the term "reduced mortality", and is left alone the same way.
// Counting the bracketed words sent it to the matcher, which refused it as
// too short to check, and that refusal read NOT_FOUND, a blocking verdict on a
// faithful quotation.
test('short quote: two quoted words outside brackets are a term, left alone like any two-word quotation', () => {
  for (const md of [
    'The trial found that "[The drug] reduced mortality" [@k, p. 2].',
    'He conceded that "[It] was wrong" [@k].',
    'They "[the authors] [sic] agreed" [@k].',
    'They found that "reduced mortality" [@k].',
  ]) {
    assert.deepEqual(extractQuotes(md), [], md);
  }
  // Three quoted words outside the bracket are checked, and a bracket inside a word keeps its letters.
  assert.equal(extractQuotes('They found that "[The drug] reduced mortality overall" [@k].')[0]?.citekey, 'k');
  assert.equal(extractQuotes('They wrote that "[T]he drug helped" [@k].')[0]?.citekey, 'k');
});

test('short quote: a one-word part around an ellipsis says how to quote it so it can be checked', () => {
  const r = matchQuote('The drug reduced ... patients', 'The drug reduced mortality in older patients.');
  assert.equal(r.found, false);
  assert.match(r.reason, /two or more quoted words on each side of the ellipsis/);
});
