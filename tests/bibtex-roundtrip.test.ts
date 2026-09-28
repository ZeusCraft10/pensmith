// tests/bibtex-roundtrip.test.ts — SRC-12 (D-19-19): CITATIONS.bib always
// parses with the project's own parseBib and carries what a reference needs.
//
//   - the five SRC-12 names round-trip family / given exactly;
//   - a fast-check property (>= 1000 runs, Unicode names, titles, abstracts)
//     shows renderBibtex -> parseBib is lossless (on the normalized value);
//   - abstract, journal / booktitle, volume, number, pages, publisher,
//     editor, isbn, eprint + archivePrefix + primaryClass, and the CSL type ->
//     @article / @book / @incollection / @inproceedings / @techreport /
//     @phdthesis / @misc mapping;
//   - APA in-text "(Vaswani & Shazeer, 2017)" from the offline renderer and,
//     when pandoc is on PATH, from pandoc citeproc.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { renderBibtex, writeBibtex, normalizeBibValue, type BibSource } from '../bin/lib/bibtex-write.js';
import { parseBib, parseBibSync, renderInText, renderApa } from '../bin/lib/citations.js';
import { parsePersonName } from '../bin/lib/person-name.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function entryById(bib: string, id: string): Record<string, unknown> {
  const e = parseBibSync(bib).find((x) => x['id'] === id);
  assert.ok(e, `${id} is in the rendered bib`);
  return e;
}

type ParsedName = { family?: string; given?: string; suffix?: string; 'non-dropping-particle'?: string };

test('SRC-12: the five SRC-12 names parse back with family/given exactly (writeBibtex -> parseBib)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-bibnames-'));
  const target = path.join(dir, 'CITATIONS.bib');
  const names = ['Эсенаманов, Байэл', 'Ashish Vaswani', 'van der Maaten, Ernst', '王小明', 'Παπαδόπουλος, Γιώργος'];
  await writeBibtex([{ citekey: 'names2024', title: 'Five names', authors: names, year: 2024, doi: '10.5555/names.2024' }], target);
  const text = fs.readFileSync(target, 'utf8');
  assert.doesNotMatch(text, /\{\\u/, 'no {\\u …} escapes: names are raw UTF-8');
  const parsed = (await parseBib(text))[0]!;
  const authors = parsed['author'] as ParsedName[];
  assert.equal(authors.length, 5);
  const want = names.map((n) => parsePersonName(n)!);
  authors.forEach((a, i) => {
    assert.equal(a['non-dropping-particle'], undefined, `author ${i + 1}: no particle split off the family`);
    assert.equal(a.family, want[i]!.family, `author ${i + 1} family`);
    assert.equal(a.given, want[i]!.given, `author ${i + 1} given`);
  });
  assert.deepEqual(
    authors.map((a) => [a.family, a.given ?? null]),
    [
      ['Эсенаманов', 'Байэл'],
      ['Vaswani', 'Ashish'],
      ['van der Maaten', 'Ernst'],
      ['王小明', null],
      ['Παπαδόπουλος', 'Γιώργος'],
    ],
  );
});

test('SRC-12: corporate names stay one literal name; suffixes survive', () => {
  const bib = renderBibtex([
    { citekey: 'encode2012', title: 'An integrated encyclopedia of DNA elements', authors: ['{ENCODE Project Consortium}'], year: 2012, doi: '10.1038/nature11247' },
    { citekey: 'king1963', title: 'Letter from Birmingham Jail', authors: ['King, Martin Luther, Jr.', 'Bill and Melinda Gates, Foundation'], year: 1963, doi: '10.5555/king.1963' },
  ]);
  assert.match(bib, /author = \{\{ENCODE Project Consortium\}\}/);
  const enc = entryById(bib, 'encode2012')['author'] as ParsedName[];
  assert.deepEqual(enc, [{ family: 'ENCODE Project Consortium' }]);
  const king = entryById(bib, 'king1963')['author'] as ParsedName[];
  assert.equal(king.length, 2, 'a family name containing "and" is not split into two authors');
  assert.deepEqual({ ...king[0] }, { family: 'King', given: 'Martin Luther', suffix: 'Jr.' });
  assert.equal(king[1]!.family, 'Bill and Melinda Gates');
});

