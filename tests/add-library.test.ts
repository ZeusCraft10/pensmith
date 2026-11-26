// tests/add-library.test.ts — `pensmith add` writes through the library.
//
// add used to reload every CITATIONS.bib entry through a lossy converter and
// rewrite the file to append one source: entries with no DOI were deleted,
// `note = {RETRACTED}` was dropped, a key that was not lowercase became
// `anon`, and journal, volume and pages were lost. The same DOI could be added
// twice (engel2009 and engel2009a for one work), and when the new work's key
// was taken, the remap and the "added" message used the unsuffixed key, so a
// section was pointed at the other paper. For a PDF, add took the first text
// line as a title and accepted Crossref's top hit whatever it was. Every case
// runs the real CLI on recorded registry answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cli } from './lib/export-fixture.js';

const BYO_PDF = fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url));

function project(bib?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-add-library-'));
  mkdirSync(join(root, '.paper', 'sections', '01-intro'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'sections', '01-intro', 'PLAN.md'),
    '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: []\nverified_against_draft_hash: abc123\n---\n# Intro\n',
  );
  if (bib !== undefined) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  return root;
}

const bibOf = (root: string): string => readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
const keysOf = (bib: string): string[] => [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!);

/** A PDF of `lines`, one per line, as a journal's first page would set them. */
async function pdfOf(root: string, lines: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((ln, i) => page.drawText(ln, { x: 56, y: 740 - 18 * i, size: 11, font }));
  const file = join(root, 'paper.pdf');
  writeFileSync(file, await doc.save({ useObjectStreams: false }));
  return file;
}

test('adding a DOI that is already in the library reuses its key and adds nothing', () => {
  const root = project();
  const first = cli(root, ['add', '10.1109/MCSE.2011.37', '--yolo']);
  assert.equal(first.status, 0, first.out);
  const again = cli(root, ['add', 'https://doi.org/10.1109/mcse.2011.37', '--yolo']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /already in the library as vanderwalt2011/, again.out);
  assert.deepEqual(keysOf(bibOf(root)), ['vanderwalt2011'], 'one work, one entry');
});

