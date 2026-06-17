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