test('SRC-12: every bibliographic field is written and read back; types map to BibTeX entry types', () => {
  const sources: BibSource[] = [
    {
      citekey: 'lecun2015', title: 'Deep learning', authors: ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey'], year: 2015,
      doi: '10.1038/nature14539', venue: 'Nature', volume: '521', issue: '7553', pages: '436-444',
      publisher: 'Springer Science and Business Media LLC', type: 'article-journal',
      abstract: 'Deep learning allows computational models that are composed of multiple processing layers to learn representations of data.',
    },
    { citekey: 'kuhn1962', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas S.'], year: 1962, isbn: '978-0-226-45808-3', publisher: 'University of Chicago Press', type: 'book' },
    { citekey: 'smith2000', title: 'A chapter', authors: ['Smith, Ann'], editors: ['Editor, Eve'], venue: 'The Handbook', publisher: 'Pub House', year: 2000, pages: '1–20', doi: '10.5555/chap.2000', type: 'chapter' },
    { citekey: 'conf2019', title: 'A conference paper', authors: ['Lee, Kim'], venue: 'Proceedings of the Conference', year: 2019, doi: '10.5555/conf.2019', type: 'paper-conference' },
    { citekey: 'nber2020', title: 'A working paper', authors: ['Doe, Jo'], publisher: 'National Bureau of Economic Research', issue: 'w27000', year: 2020, doi: '10.3386/w27000', type: 'report' },
    { citekey: 'thesis2018', title: 'A thesis', authors: ['Roe, Ray'], publisher: 'MIT', year: 2018, doi: '10.5555/thesis.2018', type: 'thesis' },
    { citekey: 'vaswani2017', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, arxiv: '1706.03762', type: 'preprint', abstract: 'The dominant sequence transduction models.' },
    { citekey: 'witten1999', title: 'An old-style preprint', authors: ['Witten, Edward'], year: 1999, arxiv: 'hep-th/9901001v2' },
  ];
  const bib = renderBibtex(sources);
  const types = Object.fromEntries([...bib.matchAll(/^@(\w+)\{([^,]+),/gm)].map((m) => [m[2], m[1]]));
  assert.deepEqual(types, {
    conf2019: 'inproceedings',
    kuhn1962: 'book',
    lecun2015: 'article',
    nber2020: 'techreport',
    smith2000: 'incollection',
    thesis2018: 'phdthesis',
    vaswani2017: 'misc',
    witten1999: 'misc',
  });

  const lecun = entryById(bib, 'lecun2015');
  assert.equal(lecun['container-title'], 'Nature');
  assert.equal(lecun['volume'], '521');
  assert.equal(lecun['issue'], '7553');
  assert.equal(lecun['page'], '436-444');
  assert.equal(lecun['publisher'], 'Springer Science and Business Media LLC', 'a publisher containing "and" is not split');
  assert.equal(lecun['DOI'], '10.1038/nature14539');
  assert.match(bib, /abstract = \{Deep learning allows computational models/);
  assert.equal(lecun['abstract'], sources[0]!.abstract, 'parseBib reads the abstract back');

  const kuhn = entryById(bib, 'kuhn1962');
  assert.equal(kuhn['ISBN'], '9780226458083', 'ISBN-13 digits');
  assert.equal(kuhn['publisher'], 'University of Chicago Press');

  const chap = entryById(bib, 'smith2000');
  assert.equal(chap['container-title'], 'The Handbook', 'a chapter carries its booktitle');
  assert.deepEqual(chap['editor'], [{ family: 'Editor', given: 'Eve' }]);
  assert.equal(chap['page'], '1-20');

  assert.equal(entryById(bib, 'conf2019')['container-title'], 'Proceedings of the Conference');
  assert.equal(entryById(bib, 'nber2020')['publisher'], 'National Bureau of Economic Research', 'institution');
  assert.equal(entryById(bib, 'nber2020')['number'], 'w27000');
  assert.equal(entryById(bib, 'thesis2018')['publisher'], 'MIT', 'school');

  const vaswani = entryById(bib, 'vaswani2017');
  assert.match(bib, /eprint = \{1706\.03762\},\n {2}archivePrefix = \{arXiv\},/);
  assert.equal(vaswani['eprint'], '1706.03762', 'parseBib preserves eprint');
  assert.equal(vaswani['archivePrefix'], 'arXiv', 'parseBib preserves archivePrefix');
  assert.equal(vaswani['URL'], 'https://arxiv.org/abs/1706.03762');
  const witten = entryById(bib, 'witten1999');
  assert.equal(witten['eprint'], 'hep-th/9901001');
  assert.equal(witten['primaryClass'], 'hep-th', 'an old-style id names its primary class');
});

test('SRC-12: abstract = {…} is present exactly when the entry has one', () => {
  const bib = renderBibtex([
    { citekey: 'with2020', title: 'With', authors: ['A, B'], year: 2020, doi: '10.5555/with', abstract: 'Has an abstract & 50% braces {x}.' },
    { citekey: 'without2020', title: 'Without', authors: ['A, B'], year: 2020, doi: '10.5555/without' },
  ]);
  const blocks = bib.split(/\n(?=@)/);
  assert.match(blocks.find((b) => b.includes('with2020,'))!, /abstract = \{/);
  assert.doesNotMatch(blocks.find((b) => b.includes('without2020,'))!, /abstract/);
  assert.equal(entryById(bib, 'with2020')['abstract'], 'Has an abstract & 50% braces {x}.');
});

test('SRC-12: an identifier-less bring-your-own PDF is written (@misc); an identifier-less source without one is not', () => {
  const bib = renderBibtex([
    { citekey: 'local2020', title: 'My own PDF', authors: ['Doe, Jane'], year: 2020, byo: { file: 'sources/local2020.pdf', sha256: 'a'.repeat(64) } },
    { citekey: 'nothing2020', title: 'No identifier', authors: ['Doe, Jane'], year: 2020 },
  ]);
  assert.match(bib, /^@misc\{local2020,/m);
  assert.doesNotMatch(bib, /nothing2020/);
});

test('SRC-12: TeX ligatures and specials in titles read back as typed', () => {
  const title = 'Pages 1--2, em---dash, ``quotes\'\', 50% & $5 #1 a_b ~x^2 \\cmd {braces} <i>x</i>';
  const bib = renderBibtex([{ citekey: 'tex2020', title, authors: ['A, B'], year: 2020, doi: '10.5555/tex' }]);
  assert.equal(entryById(bib, 'tex2020')['title'], title);
});

// ---------------------------------------------------------------------------
// Property: lossless round trip (D-19-19, >= 1000 runs).
// ---------------------------------------------------------------------------

const LETTERS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZéèüößçñøåÉÜ',
  ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ',
  ...'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩάέήίόύώ',
  ...'王小明田中太郎李光合成量子',
  ...'محمدعلي',
  "'",
  '-',
  '.',
];
const word = fc.array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 9 }).map((a) => a.join(''));
const nameArb = fc
  .record({ family: fc.array(word, { minLength: 1, maxLength: 3 }), given: fc.array(word, { minLength: 0, maxLength: 3 }) })
  .map(({ family, given }) => (given.length > 0 ? `${family.join(' ')}, ${given.join(' ')}` : family.join(' ')));
const textArb = fc.oneof(
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 60 }),
  fc.string({ unit: fc.constantFrom(...'ab \\{}$&%#_~^`-\'",<>!?@=.;:()[]|/*+'.split('')), minLength: 1, maxLength: 40 }),
);

