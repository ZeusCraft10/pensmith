// tests/source-tier.test.ts — the deterministic evaluator tier (SRC-09,
// D-19-16; bin/lib/source-tier.ts): the metadata decides where it can, the
// evaluator's tier only where it cannot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicTier, finalTier, isGovernmentSource } from '../bin/lib/source-tier.js';

test('preprints: a preprint-server DOI, the preprint type, an arXiv record without a version of record', () => {
  assert.equal(deterministicTier({ doi: '10.48550/arXiv.1706.03762' }), 'preprint', 'arXiv DataCite DOI');
  assert.equal(deterministicTier({ doi: '10.1101/2020.03.01.123456' }), 'preprint', 'bioRxiv');
  assert.equal(deterministicTier({ doi: '10.2139/ssrn.123456' }), 'preprint', 'SSRN');
  assert.equal(deterministicTier({ type: 'preprint' }), 'preprint');
  assert.equal(deterministicTier({ source: 'arxiv', id: '1706.03762' }), 'preprint', 'arXiv-only');
  assert.equal(deterministicTier({ arxiv: '1706.03762', doi: '10.48550/arXiv.1706.03762' }), 'preprint');
  // An arXiv record whose DOI is the journal's version of record is not arXiv-only.
  assert.notEqual(deterministicTier({ source: 'arxiv', id: '1706.03762', doi: '10.1038/nature14539', venue: 'Nature' }), 'preprint');
});

test('books: book and chapter types, an ISBN on a work that is not an article', () => {
  assert.equal(deterministicTier({ type: 'book' }), 'book');
  assert.equal(deterministicTier({ type: 'chapter', doi: '10.1007/978-3-030-00000-0_1' }), 'book');
  assert.equal(deterministicTier({ isbn: '9780226458083' }), 'book');
  assert.equal(deterministicTier({ isbn: '0-226-45808-3' }), 'book', 'an ISBN-10 is an ISBN');
  assert.equal(deterministicTier({ isbn: '9780226458084' }), null, 'a failing check digit is no ISBN');
  assert.equal(deterministicTier({ isbn: '9780226458083', type: 'article-journal' }), 'peer-reviewed', 'an article with an ISBN stays an article');
});

test('government reports: a report from a government publisher or a government domain', () => {
  assert.equal(deterministicTier({ type: 'report', publisher: 'U.S. Department of Health and Human Services' }), 'gov-report');
  assert.equal(deterministicTier({ type: 'report', publisher: 'Office for National Statistics' }), 'gov-report');
  assert.equal(deterministicTier({ type: 'report', oa_pdf_url: 'https://www.cdc.gov/report.pdf' }), 'gov-report');
  assert.equal(deterministicTier({ type: 'report', oa_url: 'https://assets.publishing.service.gov.uk/x.pdf' }), 'gov-report');
  assert.equal(deterministicTier({ oa_url: 'https://gc.ca.example.com/x' }), null, 'a lookalike host is not .gc.ca');
  assert.equal(deterministicTier({ type: 'report', publisher: 'National Bureau of Economic Research' }), null, 'a working paper is a judgment call');
  assert.equal(isGovernmentSource({ publisher: 'World Health Organization' }), true);
  assert.equal(isGovernmentSource({ oa_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/' }), true);
  // A PubMed Central copy of a journal article is on a .gov host, but it is an article.
  assert.equal(deterministicTier({ source: 'pubmed', venue: 'Lancet', oa_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/' }), 'peer-reviewed');
});

test('peer-reviewed venues, other kinds, and the judgment calls', () => {
  assert.equal(deterministicTier({ type: 'article-journal', doi: '10.1038/nature14539' }), 'peer-reviewed');
  assert.equal(deterministicTier({ type: 'paper-conference' }), 'peer-reviewed');
  assert.equal(deterministicTier({ source: 'pubmed', venue: 'JAMA' }), 'peer-reviewed');
  for (const type of ['article-newspaper', 'article-magazine', 'webpage', 'thesis', 'dataset']) {
    assert.equal(deterministicTier({ type }), 'other', type);
  }
  assert.equal(deterministicTier({ source: 'openalex', doi: '10.1234/x' }), null, 'an untyped record is the evaluator\'s call');
  assert.equal(deterministicTier({}), null);
});

test('finalTier: the metadata wins; otherwise the evaluator; otherwise unknown', () => {
  assert.equal(finalTier({ type: 'article-journal' }, 'other'), 'peer-reviewed', 'the model never overrides the registrar');
  assert.equal(finalTier({ source: 'openalex' }, 'gov-report'), 'gov-report');
  assert.equal(finalTier({ source: 'openalex' }, null), null);
});
