// tests/pass1-matching.test.ts — Pass 1 compares an entry with the registry's
// record the way a careful reader would, through the real runPass1 against
// recorded registry answers (tests/fixtures/cassettes).
//
// The old comparison was Jaro-Winkler on the raw title and on the CSL `family`
// of the first author, against Crossref only:
//   - pensmith's own bib round trip turns "van der Walt, Stéfan" into
//     {family: 'Walt', non-dropping-particle: 'van der'} while Crossref says
//     "van der Walt": MIS-CITED;
//   - Crossref titles carry <i>…</i> and subtitles; a bib title without them
//     fell below the threshold: MIS-CITED;
//   - a mixed-case DOI took the strict "redirect" branch: MIS-CITED (see
//     tests/doi-identity.test.ts);
//   - organization-only authors made Crossref's record unreadable: FABRICATED;
//   - a title one word or one number off, a wrong year, an invented co-author
//     or the wrong journal all passed: OK;
//   - an entry with no DOI was FABRICATED even with an arXiv ID, a PMID or an
//     ISBN that a registry holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPass1, runPass1Unit } from '../bin/lib/verify/pass1.js';
import { writeBibtex } from '../bin/lib/bibtex-write.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { bibFile, pass1Verdict as verdict } from './lib/bib-fixture.js';

function entry(type: string, key: string, fields: Record<string, string>): string {
  return `@${type}{${key},\n${Object.entries(fields).map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}\n`;
}

// The NumPy paper: Crossref lists Stefan van der Walt (family "van der Walt").
// The braced family and the lowercase DOI keep the particle and DOI-case
// defects (tested on their own above and below) out of the other cases.
const NUMPY = {
  title: 'The NumPy Array: A Structure for Efficient Numerical Computation',
  author: '{van der Walt}, Stéfan and Colbert, S. Chris and Varoquaux, Gaël',
  year: '2011',
  journal: 'Computing in Science \\& Engineering',
  doi: '10.1109/mcse.2011.37',
};

// Crossref's title: "Comparison of Sample Sequences of the\n <i>Salmonella typhi</i>\n Genome ...".
const IAI = {
  title: 'Comparison of Sample Sequences of the Salmonella typhi Genome to the Sequence of the Complete Escherichia coli K-12 Genome',
  author: 'McClelland, Michael and Wilson, Richard K.',
  year: '1998',
  journal: 'Infection and Immunity',
  doi: '10.1128/iai.66.9.4305-4312.1998',
};

test('Pass 1: a particle surname written by pensmith\'s own bib writer is OK', async () => {
  const candidate: SourceCandidate = {
    source: 'crossref',
    id: '10.1109/mcse.2011.37',
    doi: '10.1109/mcse.2011.37',
    title: NUMPY.title,
    authors: ['van der Walt, Stéfan', 'Colbert, S. Chris', 'Varoquaux, Gaël'],
    year: 2011,
    retracted: false,
    last_verified: '2026-11-25T00:00:00.000Z',
    citekey: 'walt2011',
    raw: {},
  };
  const p = bibFile('');
  await writeBibtex([candidate], p);
  const results = await runPass1('# S\n\nNumPy arrays [@walt2011].\n', p);
  assert.equal(results[0]?.verdict, 'OK', results[0]?.reason);
});

