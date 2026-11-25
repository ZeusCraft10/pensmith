// tests/source-names-and-ids.test.ts — every adapter hands research a work's
// authors as structured names and its identifiers, read from the registry's
// own fields.
//
// Authors used to arrive as display strings. OpenAlex, arXiv and Semantic
// Scholar write "Ashish Vaswani" (given name first) and PubMed writes
// "Wakefield AJ" (surname, then initials), and the bibliography writer split
// only on commas: the reference list printed "Ashish Vaswani" as a surname,
// and the citekey for "Wakefield AJ" was `aj1998`. The arXiv ID, PubMed ID and
// ISBN were never carried, so a work known by one of them alone could not be
// put in the bibliography at all. Each case below reads a recorded registry
// answer through the real adapter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplayName, parsePubmedName } from '../bin/lib/author-normalize.js';
import * as arxiv from '../bin/lib/sources/arxiv.js';
import * as crossref from '../bin/lib/sources/crossref.js';
import * as openalex from '../bin/lib/sources/openalex.js';
import * as pubmed from '../bin/lib/sources/pubmed.js';
import * as semanticscholar from '../bin/lib/sources/semanticscholar.js';
import * as zotero from '../bin/lib/sources/zotero-mcp.js';

test('a display name in given-family order is split into given and family names', () => {
  assert.deepEqual(parseDisplayName('Ashish Vaswani'), { family: 'Vaswani', given: 'Ashish' });
  assert.deepEqual(parseDisplayName('Aidan N. Gomez'), { family: 'Gomez', given: 'Aidan N.' });
  assert.deepEqual(parseDisplayName('Stéfan van der Walt'), { family: 'van der Walt', given: 'Stéfan' });
  assert.deepEqual(parseDisplayName('Martin Luther King Jr.'), { family: 'King', given: 'Martin Luther', suffix: 'Jr.' });
  assert.deepEqual(parseDisplayName('Vaswani, Ashish'), { family: 'Vaswani', given: 'Ashish' });
  assert.deepEqual(parseDisplayName('Aristotle'), { family: 'Aristotle' });
  assert.deepEqual(parseDisplayName('The ENCODE Project Consortium'), { literal: 'The ENCODE Project Consortium' });
  assert.equal(parseDisplayName('   '), null);
});

test('a PubMed name is a family name followed by initials', () => {
  assert.deepEqual(parsePubmedName('Wakefield AJ'), { family: 'Wakefield', given: 'A. J.' });
  assert.deepEqual(parsePubmedName('Walker-Smith JA'), { family: 'Walker-Smith', given: 'J. A.' });
  assert.deepEqual(parsePubmedName('van der Walt S'), { family: 'van der Walt', given: 'S.' });
  assert.deepEqual(parsePubmedName('Smith JA Jr'), { family: 'Smith', given: 'J. A.', suffix: 'Jr' });
});

test('PubMed: "Wakefield AJ" is the surname Wakefield, so the citekey is wakefield1998, and the PMID is kept', async () => {
  const c = await pubmed.fetchById('9500320');
  assert.ok(c, 'the recorded esummary answer has the article');
  assert.deepEqual(c.names?.[0], { family: 'Wakefield', given: 'A. J.' });
  assert.equal(c.authors[0], 'Wakefield, A. J.');
  assert.equal(c.citekey, 'wakefield1998');
  assert.equal(c.pmid, '9500320');
  assert.equal(c.container_title, 'Lancet', 'NLM\'s "(London, England)" is not part of the name');
  assert.equal(c.volume, '351');
  assert.equal(c.issue, '9103');
});

test('arXiv: names are split, and the arXiv ID and abstract are kept', async () => {
  const c = await arxiv.fetchById('1706.03762');
  assert.ok(c, 'the recorded arXiv answer has the paper');
  assert.deepEqual(c.names?.[0], { family: 'Vaswani', given: 'Ashish' });
  assert.ok(c.names?.some((n) => n.family === 'Gomez' && n.given === 'Aidan N.'), JSON.stringify(c.names));
  assert.equal(c.authors[0], 'Vaswani, Ashish');
  assert.equal(c.arxiv, '1706.03762');
  assert.equal(c.citekey, 'vaswani2017');
  assert.match(c.abstract ?? '', /dominant sequence transduction models/);
});

