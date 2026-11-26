// tests/source-hydrate.test.ts — which work a PDF's first page names as its own.
//
// A first page can print a cited work's DOI and title. hydrateFromText takes
// a printed DOI only when its work's title is printed where the paper's own
// title is: in the title block, before the abstract and before any reference
// list, with the work's authors named in the lines after it. It used to miss
// the abstract when it was labelled "Summary" or "a b s t r a c t", the
// reference list under headings such as "Notes" or "Références", and to take
// the title from anywhere in the first 30 lines. Each case runs on the
// recorded Crossref answers.

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
