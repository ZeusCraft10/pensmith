// tests/full-text.test.ts — GRND-14 (D-19-23): which sources have legitimately
// available full text, and which draft quotes lean on a source without it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fullTextAvailable, fullTextSource, fullTextByCitekey, quotesWithoutFullText, arxivIdOfEntry, arxivPdfUrl, isDataCiteArxivDoi } from '../bin/lib/full-text.js';

const NONE = { byo: null, oa_url: null, doi: null };
const SHA = 'a'.repeat(64);
const byo = (over: { text_sha256?: string | null; asserted?: boolean } = {}) => ({
  file: 'sources/x.pdf',
  sha256: SHA,
  text_sha256: over.text_sha256 === undefined ? SHA : over.text_sha256,
  asserted: over.asserted ?? false,
});

test('GRND-14: full text = what Pass 3 can check — a hashed BYO PDF, or the (Unpaywall) open-access PDF of a DOI', () => {
  assert.equal(fullTextAvailable(NONE), false);
  assert.equal(fullTextSource({ ...NONE, byo: byo() }), 'bring-your-own PDF');
  assert.equal(fullTextAvailable({ ...NONE, byo: byo({ text_sha256: null }) }), false, 'an image-only BYO PDF has no text');
  assert.equal(fullTextAvailable({ ...NONE, byo: byo({ asserted: true }) }), false, 'a PDF attached against a failed identity check is not evidence');
  assert.equal(fullTextSource({ ...NONE, doi: '10.1371/journal.pone.0000001', oa_url: 'https://example.org/x.pdf' }), 'open-access PDF');
  assert.equal(fullTextAvailable({ ...NONE, oa_url: 'https://example.org/x.pdf' }), false, 'Pass 3 finds the OA copy through the DOI');
  assert.deepEqual(
    [...fullTextByCitekey([{ citekey: 'a2020', ...NONE }, { citekey: 'b2021', ...NONE, doi: '10.5555/b', oa_url: 'https://example.org/b.pdf' }])],
    [['a2020', false], ['b2021', true]],
  );
});

test('GRND-14 (review round 2): an arXiv id is checkable full text (Pass 3 fetches its arXiv PDF); a PMCID alone is not', () => {
  assert.equal(fullTextSource({ ...NONE, arxiv: '1706.03762' }), 'arXiv PDF');
  assert.equal(fullTextSource({ ...NONE, doi: '10.48550/arXiv.1706.03762' }), 'arXiv PDF', 'a DataCite arXiv DOI names the id');
  assert.equal(
    fullTextSource({ ...NONE, doi: '10.48550/arxiv.1706.03762', oa_url: 'https://arxiv.org/pdf/1706.03762' }),
    'arXiv PDF',
    'Unpaywall does not index DataCite arXiv DOIs: the basis is the arXiv PDF, not oa_url',
  );
  assert.equal(fullTextAvailable({ ...NONE, pmcid: 'PMC123' } as typeof NONE), false);
  assert.equal(arxivIdOfEntry({ doi: '10.48550/arXiv.2102.05095v2' }), '2102.05095');
  assert.equal(arxivIdOfEntry({ doi: '10.1038/nature14539', arxiv: null }), null);
  assert.equal(arxivPdfUrl('hep-th/9901001'), 'https://arxiv.org/pdf/hep-th/9901001');
  assert.equal(isDataCiteArxivDoi('https://doi.org/10.48550/arXiv.1706.03762'), true);
  assert.equal(isDataCiteArxivDoi('10.1038/nature14539'), false);
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
