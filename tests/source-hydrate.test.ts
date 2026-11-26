// tests/source-hydrate.test.ts — which work a PDF's first page names as its own.
//
// A first page can print a cited work's DOI and title. hydrateFromText takes
// a printed DOI only when its work's title is printed where the paper's own
// title is: in the title block, before the abstract and before any reference
// list, with the work's authors named in the lines after it. It used to miss
// the abstract when it was labelled "Summary" or "a b s t r a c t", the
// reference list under headings such as "Notes" or "Références", and to take
// the title from anywhere in the first 30 lines. It then missed a byline
// whose names carry affiliation marks ("Walt1", "Walt¹", "Walta,∗") or that
// is printed above the title, and took a cited title with its byline below
// the PDF's own title and text. Each case runs on the recorded Crossref
// answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateFromText } from '../bin/lib/source-hydrate.js';

const TITLE = 'Attention Is All You Need';
const AUTHORS = 'Ashish Vaswani, Noam Shazeer, Niki Parmar';
const CITED = 'The NumPy Array: A Structure for Efficient Numerical Computation';
const CITED_BYLINE = 'S. van der Walt, S. C. Colbert, G. Varoquaux. doi:10.1109/MCSE.2011.37';

async function workOf(lines: string[]): Promise<string> {
  const r = await hydrateFromText(lines.join('\n'));
  return r.kind === 'found' ? r.candidate.title : `(${r.kind})`;
}

for (const heading of [
  'References and Notes', 'Notes and References', 'Notes', 'NOTES', 'Endnotes', 'Literatur', 'Literaturverzeichnis',
  'Références', 'Références', 'Referencias', 'Bibliografía', '4 Notes',
]) {
  test(`a cited work listed under "${heading}" is not taken for the PDF's own`, async () => {
    // The cited title, then its authors and DOI, as a reference list sets them.
    assert.doesNotMatch(await workOf([TITLE, AUTHORS, heading, CITED, CITED_BYLINE]), /NumPy/);
  });
}

for (const label of ['Summary', 'SUMMARY', 'a b s t r a c t', 'A B S T R A C T']) {
  test(`an abstract labelled "${label}" ends the title block`, async () => {
    const lines = [TITLE, AUTHORS, `${label} We build on earlier work on array computing, in particular:`, CITED, CITED_BYLINE];
    assert.doesNotMatch(await workOf(lines), /NumPy/);
    assert.doesNotMatch(await workOf([TITLE, AUTHORS, label, 'We build on earlier work on array computing, in particular:', CITED, CITED_BYLINE]), /NumPy/);
  });
}

test('a printed DOI is taken when its title heads the page and its authors follow', async () => {
  assert.match(await workOf([CITED, 'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux', 'doi:10.1109/MCSE.2011.37']), /NumPy/);
  // Journal furniture and an article-type label above the title.
  assert.match(
    await workOf(['Computing in Science & Engineering, vol. 13', 'SCIENTIFIC PROGRAMMING', CITED, 'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux', 'Summary In the Python world, NumPy arrays are the standard.', 'doi:10.1109/MCSE.2011.37']),
    /NumPy/,
  );
});

test('a cited title in the body, not followed by its authors, is not the PDF\'s own, whatever its DOI says', async () => {
  assert.doesNotMatch(await workOf([TITLE, AUTHORS, 'We build on earlier work on array computing, in particular:', CITED, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
});

for (const [kind, byline] of [
  ['digits', 'Stefan van der Walt1, S. Chris Colbert2 and Gael Varoquaux3'],
  ['superscripts', 'Stefan van der Walt¹, S. Chris Colbert² and Gael Varoquaux³'],
  ['symbols', 'Stefan van der Walt*, S. Chris Colbert† and Gael Varoquaux‡'],
  ['letters set against the name', 'Stefan van der Walta,∗, S. Chris Colbertb, Gael Varoquauxc'],
  ['a letter at the line\'s end', 'Gael Varoquauxc'],
] as const) {
  test(`a byline whose names carry affiliation marks (${kind}) names the paper's authors`, async () => {
    assert.match(await workOf([CITED, byline, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
  });
}

test('a byline printed above the title names the paper\'s authors', async () => {
  assert.match(await workOf(['Stefan van der Walt, S. Chris Colbert and Gael Varoquaux', CITED, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
  assert.match(await workOf(['Stefan van der Walt1, S. Chris Colbert2 and', 'Gael Varoquaux3', CITED, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
});

test('a first page with the journal\'s furniture above the title is the work it names', async () => {
  assert.match(
    await workOf([
      'Computing in Science & Engineering 13 (2011) 22–30',
      'Contents lists available at ScienceDirect',
      'Computing in Science & Engineering',
      'journal homepage: www.computer.org/cise',
      CITED,
      'Stefan van der Walta,∗, S. Chris Colbertb, Gael Varoquauxc',
      'a b s t r a c t',
      'In the Python world, NumPy arrays are the standard representation for numerical data.',
      'doi:10.1109/MCSE.2011.37',
    ]),
    /NumPy/,
  );
  assert.match(await workOf(['Published as a conference paper at ICLR 2019', CITED, 'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux', 'doi:10.1109/MCSE.2011.37']), /NumPy/);
});

test('a cited title with its byline, below the PDF\'s own title, byline and text, is not the PDF\'s own', async () => {
  // Erratum and commentary first pages set the work they discuss this way.
  const byline = 'S. van der Walt, S. C. Colbert, G. Varoquaux';
  assert.doesNotMatch(await workOf([TITLE, AUTHORS, 'We build on earlier work on array computing, in particular:', CITED, byline, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
  assert.doesNotMatch(
    await workOf([TITLE, AUTHORS, 'We build on earlier work on array computing.', 'See also', CITED, 'van der Walt, Colbert, Varoquaux (2011)', 'https://doi.org/10.1109/MCSE.2011.37']),
    /NumPy/,
  );
  // A byline of the cited work's authors above it does not make it the PDF's own when its own title comes first.
  assert.doesNotMatch(await workOf([TITLE, AUTHORS, 'We build on the work of', 'S. van der Walt, S. C. Colbert and G. Varoquaux:', CITED, 'doi:10.1109/MCSE.2011.37']), /NumPy/);
});

test('a notice about a work (an erratum, a comment, a reply) is not that work', async () => {
  const byline = 'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux';
  for (const label of ['ERRATUM', 'Erratum', 'Corrigendum', 'Correction', 'Comment on', 'Reply to', 'Retraction', 'Expression of Concern']) {
    assert.doesNotMatch(await workOf([label, CITED, byline, 'doi:10.1109/MCSE.2011.37']), /NumPy/, label);
  }
  assert.doesNotMatch(await workOf(['Comment on van der Walt et al.', CITED, byline, 'John Roe', 'doi:10.1109/MCSE.2011.37']), /NumPy/);
});

test('a work with no personal author is the PDF\'s own only when its title is the first title line', async () => {
  const encode = 'An integrated encyclopedia of DNA elements in the human genome';
  const doi = 'doi:10.1038/nature11247';
  assert.match(await workOf(['Nature 489 (2012) 57–74', encode, 'The ENCODE Project Consortium', doi]), /encyclopedia/);
  assert.doesNotMatch(await workOf(['Erratum', encode, 'The ENCODE Project Consortium', doi]), /encyclopedia/);
  assert.doesNotMatch(await workOf(['Deep Nets', 'Jane Roe', encode, doi]), /encyclopedia/);
});
