// tests/intake-brief.test.ts — GRND-03 (Phase 18 seam S-A): `.paper/INTAKE.md`
// is a structured, versioned brief read through the CONF-04 loader; it
// round-trips, a v0 document migrates, and an invalid one fails with one line
// naming the file and field.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import {
  ASSIGNMENT_END,
  ASSIGNMENT_START,
  IntakeBriefError,
  IntakeBriefSchema,
  assignmentFromBody,
  defaultIntakeBrief,
  intakePath,
  readIntakeBrief,
  renderIntakeDocument,
} from '../bin/lib/intake-brief.js';

const ASSIGNMENT = 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.\n\n## Requirements\n\n- cite 8 sources';

async function withPaper(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-intake-brief-'));
  mkdirSync(path.join(root, '.paper'), { recursive: true });
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('GRND-03: the brief renders, reads back through the loader and keeps the verbatim assignment', async () => {
  await withPaper(async (root) => {
    const text = renderIntakeDocument(
      {
        topic: 'attention mechanisms in transformers',
        discipline: 'computer-science',
        paper_type: 'literature-review',
        length_target_words: 1500,
        citation_style: 'apa',
        sectioning_notes: ['a literature review section before methods'],
        assignment_source: { kind: 'file', name: 'assignment.txt' },
        follow_ups: [{ id: 'audience', question: 'Who is the audience?', answer: 'undergraduates' }],
      },
      ASSIGNMENT,
      [{ id: 'discipline', question: 'Which discipline?', answer: 'computer-science' }],
    );
    await atomicWriteFile(intakePath(root), text);
    const doc = readIntakeBrief(root);
    assert.ok(doc);
    assert.equal(doc.diskVersion, 1);
    assert.equal(doc.brief.schema_version, 1);
    assert.equal(doc.brief.topic, 'attention mechanisms in transformers');
    assert.equal(doc.brief.length_target_words, 1500);
    assert.equal(doc.brief.citation_style, 'apa');
    assert.equal(doc.brief.class, 'Unfiled', 'defaults fill the rest');
    assert.equal(doc.brief.counterargument, 'auto');
    assert.equal(doc.assignment, ASSIGNMENT, 'a "## Requirements" heading inside the assignment is kept');
    // The key order is the schema's; re-rendering the parsed brief is byte-identical.
    assert.equal(renderIntakeDocument(doc.brief, doc.assignment, [{ id: 'discipline', question: 'Which discipline?', answer: 'computer-science' }]), text);
    assert.deepEqual(Object.keys(parseFrontmatter(text).frontmatter).slice(0, 3), ['schema_version', 'topic', 'thesis']);
  });
});

test('GRND-03: a v0 INTAKE.md (Phase 17 rendering) migrates in memory and is never written back by a reader', async () => {
  await withPaper(async (root) => {
    const legacy = '# Intake\n\nTopic: the French Revolution\nDiscipline: History\n\n## Assignment\n\nArgue what caused the French Revolution.\n\n## Clarifying questions\n\n1. Length?\n';
    await atomicWriteFile(intakePath(root), legacy);
    const doc = readIntakeBrief(root);
    assert.ok(doc);
    assert.equal(doc.diskVersion, 0);
    assert.deepEqual([doc.brief.topic, doc.brief.discipline], ['the French Revolution', 'history']);
    assert.equal(doc.assignment, 'Argue what caused the French Revolution.');
  });
});

test('GRND-03: an absent INTAKE.md reads as null; an invalid field is one IntakeBriefError naming the file and field', async () => {
  await withPaper(async (root) => {
    assert.equal(readIntakeBrief(root), null);
    await atomicWriteFile(intakePath(root), '---\nschema_version: 1\ncitation_style: turabian\n---\n# Intake\n');
    assert.throws(() => readIntakeBrief(root), (e: unknown) => {
      assert.ok(e instanceof IntakeBriefError);
      assert.match(e.message, /INTAKE\.md: invalid intake field "citation_style"/);
      return true;
    });
  });
});

test('GRND-03: the assignment block cannot be closed by the assignment text itself', () => {
  const tricky = `before ${ASSIGNMENT_END} after ${ASSIGNMENT_START} end`;
  const text = renderIntakeDocument({ topic: 't' }, tricky, []);
  const body = parseFrontmatter(text).body;
  const back = assignmentFromBody(body);
  assert.ok(back.startsWith('before ') && back.endsWith(' end'));
  assert.ok(!back.includes(ASSIGNMENT_END));
  assert.equal(defaultIntakeBrief().mode, 'draft');
  assert.throws(() => IntakeBriefSchema.parse({ follow_ups: [1, 2, 3, 4].map((i) => ({ id: `q${i}`, question: 'q', answer: 'a' })) }), 'at most 3 follow-ups');
});
