// tests/pass3-short-quote.test.ts — a short quotation (three to nine words)
// must appear word for word in the source, and an ellipsis marks words left
// out.
//
// The exact check compared the whole quotation, ellipsis included, so a
// faithful `"the effect ... is robust"` was NOT_FOUND.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortQuoteFound } from '../bin/lib/verify/pass3.js';

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
