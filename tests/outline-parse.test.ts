/**
 * tests/outline-parse.test.ts
 * 
 * Format: Markdown table
 * | # | slug | title | depends_on | word target | assigned_sources |
 * 
 * Example:
 * | 1 | 01-intro | Introduction | | 500 | smith2020, jones2019 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutline } from '../bin/lib/outline-parse.js';

test('parseOutline: parses valid table', () => {
  const raw = `
# Paper Title

| # | slug | title | depends_on | word target | assigned_sources |
|---|------|-------|------------|-------------|------------------|
| 1 | 01-intro | Introduction | | 500 | smith2020 |
| 2 | 02-methods | Methodology | 01-intro | 1000 | |
`;
  const result = parseOutline(raw);
  assert.equal(result.paper_title, 'Paper Title');
  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.sections[0], {
    n: 1,
    slug: '01-intro',
    title: 'Introduction',
    depends_on: [],
    estimated_word_count: 500,
    assigned_sources: ['smith2020']
  });
  assert.deepEqual(result.sections[1], {
    n: 2,
    slug: '02-methods',
    title: 'Methodology',
    depends_on: ['01-intro'],
    estimated_word_count: 1000,
    assigned_sources: []
  });
});

test('parseOutline: ignores non-table lines and handles empty depends_on', () => {
  const raw = `
Some preamble text.

| # | slug | title | depends_on | word target | assigned_sources |
|---|------|-------|------------|-------------|------------------|
| 1 | 01-a | A | | 100 | |
`;
  const result = parseOutline(raw);
  assert.equal(result.sections.length, 1);
  const section = result.sections[0];
  assert.ok(section);
  assert.deepEqual(section.depends_on, []);
});

test('parseOutline: throws on duplicate slug', () => {
  const raw = `
| # | slug | title | depends_on | word target | assigned_sources |
|---|------|-------|------------|-------------|------------------|
| 1 | 01-a | A | | 100 | |
| 2 | 01-a | B | | 100 | |
`;
  assert.throws(() => parseOutline(raw), /duplicate slug: 01-a/);
});

test('parseOutline: throws on duplicate section number', () => {
  const raw = `
| # | slug | title | depends_on | word target | assigned_sources |
|---|------|-------|------------|-------------|------------------|
| 1 | 01-a | A | | 100 | |
| 1 | 02-b | B | | 100 | |
`;
  assert.throws(() => parseOutline(raw), /duplicate section number: 1/);
});

test('parseOutline: throws on malformed line', () => {
  const raw = `
| # | slug | title | depends_on | word target | assigned_sources |
|---|------|-------|------------|-------------|------------------|
| 1 | bad-line |
`;
  assert.throws(() => parseOutline(raw), /couldn't parse line 4/);
});
