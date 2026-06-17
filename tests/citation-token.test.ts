// tests/citation-token.test.ts — RED (Wave 0) specs for bin/lib/citation-token.ts.
//
// The shared citation-token helpers factored out of verify/pass1.ts:187 +
// citekey.ts:25 so the compile smoother (Plan 05) can substitute the SAME
// token family the verifier extracts. Regex literal is LOCKED to the
// existing pass1.ts extraction regex: /\[@([a-z][a-z0-9_-]*)\]/g.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITATION_TOKEN_RE,
  extractCitekeys,
  replaceCitekeys,
} from '../bin/lib/citation-token.js';

test('CITATION_TOKEN_RE is the locked bare-citekey regex (global)', () => {
  // Same literal as bin/lib/verify/pass1.ts:187.
  assert.equal(CITATION_TOKEN_RE.source, '\\[@([a-z][a-z0-9_-]*)\\]');
  assert.ok(CITATION_TOKEN_RE.global, 'regex must carry the global flag');
});

test('extractCitekeys returns citekeys in first-appearance order, deduped', () => {
  const md = 'text [@smith2020] and [@jones-2019], again [@smith2020].';
  assert.deepEqual(extractCitekeys(md), ['smith2020', 'jones-2019']);
});

test('extractCitekeys returns [] when no tokens are present', () => {
  assert.deepEqual(extractCitekeys('no citations here'), []);
});

test('replaceCitekeys swaps every [@key] via the callback', () => {
  const md = 'see [@smith2020] and [@jones-2019]';
  const out = replaceCitekeys(md, (key) => `<<${key}>>`);
  assert.equal(out, 'see <<smith2020>> and <<jones-2019>>');
});

test('replaceCitekeys round-trips when the callback re-emits the token', () => {
  const md = 'a [@smith2020] b [@jones-2019] c';
  const out = replaceCitekeys(md, (key) => `[@${key}]`);
  assert.equal(out, md);
});

test('the {{cite_K_M}} placeholder family is DISJOINT from CITATION_TOKEN_RE', () => {
  // D-13: smoother substitutes [@key] -> {{cite_K_M}}; the placeholder must
  // not itself be matched as a citation token (no collision by construction).
  const placeholder = 'transition {{cite_0_1}} and {{cite_1_2}} end';
  assert.deepEqual(extractCitekeys(placeholder), []);
  // A fresh-lastIndex test against the placeholder string.
  assert.equal(new RegExp(CITATION_TOKEN_RE.source, 'g').test(placeholder), false);
});

test('replaceCitekeys does not touch placeholder tokens', () => {
  const md = '[@smith2020] then {{cite_0_1}}';
  const out = replaceCitekeys(md, () => 'X');
  assert.equal(out, 'X then {{cite_0_1}}');
});