test('SRC-12 property: renderBibtex -> parseBib is lossless for Unicode names, titles and abstracts (1000 runs)', () => {
  fc.assert(
    fc.property(fc.array(nameArb, { minLength: 1, maxLength: 4 }), textArb, textArb, (names, title, abstract) => {
      fc.pre(normalizeBibValue(title).length > 0);
      const bib = renderBibtex([{ citekey: 'prop2020', title, authors: names, year: 2020, doi: '10.5555/prop', abstract }]);
      const e = parseBibSync(bib)[0]!;
      assert.equal(e['title'], normalizeBibValue(title));
      const a = normalizeBibValue(abstract);
      if (a) assert.equal(e['abstract'], a);
      const got = (e['author'] as ParsedName[]).map((x) => ({ family: x.family, given: x.given }));
      const want = names.map((n) => {
        const p = parsePersonName(n)!;
        return { family: p.family, given: p.given };
      });
      assert.deepEqual(got, want);
    }),
    { numRuns: 1000 },
  );
});

// ---------------------------------------------------------------------------
// APA in-text rendering (offline renderer, and pandoc citeproc when present).
// ---------------------------------------------------------------------------

const VASWANI: BibSource = { citekey: 'vaswani2017', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, arxiv: '1706.03762', type: 'preprint' };

test('SRC-12: the offline renderer cites Vaswani & Shazeer 2017 as "(Vaswani & Shazeer, 2017)"', async () => {
  const entries = await parseBib(renderBibtex([VASWANI]));
  assert.equal(await renderInText(entries, 'apa'), '(Vaswani & Shazeer, 2017)');
  const reference = await renderApa(entries);
  assert.match(reference, /^Vaswani, A\., & Shazeer, N\. \(2017\)\. Attention Is All You Need\. https:\/\/arxiv\.org\/abs\/1706\.03762/);
});

function pandocBinary(): string | null {
  const candidates = [process.env['PENSMITH_PANDOC'], 'pandoc'].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /^pandoc/.test(r.stdout)) return c;
  }
  return null;
}

test('SRC-12: pandoc citeproc (when on PATH) renders "(Vaswani & Shazeer, 2017)" from the written bib', (t) => {
  const pandoc = pandocBinary();
  if (pandoc === null) {
    t.diagnostic('pandoc is not on PATH: the citeproc half of this check needs it (the offline half ran above)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-pandoc-apa-'));
  fs.writeFileSync(path.join(dir, 'refs.bib'), renderBibtex([VASWANI]));
  fs.writeFileSync(path.join(dir, 'doc.md'), 'A claim [@vaswani2017].\n');
  const r = spawnSync(
    pandoc,
    ['doc.md', '--citeproc', '--bibliography', 'refs.bib', '--csl', path.join(REPO, 'templates', 'citation-styles', 'apa.csl'), '-t', 'plain'],
    { cwd: dir, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /A claim \(Vaswani & Shazeer, 2017\)\./);
  assert.match(r.stdout, /Vaswani, A\., & Shazeer, N\. \(2017\)\. Attention is all you need\./);
});
