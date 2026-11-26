// tests/intake-thesis.test.ts — a thesis is added to the kept assignment, never put in its place.
//
// Intake adds a thesis (from `--thesis`, which `sketch` uses) to the
// assignment as a last `Thesis: ...` paragraph, marked as the one it added. A
// run that brought no assignment text used to start from the thesis alone,
// so the answering run after an exit 3 overwrote PROJECT.md with only
// `Thesis: ...`, lost the assignment, and asked the answered questions again.
// Then an assignment that itself ended with a `Thesis:` line lost that line
// when a thesis was given or cleared. These tests drive each way of getting
// there through the real CLI, with no terminal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAssignment, readIntake, THESIS_MARK } from '../bin/lib/intake-record.js';
import { runCli } from './lib/export-fixture.js';

const ASSIGNMENT = 'PSYC 210 essay. Write about 2,000 words on whether social media use causes anxiety in adolescents. APA style.';
const THESIS = 'SM raises anxiety.';
// What PROJECT.md keeps for ASSIGNMENT with THESIS added, written out rather than built with withThesis.
const KEPT_WITH_THESIS = `${ASSIGNMENT}\n\n${THESIS_MARK}\nThesis: ${THESIS}`;
const ALL = {
  topic: 'social media and anxiety',
  discipline: 'psychology',
  length_words: '2000',
  citation_style: 'apa',
  audience: 'an undergraduate course',
  counterargument: 'required',
};
const REST = Object.fromEntries(Object.entries(ALL).filter(([k]) => k !== 'topic'));

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-thesis-'));
}

/** The text under `## Assignment` in PROJECT.md ('' when there is none). */
const keptAssignment = (dir: string): string => readAssignment(dir) ?? '';

function intakeJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('a thesis kept with the assignment survives the answering run, which keeps the answers given', () => {
  const dir = tmp();
  const first = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify({ assignment: ASSIGNMENT, topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);

  const second = runCli(['new', '--answers', JSON.stringify(REST)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);
});

test('--from brief.txt --thesis T, then an answering run without --from, keeps the brief and the thesis', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'brief.txt'), ASSIGNMENT + '\n');
  const first = runCli(['new', '--from', 'brief.txt', '--thesis', THESIS, '--answers', JSON.stringify({ topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);

  const second = runCli(['new', '--answers', JSON.stringify(REST)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);
});

test("sketch's three runs (thesis, then assignment, then answers) keep the assignment and the thesis once", () => {
  const dir = tmp();
  const first = runCli(['new', '--thesis', THESIS], dir);
  assert.equal(first.status, 3, first.stderr);

  const second = runCli(['new', '--answers', JSON.stringify({ assignment: ASSIGNMENT })], dir);
  assert.equal(second.status, 3, second.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);

  const third = runCli(['new', '--answers', JSON.stringify(ALL)], dir);
  assert.equal(third.status, 0, third.stdout + third.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);
});

test('answers given with a thesis alone count for the assignment given next', () => {
  const dir = tmp();
  const first = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify({ topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  const second = runCli(['new', '--answers', JSON.stringify({ assignment: ASSIGNMENT })], dir);
  assert.equal(second.status, 3, second.stderr);
  const third = runCli(['new', '--answers', JSON.stringify(REST)], dir);
  assert.equal(third.status, 0, third.stdout + third.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);
});

test('a thesis given on a later run is added to the kept assignment, and the answers given survive it', () => {
  const dir = tmp();
  const first = runCli(['new', '--answers', JSON.stringify({ assignment: ASSIGNMENT, topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  assert.equal(keptAssignment(dir), ASSIGNMENT);

  const second = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify(REST)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(keptAssignment(dir), KEPT_WITH_THESIS);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);
});

test('the same thesis given again is added once, and a new one replaces it', () => {
  const dir = tmp();
  const first = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify({ assignment: ASSIGNMENT })], dir);
  assert.equal(first.status, 3, first.stderr);
  const again = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify(ALL)], dir);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(count(keptAssignment(dir), 'Thesis:'), 1, keptAssignment(dir));

  // Intake run again on the finished paper, with another thesis.
  const other = 'Social media use and anxiety share causes.';
  const redo = runCli(['new', '--thesis', other, '--answers', JSON.stringify(ALL)], dir);
  assert.equal(redo.status, 0, redo.stdout + redo.stderr);
  assert.equal(keptAssignment(dir), `${ASSIGNMENT}\n\n${THESIS_MARK}\nThesis: ${other}`);
  // ...and once more with no thesis: the kept one stays.
  const plain = runCli(['new', '--answers', JSON.stringify(ALL)], dir);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.equal(keptAssignment(dir), `${ASSIGNMENT}\n\n${THESIS_MARK}\nThesis: ${other}`);
});

test("an explicit --thesis '' clears a kept thesis, during intake and after it", () => {
  const dir = tmp();
  const first = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify({ assignment: ASSIGNMENT, topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  const cleared = runCli(['new', '--thesis', '', '--answers', JSON.stringify(REST)], dir);
  assert.equal(cleared.status, 0, cleared.stdout + cleared.stderr);
  assert.equal(keptAssignment(dir), ASSIGNMENT);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);

  const dir2 = tmp();
  const done = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify({ assignment: ASSIGNMENT, ...ALL })], dir2);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(keptAssignment(dir2), KEPT_WITH_THESIS);
  const redo = runCli(['new', '--thesis', '', '--answers', JSON.stringify(ALL)], dir2);
  assert.equal(redo.status, 0, redo.stdout + redo.stderr);
  assert.equal(keptAssignment(dir2), ASSIGNMENT);
});

test('with PII redaction on, the answering run keeps the redacted assignment and its thesis, and the raw text stays local', () => {
  const dir = tmp();
  const email = 'jane.doe@example.edu';
  const raw = `${ASSIGNMENT} Questions to ${email}.`;
  const first = runCli(['new', '--pii-redact', '--thesis', THESIS, '--answers', JSON.stringify({ assignment: raw, topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  const second = runCli(['new', '--answers', JSON.stringify(REST)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const kept = keptAssignment(dir);
  assert.doesNotMatch(kept, /jane\.doe/);
  assert.ok(kept.endsWith(`\n\n${THESIS_MARK}\nThesis: SM raises anxiety.`), kept);
  assert.match(kept, /^PSYC 210 essay\.[\s\S]*\[REDACTED:EMAIL\]/);
  assert.equal(intakeJson(dir)['topic'], ALL.topic);
  assert.equal(readFileSync(join(dir, '.paper', 'INTAKE.raw.local'), 'utf8').trim(), `${raw}\n\n${THESIS_MARK}\nThesis: ${THESIS}`);
});

test("an assignment that ends with its own 'Thesis:' line keeps it when a thesis is given or cleared", () => {
  // A rubric line of the assignment, not a thesis pensmith added.
  const own = 'PSYC 210 essay, 2000 words, APA.\n\nThesis: must be arguable and stated in the introduction.';
  const dir = tmp();
  const first = runCli(['new', '--answers', JSON.stringify({ assignment: own, topic: ALL.topic })], dir);
  assert.equal(first.status, 3, first.stderr);
  assert.equal(keptAssignment(dir), own);

  const second = runCli(['new', '--thesis', THESIS, '--answers', JSON.stringify(REST)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.ok(keptAssignment(dir).startsWith(`${own}\n\n`), keptAssignment(dir));
  // What the outline and the other steps are given: the assignment word for word, then the thesis.
  assert.equal(readIntake(dir)?.assignment, `${own}\n\nThesis: ${THESIS}`);

  const cleared = runCli(['new', '--thesis', '', '--answers', JSON.stringify(ALL)], dir);
  assert.equal(cleared.status, 0, cleared.stdout + cleared.stderr);
  assert.equal(keptAssignment(dir), own);
  const again = runCli(['new', '--thesis', '', '--answers', JSON.stringify(ALL)], dir);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(keptAssignment(dir), own);
});
