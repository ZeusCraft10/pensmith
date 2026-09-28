// tests/intake-battery.test.ts — GRND-02 (D-18-09): the PRD §7.1 question
// battery and how its answers are collected.
//
//   - the battery: order, options from the preset file, flags and
//     answers-file keys, the tutorial.ts question composed without naming it;
//   - collectFixedAnswers: flag > --answers file > config.toml; unknown
//     answers-file keys and invalid values are one-line usage errors naming
//     the valid ones; `[follow_ups]` and `thesis`;
//   - refuseUnanswered: the intake-defaults gate refuses (EXIT_APPROVAL) a run
//     that cannot prompt, naming the unanswered questions; --yolo accepts;
//   - resolveBattery: asks unanswered questions with the suggestion as
//     default, re-asks an invalid answer, turns answers that run out into the
//     intake-defaults refusal;
//   - resolveFollowUps: answers file > asked > suggested (marked), and a run
//     whose scripted answers run out records the suggestions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Q, answersFileKeys, describeIntakeQuestions, intakeQuestions, type IntakeQuestion } from '../bin/lib/intake-questions.js';
import {
  collectFixedAnswers,
  promptFor,
  refuseUnanswered,
  resolveBattery,
  resolveFollowUps,
  unansweredDetail,
  unansweredQuestions,
  type FixedAnswers,
} from '../bin/lib/intake-answers.js';
import { readIntakeAnswersFile } from '../bin/lib/config.js';
import { PromptAbortedError, type PromptAnswer, type PromptQuestion } from '../bin/lib/prompts.js';
import { GateRefusedError } from '../bin/lib/gates.js';
import { EXIT_APPROVAL, EXIT_USAGE, PensmithError } from '../bin/lib/exit-codes.js';
import { disciplineSlugs } from '../bin/lib/disciplines.js';
import { TUTORIAL_INTAKE_QUESTION } from '../bin/lib/tutorial.js';

const questions = intakeQuestions();

function byId(id: string): IntakeQuestion {
  const q = questions.find((x) => x.id === id);
  assert.ok(q, id);
  return q;
}

/** A scripted asker: one answer per question, in order; runs out → PromptAbortedError. */
function scripted(answers: string[]): { ask: (q: PromptQuestion) => Promise<PromptAnswer>; asked: PromptQuestion[] } {
  const asked: PromptQuestion[] = [];
  return {
    asked,
    async ask(q: PromptQuestion): Promise<PromptAnswer> {
      asked.push(q);
      const next = answers.shift();
      if (next === undefined) throw new PromptAbortedError(q.id);
      if (q.kind === 'confirm') return { id: q.id, kind: 'confirm', value: next === '' ? q.default === true : /^y/i.test(next) };
      if (q.kind === 'select') return { id: q.id, kind: 'select', value: next === '' ? (q.default ?? '') : next };
      if (q.kind === 'multiline') return { id: q.id, kind: 'multiline', value: next };
      if (q.kind === 'multiselect') return { id: q.id, kind: 'multiselect', value: [next] };
      return { id: q.id, kind: 'text', value: next === '' ? (q.default ?? '') : next };
    },
  };
}

const noFixed: FixedAnswers = { values: new Map(), followUps: new Map(), thesis: '' };

test('GRND-02: the battery is the PRD §7.1 list, in order, with preset options and one flag and key each', () => {
  assert.deepEqual(
    questions.map((q) => q.id),
    [Q.pii, Q.discipline, Q.mode, TUTORIAL_INTAKE_QUESTION.id, Q.class, Q.counterargument, Q.styleSamples, Q.length, Q.citationStyle],
  );
  assert.deepEqual(byId(Q.discipline).options.map((o) => o.value), disciplineSlugs(), 'discipline options come from disciplines.json');
  assert.deepEqual(byId(Q.citationStyle).options.length, 8);
  const flags = questions.map((q) => q.flag);
  assert.equal(new Set(flags).size, flags.length, 'one flag per question');
  assert.ok(flags.includes('citation-style') && flags.includes('style-samples') && flags.includes('pii-redact'));
  assert.deepEqual(answersFileKeys(), [...questions.map((q) => q.key), 'thesis', 'follow_ups']);
  const described = describeIntakeQuestions();
  assert.equal(described.length, questions.length);
  assert.equal(described.find((d) => d['id'] === Q.pii)?.['flag'], '--pii-redact / --no-pii-redact');
});

