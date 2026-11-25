// tests/verdict-rows-keys.test.ts — every key verify writes into a verdict row
// is read back by the parser compile, done and revise use.
//
// The parser used to read a key as `[a-z][a-z0-9_-]*`, so a FABRICATED row for
// a Pandoc key with `.`, `/`, `:` or `+` parsed as no row and compiled. A row
// key that is text from the draft can hold a line break or ` ("`; either one
// also used to drop the row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVerdictRows,
  parseVerdictRowDetails,
  renderPass1VerdictRow,
  renderPass3VerdictRow,
} from '../bin/lib/verify/verdict-rows.js';

const PUNCTUATED = ['ghost.2099:v2', 'a/b+c', 'Key:Sub', 'doe#1$x', 'w~x<y>z?q', 'a-b_c&d%e'];

test('verdict rows: a FABRICATED Pass-1 row blocks whatever Pandoc key characters its key holds', () => {
  const md = ['Status: failed', '', ...PUNCTUATED.map((k) => renderPass1VerdictRow(k, 'FABRICATED', 0, 0, 'not in CITATIONS.bib'))].join('\n');
  assert.deepEqual(parseVerdictRows(md), PUNCTUATED);
});

test('verdict rows: a NOT_FOUND Pass-3 row blocks whatever Pandoc key characters its key holds', () => {
  const md = PUNCTUATED.map((k) => renderPass3VerdictRow(k, 'the effect is robust: **always**', 'NOT_FOUND', 0.2, 'quote not found')).join('\n');
  assert.deepEqual(parseVerdictRows(md), PUNCTUATED);
});

test('verdict rows: a row whose key holds a line break is written on one line and still blocks', () => {
  const md = [
    renderPass1VerdictRow('Engel and\nFleming (2007)', 'RAW_CITATION', 0, 0, 'typed as text'),
    renderPass1VerdictRow('[@ smith\r\n2020]', 'UNPARSEABLE', 0, 0, 'no key\nthat parses'),
    renderPass3VerdictRow('k', 'a quote\nthat wraps', 'NOT_FOUND', 0, 'not\nfound'),
  ].join('\n');
  assert.equal(md.split('\n').length, 3, md);
  assert.deepEqual(parseVerdictRows(md), ['Engel and Fleming (2007)', '[@ smith 2020]', 'k']);
});

test('verdict rows: a Pass-1 key holding ` ("` is still read as a Pass-1 row', () => {
  const row = renderPass1VerdictRow('[@ smith ("the effect")]', 'UNPARSEABLE', 0, 0, 'no key that parses');
  assert.deepEqual(parseVerdictRowDetails(row).map((r) => [r.citekey, r.verdict, r.blocking]), [
    ['[@ smith ("the effect")]', 'UNPARSEABLE', true],
  ]);
});
