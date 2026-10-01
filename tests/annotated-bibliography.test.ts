// tests/annotated-bibliography.test.ts — the outline-only deliverables'
// text (GRND-11, D-21-25; bin/lib/outline-export.ts).
//
//   - listedSources: the outline's assigned keys, in section order, each once,
//     with every section that lists it;
//   - outlineExportText: title, thesis, per section a heading with its role,
//     word target, purpose and its sources as one citation;
//   - abstractExcerpt: the leading sentences up to 60 words, a long first
//     sentence cut at a word and marked, markup removed, null without one;
//   - annotatedBibliographyMarkdown: per source the reference in the style
//     (author-date and numeric), tier, excerpt, why relevant and sections —
//     and no citation or markup from a library value ever survives (an
//     injected `[@key]`, `@key`, raw HTML or emphasis is escaped).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstractExcerpt, annotatedBibliographyMarkdown, listedSources, outlineExportText } from '../bin/lib/outline-export.js';
import { parseOutline } from '../bin/lib/outline-parse.js';
import { parseBibEntries } from '../bin/lib/citations.js';
import { extractCitedKeysForVerification } from '../bin/lib/citation-token.js';
import { parseMarkdown } from '../bin/lib/export/markdown.js';
import type { LibraryEntry } from '../bin/lib/library.js';

const OUTLINE = [
  '# The Paradigm and the Bank',
  '',
  'Thesis: Scientific change is social.',
  '',
  '| # | slug | title | role | depends_on | word target | assigned_sources | voice |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | intro | Introduction | intro |  | 300 | kuhn1962, berg2012 |  |',
  '| 2 | evidence | The Evidence | body | intro | 800 | berg2012 |  |',
  '| 3 | close | Conclusion | conclusion |  | 200 |  |  |',
  '',
].join('\n');

const BIB = [
  '@book{kuhn1962,',
  '  author = {Kuhn, Thomas S.},',
  '  title = {The Structure of Scientific Revolutions},',
  '  year = {1962},',
  '  publisher = {University of Chicago Press},',
  '  isbn = {9780226458083},',
  '}',
  '',
  '@article{berg2012,',
  '  author = {Lindqvist, Anna and Berg, Erik},',
  '  title = {Growth and Trust in China},',
  '  journal = {Journal of Economic History},',
  '  year = {2012},',
  '  volume = {12},',
  '  pages = {145--162},',
  '  doi = {10.5555/berg},',
  '}',
  '',
].join('\n');

function libEntry(over: Partial<LibraryEntry> & { citekey: string }): LibraryEntry {
  return { tier: null, abstract: null, why_relevant: null, ...over } as unknown as LibraryEntry;
}

test('GRND-11: listedSources — the outline\'s keys in section order, each once, with the sections that list it', () => {
  const sources = listedSources(parseOutline(OUTLINE));
  assert.deepEqual(sources, [
    { key: 'kuhn1962', sections: [{ id: '1', title: 'Introduction' }] },
    { key: 'berg2012', sections: [{ id: '1', title: 'Introduction' }, { id: '2', title: 'The Evidence' }] },
  ]);
});

