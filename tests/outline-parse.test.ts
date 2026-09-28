// tests/outline-parse.test.ts — RED (Wave 0) specs for bin/lib/outline-parse.ts.
//
// =========================================================================
// LOCKED ON-DISK .paper/OUTLINE.md FORMAT (single source of truth)
// =========================================================================
// Derived from workflows/outline.md steps 4 & 5 (the production `outline`
// verb prints the outline as this table at step 4 and persists the SAME
// human-readable Markdown at step 5 via atomicWriteFile).
//
// The persisted file is GitHub-Flavored-Markdown with:
//   1. An H1 title line:           `# <Paper Title>`
//   2. A GFM pipe table whose header row is EXACTLY (column order LOCKED):
//
//        | # | slug | title | depends_on | word target | assigned_sources |
//
//      followed by a delimiter row (`| --- | --- | ... |`) and one data
//      row per section, e.g.:
//
//        | 1 | 01-introduction | Introduction | | 800 | smith2020, jones2019 |
//        | 2 | 02-background | Background | 01-introduction | 1200 | doe2021 |
//
// Column semantics (parser contract):
//   - `#`                -> ParsedOutlineSection.n            (positive int)
//   - `slug`             -> ParsedOutlineSection.slug         (validateSlug)
//   - `title`            -> ParsedOutlineSection.title        (raw text)
//   - `depends_on`       -> ParsedOutlineSection.depends_on   (comma-split slugs; empty cell = [])
//   - `word target`      -> ParsedOutlineSection.estimated_word_count (optional int)
//   - `assigned_sources` -> NOT consumed by the wave graph (parser may keep it
//                            on the row but the scheduler never reads it here)
//
// Appearance order in the table == outline order == ParsedOutline.sections order.
// A blank `depends_on` cell (whitespace-only) parses to [].
// A malformed data row (wrong column count, non-numeric `#`, bad slug) MUST
// throw an Error whose message names the 1-based source line number.
// The parser is PURE: string in, object out — NO fs I/O.
// =========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOutline,
  renderOutlineMd,
  orderedOutlineSections,
  outlineSectionId,
  type ParsedOutline,
  type ParsedOutlineSection,
} from '../bin/lib/outline-parse.js';

const OUTLINE = `# Attention Is All You Need (replica)

| # | slug | title | depends_on | word target | assigned_sources |
| --- | --- | --- | --- | --- | --- |
| 1 | 01-introduction | Introduction | | 800 | smith2020, jones2019 |
| 2 | 02-background | Background | 01-introduction | 1200 | doe2021 |
| 3 | 03-method | The Method | 02-background | 1500 | |
`;

test('parseOutline: returns the paper title from the H1 line', () => {
  const parsed: ParsedOutline = parseOutline(OUTLINE);
  assert.equal(parsed.paper_title, 'Attention Is All You Need (replica)');
});

test('parseOutline: returns sections in appearance (outline) order', () => {
  const parsed = parseOutline(OUTLINE);
  assert.deepEqual(parsed.sections.map((s) => s.n), [1, 2, 3]);
  assert.deepEqual(
    parsed.sections.map((s) => s.slug),
    ['01-introduction', '02-background', '03-method'],
  );
});

test('parseOutline: each section carries n, slug, title, depends_on[]', () => {
  const parsed = parseOutline(OUTLINE);
  const intro: ParsedOutlineSection = parsed.sections[0]!;
  assert.equal(intro.n, 1);
  assert.equal(intro.slug, '01-introduction');
  assert.equal(intro.title, 'Introduction');
  assert.deepEqual(intro.depends_on, []);

  const background = parsed.sections[1]!;
  assert.deepEqual(background.depends_on, ['01-introduction']);
  assert.equal(background.estimated_word_count, 1200);
});

test('parseOutline: blank depends_on cell parses to an empty array', () => {
  const parsed = parseOutline(OUTLINE);
  assert.deepEqual(parsed.sections[0]!.depends_on, []);
});

test('parseOutline: multiple depends_on are comma-split and trimmed', () => {
  const raw = `# Multi-dep paper

| # | slug | title | depends_on | word target | assigned_sources |
| --- | --- | --- | --- | --- | --- |
| 1 | 01-a | A | | 100 | |
| 2 | 02-b | B | | 100 | |
| 3 | 03-c | C | 01-a, 02-b | 100 | |
`;
  const parsed = parseOutline(raw);
  assert.deepEqual(parsed.sections[2]!.depends_on, ['01-a', '02-b']);
});

test('parseOutline: a malformed data row throws naming the offending line', () => {
  // Row 5 (1-based) has a non-numeric `#` cell.
  const bad = `# Broken paper

| # | slug | title | depends_on | word target | assigned_sources |
| --- | --- | --- | --- | --- | --- |
| one | 01-introduction | Introduction | | 800 | |
`;
  let err: unknown;
  try {
    parseOutline(bad);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'expected parseOutline to throw on malformed row');
  assert.match(
    (err as Error).message,
    /line 5/,
    `error message must name the offending source line: ${(err as Error).message}`,
  );
});

test('parseOutline: a bad slug throws naming the offending line', () => {
  // Row 5 has an invalid slug (uppercase / underscore not allowed by validateSlug).
  const bad = `# Bad slug paper

| # | slug | title | depends_on | word target | assigned_sources |
| --- | --- | --- | --- | --- | --- |
| 1 | Bad_Slug | Introduction | | 800 | |
`;
  let err: unknown;
  try {
    parseOutline(bad);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'expected parseOutline to throw on bad slug');
  assert.match((err as Error).message, /line 5/);
});

