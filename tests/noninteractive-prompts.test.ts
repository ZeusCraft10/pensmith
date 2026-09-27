// tests/noninteractive-prompts.test.ts — RUN-12 (D-17-34): non-interactive
// prompts and expected failures never dump stack traces.
//
//   - The numbered prompts read ONE line per question from ONE shared line
//     reader, so several answers piped at once reach every question in order
//     (a per-question reader used to swallow the rest of the pipe).
//   - resolveMode picks clack only when stdin, stdout AND stderr are all
//     terminals; answers piped into a terminal session use numbered prompts.
//   - A matrix of the interactive verbs run with a non-terminal stdin exits
//     with its documented code and prints no stack-trace line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { askNumbered } from '../bin/lib/prompts/numbered.js';
import { resolveMode, PromptAbortedError } from '../bin/lib/prompts.js';
import { EXIT_OK, EXIT_USAGE, EXIT_APPROVAL } from '../bin/lib/exit-codes.js';
import {
  STACK_LINE,
  sandbox,
  runCli,
  seedCompiledPaper,
  writeState,
  writeOutline,
  writePlan,
} from './helpers/paper-cli-harness.js';

function sink(): NodeJS.WritableStream & { text: () => string } {
  const chunks: string[] = [];
  const s = new PassThrough();
  s.on('data', (c: Buffer) => chunks.push(c.toString()));
  return Object.assign(s, { text: () => chunks.join('') });
}

test('RUN-12: one shared line reader — answers piped at once reach successive questions', async () => {
  const stdin = new PassThrough();
  const stderr = sink();
  stdin.write('first answer\n2\ny\nlast\n');
  stdin.end();
  const a = await askNumbered({ id: 'q1', kind: 'text', label: 'First?' }, { stdin, stderr });
  const b = await askNumbered(
    { id: 'q2', kind: 'select', label: 'Pick', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
    { stdin, stderr },
  );
  const c = await askNumbered({ id: 'q3', kind: 'confirm', label: 'Sure?', default: false }, { stdin, stderr });
  const d = await askNumbered({ id: 'q4', kind: 'text', label: 'Last?' }, { stdin, stderr });
  assert.deepEqual([a.value, b.value, c.value, d.value], ['first answer', 'y', true, 'last']);
  await assert.rejects(askNumbered({ id: 'q5', kind: 'text', label: 'More?' }, { stdin, stderr }), PromptAbortedError);
  // Each prompt line is closed on a non-echoing input, so the next line is clean.
  assert.match(stderr.text(), /Enter text \(blank to keep default\): \n\[pensmith\] Pick \(select\)/);
});

test('RUN-12: a line that arrives later is still delivered to the waiting question (CRLF-safe)', async () => {
  const stdin = new PassThrough();
  const stderr = sink();
  const pending = askNumbered({ id: 'late', kind: 'text', label: 'Later?' }, { stdin, stderr });
  setTimeout(() => stdin.write('arrived\r\n'), 20);
  assert.equal((await pending).value, 'arrived');
  stdin.end();
});

test('RUN-12: resolveMode uses clack only when stdin, stdout and stderr are all terminals', () => {
  const prev = process.env['PENSMITH_PROMPT_MODE'];
  delete process.env['PENSMITH_PROMPT_MODE'];
  const saved = [process.stdin, process.stdout, process.stderr].map((s) => Object.getOwnPropertyDescriptor(s, 'isTTY'));
  const setTty = (stdin: boolean, stdout: boolean, stderr: boolean): void => {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: stderr, configurable: true });
  };
  try {
    setTty(false, true, true);
    assert.equal(resolveMode(), 'numbered', 'answers piped into a terminal session');
    setTty(true, true, false);
    assert.equal(resolveMode(), 'numbered');
    setTty(true, true, true);
    assert.equal(resolveMode(), 'clack');
    assert.equal(resolveMode({ mode: 'numbered' }), 'numbered', 'explicit mode wins');
  } finally {
    [process.stdin, process.stdout, process.stderr].forEach((s, i) => {
      const d = saved[i];
      if (d) Object.defineProperty(s, 'isTTY', d);
      else delete (s as { isTTY?: boolean }).isTTY;
    });
    if (prev !== undefined) process.env['PENSMITH_PROMPT_MODE'] = prev;
  }
});

test('RUN-12: `printf "…5 answers…" | pensmith sketch` answers every question and starts the paper', () => {
  const sb = sandbox('sketch-pipe');
  const cwd = sb.project('p');
  const answers = 'LLMs in education\nThat they replace teachers\nUndergrad instructors\nTutors help most with feedback\ny\n';
  const r = runCli(sb, cwd, ['sketch'], { input: answers });
  assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
  const labels = [
    'What interests or questions motivate this paper?',
    'What conventional view do you disagree with?',
    'Who is your target audience?',
    'In one sentence, what is your candidate thesis claim?',
    'Proceed to intake with this thesis?',
  ];
  let at = -1;
  for (const l of labels) {
    const i = r.stderr.indexOf(l);
    assert.ok(i > at, `asked in order: ${l}`);
    at = i;
  }
  assert.match(r.stdout, /Tutors help most with feedback — That they replace teachers — Undergrad instructors/);
  assert.ok(existsSync(join(cwd, '.paper', 'STATE.json')), 'confirmed → new created the paper');
  assert.ok(readFileSync(join(cwd, '.paper', 'INTAKE.md'), 'utf8').length > 0, 'INTAKE.md written from the thesis seed');
  assert.doesNotMatch(r.stderr, STACK_LINE);
});

test('RUN-12: the interactive verbs with a non-terminal stdin — documented codes, no stack-trace lines', () => {
  const sb = sandbox('noninteractive-matrix');
  const fresh = sb.project('fresh');
  const outlined = sb.project('outline');
  writeState(outlined, []);
  writeFileSync(join(outlined, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: tidal power\n');
  const compiled = sb.project('compiled');
  seedCompiledPaper(compiled);
  const addTo = sb.project('add');
  writeState(addTo, [{ n: 1, slug: 'intro' }]);
  writeOutline(addTo, [{ n: 1, slug: 'intro' }]);
  writePlan(addTo, 1, 'intro');
  const sketchDir = sb.project('sketch');

  const cases: Array<{ name: string; cwd: string; args: string[]; code: number; line: RegExp }> = [
    { name: 'new (no assignment)', cwd: fresh, args: ['new'], code: EXIT_USAGE, line: /^pensmith: no assignment: / },
    { name: 'outline approval', cwd: outlined, args: ['outline'], code: EXIT_APPROVAL, line: /^pensmith: Approve this outline/ },
    { name: 'done confirmation', cwd: compiled, args: ['done', '--format', 'md'], code: EXIT_APPROVAL, line: /^pensmith: Export the paper now\?/ },
    { name: 'add remap', cwd: addTo, args: ['add', '10.1038/nphys1170'], code: EXIT_OK, line: /remap skipped \(non-interactive\)/ },
    { name: 'sketch (input ended)', cwd: sketchDir, args: ['sketch'], code: EXIT_APPROVAL, line: /^pensmith: no answer for "sketch-interests" \(input ended\)/ },
  ];
  for (const c of cases) {
    const r = runCli(sb, c.cwd, c.args);
    assert.equal(r.status, c.code, `${c.name}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + '\n' + r.stderr, new RegExp(c.line.source, 'm'), c.name);
    assert.doesNotMatch(r.stderr, STACK_LINE, `${c.name}: no stack trace`);
  }
  assert.ok(!existsSync(join(sketchDir, '.paper')), 'an unanswered sketch creates nothing');
});