test('a new work whose key is taken gets the next free key, and the remap and the message use that key', () => {
  // A different 2009 paper by an Aspelmeyer already holds aspelmeyer2009.
  const root = project(
    '@article{aspelmeyer2009,\n  title = {A Different Paper},\n  author = {Aspelmeyer, Markus},\n  year = {2009},\n  doi = {10.0000/another-aspelmeyer-paper}\n}\n',
  );
  const r = cli(root, ['add', '10.1038/nphys1170', '--remap', '--section', '1', '--slug', 'intro', '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /added aspelmeyer2009a\b/, r.out);
  assert.doesNotMatch(r.out, /added aspelmeyer2009\b(?!a)/, r.out);
  const plan = readFileSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md'), 'utf8');
  assert.match(plan, /assigned_sources:\s*\n?\s*-?\s*\[?aspelmeyer2009a\]?/, plan);
  assert.doesNotMatch(plan, /aspelmeyer2009(?!a)/, 'the section must not point at the other paper');
  assert.match(plan, /verified_against_draft_hash: abc123/, 'the remap touches assigned_sources only');
  const bib = bibOf(root);
  assert.match(bib, /@article\{aspelmeyer2009a,[^@]*Measured measurement/);
  assert.match(bib, /@article\{aspelmeyer2009,[^@]*A Different Paper/, 'the other paper keeps its key and its entry');
});

// Entries add used to destroy: a preprint known by its eprint, a retracted
// work, a book whose key is not lowercase, and a journal article with its
// volume and pages.
const KEPT_BIB =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n  author = {Vaswani, Ashish and Shazeer, Noam},\n  year = {2017},\n' +
  '  eprint = {1706.03762},\n  archivePrefix = {arXiv},\n  primaryClass = {cs.CL}\n}\n\n' +
  '@article{wakefield1998,\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n' +
  '  author = {Wakefield, A. J.},\n  journal = {The Lancet},\n  volume = {351},\n  number = {9103},\n  pages = {637--641},\n' +
  '  year = {1998},\n  doi = {10.1016/S0140-6736(97)11096-0},\n  note = {RETRACTED}\n}\n\n' +
  '@book{Kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas S.},\n' +
  '  publisher = {University of Chicago Press},\n  year = {1962},\n  isbn = {9780226458083}\n}\n';

test('adding a source leaves every other entry of CITATIONS.bib exactly as it was', () => {
  const root = project(KEPT_BIB);
  const r = cli(root, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(r.status, 0, r.out);
  const bib = bibOf(root);
  for (const block of KEPT_BIB.split('\n\n')) assert.ok(bib.includes(block.trim()), `kept byte for byte:\n${block}`);
  assert.deepEqual(keysOf(bib).sort(), ['Kuhn1962', 'aspelmeyer2009', 'vaswani2017', 'wakefield1998']);
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ id: string; custom: { retracted: boolean } }> };
  assert.equal(lib.entries.find((e) => e.id === 'wakefield1998')?.custom.retracted, true, 'the library knows the work is retracted');
});

test('add <pdf> looks the paper up by the arXiv ID printed in it, not by a title search', () => {
  const root = project();
  const r = cli(root, ['add', BYO_PDF, '--yolo']);
  assert.equal(r.status, 0, r.out);
  const bib = bibOf(root);
  assert.deepEqual(keysOf(bib), ['vaswani2017'], bib);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.doesNotMatch(bib, /Is \{?Attention/, 'not the chapter a title search returns first');
  // The PDF's text is kept for checking quotations against it.
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ custom: { local_text?: string; provenance: Array<{ source: string; file?: string }> } }> };
  const item = lib.entries[0]!;
  assert.equal(item.custom.local_text, 'sources/vaswani2017.txt');
  assert.match(readFileSync(join(root, '.paper', 'sources', 'vaswani2017.txt'), 'utf8'), /dominant sequence transduction models/);
  assert.ok(item.custom.provenance.some((p) => p.source === 'pdf' && p.file === BYO_PDF), JSON.stringify(item.custom.provenance));
});

test('add <pdf> with no identifier refuses a title-search hit that is not the paper', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit',
    'Abstract The dominant sequence transduction models are based on complex recurrent networks.',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /not added/i, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> with no identifier accepts a title-search hit with the same title and an author named in the PDF', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux',
    'In the Python world, NumPy arrays are the standard representation for numerical data.',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(bibOf(root), /doi = \{10\.1109\/mcse\.2011\.37\}/);
});

test('add <pdf> uses a DOI printed in it only when that DOI names this paper', async () => {
  // The only DOI on the page is a reference's: the NumPy paper's, cited by a
  // paper on attention, written as references are, with the cited title and
  // authors. The cited title is in the PDF's text, but not in its title block.
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar',
    'References',
    '[1] S. van der Walt, S. C. Colbert, G. Varoquaux.',
    'The NumPy Array: A Structure for Efficient Numerical Computation.',
    'Computing in Science & Engineering 13(2), 2011. doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false);

  const own = await pdfOf(root, [
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const ok = cli(root, ['add', own, '--yolo']);
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(keysOf(bibOf(root)), ['vanderwalt2011']);
});

test('add <pdf> finds its own DOI when its title wraps onto a second line', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'The NumPy Array: A Structure for',
    'Efficient Numerical Computation',
    'Stefan van der Walt, S. Chris Colbert and Gael Varoquaux',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(keysOf(bibOf(root)), ['vanderwalt2011']);
});

test('add <pdf> refuses a title-search hit one word from its title, even when its author is cited', async () => {
  // Jaro-Winkler scores "Climate change and mental health" 0.93 against
  // "Climate change and human health", and the reference list names Berry.
  // The hit is a synthetic record (10.0000 test prefix).
  const root = project();
  const pdf = await pdfOf(root, [
    'Climate change and human health',
    'Jane Smith and John Jones',
    'Abstract Rising temperatures change the burden of disease.',
    'References',
    '[1] H. L. Berry. Climate change and mental health. 2010.',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added berry2010/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> refuses a title-search hit one word from its title when its author is named in the PDF too', async () => {
  // The same author wrote both papers, so the author check passes: only the
  // word-for-word title check tells "mental health" from "human health".
  const root = project();
  const pdf = await pdfOf(root, [
    'Climate change and human health',
    'Helen L. Berry and John Jones',
    'Abstract Rising temperatures change the burden of disease.',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added berry2010/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> refuses a DOI printed with its title after the abstract, before any references heading', async () => {
  // A cited work's DOI and title, set as whole lines in the body of a paper
  // with no reference heading on its first page. The title is in the PDF's
  // opening, but not in its title block (the lines before the abstract).
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar',
    'Abstract We build on earlier work on array computing, in particular:',
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> refuses a hit with its title when none of the hit\'s authors is named before the references', async () => {
  // Same title as the NumPy paper, other authors; the NumPy paper's authors
  // appear only in the reference list.
  const root = project();
  const pdf = await pdfOf(root, [
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'John Smith and Jane Doe',
    'Abstract We revisit array computing in Python.',
    'References',
    '[1] S. van der Walt, S. C. Colbert and G. Varoquaux. 2011.',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> holds a printed DOI to the whole title, when Crossref\'s subtitle list starts with a blank', async () => {
  // Crossref keeps the subtitle in a list of its own; this record's list is
  // ['', 'A field study'] (a synthetic record, 10.0000 test prefix). Its
  // whole title, the one Pass 1 compares, has the subtitle, so a PDF that
  // prints only the main title is not this work, and one that prints the
  // whole title is.
  const root = project();
  const mainOnly = await pdfOf(root, [
    'Measuring trust in online communities',
    'Chidi Okonkwo and Astrid Lindqvist',
    'https://doi.org/10.0000/pensmith-subtitle-blank-first',
    'Abstract We survey trust between members of three online forums.',
  ]);
  const r = cli(root, ['add', mainOnly, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');

  const whole = await pdfOf(root, [
    'Measuring trust in online communities: A field study',
    'Chidi Okonkwo and Astrid Lindqvist',
    'https://doi.org/10.0000/pensmith-subtitle-blank-first',
    'Abstract We survey trust between members of three online forums.',
  ]);
  const ok = cli(root, ['add', whole, '--yolo']);
  assert.equal(ok.status, 0, ok.out);
  assert.match(bibOf(root), /doi = \{10\.0000\/pensmith-subtitle-blank-first\}/, ok.out);
});

// A cited work's DOI and title on the first page, where the opening is not
// cut where it should be: under a reference heading pensmith did not know,
// or with no abstract label at all. Both stored the NumPy paper for a PDF of
// 'Attention Is All You Need'.
test('add <pdf> refuses a cited DOI under a "References and Notes" heading', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar',
    'References and Notes',
    '[1] S. van der Walt, S. C. Colbert, G. Varoquaux.',
    'The NumPy Array: A Structure for Efficient Numerical Computation.',
    'Computing in Science & Engineering 13(2), 2011. doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> with no abstract label refuses a cited title printed as a body line with its DOI', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar',
    'We build on earlier work on array computing, in particular:',
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> refuses a cited title printed in the body with its byline and DOI', async () => {
  // The PDF's own title, byline and text come first; the NumPy paper's title,
  // authors and DOI are set below them, as an erratum or a comment sets the
  // work it is about. Nothing on the page confirms the PDF is the NumPy paper.
  const root = project();
  const pdf = await pdfOf(root, [
    'Attention Is All You Need',
    'Ashish Vaswani, Noam Shazeer, Niki Parmar',
    'We build on earlier work on array computing, in particular:',
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'S. van der Walt, S. C. Colbert, G. Varoquaux',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.doesNotMatch(r.out, /added vanderwalt2011/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <pdf> refuses a cited title set below the PDF\'s own title and a byline that reads as no names, and names add <doi>', async () => {
  // A commentary's first page: its own title, a byline of one initial and a
  // surname, then the NumPy paper's title, authors and DOI.
  const root = project();
  const pdf = await pdfOf(root, [
    'Some Remarks on Array Computing in Python',
    'J. Roe',
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'S. van der Walt, S. C. Colbert, G. Varoquaux',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /NOT added/, r.out);
  assert.match(r.out, /`pensmith add <doi>`/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
  assert.equal(existsSync(join(root, '.paper', 'LIBRARY.json')), false, 'nothing was written');
});

test('add <pdf> takes the printed DOI of a paper whose byline numbers its authors\' affiliations', async () => {
  const root = project();
  const pdf = await pdfOf(root, [
    'The NumPy Array: A Structure for Efficient Numerical Computation',
    'Stefan van der Walt1, S. Chris Colbert2 and Gael Varoquaux3',
    'doi:10.1109/MCSE.2011.37',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(keysOf(bibOf(root)), ['vanderwalt2011']);
});

test('add <pdf> takes the arXiv ID printed in a paper whose first page sets a permission notice above its title', async () => {
  // The first page of the arXiv PDF of "Attention Is All You Need": Google's
  // reproduction notice, the title, then one author per line with a mark, an
  // affiliation and an email; arXiv's stamp in the margin is read later.
  const root = project();
  const pdf = await pdfOf(root, [
    'Provided proper attribution is provided, Google hereby grants permission to',
    'reproduce the tables and figures in this paper solely for use in journalistic or',
    'scholarly works.',
    'Attention Is All You Need',
    'Ashish Vaswani', '*', 'Google Brain', 'avaswani@google.com',
    'Noam Shazeer', '*', 'Google Brain', 'noam@google.com',
    'Abstract',
    'The dominant sequence transduction models are based on complex recurrent or',
    'convolutional neural networks that include an encoder and a decoder.',
    'arXiv:1706.03762v7 [cs.CL] 2 Aug 2023',
  ]);
  const r = cli(root, ['add', pdf, '--yolo']);
  assert.equal(r.status, 0, r.out);
  const bib = bibOf(root);
  assert.deepEqual(keysOf(bib), ['vaswani2017'], bib);
  assert.match(bib, /eprint = \{1706\.03762\}/);
});

test('add <url> of a page with no citation meta tag reads only the first DOI-shaped text on it', () => {
  // The page's first DOI-shaped text is not a DOI ("10.5555/)"); a later DOI
  // on the page may be a cited work's, so the page is not taken to name it.
  const root = project();
  const r = cli(root, ['add', 'https://example.org/pensmith-first-doi-unreadable', '--yolo']);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /the page names no DOI/, r.out);
  assert.equal(existsSync(join(root, '.paper', 'CITATIONS.bib')), false, 'nothing was written');
});

test('add <arXiv ID> adds the preprint, known by its eprint', () => {
  const root = project();
  const r = cli(root, ['add', 'arXiv:1706.03762', '--yolo']);
  assert.equal(r.status, 0, r.out);
  const bib = bibOf(root);
  assert.deepEqual(keysOf(bib), ['vaswani2017']);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.match(bib, /author = \{Vaswani, Ashish and Shazeer, Noam/);
});

test('add <file.bib> imports its entries by identifier, as they are written', () => {
  const root = project(KEPT_BIB);
  const imported = join(root, 'refs.bib');
  writeFileSync(
    imported,
    // Already in the library under another key (same DOI, other spelling).
    '@article{wakefield98,\n  title = {Ileal-lymphoid-nodular hyperplasia},\n  author = {Wakefield, Andrew},\n  year = {1998},\n  doi = {10.1016/s0140-6736(97)11096-0}\n}\n\n' +
      // New, but its key is taken by another work.
      '@article{vaswani2017,\n  title = {Measured measurement},\n  author = {Aspelmeyer, Markus},\n  journal = {Nature Physics},\n  year = {2009},\n  doi = {10.1038/nphys1170}\n}\n',
  );
  const r = cli(root, ['add', imported, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /already in the library as wakefield1998/, r.out);
  assert.match(r.out, /added vaswani2017a/, r.out);
  const bib = bibOf(root);
  assert.deepEqual(keysOf(bib).sort(), ['Kuhn1962', 'vaswani2017', 'vaswani2017a', 'wakefield1998']);
  assert.ok(bib.includes('@article{vaswani2017a,\n  title = {Measured measurement},'), 'imported as written, under its new key');
  assert.ok(bib.includes(KEPT_BIB.split('\n\n')[0]!.trim()), 'the work that held the key keeps it');
});

// Zotero's own CSL-JSON export names each item by its URI, which BibTeX
// cannot use as a key.
const ZOTERO_ITEM = {
  id: 'http://zotero.org/users/local/AbCdEf/items/7XK2Q9PZ',
  type: 'article-journal',
  title: 'Measured measurement',
  'container-title': 'Nature Physics',
  volume: '5',
  issue: '1',
  page: '11-12',
  author: [{ family: 'Aspelmeyer', given: 'Markus' }],
  issued: { 'date-parts': [[2009]] },
  DOI: '10.1038/nphys1170',
};

const libraryKeys = (root: string): string[] =>
  (JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ id: string }> }).entries.map((e) => e.id).sort();

test('add <file.json> files a Zotero export under the key its bibliography entry has, and later adds keep one entry per work', () => {
  const root = project();
  const file = join(root, 'zotero.json');
  writeFileSync(file, JSON.stringify([ZOTERO_ITEM]));
  const r = cli(root, ['add', file, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /added aspelmeyer2009\./, r.out);
  assert.deepEqual(libraryKeys(root), keysOf(bibOf(root)).sort(), 'LIBRARY.json and CITATIONS.bib file the work under one key');

  const next = cli(root, ['add', '10.1109/MCSE.2011.37', '--yolo']);
  assert.equal(next.status, 0, next.out);
  const keys = keysOf(bibOf(root)).sort();
  assert.deepEqual(keys, ['aspelmeyer2009', 'vanderwalt2011'], 'no work is in the bibliography twice');
  assert.deepEqual(libraryKeys(root), keys);

  const again = cli(root, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /already in the library as aspelmeyer2009;/, again.out);
});

test('add <file.json> reads number variables given as numbers and names with an empty part', () => {
  const root = project();
  const file = join(root, 'refs.json');
  writeFileSync(
    file,
    JSON.stringify([{ ...ZOTERO_ITEM, id: 'aspelmeyer2009measured', volume: 5, issue: 1, author: [{ family: 'Aspelmeyer', given: '' }, { family: '', given: '' }] }]),
  );
  const r = cli(root, ['add', file, '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /added aspelmeyer2009measured\./, r.out);
  const bib = bibOf(root);
  assert.match(bib, /^@article\{aspelmeyer2009measured,/m, bib);
  assert.match(bib, /volume = \{5\}/, bib);
  assert.match(bib, /number = \{1\}/, bib);
  assert.match(bib, /author = \{\{Aspelmeyer\}\},/, 'the empty given name is dropped, the second, empty name too');
});
