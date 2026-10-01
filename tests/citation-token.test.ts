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
  LOCATOR_TERMS,
  citationItems,
  extractCitekeys,
  findCitations,
  lineOfOffset,
  offsetInSpans,
  provableCodeSpans,
  replaceCitekeys,
  splitLocator,
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

// ---- VRFY-09 (D-20-06): citationItems gives every Pandoc form's parts ----------

const items = (md: string): Array<Record<string, unknown>> =>
  findCitations(md).flatMap(citationItems).map((i) => ({ ...i }));

test('VRFY-09: citationItems returns key, prefix, suffix, locator, label, suppress-author and narrative for every Pandoc form', () => {
  assert.deepEqual(items('[@k]'), [{ prefix: '', key: 'k', suppressAuthor: false, suffix: '', narrative: false }]);
  assert.deepEqual(items('[@k, p. 5]'), [{ prefix: '', key: 'k', suppressAuthor: false, suffix: ', p. 5', locator: '5', label: 'page', narrative: false }]);
  assert.deepEqual(items('[@k p. 5]'), [{ prefix: '', key: 'k', suppressAuthor: false, suffix: ' p. 5', locator: '5', label: 'page', narrative: false }]);
  assert.deepEqual(items('[see @k, chap. 2]'), [{ prefix: 'see', key: 'k', suppressAuthor: false, suffix: ', chap. 2', locator: '2', label: 'chapter', narrative: false }]);
  // "ch." is not one of Pandoc's locator terms (pandoc 3.9 --citeproc prints it as a suffix): no locator.
  assert.deepEqual(items('[see @k, ch. 2]'), [{ prefix: 'see', key: 'k', suppressAuthor: false, suffix: ', ch. 2', narrative: false }]);
  assert.deepEqual(items('[@a; @b]').map((i) => i['key']), ['a', 'b']);
  assert.deepEqual(items('[-@k]'), [{ prefix: '', key: 'k', suppressAuthor: true, suffix: '', narrative: false }]);
  assert.deepEqual(items('As @k argues.'), [{ prefix: '', key: 'k', suppressAuthor: false, suffix: '', narrative: true }]);
  assert.deepEqual(items('Mail x@example.org.'), [], 'an email is not a citation');
  assert.deepEqual(items('[@{Braced Key}]').map((i) => i['key']), [], 'a braced key cannot hold a space (Pandoc prints it as text)');
  assert.deepEqual(items('[@{Braced_Key}] and @{a.b}').map((i) => [i['key'], i['narrative']]), [['Braced_Key', false], ['a.b', true]]);
  assert.deepEqual(items('[@Vaswani2017]').map((i) => i['key']), ['Vaswani2017'], 'uppercase keys');
  assert.deepEqual(
    items('[@a.b; @a:b; @a#b; @a$b; @a%b; @a&b; @a+b; @a?b; @a<b; @a>b; @a~b; @a/b; @a_b]').map((i) => i['key']),
    ['a.b', 'a:b', 'a#b', 'a$b', 'a%b', 'a&b', 'a+b', 'a?b', 'a<b', 'a>b', 'a~b', 'a/b', 'a_b'],
    'the full key charset',
  );
  assert.deepEqual(items('[@k, 33-35, emphasis added]')[0], {
    prefix: '', key: 'k', suppressAuthor: false, suffix: ', 33-35, emphasis added', locator: '33-35', label: 'page', narrative: false,
  });
});

test('VRFY-09 / D-21-04: splitLocator reads the locator terms Pandoc knows; a suffix that opens with a number is a page, comma or not', () => {
  assert.deepEqual(splitLocator(', pp. 33–35, emphasis added'), { locator: '33–35', label: 'page', rest: ', emphasis added' });
  assert.deepEqual(splitLocator(', chap. iv'), { locator: 'iv', label: 'chapter', rest: '' });
  assert.deepEqual(splitLocator(' § 3'), { locator: '3', label: 'section', rest: '' });
  assert.deepEqual(splitLocator(', 12'), { locator: '12', label: 'page', rest: '' });
  // Carry-over 3 (Phase 21): pandoc reads [@k 12] as page 12 — the offline exporter does too.
  assert.deepEqual(splitLocator(' 12'), { locator: '12', label: 'page', rest: '' }, 'no comma: still a page, as in pandoc');
  assert.equal(splitLocator(', iv'), null, 'a roman numeral with no term is suffix text, as in pandoc');
  assert.deepEqual(splitLocator(', 33 and passim'), { locator: '33', label: 'page', rest: ' and passim' });
  assert.equal(splitLocator(', emphasis added'), null);
  assert.deepEqual(splitLocator(', p. x'), { locator: 'x', label: 'page', rest: '' }, 'a roman numeral is a value');
  assert.equal(splitLocator(', p. abc'), null, 'a term needs a value');
  assert.ok(LOCATOR_TERMS.length >= 15);
});

test('VRFY-09: lineOfOffset counts LF and CRLF alike; provableCodeSpans is the code the text scanners skip', () => {
  assert.equal(lineOfOffset('a\nb\nc', 4), 3);
  assert.equal(lineOfOffset('a\r\nb\r\nc', 6), 3);
  const md = 'Text `code` and\n\n```\nblock\n```\n';
  const spans = provableCodeSpans(md);
  assert.deepEqual(spans.map(([s, e]) => md.slice(s, e)), ['`code`', '```\nblock\n```']);
  assert.ok(offsetInSpans(md.indexOf('block'), spans));
  assert.deepEqual(provableCodeSpans('<div>\n\n```\nx\n```\n'), [], 'raw HTML outside a fence voids the proof');
  assert.equal(provableCodeSpans('```\n<div>\\cite{x}\n```\n').length, 1, 'constructs inside a fence do not void it (D-20-08)');
});