test('GRND-02: the tutorial.ts question is composed opaquely (intake-questions.ts and intake-answers.ts never name it)', () => {
  const fq = byId(TUTORIAL_INTAKE_QUESTION.id);
  assert.equal(fq.label, TUTORIAL_INTAKE_QUESTION.label);
  assert.deepEqual(fq.options.map((o) => o.value), TUTORIAL_INTAKE_QUESTION.options.map((o) => o.value));
  assert.equal(fq.staticDefault, TUTORIAL_INTAKE_QUESTION.defaultValue);
  for (const file of ['bin/lib/intake-questions.ts', 'bin/lib/intake-answers.ts', 'bin/lib/intake-overrides.ts', 'bin/lib/assignment.ts', 'bin/lib/intake-parse.ts']) {
    const code = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(code, /\bgoal|learning|educator/i, `${file} stays unaware of the fragment's fields`);
  }
});

test('GRND-02: answers parse — discipline names and aliases, styles, lengths, yes/no, and refusals name the valid values', () => {
  const d = byId(Q.discipline);
  assert.deepEqual(d.parse('Psych'), { ok: true, value: 'psychology' });
  assert.deepEqual(d.parse('Biology / Life Sciences'), { ok: true, value: 'biology' });
  assert.deepEqual(d.parse('other'), { ok: true, value: 'other' });
  const bad = d.parse('underwater basket weaving');
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /unknown discipline .* \(one of: computer-science, biology/);
  assert.deepEqual(byId(Q.citationStyle).parse('Chicago'), { ok: true, value: 'chicago-notes-bib' });
  const style = byId(Q.citationStyle).parse('nonsense');
  assert.equal(style.ok, false);
  for (const k of ['apa', 'mla', 'chicago-notes-bib', 'chicago-author-date', 'ieee', 'ama', 'vancouver', 'harvard']) {
    assert.ok(!style.ok && style.error.includes(k), `the style refusal lists ${k}`);
  }
  assert.deepEqual(byId(Q.length).parse('2,000 words'), { ok: true, value: 2000 });
  assert.deepEqual(byId(Q.length).parse(1800), { ok: true, value: 1800 });
  assert.equal(byId(Q.length).parse('many').ok, false);
  assert.deepEqual(byId(Q.counterargument).parse('Y'), { ok: true, value: 'yes' });
  assert.deepEqual(byId(Q.counterargument).parse('auto'), { ok: true, value: 'auto' });
  assert.deepEqual(byId(Q.pii).parse(true), { ok: true, value: true });
  assert.deepEqual(byId(Q.pii).parse('no'), { ok: true, value: false });
  assert.deepEqual(byId(Q.styleSamples).parse('no'), { ok: true, value: '' });
  assert.deepEqual(byId(Q.class).parse(''), { ok: true, value: 'Unfiled' });
  assert.deepEqual(byId(Q.mode).parse('outline-only'), { ok: true, value: 'outline' });
  assert.deepEqual(byId(TUTORIAL_INTAKE_QUESTION.id).parse(TUTORIAL_INTAKE_QUESTION.options[2]?.value), { ok: true, value: TUTORIAL_INTAKE_QUESTION.options[2]?.value });
  assert.equal(byId(TUTORIAL_INTAKE_QUESTION.id).parse('sideways').ok, false);
});

