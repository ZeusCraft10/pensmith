// tests/intake-contract.test.ts — intake keeps the assignment and the answers.
//
// intake used to send the assignment to the clarifier, whose job is to write
// clarifying questions, and save the questions as INTAKE.md: nothing asked
// them, the assignment was kept nowhere, and research searched on
// "1. Which discipline best fits…". It also rewrote a config.toml in the
// project root through a TOML round trip, dropping its comments and resetting
// the goal to draft on every run. Now the assignment is kept word for word,
// the questions are asked (or reported with exit 3 when there is no terminal)
// and the checked answers are stored as data.

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _setGeneratorForTest, type Generator } from '../bin/lib/anthropic.js';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const ASSIGNMENT = [
  'PSYC 210, paper 2. Write an argumentative essay (about 2,000 words) on whether',
  'social media use causes anxiety in adolescents. Use APA style and at least six',
  'peer-reviewed sources.',
].join('\n');

const ALL_ANSWERS = {
  topic: 'social media use and adolescent anxiety',
  discipline: 'Psych',
  length_words: '2,000 words',
  citation_style: 'APA 7th',
  audience: 'undergraduate psychology course',
  counterargument: 'yes',
};

function runCli(args: string[], cwd: string, env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1', ...env }),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as Record<string, unknown>;
}

function tmp(prefix = 'pensmith-intake-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('the assignment is kept word for word and the answers are stored as checked fields', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'brief.txt'), ASSIGNMENT + '\n');
  const r = runCli(['new', '--from', 'brief.txt', '--answers', JSON.stringify(ALL_ANSWERS)], dir);
  assert.equal(r.status, 0, r.stderr);
  const project = readFileSync(join(dir, '.paper', 'PROJECT.md'), 'utf8');
  assert.ok(project.includes(`## Assignment\n\n${ASSIGNMENT}\n`), project);
  const intake = JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(intake, {
    $schemaVersion: 1,
    topic: 'social media use and adolescent anxiety',
    discipline: 'psychology',
    length_words: 2000,
    citation_style: 'apa',
    audience: 'undergraduate psychology course',
    counterargument: 'required',
  });
  const intakeMd = readFileSync(join(dir, '.paper', 'INTAKE.md'), 'utf8');
  assert.doesNotMatch(intakeMd, /\?/, 'INTAKE.md holds answers, not questions');
  assert.match(intakeMd, /^Topic: social media use and adolescent anxiety$/m);
  assert.ok(existsSync(join(dir, '.paper', 'STATE.json')));
  // The chosen style is the paper's setting, which done reads first.
  assert.match(readFileSync(join(dir, '.paper', 'config.toml'), 'utf8'), /^citation_style = "apa"$/m);
});

test('without a terminal the questions are reported with exit 3, and the answering run uses the kept assignment', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.md'), ASSIGNMENT + '\n');
  const first = runCli(['new'], dir);
  assert.equal(first.status, 3, first.stderr);
  const pending = lastJsonLine(first.stdout);
  assert.equal(pending['pending'], 'intake-questions');
  const ids = (pending['questions'] as Array<{ id: string }>).map((q) => q.id);
  assert.deepEqual(ids, ['topic', 'discipline', 'length_words', 'citation_style', 'audience', 'counterargument']);
  assert.match(String(pending['how_to_answer']), /--answers/);
  // assignment.md in the folder was found and kept; nothing was guessed.
  assert.match(readFileSync(join(dir, '.paper', 'PROJECT.md'), 'utf8'), /argumentative essay/);
  assert.ok(!existsSync(join(dir, '.paper', 'INTAKE.json')));
  assert.ok(!existsSync(join(dir, '.paper', 'STATE.json')));
  assert.ok(!existsSync(join(dir, '.paper', 'config.toml')), 'settings are saved only after a complete intake');

  const answersFile = join(dir, 'answers.json');
  writeFileSync(answersFile, JSON.stringify({ ...ALL_ANSWERS, discipline: 'computer science' }));
  const second = runCli(['new', '--answers', answersFile], dir);
  assert.equal(second.status, 0, second.stderr);
  const intake = JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(intake['discipline'], 'computer-science');
  assert.ok(!existsSync(join(dir, '.paper', 'INTAKE.pending.json')));
});

