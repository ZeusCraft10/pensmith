// tests/rewrite-guard.test.ts — the ONE guard around every model rewrite of
// verified prose (Phase 21, EXP-10, EXP-14; D-21-14): maskForRewrite and
// validateRewrite driven directly, as the Tier-1 boundary and humanizer
// submission tools (PLUG-07, PLUG-10) will call them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskForRewrite, unmaskRewrite, validateRewrite, boundaryAdditions, headingLines } from '../bin/lib/rewrite-guard.js';
import { boundaryAdditions as compileBoundaryAdditions } from '../bin/lib/compile.js';

const TEXT =
  'Deep networks learn layered representations [@lecun2015, p. 4]. As @aspelmeyer2009 notes, measurement "shapes what an observer is able to record about a system" [@aspelmeyer2009].\n\n' +
  'A second paragraph cites a cluster [@lecun2015; @zhu2020] and a suppressed author [-@zhu2020].';

test('D-21-14: maskForRewrite hides every citation form and every quote of at least quote_min_words words; unmask restores the bytes', () => {
  const mask = maskForRewrite(TEXT, { namespace: 3 });
  assert.doesNotMatch(mask.masked, /@/, 'no citation survives the mask');
  assert.doesNotMatch(mask.masked, /shapes what an observer/, 'the quote is masked');
  assert.match(mask.masked, /\{\{cite_3_0\}\}/);
  assert.match(mask.masked, /\{\{quote_3_0\}\}/);
  assert.equal(mask.cites.size, 5, '[@lecun2015, p. 4], @aspelmeyer2009, the quote\'s [@aspelmeyer2009], the cluster, [-@zhu2020]');
  assert.equal(unmaskRewrite(mask.masked, mask), TEXT);
  // A short quoted phrase (under 5 words) is prose, not a checked quote: left as is.
  const short = maskForRewrite('The so-called "deep" turn [@lecun2015].');
  assert.match(short.masked, /"deep"/);
  // A block quote run is one placeholder.
  const block = maskForRewrite('Intro text [@lecun2015].\n\n> Measurement shapes what an observer is able to record [@aspelmeyer2009].\n\nAfter.');
  assert.match(block.masked, /^Intro text \{\{cite_0_0\}\}\.\n\n\{\{quote_0_0\}\}\n\nAfter\.$/);
});

test('D-21-14: validateRewrite accepts a prose-only rewrite and restores the citations byte for byte', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} This carries the argument forward.\n\n${p2}`, allowedParagraphs: [0, 1] });
  assert.equal(v.ok, true, v.reasons.join('; '));
  assert.ok(v.text.includes('[@lecun2015, p. 4]') && v.text.includes('[-@zhu2020]') && v.text.includes('This carries the argument forward.'));
});

test('D-21-14: validateRewrite rejects a dropped, added or duplicated citation — "citation set changed"', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  const dropped = validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\n${p2.replace('{{cite_0_3}}', '')}` });
  assert.deepEqual([dropped.ok, dropped.reasons[0]], [false, 'citation set changed']);
  assert.equal(dropped.text, TEXT, 'a rejected rewrite keeps the original');
  const duplicated = validateRewrite({ original: TEXT, mask, rewritten: `${p1} {{cite_0_0}}\n\n${p2}` });
  assert.equal(duplicated.reasons[0], 'citation set changed');
  for (const added of ['[@fake2099, p. 3]', '[-@evil9999]', 'as @evil9999 notes', '[@{evil9999}]']) {
    const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} Moreover, ${added}.\n\n${p2}` });
    assert.equal(v.ok, false, added);
    assert.equal(v.reasons[0], 'citation set changed', added);
  }
});

test('D-21-14: validateRewrite rejects a changed quote, a changed heading, a change outside the allowed paragraphs and anything new the gate would check', () => {
  const mask = maskForRewrite(TEXT);
  const [p1, p2] = mask.masked.split('\n\n') as [string, string];
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: `${p1.replace('{{quote_0_0}}', '"a different quotation of several words here"')}\n\n${p2}` }).reasons[0], 'a quoted passage changed');
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\n${p2} Changed.`, allowedParagraphs: [0] }).reasons[0], 'text outside the allowed paragraphs changed');
  assert.match(validateRewrite({ original: TEXT, mask, rewritten: `${p1}\n\nExtra.\n\n${p2}`, allowedParagraphs: [0, 1] }).reasons[0] ?? '', /^paragraph structure changed/);
  const headed = '## Methods\n\nWe measure carefully [@aspelmeyer2009].';
  const hm = maskForRewrite(headed);
  assert.equal(validateRewrite({ original: headed, mask: hm, rewritten: hm.masked.replace('## Methods', '## Method') }).reasons[0], 'a heading changed');
  assert.deepEqual(headingLines(headed), ['## Methods']);
  for (const extra of ['as (Smith & Jones, 2019) found', 'and "deep networks will always outperform every other method ever devised"', 'see doi:10.9999/fabricated.2019', 'as in [3]']) {
    const v = validateRewrite({ original: TEXT, mask, rewritten: `${p1} Moreover, ${extra}.\n\n${p2}` });
    assert.equal(v.ok, false, extra);
    assert.match(v.reasons[0] ?? '', /^adds .* which no section verified$|^a quoted passage changed$/, extra);
  }
  assert.equal(validateRewrite({ original: TEXT, mask, rewritten: '   ' }).reasons[0], 'empty rewrite');
});

test('D-21-14: boundaryAdditions moved to the guard and stays re-exported from compile.ts', () => {
  assert.equal(compileBoundaryAdditions, boundaryAdditions);
  assert.equal(boundaryAdditions('Plain text.', 'Plain text, rephrased.'), null);
  assert.match(boundaryAdditions('Plain text.', 'Plain text (Smith, 2019).') ?? '', /UNSUPPORTED-FORM/);
});
