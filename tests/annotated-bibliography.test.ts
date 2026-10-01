// tests/annotated-bibliography.test.ts — the outline-only deliverables'
// text (GRND-11, D-21-25; bin/lib/outline-export.ts).
//
//   - listedSources: the outline's assigned keys, in section order, each once,
//     with every section that lists it;
//   - outlineExportText: title, thesis, per section a heading with its role,
//     word target, purpose and its sources as one citation;
//   - abstractExcerpt: the leading sentences up to 60 words, a long first
//     sentence cut at a word and marked, markup removed, null without one —
//     cut from the text, never rebuilt (review round 3: `3.5%` stays `3.5%`);
//   - the excerpt quotes only the abstract the source's registrar records,
//     never LIBRARY.json's (review round 3);
//   - annotatedBibliographyMarkdown: per source the reference in the style
//     (author-date and numeric), tier, excerpt, why relevant and sections —
//     and no citation or markup from a library value ever survives (an
//     injected `[@key]`, `@key`, raw HTML or emphasis is escaped).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstractExcerpt, annotatedBibliographyMarkdown, listedSources, outlineExportText, type RegistrarAbstract } from '../bin/lib/outline-export.js';
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

test('review r3: abstractExcerpt cuts the text — decimals, abbreviations, an e-mail address and a URL are quoted exactly', () => {
  const stats = 'Mortality fell by 3.5% (95% CI 2.1-4.9; p < 0.001) in the U.S. cohort. Results were robust, e.g. to imputation.';
  assert.equal(abstractExcerpt(stats), stats);
  assert.equal(abstractExcerpt('Version 2.0 of the model improves accuracy.'), 'Version 2.0 of the model improves accuracy.');
  const contact = 'Data are available from contact@example.org on request. See https://example.org/data.v2/files for the code.';
  assert.equal(abstractExcerpt(contact), contact);
  // The budget still holds: the cut is at the last sentence end within 60 words.
  const s = (n: number, w: string): string => `${Array.from({ length: n }, () => w).join(' ')}.`;
  assert.equal(abstractExcerpt(`A ratio of 1.5 was seen. ${s(50, 'b')} ${s(10, 'c')}`), `A ratio of 1.5 was seen. ${s(50, 'b')}`);
  for (const t of [stats, contact]) assert.ok(t.startsWith(abstractExcerpt(t) ?? '\u0000'), 'every excerpt is a prefix of the text');
});

