// tests/citation-grammar-detect.test.ts — what the citation grammar finds
// beyond Pandoc citations: raw identifiers and author-year prose written as
// text, bracketed citations that do not parse, and direct quotations with the
// citation each one is attributed to.
//
// The verifier used to see only `[@key]` clusters, so a DOI pasted into the
// text, an `(Author, 2020)` citation, a broken `[@ key]` and every quotation
// not followed by a bare lowercase `[@key]` reached the export unchecked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCitations,
  findQuotes,
  findRawCitations,
  findUnparseableCitations,
} from '../bin/lib/citation-grammar.js';

const raws = (md: string): Array<[string, string]> => findRawCitations(md).map((r) => [r.kind, r.raw]);

test('raw identifiers: DOIs, doi.org URLs, arXiv IDs and PMIDs written as text', () => {
  const md = [
    'A bare DOI 10.1038/nature05678 and doi:10.1000/xyz123.',
    'A link (https://doi.org/10.1016/S0140-6736(97)11096-0).',
    'Preprints arXiv:1706.03762v5 and https://arxiv.org/abs/2103.00020 and arXiv: hep-th/9901001.',
    'PubMed PMID: 12345678, PMCID PMC7654321 and https://pubmed.ncbi.nlm.nih.gov/31234567/.',
  ].join('\n');
  assert.deepEqual(raws(md), [
    ['doi', '10.1038/nature05678'],
    ['doi', 'doi:10.1000/xyz123'],
    ['doi', 'https://doi.org/10.1016/S0140-6736(97)11096-0'],
    ['arxiv', 'arXiv:1706.03762v5'],
    ['arxiv', 'https://arxiv.org/abs/2103.00020'],
    ['arxiv', 'arXiv: hep-th/9901001'],
    ['pmid', 'PMID: 12345678'],
    ['pmid', 'PMCID PMC7654321'],
    ['pmid', 'https://pubmed.ncbi.nlm.nih.gov/31234567/'],
  ]);
});

test('raw author-year citations: parenthetical and narrative forms', () => {
  const md = [
    'Coherence is long lived (Engel et al., 2007, p. 4).',
    'Two groups agree (Smith & Lee, 2021; see also Doe 2019).',
    'Smith and Lee (2021) disagree, as does van der Berg (2018).',
    'Engel et al. (2007) were first; Smith’s (2020) review followed.',
    'Agencies report it too (WHO, 2020).',
  ].join('\n');
  assert.deepEqual(raws(md), [
    ['author-year', '(Engel et al., 2007, p. 4)'],
    ['author-year', '(Smith & Lee, 2021; see also Doe 2019)'],
    ['author-year', 'Smith and Lee (2021)'],
    ['author-year', 'van der Berg (2018)'],
    ['author-year', 'Engel et al. (2007)'],
    ['author-year', 'Smith’s (2020)'],
    ['author-year', '(WHO, 2020)'],
  ]);
});

test('raw citations: code, Pandoc citations, escapes and dates are not raw citations', () => {
  const md = [
    'Inline `10.1038/nature05678` and a key [@10.1234/abc] are fine.',
    '```',
    'doi:10.1000/fenced (Smith, 2020)',
    '```',
    'It happened in June (2020) and in (Summer 2019); also Brexit \\(2016).',
    'Figure 3 (2021 data) and a year range (2019-2020) are not citations.',
    'The Clean Air Act (1970), the Kyoto Protocol (1997) and the Framingham Heart Study (1948) are not either.',
  ].join('\n');
  assert.deepEqual(raws(md), []);
});

test('unparseable citations: an @ where a citation key should be, but no key parses', () => {
  const md = 'Broken [@ smith2020] and [@] and [-@] and [@-x]. Fine: [contact a@b.com], [text; @b], [@ok].';
  assert.deepEqual(findUnparseableCitations(md).map((u) => u.raw), ['[@ smith2020]', '[@]', '[-@]', '[@-x]']);
});

/** Each quotation as [quoted text, attributed keys]. */
function quotes(md: string): Array<[string, string[]]> {
  return findQuotes(md).map((q) => [q.text, q.citation ? q.citation.items.map((i) => i.key) : []]);
}

const Q = 'attention mechanisms alone suffice for sequence transduction';

test('quotes: the citation after the quote, in any Pandoc form, is the attribution', () => {
  assert.deepEqual(quotes(`They wrote "${Q}" [@vaswani2017, p. 2].`), [[Q, ['vaswani2017']]]);
  assert.deepEqual(quotes(`They wrote "${Q}" [@Vaswani2017].`), [[Q, ['Vaswani2017']]]);
  assert.deepEqual(quotes(`They wrote "${Q}" [@a; @b, ch. 3].`), [[Q, ['a', 'b']]]);
  assert.deepEqual(quotes(`They wrote "${Q}" (p. 2) [@k].`), [[Q, ['k']]]);
  assert.deepEqual(quotes(`They wrote “${Q},” the authors argue [see -@k, p. 9].`), [[Q, ['k']]]);
});

test('quotes: a citation before the quote in the same sentence attributes it', () => {
  assert.deepEqual(quotes(`As [@k] put it, "${Q}".`), [[Q, ['k']]]);
  assert.deepEqual(quotes(`@smith04 [p. 33] wrote that "${Q}".`), [[Q, ['smith04']]]);
  // A citation in an earlier sentence does not.
  assert.deepEqual(quotes(`Earlier work exists [@old]. Then someone wrote "${Q}".`), [[Q, []]]);
});