// A rubric often has headings of its own.
const ASSIGNMENT_MD = [
  '# PSYC 210, paper 2',
  '',
  'Write an argumentative essay on social media and teen anxiety.',
  '',
  '## Requirements',
  '',
  '- About 2,000 words',
  '- APA style',
  '- At least six peer-reviewed sources',
  '',
  '## Assignment',
  '',
  'Submit it on the course page.',
].join('\n');

test('an assignment with headings of its own is read back whole', async () => {
  const { readIntake } = await import('../bin/lib/intake-record.js');
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.md'), ASSIGNMENT_MD + '\n');
  const r = runCli(['new', '--answers', JSON.stringify(ALL_ANSWERS)], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readIntake(dir)?.assignment, ASSIGNMENT_MD);
});

test('without a terminal, answers given on an earlier run are kept until intake completes', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.md'), ASSIGNMENT + '\n');
  const first = runCli(['new', '--citation-style', 'apa'], dir);
  assert.equal(first.status, 3, first.stderr);
  const asked = (lastJsonLine(first.stdout)['questions'] as Array<{ id: string }>).map((q) => q.id);
  assert.deepEqual(asked, ['topic', 'discipline', 'length_words', 'audience', 'counterargument']);
  assert.ok(!existsSync(join(dir, '.paper', 'INTAKE.json')));

  // Answering exactly the questions listed completes intake.
  const rest = Object.fromEntries(Object.entries(ALL_ANSWERS).filter(([id]) => id !== 'citation_style'));
  const second = runCli(['new', '--answers', JSON.stringify(rest)], dir);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const intake = JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(intake['citation_style'], 'apa');
  assert.equal(intake['topic'], ALL_ANSWERS.topic);
  assert.ok(!existsSync(join(dir, '.paper', 'INTAKE.pending.json')));
});

test('with no assignment anywhere and no terminal, intake asks for it (exit 3) and sends nothing to a model', () => {
  const dir = tmp();
  const r = runCli(['new'], dir);
  assert.equal(r.status, 3, r.stderr);
  const pending = lastJsonLine(r.stdout);
  assert.deepEqual((pending['questions'] as Array<{ id: string }>).map((q) => q.id), ['assignment']);
  assert.ok(!existsSync(join(dir, '.paper', 'PROJECT.md')));
  assert.ok(!existsSync(join(dir, '.paper', 'COSTS.jsonl')));
});

test('a missing --from file, an unknown answer id and an unusable answer are refused with exit 2 before anything is kept', () => {
  const dir = tmp();
  const a = runCli(['new', '--from', 'nope.txt'], dir);
  assert.equal(a.status, 2, a.stderr);
  assert.match(a.stderr, /nope\.txt/);
  writeFileSync(join(dir, 'assignment.txt'), ASSIGNMENT);
  const b = runCli(['new', '--answers', JSON.stringify({ ...ALL_ANSWERS, colour: 'blue' })], dir);
  assert.equal(b.status, 2, b.stderr);
  assert.match(b.stderr, /colour/);
  const c = runCli(['new', '--answers', JSON.stringify({ ...ALL_ANSWERS, citation_style: 'Turabian' })], dir);
  assert.equal(c.status, 2, c.stderr);
  const d = runCli(['new', '--answers', JSON.stringify({ ...ALL_ANSWERS, length_words: 'long' })], dir);
  assert.equal(d.status, 2, d.stderr);
  assert.ok(!existsSync(join(dir, '.paper', 'PROJECT.md')));
  assert.ok(!existsSync(join(dir, '.paper', 'INTAKE.json')));
});

