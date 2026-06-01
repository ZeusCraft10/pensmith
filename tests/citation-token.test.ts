/**
 * tests/citation-token.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitekeys, replaceCitekeys, CITATION_TOKEN_RE } from '../bin/lib/citation-token.js';

test('extractCitekeys: returns deduped citekeys in order', () => {
  const md = 'See [@smith2020] and [@jones2019]. Also [@smith2020] again.';
  const result = extractCitekeys(md);
  assert.deepEqual(result, ['smith2020', 'jones2019']);
});

test('replaceCitekeys: swaps each [@key] via callback', () => {
  const md = 'See [@smith2020] and [@jones2019].';
  const result = replaceCitekeys(md, (key) => `{{${key.toUpperCase()}}}`);
  assert.equal(result, 'See {{SMITH2020}} and {{JONES2019}}.');
});

test('CITATION_TOKEN_RE: does not match placeholders', () => {
  const placeholder = '{{cite_1_1}}';
  assert.ok(!CITATION_TOKEN_RE.test(placeholder));
});

test('extractCitekeys: handles no citations', () => {
  assert.deepEqual(extractCitekeys('no citations here'), []);
});
