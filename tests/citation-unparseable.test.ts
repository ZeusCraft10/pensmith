// tests/citation-unparseable.test.ts — citation-shaped text the one grammar
// cannot read is an UNPARSEABLE finding, never "absent" (VRFY-09, D-20-07).
//
// Each rule has LF and CRLF cases with their lines; the negatives (an email, an
// escaped `\@k` or `\[`, provable code, well-formed clusters, a stray extra
// bracket) report nothing. tests/citation-grammar-pandoc.test.ts checks every
// rule against pandoc 3.9 itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitedKeysForVerification, findUnparseableCitations } from '../bin/lib/citation-token.js';

type Case = readonly [md: string, expected: ReadonlyArray<readonly [form: string, line: number, text: string]>];

const POSITIVE: readonly Case[] = [
  ['A claim [@].', [['empty-key', 1, '[@]']]],
  ['A claim [@ smith2020].', [['empty-key', 1, '[@ smith2020]']]],
  ['A claim [-@].', [['empty-key', 1, '[-@]']]],
  ['A claim [ @].', [['empty-key', 1, '[ @]']]],
  ['A claim [@smith2020; @].', [['empty-key', 1, '@]']]],
  ['A claim [@smith2020 about trees.', [['unbalanced-bracket', 1, '[@smith2020 about trees.']]],
  ['A claim [see @smith2020 and more.\nStill the same paragraph.', [['unbalanced-bracket', 1, '[see @smith2020 and more.']]],
  ['One.\n\nTwo [@a\n\nThree [@b].', [['unbalanced-bracket', 3, '[@a']]],
  ['A claim @{unterminated here.', [['unterminated-braced-key', 1, '@{unterminated']]],
  ['A claim [@{two words}].', [['unterminated-braced-key', 1, '@{two']]],
  ['Claim A [@smith2020 [see note]].', [['nested-bracket', 1, '[@smith2020 [see note]]']]],
  ['A claim [see [x] @smith2020].', [['nested-bracket', 1, '[see [x] @smith2020]']]],
  ['A claim [@smith2020, p. [5]].', [['nested-bracket', 1, '[@smith2020, p. [5]]']]],
  ['# Heading\n\nText\nmore text [@].\n\nLast @{x', [['empty-key', 4, '[@]'], ['unterminated-braced-key', 6, '@{x']]],
];

const NEGATIVE: readonly string[] = [
  'Write to jane.doe@example.org [or call].',
  'An escaped \\@smith2020 and an escaped bracket \\[@smith2020 are text.',
  // (A brace in the paragraph would void the inline-code proof: then they count, fail closed.)
  'Code: `[@]` and `[@k [n]]` stay code.',
  '```\n[@\n@{x\n[@k [x]]\n```\n\nText [@k].',
  'Clusters [@a; @b], [see @a, p. 5; -@b], [@{braced}], narrative @a and [-@a].',
  'Extra brackets [[@k] and [@k]] are text around a citation.',
  'A footnote [^1] and a link [text](http://x.org/@user).',
  'An @ alone, @ noon, and user@host.',
];

const crlf = (s: string): string => s.replace(/\r?\n/g, '\r\n');
const found = (md: string): Array<[string, number, string]> => findUnparseableCitations(md).map((f) => [f.form, f.line, f.text]);

test('VRFY-09: every UNPARSEABLE rule reports its text and line (LF and CRLF)', () => {
  for (const [md, expected] of POSITIVE) {
    assert.deepEqual(found(md), expected.map((e) => [...e]), JSON.stringify(md));
    assert.deepEqual(found(crlf(md)), expected.map((e) => [...e]), `${JSON.stringify(md)} (CRLF)`);
    for (const f of findUnparseableCitations(md)) {
      assert.equal(f.verdict, 'UNPARSEABLE');
      assert.ok(f.reason.length > 30, 'a reason that says what to write instead');
    }
  }
});

test('VRFY-09: text Pandoc cannot read as a citation start, escapes, provable code and well-formed citations report nothing', () => {
  for (const md of NEGATIVE) {
    assert.deepEqual(found(md), [], JSON.stringify(md));
    assert.deepEqual(found(crlf(md)), [], `${JSON.stringify(md)} (CRLF)`);
  }
});

test('VRFY-09: an unparseable citation still hands its readable key to Pass 1 (fail closed twice)', () => {
  assert.deepEqual(extractCitedKeysForVerification('A claim [@ghost2099 about trees.'), ['ghost2099']);
  assert.deepEqual(extractCitedKeysForVerification('Claim A [@smith2020 [see note]].'), ['smith2020']);
  assert.equal(findUnparseableCitations('Claim A [@smith2020 [see note]].').length, 1);
});

test('VRFY-09: each finding is one line of text, at most 80 characters', () => {
  const long = `A claim [@k ${'word '.repeat(40)}`;
  const [f] = findUnparseableCitations(long);
  assert.ok(f !== undefined && f.text.length <= 80 && !f.text.includes('\n'));
});