test('intake never touches a config.toml in the project root, and edits .paper/config.toml in place', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.txt'), ASSIGNMENT);
  // The user's own Hugo config, in the folder they run pensmith in.
  const hugo = 'baseURL = "https://example.org/"   # site\ntitle = "Notes"\n';
  writeFileSync(join(dir, 'config.toml'), hugo);
  mkdirSync(join(dir, '.paper'));
  const mine = '# my settings\n[project]\ngoal = "learning"  # I am studying this\nclass = "PSYC 210"\n\n[budget]\ncost_cap_usd = 3\n';
  writeFileSync(join(dir, '.paper', 'config.toml'), mine);

  const r = runCli(['new', '--answers', JSON.stringify(ALL_ANSWERS)], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, 'config.toml'), 'utf8'), hugo);
  const after = readFileSync(join(dir, '.paper', 'config.toml'), 'utf8');
  // goal is kept (no --goal given), comments and the other tables survive.
  assert.equal(after, mine.replace('class = "PSYC 210"\n', 'class = "PSYC 210"\ncitation_style = "apa"\n'));

  const g = runCli(['new', '--answers', JSON.stringify(ALL_ANSWERS), '--goal', 'both'], dir);
  assert.equal(g.status, 0, g.stderr);
  assert.match(readFileSync(join(dir, '.paper', 'config.toml'), 'utf8'), /^goal = "both"$/m);
  assert.match(readFileSync(join(dir, '.paper', 'config.toml'), 'utf8'), /^# my settings$/m);
});

test('a .paper/config.toml that does not parse is left as it is, with a warning', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.txt'), ASSIGNMENT);
  mkdirSync(join(dir, '.paper'));
  const broken = '[project\ngoal = "learning"\n';
  writeFileSync(join(dir, '.paper', 'config.toml'), broken);
  const r = runCli(['new', '--answers', JSON.stringify(ALL_ANSWERS)], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, '.paper', 'config.toml'), 'utf8'), broken);
  assert.match(r.stderr, /left as it is[\s\S]*citation_style = "apa"/);
});

// ---- in-process: the clarifier and the terminal questions ----

let prevCwd = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['PENSMITH_NO_LLM', 'ANTHROPIC_API_KEY', 'PENSMITH_OFFLINE'];
beforeEach(() => {
  prevCwd = process.cwd();
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env['PENSMITH_NO_LLM'];
  delete process.env['PENSMITH_OFFLINE'];
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-sent';
});
afterEach(() => {
  _setGeneratorForTest(null);
  process.chdir(prevCwd);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clarifier(seen: Array<{ system: string; user: string; schema: unknown }>): Generator {
  return {
    async generate(req) {
      seen.push({ system: req.system, user: req.messages.at(-1)?.content ?? '', schema: req.jsonSchema });
      const text = JSON.stringify({
        topic: 'social media and adolescent anxiety',
        questions: [
          { id: 'discipline', question: 'Which field is this for?', suggested: 'psychology' },
          { id: 'length_words', question: 'How long?', suggested: '2000' },
          { id: 'citation_style', question: 'Which style?', suggested: 'APA' },
        ],
      });
      return { text, model: req.model, stop: 'complete', stopReason: 'end_turn', usage: [{ model: req.model, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }] };
    },
  };
}

async function runIntake(dir: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { intakeCommand } = await import('../bin/cli/intake.js');
  process.chdir(dir);
  return (await (intakeCommand.run as (c: { args: Record<string, unknown> }) => Promise<Record<string, unknown>>)({ args })) ?? {};
}

test('on a terminal every question is asked with the clarifier\'s suggestion, and an unusable answer is asked again', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.txt'), ASSIGNMENT);
  const seen: Array<{ system: string; user: string; schema: unknown }> = [];
  _setGeneratorForTest(clarifier(seen));
  const { __setAskForTest } = await import('../bin/cli/intake.js');
  const asked: Array<{ id: string; suggested: string; invalid?: string }> = [];
  const typed: Record<string, string[]> = {
    topic: [''],
    discipline: ['psychology'],
    length_words: ['a lot', '8 pages'],
    citation_style: ['APA'],
    audience: ['second-year undergraduates'],
    counterargument: ['required'],
  };
  const restore = __setAskForTest(async (q, invalid) => {
    asked.push({ id: q.id, suggested: q.suggested, ...(invalid ? { invalid } : {}) });
    const next = typed[q.id]!.shift()!;
    return next === '' ? q.suggested : next;
  });
  try {
    const res = await runIntake(dir, {});
    assert.equal(res['ok'], true, JSON.stringify(res));
  } finally {
    restore();
  }
  // One structured call, with the assignment as the user turn.
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.user, ASSIGNMENT);
  assert.deepEqual(Object.keys((seen[0]!.schema as { properties: object }).properties), ['topic', 'questions']);
  assert.deepEqual(asked.map((a) => a.id), ['topic', 'discipline', 'length_words', 'length_words', 'citation_style', 'audience', 'counterargument']);
  assert.equal(asked[0]!.suggested, 'social media and adolescent anxiety');
  assert.match(asked[3]!.invalid ?? '', /number of words/);
  const intake = JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(intake['topic'], 'social media and adolescent anxiety');
  assert.equal(intake['length_words'], 8 * 275);
});

