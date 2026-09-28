// tests/full-text.test.ts — GRND-14 (D-19-23): which sources have legitimately
// available full text, and which draft quotes lean on a source without it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fullTextAvailable, fullTextSource, fullTextByCitekey, quotesWithoutFullText } from '../bin/lib/full-text.js';

const NONE = { byo: null, oa_url: null, arxiv: null, pmcid: null };
const SHA = 'a'.repeat(64);

test('GRND-14: full text = a hashed BYO PDF, an OA PDF, an arXiv id or a PMCID', () => {
  assert.equal(fullTextAvailable(NONE), false);
  assert.equal(fullTextSource({ ...NONE, byo: { file: 'sources/x.pdf', sha256: SHA, text_sha256: SHA } }), 'bring-your-own PDF');
  assert.equal(fullTextAvailable({ ...NONE, byo: { file: 'sources/x.pdf', sha256: SHA, text_sha256: null } }), false, 'an image-only BYO PDF has no text');
  assert.equal(fullTextSource({ ...NONE, oa_url: 'https://example.org/x.pdf' }), 'open-access PDF');
  assert.equal(fullTextSource({ ...NONE, arxiv: '1706.03762' }), 'arXiv');
  assert.equal(fullTextSource({ ...NONE, pmcid: 'PMC123' }), 'PubMed Central');
  assert.deepEqual(
    [...fullTextByCitekey([{ citekey: 'a2020', ...NONE }, { citekey: 'b2021', ...NONE, arxiv: '2101.00001' }])],
    [['a2020', false], ['b2021', true]],
  );
});

const DRAFT = [
  '# Background',
  '',
  'As the authors put it, "the dominant sequence transduction models are based on complex recurrent or convolutional neural networks" [@vaswani2017].',
  '',
  'Another view holds that "deep learning allows computational models composed of multiple processing layers to learn representations" [@lecun2015].',
  '',
  '> Quantum measurements are usually thought of as instantaneous projections, but experiments now follow a measurement as it unfolds in time.',
  '',
  '[@aspelmeyer2009]',
  '',
  'A short "three word quote" [@lecun2015] is not a direct quote Pass 3 checks.',
].join('\n');

test('GRND-14: quotesWithoutFullText lists the direct quotes attributed to sources without full text', () => {
  const flags = new Map([
    ['vaswani2017', true],
    ['lecun2015', false],
  ]);
  const got = quotesWithoutFullText(DRAFT, flags);
  assert.deepEqual(
    got.map((q) => [q.citekey, q.kind]).sort(),
    [
      ['aspelmeyer2009', 'block'],
      ['lecun2015', 'inline'],
    ],
    'an unknown citekey (aspelmeyer2009) counts as no full text',
  );
  assert.match(got.find((q) => q.citekey === 'lecun2015')!.quote, /^deep learning allows computational models/);
  assert.deepEqual(quotesWithoutFullText(DRAFT, { vaswani2017: true, lecun2015: true, aspelmeyer2009: true }), []);
  assert.deepEqual(quotesWithoutFullText(DRAFT.replace(/\n/g, '\r\n'), flags).map((q) => q.citekey).sort(), ['aspelmeyer2009', 'lecun2015'], 'CRLF drafts too');
});
