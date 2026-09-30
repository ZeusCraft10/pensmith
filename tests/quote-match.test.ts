// tests/quote-match.test.ts — Pass 3's quote matcher (fuzzy.ts matchQuote,
// VRFY-19): an editorial bracket or an elision never changes what the source
// says (review round 3). Every part of such a quote is verbatim, so only the
// bracket's text and the source text an elision skips can show it.
//
//   - a bracket that inserts a negation ("[did not]", "[not]", "[Not]") the
//     source does not have there, stands in for a negation it drops
//     ("[did]" over "do not"), or adds a number the source does not have
//     there, is refused, naming it;
//   - an elision that skips a negation of the sentence ("the trial ... show"
//     over "the trial do not show") is refused; a whole elided sentence with a
//     negation in it says nothing about the quoted parts;
//   - brackets that keep the source's meaning ("[the]", "[T]he", "[sic]",
//     "[did not]" over "do not") still pass verbatim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchQuote, quoteMatched } from '../bin/lib/fuzzy.js';

const SRC = 'In our cohort, the results of the randomized trial show a clear reduction in overall mortality among treated patients.';
const NEG = 'In our cohort, the results of the randomized trial do not show a clear reduction in overall mortality among treated patients.';

test('review round 3: a bracket that adds a negation or a number, or stands in for a negation, is refused naming it — never a verbatim PASS', () => {
  for (const [quote, source, why] of [
    ['the results of the randomized trial [did not] show a clear reduction in overall mortality', SRC, /the editorial bracket "\[did not\]" adds "not", which the source does not say there/],
    ['the results of the randomized trial [not] show a clear reduction in overall mortality', SRC, /adds "not"/],
    ['[Not] the results of the randomized trial show a clear reduction', SRC, /adds "not"/],
    ['the results of the randomized trial [did] show a clear reduction in overall mortality', NEG, /the editorial bracket "\[did\]" stands in for "not" in the source/],
    ['the results of the [2019] randomized trial show a clear reduction in overall mortality', SRC, /adds the number 2019/],
  ] as const) {
    const m = matchQuote(quote, source);
    assert.equal(m.verbatim, false, quote);
    assert.equal(quoteMatched(m), false, quote);
    assert.match(m.refused ?? '', why, quote);
  }
});

test('review round 3: an elision that skips a negation of the quoted sentence is refused; one that skips a whole sentence is not', () => {
  const m = matchQuote('the results of the randomized trial ... show a clear reduction in overall mortality', NEG);
  assert.equal(quoteMatched(m), false);
  assert.match(m.refused ?? '', /its elision drops "not" from the source/);
  const nt = matchQuote('the results of the randomized trial ... show a clear reduction', 'In our cohort, the results of the randomized trial don\'t show a clear reduction.');
  assert.match(nt.refused ?? '', /its elision drops "don't"/);
  const whole = 'The treatment was well tolerated. We did not observe severe adverse events in the first week. Overall, the results of the trial show a clear reduction in mortality.';
  assert.deepEqual(matchQuote('The treatment was well tolerated ... the results of the trial show a clear reduction in mortality', whole), { verbatim: true, ratio: 1 });
});

test('review round 3: brackets that keep the meaning still pass verbatim', () => {
  for (const [quote, source] of [
    ['the results of the randomized trial show a clear reduction in overall mortality', SRC],
    ['[the] results of the randomized trial show a clear reduction in overall mortality', SRC],
    ['[T]he results of the randomized trial show a clear reduction', SRC],
    ['the results of the randomized trial show a clear reduction [sic] in overall mortality', SRC],
    ['the results of the randomized trial [did not] show a clear reduction in overall mortality', NEG],
    ['In our cohort ... the randomized trial show a clear reduction in overall mortality', SRC],
  ] as const) {
    assert.deepEqual(matchQuote(quote, source), { verbatim: true, ratio: 1 }, quote);
  }
});