test('GRND-11: outlineExportText — title, thesis, each section with role, word target and its sources as one citation', () => {
  const text = outlineExportText(parseOutline(OUTLINE));
  assert.match(text, /^# The Paradigm and the Bank\n\n\*\*Thesis:\*\* Scientific change is social\.\n/);
  assert.match(text, /^## 1\. Introduction\n\n\*Role:\* intro · \*Word target:\* 300 words\n\n\*Sources:\* \[@kuhn1962; @berg2012\]$/m);
  assert.match(text, /^## 2\. The Evidence\n\n\*Role:\* body · \*Word target:\* 800 words\n\n\*Sources:\* \[@berg2012\]$/m);
  assert.match(text, /^## 3\. Conclusion\n\n.*\n\n\*Sources:\* none assigned$/m);
  assert.deepEqual(extractCitedKeysForVerification(text), ['kuhn1962', 'berg2012'], 'the gate reads exactly the listed keys');
});

test('GRND-11: abstractExcerpt — the leading sentences up to 60 words, labelled by the caller; a long first sentence is cut and marked', () => {
  assert.equal(abstractExcerpt(null), null);
  assert.equal(abstractExcerpt('   '), null);
  assert.equal(abstractExcerpt('<jats:p>One <i>short</i> sentence.</jats:p> Two.'), 'One short sentence. Two.');
  const s = (n: number, w: string): string => `${Array.from({ length: n }, () => w).join(' ')}.`;
  // 25 + 30 words fit; the third sentence (10 more) would pass 60.
  assert.equal(abstractExcerpt(`${s(25, 'a')} ${s(30, 'b')} ${s(10, 'c')}`), `${s(25, 'a')} ${s(30, 'b')}`);
  const long = abstractExcerpt(s(80, 'w')) ?? '';
  assert.equal(long.split(' ').length, 61, '60 words and the mark');
  assert.ok(long.endsWith(' …'));
  assert.equal(abstractExcerpt('Is it? Yes! Done.'), 'Is it? Yes! Done.');
});

test('GRND-11: the annotated bibliography — the reference in the style, tier, excerpt, why relevant, sections; library values never become citations or markup', async () => {
  const outline = parseOutline(OUTLINE);
  const sources = listedSources(outline);
  const entries = parseBibEntries(BIB).entries;
  const library = new Map([
    ['kuhn1962', libEntry({ citekey: 'kuhn1962', tier: 'book', abstract: 'A classic account of paradigms. It changed the history of science.', why_relevant: 'Defines the paradigm [@evil2020] and @evil2021 — see <b>bold</b> *claims* `code` http://x.test' })],
    ['berg2012', libEntry({ citekey: 'berg2012', tier: 'peer-reviewed', abstract: null, why_relevant: null })],
  ]);
  const apa = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library, style: 'apa' });
  assert.match(apa, /^# The Paradigm and the Bank — Annotated Bibliography$/m);
  assert.match(apa, /^Kuhn, T\. S\. \(1962\)\. \*The Structure of Scientific Revolutions\*\. University of Chicago Press\.$/m);
  assert.match(apa, /^Lindqvist, A\., & Berg, E\. \(2012\)\. Growth and Trust in China\. \*Journal of Economic History\*, \*12\*, 145–162\. <https:\/\/doi\.org\/10\.5555\/berg>$/m, 'the title as written (case protected), never sentence-cased');
  assert.match(apa, /^- \*\*Type:\*\* book$/m);
  assert.match(apa, /^- \*\*Type:\*\* peer-reviewed$/m);
  assert.match(apa, /^- \*\*Summary \(abstract excerpt\):\*\* “A classic account of paradigms\. It changed the history of science\.”$/m);
  assert.match(apa, /^- \*\*Summary \(abstract excerpt\):\*\* no abstract available$/m);
  assert.match(apa, /^- \*\*Why it is relevant:\*\* not recorded$/m);
  assert.match(apa, /^- \*\*Supports:\*\* §1 Introduction; §2 The Evidence$/m);
  assert.deepEqual(extractCitedKeysForVerification(apa), [], 'no citation in the annotated bibliography');
  // The injected markup reads back as text.
  const parsed = JSON.stringify(parseMarkdown(apa).blocks);
  assert.doesNotMatch(parsed, /"t":"code"/, 'no code span');
  assert.doesNotMatch(parsed, /"t":"(emph|strong)","children":\[\{"t":"text","text":"(claims|bold)"/, 'library values are not emphasis or strong');
  assert.match(
    apa,
    /^- \*\*Why it is relevant:\*\* Defines the paradigm \\\[\\@evil2020\\\] and \\@evil2021 — see bold \\\*claims\\\* \\`code\\` http:\/\/x\.test$/m,
    'markup tags removed, everything else escaped as text',
  );

  const ieee = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library, style: 'ieee' });
  assert.match(ieee, /^\\\[1\\\] T\. S\. Kuhn, /m, 'a numeric style numbers the sources in outline order');
  assert.match(ieee, /^\\\[2\\\] A\. Lindqvist and E\. Berg, /m);
});