/** runIntake, leaving the exit code as it found it. */
async function runIntakeOnce(dir: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await runIntake(dir, args);
  } finally {
    process.exitCode = 0;
  }
}

type Waiting = Array<{ id: string; question: string; suggested: string }>;

test('a partial answering run after exit 3 reuses the kept questions and asks the model nothing again', async () => {
  // The assignment comes from outside the folder, so later runs use the copy
  // kept in PROJECT.md; it has headings of its own.
  const dir = tmp();
  const elsewhere = tmp('pensmith-brief-');
  writeFileSync(join(elsewhere, 'brief.md'), ASSIGNMENT_MD + '\n');
  const seen: Array<{ system: string; user: string; schema: unknown }> = [];
  _setGeneratorForTest(clarifier(seen));

  const first = await runIntakeOnce(dir, { from: join(elsewhere, 'brief.md') });
  assert.equal(first['mode'], 'pending');
  assert.equal(seen.length, 1);

  const second = await runIntakeOnce(dir, { answers: JSON.stringify({ topic: 'x', discipline: 'psychology' }) });
  assert.equal(second['mode'], 'pending');
  assert.equal(seen.length, 1, 'the questions from the first run are reused');
  const waiting = second['questions'] as Waiting;
  assert.deepEqual(waiting.map((q) => q.id), ['length_words', 'citation_style', 'audience', 'counterargument']);
  // The clarifier's wording and suggestions are kept, not pensmith's defaults.
  assert.deepEqual(waiting[0], { id: 'length_words', question: 'How long?', suggested: '2000' });
  assert.equal(waiting[1]!.suggested, 'APA');

  const third = await runIntakeOnce(dir, {
    answers: JSON.stringify({ length_words: '2000', citation_style: 'apa', audience: 'a seminar', counterargument: 'none' }),
  });
  assert.equal(third['ok'], true, JSON.stringify(third));
  assert.equal(seen.length, 1);
  const intake = JSON.parse(readFileSync(join(dir, '.paper', 'INTAKE.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(intake['topic'], 'x');
  assert.equal(intake['discipline'], 'psychology');
});

test('a changed assignment asks the clarifier again and drops the answers kept for the old one', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'assignment.txt'), ASSIGNMENT);
  const seen: Array<{ system: string; user: string; schema: unknown }> = [];
  _setGeneratorForTest(clarifier(seen));
  await runIntakeOnce(dir, { answers: JSON.stringify({ topic: 'x', discipline: 'psychology' }) });
  assert.equal(seen.length, 1);

  writeFileSync(join(dir, 'assignment.txt'), 'HIST 330. Write 3,000 words on the 1832 Reform Act. Chicago notes.');
  const again = await runIntakeOnce(dir, { answers: JSON.stringify({ audience: 'a seminar' }) });
  assert.equal(again['mode'], 'pending');
  assert.equal(seen.length, 2, 'the questions kept for the old assignment are not reused');
  assert.match(seen[1]!.user, /Reform Act/);
  const waiting = (again['questions'] as Waiting).map((q) => q.id);
  assert.deepEqual(waiting, ['topic', 'discipline', 'length_words', 'citation_style', 'counterargument']);
});

