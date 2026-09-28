// tests/intake-tty.test.ts — GRND-02 acceptance #1 on the TERMINAL path: a user
// running bare `pensmith` in a folder holding assignment.txt answers intake
// through @clack/prompts (bin/lib/prompts/clack.ts) and intake finishes.
//
// The CLI is a real child process whose stdio report isTTY
// (tests/helpers/fake-tty.mjs), so resolveMode() picks clack and every prompt
// is a clack prompt fed with keypresses. Each prompt is answered only once its
// label is on stdout.
//
//   (a) Enter on every prompt accepts every default: the style-match question
//       ("leave blank to skip") is off — never a folder named "undefined" — and
//       INTAKE.md and config.toml are written.
//   (b) Typing over a pre-filled default stores exactly what was typed: class
//       "HIST 200" (not "UnfiledHIST 200"), length 2000 (not 15002000) and the
//       follow-up answer verbatim (not appended to the suggestion).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { intakeQuestions, Q } from '../bin/lib/intake-questions.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const FAKE_TTY = import.meta.resolve('./helpers/fake-tty.mjs');

const ASSIGNMENT = 'Write an argumentative essay on whether social media harms adolescents.\n';
const FOLLOW_UP = 'Who is the intended audience for this paper?';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** CSI sequences (colors, cursor moves, erase), OSC titles and charset selects. */
const CONTROL = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}|${ESC}[()][A-Za-z0-9]`, 'g');

/** Terminal control sequences removed, so labels are plain substrings. */
function plain(s: string): string {
  return s.replace(CONTROL, '');
}

/** The label clack shows for a battery question (a stable prefix of it). */
function labelOf(id: string): string {
  const q = intakeQuestions().find((x) => x.id === id);
  assert.ok(q, `no intake question ${id}`);
  return q.label.slice(0, 40);
}

interface Step {
  readonly label: string;
  readonly keys: string;
}

/**
 * Run bare `pensmith` in the sandbox as a terminal session: whenever one of the
 * steps' labels appears on stdout (after the previous answer), write its keys.
 * Resolves with the exit status and the plain transcript.
 */
function drive(sb: LlmSandbox, steps: readonly Step[]): Promise<{ status: number | null; transcript: string; answered: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, '--import', FAKE_TTY, PENSMITH_TS], {
      cwd: sb.root,
      env: sb.spawnEnv({ PENSMITH_NO_LLM: '1', PENSMITH_PROMPT_MODE: undefined, NO_COLOR: '1', FORCE_COLOR: undefined }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let consumed = 0;
    const pending = [...steps];
    const answered: string[] = [];
    let timer: NodeJS.Timeout | null = null;
    const kill = setTimeout(() => child.kill('SIGKILL'), 90_000);
    const answerNext = (): void => {
      timer = null;
      const text = plain(out).slice(consumed);
      // The earliest pending label on screen is the prompt now waiting.
      let best: { i: number; at: number } | null = null;
      pending.forEach((s, i) => {
        const at = text.indexOf(s.label);
        if (at >= 0 && (best === null || at < best.at)) best = { i, at };
      });
      if (best === null) return;
      const { i } = best as { i: number; at: number };
      const step = pending.splice(i, 1)[0] as Step;
      consumed = plain(out).length;
      answered.push(step.label);
      child.stdin.write(step.keys);
      if (pending.length === 0) child.stdin.end();
    };
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      // Let the prompt finish rendering before answering it.
      if (timer === null) timer = setTimeout(answerNext, 150);
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d; });
    child.on('error', (e) => { clearTimeout(kill); reject(e); });
    child.on('close', (status) => {
      clearTimeout(kill);
      if (timer) clearTimeout(timer);
      resolve({ status, transcript: `${plain(out)}\n--- stderr ---\n${plain(err)}`, answered });
    });
  });
}

function battery(overrides: Partial<Record<string, string>> = {}): Step[] {
  const enter = '\r';
  return [
    { label: 'Use the assignment file in this folder', keys: enter },
    ...intakeQuestions().map((q) => ({ label: labelOf(q.id), keys: overrides[q.id] ?? enter })),
    { label: FOLLOW_UP, keys: overrides['follow-up'] ?? enter },
  ];
}

test('GRND-02 (TTY): Enter on every clack prompt accepts the defaults; intake writes INTAKE.md and config.toml', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const steps = battery();
    const r = await drive(sb, steps);
    assert.equal(r.status, 0, r.transcript);
    assert.deepEqual([...r.answered].sort(), steps.map((s) => s.label).sort(), `every prompt was asked:\n${r.transcript}`);
    assert.doesNotMatch(r.transcript, /undefined/, 'no answer turns into the text "undefined"');
    const intake = fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8');
    assert.match(intake, /^class: Unfiled$/m);
    assert.match(intake, /^length_target_words: 1500$/m);
    assert.match(intake, /^style_match: false$/m, 'a blank style-samples answer is off');
    assert.match(intake, /the course instructor and classmates/, 'the suggested follow-up answer is recorded');
    assert.ok(fs.existsSync(path.join(sb.paper, 'config.toml')), 'config.toml is written');
    assert.ok(!fs.existsSync(path.join(sb.paper, 'STYLE.json')), 'no style profile without samples');
  });
});

test('GRND-02 (TTY): a typed answer replaces the pre-filled default instead of being appended to it', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' }, paper: false }, async (sb) => {
    fs.writeFileSync(path.join(sb.root, 'assignment.txt'), ASSIGNMENT);
    const steps = battery({
      [Q.class]: 'HIST 200\r',
      [Q.length]: '2000\r',
      'follow-up': 'graduate students in my seminar\r',
    });
    const r = await drive(sb, steps);
    assert.equal(r.status, 0, r.transcript);
    const intake = fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8');
    assert.match(intake, /^class: HIST 200$/m, intake);
    assert.match(intake, /^length_target_words: 2000$/m, intake);
    assert.match(intake, /graduate students in my seminar/);
    assert.doesNotMatch(intake, /UnfiledHIST|15002000|classmatesgraduate/);
    assert.match(fs.readFileSync(path.join(sb.paper, 'config.toml'), 'utf8'), /^length_target_words = 2000$/m);
  });
});
