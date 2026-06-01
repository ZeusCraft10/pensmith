// tests/prompts-schema.test.ts — Zod schema validation for TIER-05 prompt types.
//
// Asserts: valid shapes parse OK; invalid shapes are rejected with the correct
// discriminated-union branch and field constraints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PromptQuestionSchema,
  SelectQuestionSchema,
  MultiSelectQuestionSchema,
} from '../bin/lib/prompts/schema.js';

// ── Happy-path cases ─────────────────────────────────────────────────────────

test('schema: select with 4 options + default parses OK', () => {
  const result = PromptQuestionSchema.safeParse({
    id: 'discipline',
    kind: 'select',
    label: 'Which discipline preset?',
    options: [
      { value: 'cs', label: 'Computer science', hint: 'APA + arXiv-heavy' },
      { value: 'bio', label: 'Biological sciences', hint: 'CSE + PubMed' },
      { value: 'history', label: 'History', hint: 'Chicago notes-bib' },
      { value: 'other', label: 'Pick a custom style' },
    ],
    default: 'cs',
  });
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.kind, 'select');
    assert.equal(result.data.id, 'discipline');
    assert.equal(result.data.options.length, 4);
  }
});

test('schema: text with default and placeholder parses OK', () => {
  const result = PromptQuestionSchema.safeParse({
    id: 'paper-title',
    kind: 'text',
    label: 'Enter paper title:',
    default: 'My Thesis',
    placeholder: 'Type here...',
  });
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.kind, 'text');
  }
});

test('schema: confirm with default:true parses OK', () => {
  const result = PromptQuestionSchema.safeParse({
    id: 'approve',
    kind: 'confirm',
    label: 'Proceed with export?',
    default: true,
  });
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.kind, 'confirm');
    assert.equal(result.data.default, true);
  }
});

test('schema: multiselect with default as string array parses OK', () => {
  const result = PromptQuestionSchema.safeParse({
    id: 'formats',
    kind: 'multiselect',
    label: 'Select output formats:',
    options: [
      { value: 'pdf', label: 'PDF' },
      { value: 'docx', label: 'DOCX' },
      { value: 'tex', label: 'LaTeX' },
    ],
    default: ['pdf', 'tex'],
  });
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.kind, 'multiselect');
    assert.deepEqual(result.data.default, ['pdf', 'tex']);
  }
});

// ── Negative cases ────────────────────────────────────────────────────────────

test('schema: select with empty options array is rejected', () => {
  const result = SelectQuestionSchema.safeParse({
    id: 'q',
    kind: 'select',
    label: 'Pick one',
    options: [],
  });
  assert.equal(result.success, false, 'expected parse to fail for empty options');
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p.includes('options')), `expected error on options, got: ${paths.join(', ')}`);
  }
});

test('schema: select missing id is rejected', () => {
  const result = PromptQuestionSchema.safeParse({
    kind: 'select',
    label: 'No ID here',
    options: [{ value: 'a', label: 'A' }],
  });
  assert.equal(result.success, false, 'expected parse to fail for missing id');
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p === 'id' || p.includes('id')), `expected error on id, got: ${paths.join(', ')}`);
  }
});

test('schema: multiselect with default as string (not array) is rejected', () => {
  const result = MultiSelectQuestionSchema.safeParse({
    id: 'q',
    kind: 'multiselect',
    label: 'Pick many',
    options: [{ value: 'a', label: 'A' }],
    default: 'a',  // should be array
  });
  assert.equal(result.success, false, 'expected parse to fail for non-array default on multiselect');
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p.includes('default')), `expected error on default, got: ${paths.join(', ')}`);
  }
});

test('schema: confirm with default as string "yes" is rejected', () => {
  const result = PromptQuestionSchema.safeParse({
    id: 'q',
    kind: 'confirm',
    label: 'Sure?',
    default: 'yes',  // should be boolean
  });
  assert.equal(result.success, false, 'expected parse to fail for string default on confirm');
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p.includes('default')), `expected error on default, got: ${paths.join(', ')}`);
  }
});