test('Pass 1: a Crossref title with MathML markup matches the same title written as text', async () => {
  // Crossref's record (author list cut to its first 20 of 5156 to fit the
  // cassette budget) has the title "Combined Measurement of the Higgs Boson
  // Mass in <mml:math>…pp…</mml:math> Collisions at <mml:math>…√s=7…</mml:math> and 8 TeV …".
  const r = await verdict(entry('article', 'aad2015', {
    title: 'Combined Measurement of the Higgs Boson Mass in pp Collisions at √s=7 and 8 TeV with the ATLAS and CMS Experiments',
    author: 'Aad, G. and Abbott, B. and Abdallah, J.',
    year: '2015',
    journal: 'Phys. Rev. Lett.',
    doi: '10.1103/physrevlett.114.191803',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
});

test('Pass 1: a Crossref title with <i> markup matches the same title without it', async () => {
  const r = await verdict(entry('article', 'mcclelland1998', IAI));
  assert.equal(r.verdict, 'OK', r.reason);
});

test('Pass 1: a title that leaves out the subtitle is OK', async () => {
  const r = await verdict(entry('article', 'walt2011', { ...NUMPY, title: 'The NumPy Array' }));
  assert.equal(r.verdict, 'OK', r.reason);
});

// Crossref keeps many publishers' subtitles in a field of their own. This
// record is synthetic (the 10.0000 prefix is never registered): none of the
// recorded works has a non-empty Crossref `subtitle`.
const SUBTITLED = {
  author: 'Roe, Jane and Haddad, Omar',
  year: '2020',
  journal: 'Journal of Planetary Interiors',
  doi: '10.0000/pensmith-subtitle-field',
};

test('Pass 1: a subtitle Crossref keeps in its own field may be left out, but not replaced by another', async () => {
  const full = await verdict(entry('article', 'roe2020', { ...SUBTITLED, title: 'Tidal heating in icy moons: A laboratory model' }));
  assert.equal(full.verdict, 'OK', full.reason);
  const short = await verdict(entry('article', 'roe2020', { ...SUBTITLED, title: 'Tidal heating in icy moons' }));
  assert.equal(short.verdict, 'OK', short.reason);
  const other = await verdict(entry('article', 'roe2020', { ...SUBTITLED, title: 'Tidal heating in icy moons: A field survey' }));
  assert.equal(other.verdict, 'MIS-CITED', other.reason);
  assert.match(other.reason, /title is not the one Crossref gives \("Tidal heating in icy moons: A laboratory model"\)/);
});

test('Pass 1: a corporate author (Crossref lists only "The ENCODE Project Consortium") is OK', async () => {
  const r = await verdict(entry('article', 'encode2012', {
    title: 'An integrated encyclopedia of DNA elements in the human genome',
    author: '{The ENCODE Project Consortium}',
    year: '2012',
    journal: 'Nature',
    doi: '10.1038/nature11247',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
});

test('Pass 1: a sibling title one word off is MIS-CITED, not OK', async () => {
  const r = await verdict(entry('article', 'walt2011', {
    ...NUMPY, title: 'The NumPy Array: A Structure for Efficient Numerical Simulation',
  }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /title/);
});

test('Pass 1: a title whose number differs ("K-13" for "K-12") is MIS-CITED', async () => {
  const r = await verdict(entry('article', 'mcclelland1998', { ...IAI, title: IAI.title.replace('K-12', 'K-13') }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
});

test('Pass 1: a year more than one off is MIS-CITED; one year off (online first) is OK', async () => {
  const wrong = await verdict(entry('article', 'walt2011', { ...NUMPY, year: '2015' }));
  assert.equal(wrong.verdict, 'MIS-CITED', wrong.reason);
  assert.match(wrong.reason, /year 2015/);
  const near = await verdict(entry('article', 'walt2011', { ...NUMPY, year: '2010' }));
  assert.equal(near.verdict, 'OK', near.reason);
});

test('Pass 1: an invented co-author is MIS-CITED', async () => {
  const r = await verdict(entry('article', 'walt2011', { ...NUMPY, author: `${NUMPY.author} and Doe, John` }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /Doe is not an author/);
});

test('Pass 1: a first author who is not the work\'s first author is MIS-CITED', async () => {
  const r = await verdict(entry('article', 'walt2011', { ...NUMPY, author: 'Varoquaux, Gaël and {van der Walt}, Stéfan' }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /first author/);
});

test('Pass 1: the wrong journal is MIS-CITED; the journal\'s abbreviation is OK', async () => {
  const wrong = await verdict(entry('article', 'walt2011', { ...NUMPY, journal: 'Nature' }));
  assert.equal(wrong.verdict, 'MIS-CITED', wrong.reason);
  assert.match(wrong.reason, /journal "Nature"/);
  const abbrev = await verdict(entry('article', 'walt2011', { ...NUMPY, journal: 'Comput. Sci. Eng.' }));
  assert.equal(abbrev.verdict, 'OK', abbrev.reason);
});

test('Pass 1: an entry with only an arXiv ID is resolved through the arXiv API', async () => {
  const r = await verdict(entry('misc', 'vaswani2017', {
    title: 'Attention Is All You Need',
    author: 'Vaswani, Ashish and Shazeer, Noam and Parmar, Niki',
    year: '2017',
    eprint: '1706.03762',
    archivePrefix: 'arXiv',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /arXiv record for arXiv:1706\.03762/);
});

test('Pass 1: an entry with only a PMID is resolved through PubMed', async () => {
  const r = await verdict(entry('article', 'encode2012', {
    title: 'An integrated encyclopedia of DNA elements in the human genome',
    author: '{ENCODE Project Consortium}',
    year: '2012',
    journal: 'Nature',
    pmid: '22955616',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /PubMed record for PMID 22955616/);
});

test('Pass 1: a book cited by ISBN is resolved through Open Library', async () => {
  const r = await verdict(entry('book', 'cormen2009', {
    title: 'Introduction to Algorithms',
    author: 'Cormen, Thomas H. and Leiserson, Charles E. and Rivest, Ronald L. and Stein, Clifford',
    year: '2009',
    publisher: 'MIT Press',
    isbn: '978-0-262-03384-8',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /Open Library record for ISBN/);
});

test('Pass 1: an ISBN with a wrong check digit is MIS-CITED: the entry is wrong, the book may be real', async () => {
  const r = await verdict(entry('book', 'cormen2009', {
    title: 'Introduction to Algorithms', author: 'Cormen, Thomas H.', year: '2009', isbn: '978-0-262-03384-9',
  }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /check digit/);
});

test('Pass 1: an entry with no identifier at all is UNRESOLVED (blocking), not FABRICATED', async () => {
  const r = await verdict(entry('book', 'doe2009', { title: 'A Book Without Identifiers', author: 'Doe, Jane', year: '2009' }));
  assert.equal(r.verdict, 'UNRESOLVED', r.reason);
  assert.match(r.reason, /no DOI, arXiv ID, PMID or ISBN/);
});

test('Pass 1: an invented DOI next to a real arXiv ID is MIS-CITED: the reference list would print the fake DOI', async () => {
  const r = await verdict(entry('misc', 'vaswani2017', {
    title: 'Attention Is All You Need',
    author: 'Vaswani, Ashish',
    year: '2017',
    doi: '10.1038/s41586-024-99999-x',
    eprint: '1706.03762',
    archivePrefix: 'arXiv',
  }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /DOI 10\.1038\/s41586-024-99999-x is not registered/);
});

test('Pass 1: an ISBN written with a qualifier ("(hbk)") is read as the ISBN', async () => {
  const r = await verdict(entry('book', 'cormen2009', {
    title: 'Introduction to Algorithms',
    author: 'Cormen, Thomas H. and Leiserson, Charles E. and Rivest, Ronald L. and Stein, Clifford',
    year: '2009',
    isbn: '978-0-262-03384-8 (hbk), 978-0-262-53305-8 (pbk)',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /Open Library record for ISBN 978-0-262-03384-8/);
});

test('Pass 1: an ISBN field that is not an ISBN at all is not blamed on its check digit', async () => {
  const r = await verdict(entry('book', 'cormen2009', {
    title: 'Introduction to Algorithms', author: 'Cormen, Thomas H.', year: '2009', isbn: 'unknown',
  }));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /unknown is not a valid ISBN/);
  assert.doesNotMatch(r.reason, /check digit/);
});

test('Pass 1: a PMID written "PMID: 22955616" is that PMID', async () => {
  const r = await verdict(entry('article', 'encode2012', {
    title: 'An integrated encyclopedia of DNA elements in the human genome',
    author: '{ENCODE Project Consortium}',
    year: '2012',
    journal: 'Nature',
    pmid: 'PMID: 22955616',
  }));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /PubMed record for PMID 22955616\b/);
});

test('Pass 1: a DOI given only as a doi.org link in `url` is looked up as the DOI', async () => {
  const { title, author, year, journal } = NUMPY;
  for (const url of ['https://doi.org/10.1109/mcse.2011.37', 'http://dx.doi.org/10.1109/mcse.2011.37']) {
    const r = await verdict(entry('article', 'walt2011', { title, author, year, journal, url }));
    assert.equal(r.verdict, 'OK', `${url}: ${r.reason}`);
    assert.match(r.reason, /Crossref record for DOI 10\.1109\/mcse\.2011\.37/);
  }
});

test('runPass1Unit: a name that starts with a comma is compared as written, not dropped', () => {
  // ", Smith" once parsed as an empty family name, which the matcher skips:
  // with no name left to compare, the author check passed. It is now a
  // display name, as the registry adapters read one.
  const unit = (claimed: string, actual: string) => runPass1Unit({
    claimed: { title: 'Attention Is All You Need', authors: [claimed], doi: '10.1/x' },
    actual: { title: 'Attention Is All You Need', authors: [actual], doi: '10.1/x' },
  });
  for (const [claimed, actual] of [[', Smith', 'Jones, Bob'], [',Smith', 'Jones, Bob'], ['Jones, Bob', ', Smith']] as const) {
    const r = unit(claimed, actual);
    assert.equal(r.verdict, 'MIS-CITED', `${claimed} vs ${actual}: ${r.reason}`);
    assert.equal(r.authorJW, 0);
  }
  assert.equal(unit(', Smith', ', Smith').verdict, 'OK');
});
