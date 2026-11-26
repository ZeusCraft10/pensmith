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
// the PDF's own title and text. The fix for that refused papers with a
// notice or a running head above their title, took a reference set authors
// first for a byline above a title, and read "Cheng," as "Chen". Each case
// runs on the recorded Crossref and arXiv answers.

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

// What sits above a paper's own title is often not a label: a permission
// notice, a template's header, a journal's running head. Requiring every line
// above the title to be furniture or a short label refused the arXiv PDF of
// "Attention Is All You Need" and the papers below, each of which prints its
// own identifier. Only positive evidence that another work heads the PDF (a
// notice, or a title with a byline of other people) refuses it.
const OWN_BYLINE = 'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux';
const NUMPY_DOI = 'doi:10.1109/MCSE.2011.37';

test('the arXiv PDF of "Attention Is All You Need", with Google\'s permission notice above its title, is that paper', async () => {
  // The first page as pdf.js reads it: one author per line, each with a mark
  // on the next line, an affiliation and an email; arXiv's stamp comes later.
  const lines = [
    'Provided proper attribution is provided, Google hereby grants permission to',
    'reproduce the tables and figures in this paper solely for use in journalistic or',
    'scholarly works.',
    TITLE,
    'Ashish Vaswani', '∗', 'Google Brain', 'avaswani@google.com',
    'Noam Shazeer', '∗', 'Google Brain', 'noam@google.com',
    'Niki Parmar', '∗', 'Google Research', 'nikip@google.com',
    'Jakob Uszkoreit', '∗', 'Google Research', 'usz@google.com',
    'Abstract',
    'The dominant sequence transduction models are based on complex recurrent or',
    'convolutional neural networks that include an encoder and a decoder.',
    'arXiv:1706.03762v7 [cs.CL] 2 Aug 2023',
  ];
  const r = await hydrateFromText(lines.join('\n'));
  assert.equal(r.kind, 'found', JSON.stringify(r));
  assert.equal(r.kind === 'found' && r.candidate.title, TITLE);
  assert.match(r.kind === 'found' ? r.via : '', /arXiv ID printed in the PDF \(1706\.03762\)/);
});

for (const [name, header] of [
  ['the Springer svjour3 template header', ['Noname manuscript No.', '(will be inserted by the editor)']],
  ['the AASTeX template header', ['Draft version February 1, 2022', 'Typeset using LATEX twocolumn style in AASTeX631']],
  ['a journal running head', ['IEEE Transactions on Pattern Analysis and Machine Intelligence']],
  ['a running head with its page count', ['Behavioral and Brain Sciences (2017), Page 1 of 72']],
  ['a journal name', ['Current Directions in Psychological Science']],
  ['a special-issue line', ['Special Issue: Python for Scientific Computing']],
  ['a special-issue sentence', ['This article is part of the special issue on Python for scientific computing']],
  ['a retraction stamp on the work itself', ['RETRACTED ARTICLE']],
  ['two labels', ['Research Article', 'Open Access']],
  ['a label and a licence', ['Research Article', 'Open Access', 'CC BY 4.0']],
  ['Physical Review\'s labels', ['PHYSICAL REVIEW LETTERS 120, 123456 (2018)', 'Featured in Physics', 'Editors\' Suggestion']],
] as const) {
  test(`a paper with ${name} above its title is the work its printed DOI names`, async () => {
    const byline = name.startsWith('the Springer') ? 'Stefan van der Walt · S. Chris Colbert · Gael Varoquaux' : OWN_BYLINE;
    assert.match(await workOf([...header, CITED, byline, NUMPY_DOI]), /NumPy/);
  });
}

test('another work\'s title and byline above a cited title still refuse it, however short or capitalised', async () => {
  const cited = 'S. van der Walt, S. C. Colbert, G. Varoquaux';
  // A short title and a one-author byline.
  assert.doesNotMatch(await workOf(['Deep Nets', 'Jane Roe', CITED, cited, NUMPY_DOI]), /NumPy/);
  // An all-capitals title and byline.
  assert.doesNotMatch(await workOf(['ATTENTION IS ALL YOU NEED', 'ASHISH VASWANI, NOAM SHAZEER, NIKI PARMAR', CITED, cited, NUMPY_DOI]), /NumPy/);
  // One author per line, as pdf.js reads the arXiv PDF.
  assert.doesNotMatch(await workOf([TITLE, 'Ashish Vaswani', '∗', 'Google Brain', CITED, cited, NUMPY_DOI]), /NumPy/);
  // A byline that names one of the cited work's authors among others.
  assert.doesNotMatch(await workOf(['Deep Learning for Arrays', 'Stefan van der Walt and John Roe', 'We build on', CITED, cited, NUMPY_DOI]), /NumPy/);
});

