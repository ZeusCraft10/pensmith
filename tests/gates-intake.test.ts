// tests/gates-intake.test.ts — the Phase 18 intake gates (RUN-28, PRD §7.20)
// driven through the real verb (the built CLI), without a terminal, with and
// without --yolo:
//
//   assignment-pickup (GRND-01) — skip: use the file / without a terminal: skip
//     (use the file). The folder's assignment.* is used and NAMED; several
//     files cannot be chosen without a terminal (EXIT_USAGE naming them).
//   intake-defaults (GRND-02) — skip: accept the defaults / without a terminal:
//     refuse 3. The refusal names the unanswered questions and happens before
//     any write; --yolo accepts and prints the defaults; scripted numbered
//     answers that run out refuse the same way.
//
// Every refusal is checked to mutate nothing (a folder snapshot before/after).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIGNMENT_FIXTURE, STACK_LINE, changedPaths, runCli, sandbox, snapshot } from './helpers/paper-cli-harness.js';
import { gateDef } from '../bin/lib/gates.js';
import { readIntakeBrief } from '../bin/lib/intake-brief.js';
import { TUTORIAL_INTAKE_QUESTION } from '../bin/lib/tutorial.js';
import { EXIT_APPROVAL, EXIT_OK, EXIT_USAGE } from '../bin/lib/exit-codes.js';

const A1 = readFileSync(ASSIGNMENT_FIXTURE, 'utf8');
const ALL_FLAGS = [
  '--no-pii-redact', '--discipline', 'other', '--mode', 'draft', `--${TUTORIAL_INTAKE_QUESTION.flag}`, TUTORIAL_INTAKE_QUESTION.defaultValue,
  '--class', 'CS 480', '--counterargument', 'auto', '--style-samples', 'no', '--length', '1500', '--citation-style', 'APA',
];

test('RUN-28: the registry holds both intake gates as PRD §7.20 states them', () => {
  const pickup = gateDef('assignment-pickup');
  assert.equal(pickup.yolo, 'skip');
  assert.equal(pickup.yoloChoice, 'use the file');
  assert.equal(pickup.nonInteractive, 'skip');
  const defaults = gateDef('intake-defaults');
  assert.equal(defaults.yolo, 'skip');
  assert.equal(defaults.yoloChoice, 'accept the defaults');
  assert.equal(defaults.nonInteractive, 'refuse');
  assert.equal(defaults.nonTtyExit, EXIT_APPROVAL);
});

test('assignment-pickup: without a terminal (fully answered, no --yolo) and with --yolo, the folder file is used and named', () => {
  const sb = sandbox('gate-pickup');
  for (const [name, extra] of [['answered', ALL_FLAGS], ['yolo', ['--yolo']]] as const) {
    const root = sb.project(name);
    writeFileSync(join(root, 'assignment.txt'), A1);
    const r = runCli(sb, root, ['new', ...extra]);
    assert.equal(r.status, EXIT_OK, `${name}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^pensmith new: using the assignment file in this folder: assignment\.txt$/m);
    assert.deepEqual(readIntakeBrief(root)?.brief.assignment_source, { kind: 'cwd', name: 'assignment.txt' });
    assert.doesNotMatch(r.stderr, STACK_LINE);
  }
});

test('assignment-pickup: several assignment files cannot be chosen without a terminal — EXIT_USAGE naming them, nothing written', () => {
  const sb = sandbox('gate-pickup-several');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  writeFileSync(join(root, 'assignment.md'), '# Another brief\n');
  const before = snapshot(root);
  for (const extra of [['--yolo'], ALL_FLAGS]) {
    const r = runCli(sb, root, ['new', ...extra]);
    assert.equal(r.status, EXIT_USAGE, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith: several assignment files in .+: assignment\.txt, assignment\.md — name one with --from <file> or @<file>$/m);
    assert.deepEqual(changedPaths(before, snapshot(root)), [], 'nothing changed');
  }
  const named = runCli(sb, root, ['new', '@assignment.md', '--yolo']);
  assert.equal(named.status, EXIT_OK, named.stderr);
});

test('intake-defaults: without a terminal and without --yolo the verb refuses (exit 3) naming the questions — and mutates nothing', () => {
  const sb = sandbox('gate-defaults');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  const before = snapshot(root);
  const r = runCli(sb, root, ['new', '--discipline', 'history']);
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: Accept the intake defaults\? \(unanswered: pii_redaction \(--pii-redact \/ --no-pii-redact\), mode \(--mode\), .* — answer them with those flags or --answers <file\.toml>\) needs an answer: re-run in a terminal, or pass --yolo to accept the defaults\.$/m);
  assert.doesNotMatch(r.stderr, /discipline \(--discipline\)/, 'an answered question is not named');
  assert.doesNotMatch(r.stdout, /pensmith is a structured research-and-drafting assistant/, 'refused before the disclaimer and any model call');
  assert.deepEqual(changedPaths(before, snapshot(root)), [], 'nothing changed');
  assert.doesNotMatch(r.stderr, STACK_LINE);
});

test('intake-defaults: --yolo accepts the suggested defaults and prints them', () => {
  const sb = sandbox('gate-defaults-yolo');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  const r = runCli(sb, root, ['new', '--yolo', '--discipline', 'history']);
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^pensmith new: --yolo accepted the suggested intake defaults:\n(?: {2}\S+ = .+\n){8}/m);
  assert.doesNotMatch(r.stdout, /^ {2}discipline = /m, 'the answered question is not a default');
  assert.match(r.stdout, /^ {2}citation_style = APA$/m, 'the assignment\'s own "APA style" is the suggested style');
  const intake = readFileSync(join(root, '.paper', 'INTAKE.md'), 'utf8');
  assert.match(intake, /— suggested default, accepted with --yolo/);
  assert.match(intake, /- \*\*discipline\*\*: .*\n {2}- History \(history\) — from a flag/);
});

test('intake-defaults: scripted numbered answers that run out refuse the same way (exit 3), writing nothing', () => {
  const sb = sandbox('gate-defaults-numbered');
  const root = sb.project('p');
  writeFileSync(join(root, 'assignment.txt'), A1);
  const before = snapshot(root);
  const r = runCli(sb, root, ['new', '--from', 'assignment.txt'], { input: 'n\n1\n', env: { PENSMITH_PROMPT_MODE: 'numbered' } });
  assert.equal(r.status, EXIT_APPROVAL, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith: Accept the intake defaults\? \(unanswered: mode \(--mode\), .*; the piped answers ran out\) needs an answer/m);
  assert.deepEqual(changedPaths(before, snapshot(root)), [], 'nothing changed');
});