test('quotes: single quotes, curly or straight; apostrophes are not quotes', () => {
  assert.deepEqual(quotes(`UK style: ‘${Q}’ [@k].`), [[Q, ['k']]]);
  assert.deepEqual(quotes(`Straight: '${Q}' [@k].`), [[Q, ['k']]]);
  assert.deepEqual(quotes("The authors' view isn't new, and the model's claim stands [@k]."), []);
});

test('quotes: block quotes take the citation inside the block, or a citation line right after it', () => {
  assert.deepEqual(quotes(`Intro.\n\n> ${Q}\n> and more words here [@k, p. 4]\n\nAfter.`), [[`${Q} and more words here`, ['k']]]);
  assert.deepEqual(quotes(`Intro.\n\n>${Q}\n\n[@k, p. 4]\n`), [[Q, ['k']]]);
  assert.deepEqual(quotes(`As @k argues:\n\n> ${Q}\n\nNext paragraph.`), [[Q, ['k']]]);
  // A block quote with no citation of its own is not given to a citation in
  // an unrelated later paragraph.
  assert.deepEqual(quotes(`Intro.\n\n> ${Q}\n\nLater prose cites [@other] in passing.`), [[Q, []]]);
});

test('quotes: quotes inside code are not quotes', () => {
  assert.deepEqual(quotes(`Code \`"${Q}" [@k]\` only.`), []);
});

test('the smoother placeholders {{cite_K_M}} are never read as citations or citation text', () => {
  const md = 'A transition {{cite_0_1}} and {{cite_1_2}}.';
  assert.deepEqual(findCitations(md), []);
  assert.deepEqual(findRawCitations(md), []);
  assert.deepEqual(findUnparseableCitations(md), []);
});

test('raw author-year citations: Harvard page forms, bare pages, year ranges and square brackets', () => {
  const md = [
    'Coherence is long lived (Smith 2020: 45).',
    'It was shown twice (Smith, 2019-2021) and (Doe, 2018–19).',
    'The figure is on one page (Smith, 2020, 45) or a range (Lee, 2017, 12-14).',
    'Some write it in square brackets [Smith, 2020] or [see Doe & Lee, 2019].',
    'Narrative forms too: Smith (2020: 45) and Doe (2019, 7).',
  ].join('\n');
  assert.deepEqual(raws(md), [
    ['author-year', '(Smith 2020: 45)'],
    ['author-year', '(Smith, 2019-2021)'],
    ['author-year', '(Doe, 2018–19)'],
    ['author-year', '(Smith, 2020, 45)'],
    ['author-year', '(Lee, 2017, 12-14)'],
    ['author-year', '[Smith, 2020]'],
    ['author-year', '[see Doe & Lee, 2019]'],
    ['author-year', 'Smith (2020: 45)'],
    ['author-year', 'Doe (2019, 7)'],
  ]);
});

test('raw citations: named storms, recessions and outbreaks with their year are not citations', () => {
  const md = [
    'After Hurricane Katrina (2005) and Typhoon Haiyan (2013), the Great Recession (2008)',
    'and the Ebola Outbreak (2014) changed the field; so did the Great Depression (1929).',
    'A link [Smith, 2020](https://example.org) and an interval [0, 1] are not citations either.',
  ].join('\n');
  assert.deepEqual(raws(md), []);
});

test('quotes: a link or image title is not a quotation', () => {
  const title = 'a long link title of well over ten words that nobody would call a quotation';
  assert.deepEqual(quotes(`See [the source](https://example.org/a "${title}") and ![fig](f.png "${title}").`), []);
  assert.deepEqual(quotes(`See [the source][ref].\n\n[ref]: https://example.org/a "${title}"\n`), []);
});

test('quotes: a word clipped with a leading apostrophe does not open a quotation', () => {
  const md = "Critics dismissed 'em as fads, and 'tis said the field moved on, rock 'n' roll aside, as the authors' retrospective shows [@k].";
  assert.deepEqual(quotes(md), []);
  assert.deepEqual(quotes(`'Twas noted that '${Q}' [@k].`), [[Q, ['k']]]);
});

test('quotes and sentences: a CRLF blank line ends a paragraph, as an LF one does', () => {
  const lf = `An unclosed "quote starts here and runs on.\n\nNext paragraph closes it" with a citation [@k] and more words after.`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.deepEqual(quotes(lf), []);
  assert.deepEqual(quotes(crlf), []);
  const md = `Intro.\r\n\r\nThen someone wrote "${Q}".\r\n\r\nLater prose cites [@other].`;
  assert.deepEqual(quotes(md), [[Q, []]]);
  assert.deepEqual(quotes(`As @k argues:\r\n\r\n> ${Q}\r\n\r\nNext paragraph.`), [[Q, ['k']]]);
});

test('raw citations: a lifespan or a period after a name is not a citation', () => {
  const md = [
    'Charles Darwin (1809–1882) and Immanuel Kant (1724-1804) wrote before Max Weber (1864–1920).',
    'Ada Lovelace (1815–52) saw it first; the Weimar Republic (1919–1933) and President Obama (2009–2017) came later.',
  ].join('\n');
  assert.deepEqual(raws(md), []);
  // A range in a bracketed author-year citation is still one.
  assert.deepEqual(raws('It held (Smith, 2019–2021) and [Doe, 2018-19].'), [
    ['author-year', '(Smith, 2019–2021)'],
    ['author-year', '[Doe, 2018-19]'],
  ]);
});