test('a refusal does not say a printed DOI names another work when the PDF prints that work\'s title', async () => {
  const r = await hydrateFromText([TITLE, AUTHORS, 'We build on earlier work on array computing, in particular:', CITED, 'S. van der Walt, S. C. Colbert, G. Varoquaux', NUMPY_DOI].join('\n'));
  assert.equal(r.kind, 'none');
  const reason = r.kind === 'none' ? r.reason : '';
  assert.doesNotMatch(reason, /names another work/, reason);
  assert.match(reason, /DOI 10\.1109\/mcse\.2011\.37 names "The NumPy Array[^"]*", whose title the PDF prints but not as its own/, reason);
});

// A reference in the authors-first form ("[1] S. van der Walt, ...", then
// the title, then the venue) has the shape of a byline above a title.
test('a reference entry set authors first is not a byline above the title', async () => {
  const ref = 'S. van der Walt, S. C. Colbert, G. Varoquaux.';
  assert.doesNotMatch(await workOf(['Deep Nets', 'Jane Roe', 'Works Consulted', `[1] ${ref}`, CITED, NUMPY_DOI]), /NumPy/);
  assert.doesNotMatch(await workOf(['ATTENTION IS ALL YOU NEED', 'ASHISH VASWANI, NOAM SHAZEER, NIKI PARMAR', ref, CITED, NUMPY_DOI]), /NumPy/);
  assert.doesNotMatch(await workOf(['Deep Nets', 'Jane Roe', ref, CITED, 'Computing in Science & Engineering 13(2), 2011. doi:10.1109/MCSE.2011.37']), /NumPy/);
  assert.doesNotMatch(await workOf([`[1] ${ref}`, CITED, NUMPY_DOI]), /NumPy/);
  assert.doesNotMatch(await workOf([ref, CITED, 'Computing in Science & Engineering 13(2), 2011. doi:10.1109/MCSE.2011.37']), /NumPy/);
});

test('a book review or an obituary is not the work it names', async () => {
  for (const label of ['Book Review', 'BOOK REVIEWS', 'News & Views', 'In Memoriam']) {
    assert.doesNotMatch(await workOf([label, CITED, OWN_BYLINE, NUMPY_DOI]), /NumPy/, label);
  }
});

// Four works share a title (synthetic records, 10.0000 test prefix), each
// with Ruiz: one by Chen, one by Cheng, one by Hann and one by Hanna. Reading
// "Cheng," as "Chen", or "Hanna," as "Hann", plus an affiliation letter would
// name both authors of two of them.
test('a family name is not read as a shorter one, so a shared title goes to the work whose authors the PDF names', async () => {
  const doiOf = async (lines: string[]): Promise<string> => {
    const r = await hydrateFromText(lines.join('\n'));
    return r.kind === 'found' ? (r.candidate.doi ?? '') : `(${r.kind})`;
  };
  const title = 'Graph signals on sparse sensor networks';
  assert.equal(await doiOf([title, 'Wei Cheng, Ana Ruiz', 'Abstract We sample graph signals.']), '10.0000/pensmith-shared-title-cheng');
  assert.equal(await doiOf([title, 'Ana Ruiz', 'Abstract We extend the sampling of Cheng, Ruiz and others.']), '10.0000/pensmith-shared-title-cheng');
  // A word in the text below the byline is read as it is printed.
  assert.equal(await doiOf([title, 'Ana Ruiz', 'Abstract We extend the sampling of Hanna, Ruiz and others.']), '10.0000/pensmith-shared-title-hanna');
  // An affiliation letter set against a name in the byline still names its author.
  assert.equal(await doiOf([title, 'Li Chena,∗, Ana Ruizb', 'Abstract We sample graph signals.']), '10.0000/pensmith-shared-title-chen');
});