// =========================================================================
// Phase 18 (GRND-07, GRND-09, D-18-14): the canonical 8-column table. The
// legacy 6-column table above is still read (role/voice absent); both now
// expose assigned_sources, and the `#` cell may carry a letter (1a).
// =========================================================================

const CANONICAL = [
  '# Attention and Transformers',
  '',
  'Thesis: Self-attention displaced recurrence.',
  '',
  '| # | slug | title | role | depends_on | word target | assigned_sources | voice |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | introduction | Introduction | intro |  | 300 | vaswani2017, bahdanau2015 |  |',
  '| 1a | background | Background | body | introduction | 300 | luong2015 | plain, expository |',
  '| 3 | conclusion | Conclusion | conclusion | background | 300 | vaswani2017 |  |',
  '',
  '## Sections',
  '',
  '- §1 Introduction — role: intro; purpose: Frame the question.',
  '- §1a Background — role: body; purpose: Establish the prior work; it matters.',
  '- §3 Conclusion — role: conclusion',
  '',
].join('\n');

function checkCanonical(parsed: ReturnType<typeof parseOutline>): void {
  assert.equal(parsed.format, 'canonical');
  assert.equal(parsed.paper_title, 'Attention and Transformers');
  assert.equal(parsed.thesis, 'Self-attention displaced recurrence.');
  assert.deepEqual(parsed.sections.map(outlineSectionId), ['1', '1a', '3']);
  const [intro, bg, concl] = parsed.sections as [ParsedOutlineSection, ParsedOutlineSection, ParsedOutlineSection];
  assert.equal(intro.suffix, undefined);
  assert.equal(bg.n, 1);
  assert.equal(bg.suffix, 'a');
  assert.equal(bg.role, 'body');
  assert.deepEqual(intro.assigned_sources, ['vaswani2017', 'bahdanau2015']);
  assert.deepEqual(bg.assigned_sources, ['luong2015']);
  assert.equal(bg.voice, 'plain, expository');
  assert.equal(intro.voice, undefined);
  assert.equal(intro.purpose, 'Frame the question.');
  assert.equal(bg.purpose, 'Establish the prior work; it matters.');
  assert.equal(concl.purpose, undefined);
  assert.deepEqual(concl.depends_on, ['background']);
  assert.equal(concl.estimated_word_count, 300);
}

test('GRND-07: the canonical 8-column table parses with ids, roles, sources, voice and purpose (LF)', () => {
  checkCanonical(parseOutline(CANONICAL));
});

test('GRND-07: the canonical table parses the same with CRLF line endings', () => {
  checkCanonical(parseOutline(CANONICAL.replace(/\n/g, '\r\n')));
});

test('GRND-07: the legacy 6-column table exposes assigned_sources, no role and no voice (LF and CRLF)', () => {
  for (const text of [OUTLINE, OUTLINE.replace(/\n/g, '\r\n')]) {
    const parsed = parseOutline(text);
    assert.equal(parsed.format, 'legacy');
    assert.deepEqual(parsed.sections[0]!.assigned_sources, ['smith2020', 'jones2019']);
    assert.deepEqual(parsed.sections[2]!.assigned_sources, []);
    assert.equal(parsed.sections[0]!.role, undefined);
    assert.equal(parsed.sections[0]!.voice, undefined);
    assert.equal(parsed.sections[0]!.slug, '01-introduction', 'a file on disk keeps its slug spelling');
  }
});

test('GRND-07: a bad role, a bad id or a duplicate id throws naming the line', () => {
  const row = (r: string): string => CANONICAL.replace('| 3 | conclusion | Conclusion | conclusion |', r);
  assert.throws(() => parseOutline(row('| 3 | conclusion | Conclusion | epilogue |')), /line 9: role must be one of/);
  assert.throws(() => parseOutline(row('| 3A | conclusion | Conclusion | conclusion |')), /line 9: section number must be 1-99/);
  assert.throws(() => parseOutline(row('| 1a | conclusion | Conclusion | conclusion |')), /line 9: duplicate section number "1a"/);
});

test('GRND-07: renderOutlineMd writes the canonical table in (n, suffix) order and round-trips', () => {
  const md = renderOutlineMd(
    {
      thesis: 'A | thesis',
      sections: [
        { n: 3, slug: 'conclusion', title: 'Conclusion', purpose: '', depends_on: ['background'], estimated_word_count: 300, assigned_sources: [], role: 'conclusion' },
        { n: 1, suffix: 'a', slug: 'background', title: 'Back | ground', purpose: 'Why.', depends_on: ['introduction'], estimated_word_count: 400, assigned_sources: ['luong2015'], role: 'body', voice: 'plain' },
        { n: 1, slug: 'introduction', title: 'Introduction', purpose: 'Frame.', depends_on: [], estimated_word_count: 300, assigned_sources: ['vaswani2017'], role: 'intro' },
      ],
    },
    'Paper',
    { marker: '> OFFLINE MODE (--dry-run) — synthetic dry-run sources, not live results.' },
  );
  assert.match(md, /^# Paper\n\n> OFFLINE MODE \(--dry-run\)/);
  assert.match(md, /\| # \| slug \| title \| role \| depends_on \| word target \| assigned_sources \| voice \|/);
  assert.match(md, /\| 1a \| background \| Back \/ ground \| body \| introduction \| 400 \| luong2015 \| plain \|/);
  const parsed = parseOutline(md);
  assert.deepEqual(parsed.sections.map(outlineSectionId), ['1', '1a', '3']);
  assert.equal(parsed.thesis, 'A / thesis');
  assert.equal(parsed.sections[1]!.purpose, 'Why.');
  assert.deepEqual(orderedOutlineSections({ sections: [...parsed.sections].reverse() }).map(outlineSectionId), ['1', '1a', '3']);
});
