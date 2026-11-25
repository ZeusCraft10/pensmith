// tests/citation-grammar.test.ts — Pandoc citation syntax and whole-paper rendering.
//
// The exporter used to find citations with `\[(@[^\]]+)\]` and cut each key at
// the first space, so `[@key, p. 5]` became the key `key,` (no match, raw text
// left in the export), prefixes were lost, and narrative `@key` was ignored.
// It then rendered each work on its own, so a numeric style numbered every
// citation 1. findCitations parses the full grammar; renderCitationsInDocument
// renders all citations in one citeproc session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedKeys, findCitations, parseLocator } from '../bin/lib/citation-grammar.js';
import { parseBib, renderCitationsInDocument } from '../bin/lib/citations.js';

test('grammar: clusters with prefix, locator, label, suffix and suppress-author', () => {
  const md = 'A [@zeta2020, p. 5] B [see @alpha2019; -@zeta2020, chap. 3] C [@doe99, pp. 33-35, 38-39 and *passim*] D [@a, {iv, vi-xi}]';
  const c = findCitations(md);
  assert.deepEqual(c.map((x) => x.raw), ['[@zeta2020, p. 5]', '[see @alpha2019; -@zeta2020, chap. 3]', '[@doe99, pp. 33-35, 38-39 and *passim*]', '[@a, {iv, vi-xi}]']);
  assert.deepEqual(c[0]!.items, [{ key: 'zeta2020', locator: '5', label: 'page' }]);
  assert.deepEqual(c[1]!.items, [
    { key: 'alpha2019', prefix: 'see' },
    { key: 'zeta2020', suppressAuthor: true, locator: '3', label: 'chapter' },
  ]);
  assert.deepEqual(c[2]!.items, [{ key: 'doe99', locator: '33-35, 38-39', label: 'page', suffix: ' and *passim*' }]);
  assert.deepEqual(c[3]!.items, [{ key: 'a', locator: 'iv, vi-xi', label: 'page' }]);
  assert.ok(c.every((x) => !x.narrative));
});

test('grammar: narrative citations, with and without a locator', () => {
  const c = findCitations('As @smith04 [p. 33] says, and @doe99 agrees.');
  assert.deepEqual(c.map((x) => [x.raw, x.narrative]), [['@smith04 [p. 33]', true], ['@doe99', true]]);
  assert.deepEqual(c[0]!.items[0], { key: 'smith04', locator: '33', label: 'page' });
});

test('grammar: keys follow Pandoc (internal punctuation, any case); trailing punctuation is not part of a key', () => {
  assert.deepEqual(citedKeys('[@Vaswani2017:attn.v2] and @doe99. Also [@{weird key}].'), ['Vaswani2017:attn.v2', 'doe99', 'weird key']);
});

test('grammar: emails and code are not citations; escaped, link and mixed brackets are not clusters', () => {
  const md = 'Mail me@example.com. `[@code]` and\n\n```\n[@fenced]\n```\n\n\\[@escaped] [@link](http://x) [text; @b]';
  // As in Pandoc, the @word inside those brackets still reads as a narrative
  // citation; the exporter cites one only when the key is in the bibliography.
  const c = findCitations(md);
  assert.deepEqual(c.map((x) => x.raw), ['@escaped', '@link', '@b']);
  assert.ok(c.every((x) => x.narrative));
});

test('grammar: a suffix without a locator keeps its comma; a bare number is a page', () => {
  assert.deepEqual(parseLocator(', emphasis added'), { suffix: ', emphasis added' });
  assert.deepEqual(parseLocator(' 12'), { locator: '12', label: 'page' });
  assert.deepEqual(parseLocator(', civil'), { suffix: ', civil' }, 'a word made of roman-numeral letters is not a locator');
});

test('renderCitationsInDocument: one session numbers by first appearance; the bibliography follows', async () => {
  const entries = await parseBib(
    '@article{zeta2020, author={Zeta, Zed}, title={Z}, journal={J}, year={2020}}\n@article{alpha2019, author={Alpha, Al}, title={A}, journal={J}, year={2019}}\n',
  );
  const cites = findCitations('First [@zeta2020]. Then [@alpha2019]. Again [@zeta2020, p. 2].');
  const r = renderCitationsInDocument(entries, 'ieee', cites);
  assert.deepEqual(r.citations, ['[1]', '[2]', '[1, p. 2]']);
  assert.match(r.bibliography[0]!, /\[1\].*Z\. Zeta/);
  assert.match(r.bibliography[1]!, /\[2\].*A\. Alpha/);
  assert.equal(r.noteStyle, false);
  assert.throws(() => renderCitationsInDocument(entries, 'ieee', findCitations('[@ghost]')), /no bibliography entry for cited key 'ghost'/);
});