test('a terminal question nobody answers in time ends intake as a refusal, not a crash', async () => {
  const { PassThrough } = await import('node:stream');
  const { askInTerminal } = await import('../bin/cli/intake.js');
  const stdin = new PassThrough(); // open, and nobody types
  const answer = await askInTerminal(
    { id: 'topic', question: 'In a short phrase, what is the paper about?', suggested: '' },
    undefined,
    { mode: 'numbered', timeoutMs: 30, stdin, stderr: new PassThrough() },
  );
  assert.equal(answer, null);
  stdin.destroy();
});

test('research and the citation style read the stored answers, not question text', async () => {
  const { readIntake } = await import('../bin/lib/intake-record.js');
  const { resolveCitationStyle } = await import('../bin/lib/citation-style.js');
  const dir = tmp();
  mkdirSync(join(dir, '.paper'));
  // What the old intake wrote: the clarifier's questions.
  writeFileSync(join(dir, '.paper', 'INTAKE.md'), '1. Which discipline best fits this assignment? Suggested: CS, Bio, History.\n2. What length?\n');
  writeFileSync(join(dir, '.paper', 'INTAKE.json'), JSON.stringify({ $schemaVersion: 1, ...{
    topic: 'tidal energy policy', discipline: 'history', length_words: 1500, citation_style: 'vancouver', audience: 'a seminar', counterargument: 'none',
  } }));
  writeFileSync(join(dir, '.paper', 'PROJECT.md'), '# x\n\n## Assignment\n\nWrite about tidal energy.\n');
  const read = readIntake(dir);
  assert.equal(read?.topic, 'tidal energy policy');
  assert.equal(read?.discipline, 'history');
  assert.equal(read?.assignment, 'Write about tidal energy.');
  // No config.toml style: the stored answer comes before the discipline preset
  // (history's is chicago-notes-bib).
  assert.equal(resolveCitationStyle(dir).style, 'vancouver');

  // research scopes the search on the stored topic and discipline.
  const prompts: string[] = [];
  _setGeneratorForTest({
    async generate(req) {
      prompts.push(req.system + '\n' + req.messages.map((m) => m.content).join('\n'));
      throw new Error('stop here');
    },
  });
  const { researchCommand } = await import('../bin/cli/research.js');
  process.chdir(dir);
  await assert.rejects((researchCommand.run as (c: { args: Record<string, unknown> }) => Promise<unknown>)({ args: { yolo: true } }));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /tidal energy policy/);
  assert.match(prompts[0]!, /Write about tidal energy\./);
  assert.doesNotMatch(prompts[0]!, /Which discipline best fits/);
});

test('the intake-clarifier prompt\'s own example is an answer the schema accepts, and its ids are the questions', async () => {
  const { loadPrompt } = await import('../bin/lib/prompt-loader.js');
  const { ClarifierSchema, QUESTION_IDS, checkAnswer } = await import('../bin/lib/intake-record.js');
  const body = loadPrompt('intake-clarifier');
  const example = /```json\n([\s\S]*?)\n```/.exec(body)?.[1];
  assert.ok(example, 'the prompt shows an example answer');
  const parsed = ClarifierSchema.parse(JSON.parse(example));
  assert.deepEqual(parsed.questions.map((q) => q.id), [...QUESTION_IDS]);
  for (const q of parsed.questions) assert.ok(checkAnswer(q.id, q.suggested).ok, `${q.id}: ${q.suggested}`);
});

test('the disciplines intake accepts are the presets templates/presets/disciplines.json has', async () => {
  const { DISCIPLINES, disciplineFromAnswer } = await import('../bin/lib/intake-record.js');
  const presets = JSON.parse(readFileSync(fileURLToPath(new URL('../templates/presets/disciplines.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
  assert.deepEqual([...DISCIPLINES].sort(), Object.keys(presets).sort());
  assert.equal(disciplineFromAnswer('History of Science'), 'history');
  assert.equal(disciplineFromAnswer('Nursing'), 'other');
});
