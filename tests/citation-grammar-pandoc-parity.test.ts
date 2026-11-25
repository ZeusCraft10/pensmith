// tests/citation-grammar-pandoc-parity.test.ts — the grammar reads citations
// the way Pandoc does.
//
// The export renders citations with Pandoc, and the verifier checks the keys
// the grammar reads. If the two disagreed, a citation Pandoc renders could go
// unchecked. For a corpus of drafts, the keys of every `Cite` node in
// `pandoc -t json` must match the grammar's keys in order.
//
// Needs Pandoc. It skips where Pandoc is missing, and the export CI lane sets
// PENSMITH_REQUIRE_EXPORT_TOOLS=1, which turns a missing Pandoc into a failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fc from 'fast-check';
import { findCitations } from '../bin/lib/citation-grammar.js';
import { needsTool } from './lib/export-fixture.js';

/** The key of every citation in every Pandoc `Cite` node of `md`, in document order. */
function pandocKeys(md: string): string[] {
  const r = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], { input: md, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const keys: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n === null || typeof n !== 'object') return;
    const node = n as { t?: string; c?: unknown };
    if (node.t === 'Cite') {
      const [citations, inlines] = node.c as [Array<{ citationId: string }>, unknown];
      keys.push(...citations.map((c) => c.citationId));
      walk(inlines);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk((JSON.parse(r.stdout) as { blocks: unknown }).blocks);
  return keys;
}

const grammarKeys = (md: string): string[] => findCitations(md).flatMap((c) => c.items.map((i) => i.key));

const CORPUS = [
  'A [@zeta2020, p. 5] B [see @alpha2019; -@zeta2020, chap. 3] C [@doe99, pp. 33-35, 38-39 and *passim*].',
  'As @smith04 [p. 33] says, and @doe99 agrees. [-@solo] and [@a;@b] and [@a ;@b] and [ @a].',
  'Mail me@example.com. \\@escaped [@link](http://x) [text; @b] [@Vaswani2017:attn.v2] and @doe99.',
  'Keys: @a.b. @a_ @a- @a:b @ä2020 @a+b @a? @a/b @a%b @a&b @1234 @_under.',
  '`[@code]` and\n\n```\n[@fenced]\n```\n\nafter [@real].',
  'x [@doe99]. "quoted [@inner]" y. **[@bold]** and *@emph*.',
  '> block [@b1]\n> more @b2\n\n- item @li\n- item [@li2, ch. 2]',
  '| a | b |\n|---|---|\n| [@tab] | @tab2 |',
  'See @doe99 [p. 4; also @smith].',
  '[@a] [@b] and [@a, p. 3; @b, ch. 2] and [@a p. 3] and see [@a]: def.',
  'Not citations: foo@bar, [x@y], [see@y], [@] and [@ smith].',
  'Old style @Doe-99, @DOE_1999 and [@{weirdkey}] and @{braced.key}.',
];

test('pandoc parity: the grammar reads the same keys as Pandoc on a fixed corpus', needsTool('pandoc'), () => {
  for (const md of CORPUS) assert.deepEqual(grammarKeys(md), pandocKeys(md), md);
});

// Generated drafts: keys with the punctuation Pandoc allows inside a key
// (`$`, `~` and `<>` are left out: Markdown reads them as math, subscript
// and HTML), every citation form, and prose that is not a citation.
const ALNUM = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_', 'é'];
const alnumRun = fc.array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 4 }).map((a) => a.join(''));
const keyArb = fc
  .tuple(alnumRun, fc.array(fc.tuple(fc.constantFrom('', ...':.#%&-+?/'), alnumRun), { maxLength: 2 }))
  .map(([h, rest]) => h + rest.map(([p, r]) => p + r).join(''));
const itemArb = fc
  .tuple(fc.constantFrom('', 'see ', 'cf. '), fc.boolean(), keyArb, fc.constantFrom('', ', p. 4', ', chap. 3', ', pp. 1-2'))
  .map(([pre, sup, key, loc]) => `${pre}${sup ? '-' : ''}@${key}${loc}`);
const pieceArb = fc.oneof(
  fc.array(itemArb, { minLength: 1, maxLength: 3 }).map((items) => `[${items.join('; ')}]`),
  fc.tuple(keyArb, fc.constantFrom('', ' [p. 7]')).map(([k, loc]) => `@${k}${loc},`),
  fc.constantFrom('the effect holds', 'mail me@example.com', 'code `@x`', 'Smith agreed'),
);
const docArb = fc.array(pieceArb, { minLength: 1, maxLength: 8 }).map((p) => p.join(' '));

test('pandoc parity: the grammar reads the same keys as Pandoc on generated drafts', needsTool('pandoc'), () => {
  const docs = fc.sample(docArb, { numRuns: 80, seed: 20261125 });
  // One Pandoc run for all of them; on a mismatch, find the draft that differs.
  const all = docs.join('\n\n* * *\n\n');
  if (JSON.stringify(grammarKeys(all)) === JSON.stringify(pandocKeys(all))) return;
  for (const md of docs) assert.deepEqual(grammarKeys(md), pandocKeys(md), md);
});
