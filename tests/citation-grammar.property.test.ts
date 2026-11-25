// tests/citation-grammar.property.test.ts — the verifier checks every work the
// export would render.
//
// Generated drafts mix Pandoc citations in every form (clusters with prefixes,
// locators and suffixes, suppress-author `-@key`, narrative `@key` with or
// without a locator, keys with internal punctuation and any case) with prose
// that is not a citation (emails, `\@` escapes, code spans). The properties:
// the grammar reads exactly the keys that were written as citations, and
// every key the exporter would render gets a Pass-1 verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { citedKeys, findCitations } from '../bin/lib/citation-grammar.js';
import { exportCitations } from '../bin/lib/exporter.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';

const ALNUM = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_', 'é', 'ü', 'ß'];
const KEY_PUNCT = [...':.#$%&-+?<>~/'];

const alnumRun = fc.array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 5 }).map((a) => a.join(''));
/** A Pandoc citation key: starts and ends with a letter, digit or `_`; punctuation only inside. */
const keyArb = fc
  .tuple(alnumRun, fc.array(fc.tuple(fc.constantFrom('', ...KEY_PUNCT), alnumRun), { maxLength: 3 }))
  .map(([head, rest]) => head + rest.map(([p, run]) => p + run).join(''));

const prefixArb = fc.constantFrom('', 'see ', 'e.g., ', 'cf. ', 'also ', 'see also ');
const locatorArb = fc.constantFrom('', ', p. 4', ', pp. 33-35', ', chap. 3', ' 12', ', {iv, vi-xi}', ', sec. 2');
const suffixArb = fc.constantFrom('', ', emphasis added', ' and passim');

interface Piece { text: string; keys: string[] }

const itemArb = fc
  .tuple(prefixArb, fc.boolean(), keyArb, locatorArb, suffixArb)
  .map(([prefix, suppress, key, locator, suffix]) => ({ text: `${prefix}${suppress ? '-' : ''}@${key}${locator}${suffix}`, key }));

const clusterArb: fc.Arbitrary<Piece> = fc
  .array(itemArb, { minLength: 1, maxLength: 3 })
  .map((items) => ({ text: `[${items.map((i) => i.text).join('; ')}]`, keys: items.map((i) => i.key) }));

const narrativeArb: fc.Arbitrary<Piece> = fc
  .tuple(keyArb, fc.constantFrom('', ' [p. 7]', ' [chap. 2]'), fc.constantFrom(' ', '. ', ', ', '; '))
  .map(([key, loc, after]) => ({ text: `@${key}${loc}${after}`, keys: [key] }));

const proseArb: fc.Arbitrary<Piece> = fc
  .constantFrom(
    'the effect is robust', 'Coherence persists', 'as shown before', 'write to me@example.com',
    'a handle \\@someone', 'code `[@notacite]` here', 'in 2020 and 2021', 'Smith noted',
  )
  .map((text) => ({ text, keys: [] }));

const docArb = fc.array(fc.oneof(clusterArb, narrativeArb, proseArb, proseArb), { minLength: 1, maxLength: 12 }).chain((pieces) =>
  fc.array(fc.constantFrom(' ', ' ', '\n\n'), { minLength: pieces.length, maxLength: pieces.length }).map((seps) => {
    let text = '';
    for (let i = 0; i < pieces.length; i += 1) text += pieces[i]!.text + seps[i]!;
    return { text, keys: [...new Set(pieces.flatMap((p) => p.keys))] };
  }),
);

test('property: the grammar reads exactly the keys written as citations, in first-appearance order', () => {
  fc.assert(
    fc.property(docArb, (doc) => {
      assert.deepEqual(citedKeys(findCitations(doc.text)), doc.keys, doc.text);
    }),
    { numRuns: 300 },
  );
});

test('property: every key the exporter would render gets a Pass-1 verdict', async () => {
  const bib = join(mkdtempSync(join(tmpdir(), 'pensmith-grammar-prop-')), 'CITATIONS.bib');
  writeFileSync(bib, '');
  await fc.assert(
    fc.asyncProperty(docArb, fc.integer({ min: 0, max: 2 ** 12 }), async (doc, mask) => {
      // The bibliography holds every key a bracketed citation names (or the
      // export refuses) plus any subset of the narrative-only keys.
      const known = new Set(doc.keys.filter((_, i) => (mask >> (i % 12)) & 1));
      for (const k of citedKeys(findCitations(doc.text).filter((c) => !c.narrative))) known.add(k);
      const rendered = citedKeys(exportCitations(doc.text, known).cites);
      const verified = new Set((await runPass1(doc.text, bib)).map((r) => r.citekey));
      for (const k of rendered) assert.ok(verified.has(k), `the export renders ${k} but Pass 1 never checks it:\n${doc.text}`);
    }),
    { numRuns: 150 },
  );
});
