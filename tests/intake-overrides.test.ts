// tests/intake-overrides.test.ts — GRND-04 (D-18-11): plain-English overrides
// and the deterministic facts intake reads from the assignment.
//
//   - citation style: "use MLA instead of APA" → mla; "APA style", "APA 7",
//     "in MLA format", "Citation style: Chicago" → the style; a negated or
//     merely mentioned name ("instead of APA", "in Chicago", "Harvard
//     University") is not an override; the last instruction wins;
//   - the alias table (schemas/config.ts): Chicago → chicago-notes-bib, the 8
//     styles and their spellings; an unknown name is refused;
//   - sectioning notes ("I need a literature review section before methods");
//   - the stated length ("1500-word", "1,500 words", ranges, pages × 300);
//   - paper type, topic phrase, discipline mention, labelled topic lines;
// every parser is exercised on LF and CRLF input.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clausesOf,
  disciplineMentionFrom,
  labelledTopicLines,
  paperTypeFrom,
  parseIntakeOverrides,
  parseLengthAnswer,
  sectioningNotesFrom,
  statedLengthWords,
  styleOverrideFrom,
  thesisSeedFrom,
  topicFromAssignment,
  topicIsGrounded,
  withThesisSeed,
} from '../bin/lib/intake-overrides.js';
import { citationStyleChoices, citationStyleKey, CITATION_STYLE_NAMES } from '../bin/lib/schemas/config.js';
import { CSL_STYLE_KEYS } from '../bin/lib/disciplines.js';

const A1 = 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.';

function both(text: string): string[] {
  const lf = text.replace(/\r\n/g, '\n');
  return [lf, lf.replace(/\n/g, '\r\n')];
}

test('GRND-04: the alias table resolves every spelling of the 8 styles, case-insensitively', () => {
  const cases: Array<[string, string]> = [
    ['APA', 'apa'], ['apa 7', 'apa'], ['APA 7th edition', 'apa'], ['APA style', 'apa'],
    ['MLA', 'mla'], ['MLA 9', 'mla'], ['mla format', 'mla'],
    ['Chicago', 'chicago-notes-bib'], ['Chicago Notes-Bibliography', 'chicago-notes-bib'], ['Chicago (Notes-Bibliography)', 'chicago-notes-bib'],
    ['Chicago NB', 'chicago-notes-bib'], ['chicago-notes-bib', 'chicago-notes-bib'], ['Turabian', 'chicago-notes-bib'],
    ['Chicago Author-Date', 'chicago-author-date'], ['Chicago (Author-Date)', 'chicago-author-date'], ['Chicago AD', 'chicago-author-date'],
    ['chicago-author-date', 'chicago-author-date'],
    ['IEEE', 'ieee'], ['AMA', 'ama'], ['AMA 11th edition', 'ama'], ['Vancouver', 'vancouver'], ['Harvard referencing', 'harvard'],
  ];
  for (const [name, key] of cases) assert.equal(citationStyleKey(name), key, name);
  for (const bad of ['nonsense', 'APA MLA', '', 'toString', 'constructor', '__proto__']) assert.equal(citationStyleKey(bad), null, bad);
  // Every display name and CSL key resolves to one of the 8 keys.
  for (const n of CITATION_STYLE_NAMES) assert.ok(CSL_STYLE_KEYS.includes(citationStyleKey(n) as never), n);
  for (const k of CSL_STYLE_KEYS) assert.equal(citationStyleKey(k), k);
  const choices = citationStyleChoices();
  for (const k of CSL_STYLE_KEYS) assert.ok(choices.includes(k), `the refusal lists ${k}`);
});

test('GRND-04: a style instruction in plain English is an override; a mention is not', () => {
  const yes: Array<[string, string]> = [
    [A1, 'apa'],
    ['Use MLA instead of APA.', 'mla'],
    ['Please use MLA for this paper.', 'mla'],
    ['Format the references in Chicago style.', 'chicago-notes-bib'],
    ['Citation style: Chicago Author-Date', 'chicago-author-date'],
    ['Cite sources in IEEE.', 'ieee'],
    ['Essay, 5 pages, in MLA format, on the French Revolution.', 'mla'],
    ['Follow APA 7 throughout.', 'apa'],
    ['Use APA. Actually, use Harvard referencing instead.', 'harvard'],
    ['I would rather you not use APA; follow MLA.', 'mla'],
  ];
  for (const [text, style] of yes) {
    for (const t of both(text)) assert.equal(styleOverrideFrom(t)?.style, style, JSON.stringify(t));
  }
  const no = [
    'Write about urban planning in Chicago.',
    'Harvard University researchers found a link.',
    'A Vancouver cohort study of 300 adults.',
    'The American Psychological Association (APA) publishes the manual.',
    'Do not use APA.',
    'Write a 1500-word essay on the French Revolution.',
  ];
  for (const text of no) assert.equal(styleOverrideFrom(text), null, text);
});