test('OpenAlex: display names are split, and an arXiv DOI gives the arXiv ID', async () => {
  const hits = await openalex.search('attention mechanisms');
  const v = hits.find((h) => /Attention Is All You Need/.test(h.title));
  assert.ok(v, 'the recorded OpenAlex search has the paper');
  assert.deepEqual(v.names, [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }]);
  assert.equal(v.arxiv, '1706.03762');
});

test('OpenAlex (a real record): "Stéfan van der Walt" keeps the particle in the family name, and the ids give the arXiv ID', async () => {
  const c = await openalex.fetchById('doi:10.1109/MCSE.2011.37');
  assert.ok(c, 'the recorded OpenAlex answer has the work');
  assert.deepEqual(c.names, [
    { family: 'van der Walt', given: 'Stéfan' },
    { family: 'Colbert', given: 'Steven C.' },
    { family: 'Varoquaux', given: 'Gael P.' },
  ]);
  assert.equal(c.citekey, 'vanderwalt2011');
  assert.equal(c.arxiv, '1102.1523');
  assert.equal(c.csl_type, 'article-journal');
  assert.equal(c.container_title, 'Computing in Science & Engineering');
  assert.deepEqual([c.volume, c.issue, c.page], ['13', '2', '22-30']);
});

test('Semantic Scholar (a real record): names are split and the arXiv ID is kept', async () => {
  const c = await semanticscholar.fetchById('DOI:10.1109/MCSE.2011.37');
  assert.ok(c, 'the recorded Semantic Scholar answer has the paper');
  assert.deepEqual(c.names?.[0], { family: 'van der Walt', given: 'S.' }, 'Semantic Scholar writes "S. van der Walt"');
  assert.equal(c.arxiv, '1102.1523');
  assert.equal(c.doi, '10.1109/MCSE.2011.37');
});

test('Crossref: family and given come from the record\'s own fields', async () => {
  const hits = await crossref.search('Attention Is All You Need', { limit: 5 });
  assert.equal(hits[0]!.title, 'Is Attention All You Need?');
  assert.deepEqual(hits[0]!.names?.[0], { family: 'Mineault', given: 'Patrick' });
  assert.equal(hits[0]!.authors[0], 'Mineault, Patrick');
  assert.equal(hits[0]!.csl_type, 'chapter');
  assert.equal(hits[0]!.isbn, '9783031842993');
});

test('Semantic Scholar: display names are split', async () => {
  const hits = await semanticscholar.search('attention mechanisms');
  const v = hits.find((h) => /Attention Is All You Need/.test(h.title));
  assert.ok(v);
  assert.deepEqual(v.names, [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }]);
  assert.equal(v.arxiv, '1706.03762');
});

test('Zotero: lastName and firstName are kept as they are', async () => {
  const saved = process.env['ZOTERO_API_KEY'];
  process.env['ZOTERO_API_KEY'] = 'test-key';
  zotero.setZoteroClientForTest({
    search: async () => [{
      key: 'ABCD1234',
      title: 'The NumPy Array: A Structure for Efficient Numerical Computation',
      creators: [{ firstName: 'Stéfan', lastName: 'van der Walt' }, { name: 'NumPy Developers' }],
      date: '2011',
      DOI: '10.1109/MCSE.2011.37',
    }],
  });
  try {
    const [c] = await zotero.search('numpy');
    assert.ok(c);
    assert.deepEqual(c.names, [{ family: 'van der Walt', given: 'Stéfan' }, { literal: 'NumPy Developers' }]);
    assert.equal(c.authors[0], 'van der Walt, Stéfan');
    assert.equal(c.citekey, 'vanderwalt2011');
  } finally {
    zotero.setZoteroClientForTest(null);
    if (saved === undefined) delete process.env['ZOTERO_API_KEY'];
    else process.env['ZOTERO_API_KEY'] = saved;
  }
});