test('GRND-02: flag > --answers file (config.toml is intake OUTPUT, never an answer); unknown answers-file keys and bad values are EXIT_USAGE', () => {
  const fixed = collectFixedAnswers({
    questions,
    flags: { discipline: 'history', 'pii-redact': false, class: 'HIST 200' },
    answersFile: { path: 'a.toml', data: { discipline: 'psychology', length: 2400, counterargument: 'yes', style_samples: 'no', follow_ups: { audience: 'my seminar' }, thesis: 'A thesis.' } },
  });
  assert.deepEqual(fixed.values.get(Q.discipline), { value: 'history', source: 'flag' });
  assert.deepEqual(fixed.values.get(Q.length), { value: 2400, source: 'answers' });
  assert.deepEqual(fixed.values.get(Q.class), { value: 'HIST 200', source: 'flag' });
  assert.deepEqual(fixed.values.get(Q.counterargument), { value: 'yes', source: 'answers' });
  assert.deepEqual(fixed.values.get(Q.styleSamples), { value: '', source: 'answers' });
  assert.deepEqual(fixed.values.get(Q.pii), { value: false, source: 'flag' });
  assert.equal(fixed.followUps.get('audience'), 'my seminar');
  assert.equal(fixed.thesis, 'A thesis.');
  assert.deepEqual(unansweredQuestions(questions, fixed).map((q) => q.id), [Q.mode, TUTORIAL_INTAKE_QUESTION.id, Q.citationStyle]);

  assert.throws(
    () => collectFixedAnswers({ questions, flags: {}, answersFile: { path: 'a.toml', data: { dicsipline: 'x' } } }),
    (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && /--answers a\.toml: unknown key "dicsipline" \(valid keys: pii_redaction, discipline, mode, .*citation_style, thesis, follow_ups\)/.test(e.message),
  );
  assert.throws(
    () => collectFixedAnswers({ questions, flags: { 'citation-style': 'nonsense' } }),
    (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && /^--citation-style: unknown citation style "nonsense" \(valid styles: APA, MLA/.test(e.message),
  );
  assert.throws(
    () => collectFixedAnswers({ questions, flags: {}, answersFile: { path: 'a.toml', data: { length: 'lots' } } }),
    (e: unknown) => e instanceof PensmithError && /--answers a\.toml: length: length must be a word count/.test(e.message),
  );
  assert.throws(
    () => collectFixedAnswers({ questions, flags: {}, answersFile: { path: 'a.toml', data: { follow_ups: 'x' } } }),
    /follow_ups must be a table/,
  );
});

test('GRND-02: --answers files parse through config.ts (LF and CRLF; missing file and bad TOML are one-line usage errors)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-answers-'));
  const body = 'discipline = "psychology"\nmode = "draft"\nclass = "PSYC 101"\nlength = 2000\n\n[follow_ups]\naudience = "first-year students"\n';
  for (const [name, text] of [['lf.toml', body], ['crlf.toml', body.replace(/\n/g, '\r\n')]] as const) {
    const f = join(dir, name);
    writeFileSync(f, text);
    const data = readIntakeAnswersFile(f);
    assert.deepEqual(data, { discipline: 'psychology', mode: 'draft', class: 'PSYC 101', length: 2000, follow_ups: { audience: 'first-year students' } }, name);
  }
  assert.throws(() => readIntakeAnswersFile(join(dir, 'missing.toml')), (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && /no such file/.test(e.message));
  writeFileSync(join(dir, 'bad.toml'), 'discipline = \n');
  assert.throws(() => readIntakeAnswersFile(join(dir, 'bad.toml')), /is not valid TOML/);
});

test('GRND-02: without a terminal and without --yolo, unanswered questions are refused through intake-defaults (exit 3), naming them', async () => {
  const prev = process.env['PENSMITH_PROMPT_MODE'];
  delete process.env['PENSMITH_PROMPT_MODE'];
  const saved = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  try {
    const missing = unansweredQuestions(questions, noFixed);
    await assert.rejects(refuseUnanswered(missing, false), (e: unknown) => {
      assert.ok(e instanceof GateRefusedError);
      assert.equal(e.exitCode, EXIT_APPROVAL);
      assert.equal(e.gateId, 'intake-defaults');
      assert.match(e.message, /^Accept the intake defaults\? \(unanswered: pii_redaction \(--pii-redact \/ --no-pii-redact\), discipline \(--discipline\), mode \(--mode\), .*length \(--length\), citation_style \(--citation-style\) — answer them with those flags or --answers <file\.toml>\) needs an answer: re-run in a terminal, or pass --yolo to accept the defaults\.$/);
      return true;
    });
    await refuseUnanswered(missing, true); // --yolo accepts the defaults
    await refuseUnanswered([], false); // nothing left to answer
  } finally {
    if (saved) Object.defineProperty(process.stdin, 'isTTY', saved);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (prev !== undefined) process.env['PENSMITH_PROMPT_MODE'] = prev;
  }
  assert.match(unansweredDetail([byId(Q.class)]), /^unanswered: class \(--class\)/);
});

test('GRND-02: resolveBattery asks every unanswered question with the suggestion as default; --yolo takes the suggestions', async () => {
  const suggest = (q: IntakeQuestion): string | number | boolean => (q.id === Q.discipline ? 'history' : q.id === Q.length ? 2400 : q.id === Q.citationStyle ? 'chicago-notes-bib' : (q.staticDefault ?? ''));
  const fixed: FixedAnswers = { values: new Map([[Q.class, { value: 'HIST 200', source: 'flag' as const }]]), followUps: new Map(), thesis: '' };
  const s = scripted(['n', '', 'outline', '', 'yes', 'no', '3000 words', 'MLA']);
  const notes: string[] = [];
  const out = await resolveBattery({ questions, fixed, suggest, yolo: false, canPrompt: true, ask: s.ask, note: (l) => notes.push(l) });
  assert.deepEqual(s.asked.map((q) => q.id), [Q.pii, Q.discipline, Q.mode, TUTORIAL_INTAKE_QUESTION.id, Q.counterargument, Q.styleSamples, Q.length, Q.citationStyle]);
  assert.equal((s.asked[1] as { default?: string }).default, 'history', 'the suggestion is the default');
  assert.deepEqual(out.get(Q.discipline), { value: 'history', source: 'asked' });
  assert.deepEqual(out.get(Q.mode), { value: 'outline', source: 'asked' });
  assert.deepEqual(out.get(Q.class), { value: 'HIST 200', source: 'flag' });
  assert.deepEqual(out.get(Q.length), { value: 3000, source: 'asked' });
  assert.deepEqual(out.get(Q.citationStyle), { value: 'mla', source: 'asked' });
  assert.deepEqual(notes, []);

  const y = scripted([]);
  const yolo = await resolveBattery({ questions, fixed: noFixed, suggest, yolo: true, canPrompt: true, ask: y.ask, note: () => {} });
  assert.equal(y.asked.length, 0, '--yolo asks nothing');
  assert.deepEqual(yolo.get(Q.length), { value: 2400, source: 'default' });
  assert.deepEqual(yolo.get(Q.pii), { value: false, source: 'default' });
});

test('GRND-02: an invalid answer is asked again; scripted answers that run out end in the intake-defaults refusal', async () => {
  const suggest = (q: IntakeQuestion): string | number | boolean => q.staticDefault ?? (q.id === Q.length ? 1500 : q.id === Q.citationStyle ? 'apa' : 'other');
  const notes: string[] = [];
  const s = scripted(['n', '', '', '', '', '', 'no', 'lots', '1200']);
  const partial = await resolveBattery({ questions: questions.slice(0, 8), fixed: noFixed, suggest, yolo: false, canPrompt: true, ask: s.ask, note: (l) => notes.push(l) }).catch((e: unknown) => e);
  assert.ok(!(partial instanceof Error), String(partial));
  assert.equal(notes.length, 1, 'one re-ask note');
  assert.match(notes[0] ?? '', /length must be a word count .* — try again$/);

  const short = scripted(['', '']);
  await assert.rejects(
    resolveBattery({ questions, fixed: noFixed, suggest, yolo: false, canPrompt: true, ask: short.ask, note: () => {} }),
    (e: unknown) => e instanceof GateRefusedError && e.exitCode === EXIT_APPROVAL && /unanswered: goal|the piped answers ran out/.test(e.message) && /ran out/.test(e.message),
  );
});

test('GRND-02: follow-ups — answers file wins, asked in a terminal, otherwise the suggestion is recorded and marked', async () => {
  const followUps = [
    { id: 'audience', question: 'Who is the audience?', suggested_answer: 'my seminar' },
    { id: 'period', question: 'Which period?', suggested_answer: '1789–1799' },
    { id: 'case', question: 'Which case study?', suggested_answer: 'Paris' },
    { id: 'extra', question: 'A fourth one?', suggested_answer: 'x' },
  ];
  const s = scripted(['the whole class']);
  const out = await resolveFollowUps({ followUps, fixed: new Map([['period', 'the Terror only']]), yolo: false, canPrompt: true, ask: s.ask });
  assert.deepEqual(out.map((f) => [f.id, f.answer, f.how]), [
    ['audience', 'the whole class', 'asked'],
    ['period', 'the Terror only', 'answers'],
    ['case', 'Paris', 'suggested'],
  ], 'at most three; the third ran out of scripted answers and records the suggestion');
  const yolo = await resolveFollowUps({ followUps, fixed: new Map(), yolo: true, canPrompt: true, ask: scripted([]).ask });
  assert.ok(yolo.every((f) => f.how === 'suggested'));
  const noTty = await resolveFollowUps({ followUps, fixed: new Map(), yolo: false, canPrompt: false, ask: scripted([]).ask });
  assert.ok(noTty.every((f) => f.how === 'suggested'));
});

test('GRND-02: promptFor renders each question kind with its suggestion as the default', () => {
  assert.deepEqual(promptFor(byId(Q.pii), true), { id: Q.pii, kind: 'confirm', label: byId(Q.pii).label, default: true });
  const sel = promptFor(byId(Q.discipline), 'history');
  assert.equal(sel.kind, 'select');
  assert.equal((sel as { default?: string }).default, 'history');
  const unknownDefault = promptFor(byId(Q.discipline), 'nope');
  assert.equal((unknownDefault as { default?: string }).default, undefined, 'a default that is not an option is dropped');
  assert.deepEqual(promptFor(byId(Q.styleSamples), ''), { id: Q.styleSamples, kind: 'text', label: byId(Q.styleSamples).label });
});