test('GRND-11: the annotated bibliography — the reference in the style, tier, excerpt, why relevant, sections; library values never become citations or markup', async () => {
  const outline = parseOutline(OUTLINE);
  const sources = listedSources(outline);
  const entries = parseBibEntries(BIB).entries;
  const library = new Map([
    ['kuhn1962', libEntry({ citekey: 'kuhn1962', tier: 'book', abstract: 'A classic account of paradigms. It changed the history of science.', why_relevant: 'Defines the paradigm [@evil2020] and @evil2021 — see <b>bold</b> *claims* `code` http://x.test' })],
    ['berg2012', libEntry({ citekey: 'berg2012', tier: 'peer-reviewed', abstract: null, why_relevant: null })],
  ]);
  const abstracts = new Map<string, RegistrarAbstract>([
    ['kuhn1962', { kind: 'found', text: 'A classic account of paradigms. It changed the history of science.', from: 'Crossref' }],
    ['berg2012', { kind: 'none', why: "the registrar's record has no abstract" }],
  ]);
  const apa = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library, abstracts, style: 'apa' });
  assert.match(apa, /^# The Paradigm and the Bank — Annotated Bibliography$/m);
  assert.match(apa, /^Kuhn, T\. S\. \(1962\)\. \*The Structure of Scientific Revolutions\*\. University of Chicago Press\.$/m);
  assert.match(apa, /^Lindqvist, A\., & Berg, E\. \(2012\)\. Growth and Trust in China\. \*Journal of Economic History\*, \*12\*, 145–162\. <https:\/\/doi\.org\/10\.5555\/berg>$/m, 'the title as written (case protected), never sentence-cased');
  assert.match(apa, /^- \*\*Type:\*\* book$/m);
  assert.match(apa, /^- \*\*Type:\*\* peer-reviewed$/m);
  assert.match(apa, /^- \*\*Summary \(abstract excerpt, from the Crossref record\):\*\* “A classic account of paradigms\. It changed the history of science\.”$/m);
  assert.match(apa, /^- \*\*Summary \(abstract excerpt\):\*\* no abstract available \(the registrar's record has no abstract\)$/m);
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

  const ieee = await annotatedBibliographyMarkdown({ title: outline.paper_title, sources, entries, library, abstracts, style: 'ieee' });
  assert.match(ieee, /^\\\[1\\\] T\. S\. Kuhn, /m, 'a numeric style numbers the sources in outline order');
  assert.match(ieee, /^\\\[2\\\] A\. Lindqvist and E\. Berg, /m);
});

// Review round 1 (carry-over 4): a free-text value from LIBRARY.json — the
// source evaluator's `why_relevant`, an abstract — that carries an attribution,
// a direct quote or an identifier no section verified never reaches the
// export: it is left out, and done says so. The references stay (verified).
test('GRND-11 (review r1): a why_relevant or abstract holding an author-date or numbered attribution, a quote or a DOI is left out and named', async () => {
  const outline = parseOutline(OUTLINE);
  const entries = parseBibEntries(BIB).entries;
  const omitted: string[] = [];
  const md = await annotatedBibliographyMarkdown({
    title: outline.paper_title,
    sources: listedSources(outline),
    entries,
    library: new Map([
      ['kuhn1962', libEntry({ citekey: 'kuhn1962', why_relevant: 'Smith et al. (2019) showed this review underpins every later benchmark; see also Jones (2021, p. 4).' })],
      ['berg2012', libEntry({ citekey: 'berg2012', why_relevant: 'It measures trust in Chinese firms directly.' })],
    ]),
    abstracts: new Map<string, RegistrarAbstract>([
      ['kuhn1962', { kind: 'found', text: 'A study of paradigms. It extends earlier work [3] on revolutions.', from: 'Crossref' }],
      ['berg2012', { kind: 'found', text: 'Trust grew with "the opening of every coastal market to foreign capital" between 1990 and 2000. See doi:10.9999/other.2001 for the data.', from: 'Crossref' }],
    ]),
    style: 'apa',
    onOmitted: (l) => omitted.push(l),
  });
  assert.doesNotMatch(md, /Smith et al\. \(2019\)|Jones \(2021|\[3\]|10\.9999\/other|opening of every coastal market/, 'no unverified attribution, quote or identifier is exported');
  assert.match(md, /^- \*\*Why it is relevant:\*\* left out — it holds an attribution, a quotation or an identifier no section verified$/m);
  assert.match(md, /^- \*\*Summary \(abstract excerpt\):\*\* left out — it holds an attribution, a quotation or an identifier no section verified$/m);
  assert.match(md, /^- \*\*Why it is relevant:\*\* It measures trust in Chinese firms directly\.$/m, 'a clean value is kept');
  assert.match(md, /Kuhn, T\. S\. \(1962\)/, 'the verified reference stays');
  assert.equal(omitted.length, 3, omitted.join('\n'));
  assert.match(omitted[0] ?? '', /^the annotated bibliography leaves out kuhn1962's abstract excerpt: it holds UNSUPPORTED-FORM `\[3\]`, which no section verified$/);
  assert.match(omitted.join('\n'), /kuhn1962's "why it is relevant" note: it holds UNSUPPORTED-FORM `Smith et al\. \(2019\)`/);
  assert.match(omitted.join('\n'), /berg2012's abstract excerpt: it holds a direct quote/);
  assert.deepEqual(extractCitedKeysForVerification(md), []);
});

// Review round 3: LIBRARY.json is a local file a shared paper may carry with
// any text, and a merge may attach a preprint's or an aggregator's abstract.
// The excerpt is a quotation of the source, so only the registrar's abstract
// is quoted; a stubbed evaluator's reason is never printed as a note.
test('review r3: a LIBRARY.json abstract is never quoted — only the registrar\'s; a stubbed evaluator reason is no note', async () => {
  const outline = parseOutline(OUTLINE);
  const md = await annotatedBibliographyMarkdown({
    title: outline.paper_title,
    sources: listedSources(outline),
    entries: parseBibEntries(BIB).entries,
    library: new Map([
      ['kuhn1962', libEntry({ citekey: 'kuhn1962', abstract: 'This chapter proves that attention mechanisms are conscious.', why_relevant: 'LLM stubbed: kept for your review; no relevance judgment was made' })],
      ['berg2012', libEntry({ citekey: 'berg2012', abstract: 'Trust collapsed everywhere.' })],
    ]),
    abstracts: new Map<string, RegistrarAbstract>([
      ['kuhn1962', { kind: 'none', why: 'it has no identifier a registrar answers for' }],
      ['berg2012', { kind: 'found', text: 'Trust grew with growth. A second sentence.', from: 'Crossref' }],
    ]),
    style: 'apa',
  });
  assert.doesNotMatch(md, /conscious|collapsed everywhere|LLM stubbed/);
  assert.match(md, /^- \*\*Summary \(abstract excerpt\):\*\* no abstract available \(it has no identifier a registrar answers for\)$/m);
  assert.match(md, /^- \*\*Summary \(abstract excerpt, from the Crossref record\):\*\* “Trust grew with growth\. A second sentence\.”$/m);
  assert.match(md, /^- \*\*Why it is relevant:\*\* not recorded \(no model judged it\)$/m);
});