test('GRND-04: sectioning notes from the assignment and the answers', () => {
  for (const t of both('Write a lab report.\nI need a literature review section before methods.\nInclude a limitations section. No abstract.')) {
    assert.deepEqual(sectioningNotesFrom(t), ['I need a literature review section before methods', 'Include a limitations section', 'No abstract']);
  }
  assert.deepEqual(sectioningNotesFrom(A1), [], 'the task sentence is not a sectioning note');
  assert.deepEqual(sectioningNotesFrom('Write a 1500-word literature review on memory.'), []);
  const o = parseIntakeOverrides('Write about memory. Use APA.', ['Put the discussion after the results.', 'Use MLA instead']);
  assert.equal(o.citationStyle?.style, 'mla', 'a later answer corrects the assignment');
  assert.deepEqual(o.sectioningNotes, ['Put the discussion after the results']);
});

test('GRND-02: the stated length — words, ranges, pages', () => {
  const cases: Array<[string, number | null]> = [
    [A1, 1500],
    ['A 1,500 word essay.', 1500],
    ['Write 2000 words.', 2000],
    ['1,500–2,000 words', 1750],
    ['between 1200 and 1500 words? no: 1200-1500 words', 1350],
    ['A 5-page paper', 1500],
    ['6 pages double spaced', 1800],
    ['4-6 pages', 1500],
    ['Write about the 1789 revolution.', null],
    ['3 words', null],
    ['no length', null],
  ];
  for (const [text, n] of cases) {
    for (const t of both(text)) assert.equal(statedLengthWords(t), n, text);
  }
  assert.equal(parseLengthAnswer('1500'), 1500);
  assert.equal(parseLengthAnswer('1,500 words'), 1500);
  assert.equal(parseLengthAnswer('6 pages'), 1800);
  assert.equal(parseLengthAnswer('lots'), null);
  assert.equal(parseLengthAnswer('50'), null);
});

test('GRND-02: paper type, topic phrase and discipline mention (LF and CRLF)', () => {
  assert.equal(paperTypeFrom(A1), 'literature-review');
  assert.equal(paperTypeFrom('Argue whether social media harms adolescents'), 'argumentative');
  assert.equal(paperTypeFrom('Write a lab report on enzyme kinetics.'), 'lab-report');
  assert.equal(paperTypeFrom('Follow Chicago style. I need a literature review section before methods.'), 'other', 'a sectioning note is not the paper type');
  for (const t of both(A1)) assert.equal(topicFromAssignment(t), 'attention mechanisms in transformers');
  for (const t of both('Name: Jane Doe\r\nBIOL 210: Write a 2000-word review of CRISPR gene drives in mosquitoes. Use MLA for this paper.')) {
    assert.equal(topicFromAssignment(t), 'CRISPR gene drives in mosquitoes');
  }
  assert.equal(topicFromAssignment('Topic: The Treaty of Versailles\nWrite 6-8 pages.'), 'The Treaty of Versailles');
  assert.equal(topicFromAssignment('Essay, 5 pages, in MLA format, on the French Revolution.'), 'the French Revolution');
  assert.equal(topicFromAssignment('Write a 1,500–2,000 word argumentative essay on whether social media harms adolescents.'), 'whether social media harms adolescents');
  assert.equal(topicFromAssignment('Use MLA for this paper.'), '', 'an instruction is never a topic');
  for (const t of both('Write a 6 page essay on the causes of the French Revolution for my History class. Use MLA for this paper.')) {
    assert.equal(topicFromAssignment(t), 'the causes of the French Revolution', 'who the paper is for is not its topic');
  }
  assert.equal(topicFromAssignment('Write an essay on grading practices in the course'), 'grading practices in the course', 'a topic that is about a course keeps it');
  for (const t of both('For my Biology class: write a lab report on enzyme kinetics.')) assert.equal(disciplineMentionFrom(t), 'biology');
  assert.equal(disciplineMentionFrom('Discipline: Psychology\nWrite an essay on memory.'), 'psychology');
  assert.equal(disciplineMentionFrom(A1), null, '"literature review" is a paper type, not the Literature discipline');
  assert.equal(disciplineMentionFrom('Write a paper in English about Hamlet.'), null, 'a language is not a course');
  assert.deepEqual(labelledTopicLines('Topic: Abraham Lincoln\r\nTitle: The Speeches\r\nName: X'), ['Abraham Lincoln', 'The Speeches']);
});

test('GRND-02: a clarifier topic is used only when it shares a content word with the assignment', () => {
  assert.equal(topicIsGrounded('attention mechanisms in transformer models', A1), true);
  assert.equal(topicIsGrounded('urban heat islands and street tree canopy cover', A1), false, 'the template example is not grounded');
  assert.equal(topicIsGrounded('', A1), false);
});

test('sketch → new: the thesis seed line round-trips', () => {
  const t = withThesisSeed('Write about tutors.', 'Tutors help most with feedback');
  assert.equal(t, 'Write about tutors.\n\nThesis seed: Tutors help most with feedback');
  assert.equal(thesisSeedFrom(t), 'Tutors help most with feedback');
  assert.equal(thesisSeedFrom(t.replace(/\n/g, '\r\n')), 'Tutors help most with feedback');
  assert.equal(withThesisSeed('', 'X'), 'Thesis seed: X');
  assert.equal(thesisSeedFrom('no seed'), '');
  assert.deepEqual(clausesOf('One. Two!\r\nThree'), ['One.', 'Two!', 'Three']);
});
