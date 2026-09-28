// tests/intake-style-producer.test.ts — STYL-01/02 producer inside `pensmith new`
// (08-05), with the Phase 18 intake battery (GRND-02): style-match is the
// §7.1 question `style_samples` (`--style-samples <dir>` / the answers-file
// key), opt-in, default off.
//
//   (1) the opt-in writes .paper/STYLE.json (flag, and the answers-file key);
//   (2) the cross-paper-reuse notice is UNCONDITIONAL — it prints in a fully
//       answered run WITHOUT --yolo (it is transparency, not a gate);
//   (3) without the opt-in no STYLE.json is produced, and config.toml [style]
//       says match_past_writing = false;
//   (4) a samples folder that does not exist is a one-line usage error before
//       anything is sent or written.
//
// The verb runs in-process (PENSMITH_NO_LLM stubs the clarifier); the skip
// guards of the Wave-0 scaffold are gone — the producer is wired.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyleProfile, checkAndRegisterFingerprint } from '../bin/lib/style-match.js';
import { TUTORIAL_INTAKE_QUESTION } from '../bin/lib/tutorial.js';
import { PensmithError, EXIT_USAGE } from '../bin/lib/exit-codes.js';

const PAPER_A = fileURLToPath(new URL('./fixtures/style-samples/paperA', import.meta.url));

/** Every battery question answered by flag, so a non-TTY run needs no --yolo. */
const ALL_ANSWERED: Record<string, unknown> = {
  discipline: 'other',
  mode: 'draft',
  [TUTORIAL_INTAKE_QUESTION.flag]: TUTORIAL_INTAKE_QUESTION.defaultValue,
  class: 'ENGL 110',
  counterargument: 'auto',
  'pii-redact': false,
  length: '1500',
  'citation-style': 'APA',
};

function mkProjectRoot(): string {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-intake-style-')));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  process.env.PENSMITH_NO_LLM = '1';
  fs.writeFileSync(path.join(tmp, 'assignment.txt'), 'Write a 1500-word essay on tidal power.\n');
  return tmp;
}

/** Capture (tee) process.stdout.write for the duration of `fn`. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return orig(chunk);
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

/** Run the intake verb inside `cwd` with the given args, returning stdout. */
async function runIntake(cwd: string, args: Record<string, unknown>): Promise<string> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { intakeCommand } = await import('../bin/cli/intake.js');
    const run = (intakeCommand as { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> }).run;
    return await captureStdout(async () => {
      await run({ args });
    });
  } finally {
    process.chdir(prevCwd);
  }
}

test('PRODUCER (1): `new --style-samples <dir>` writes .paper/STYLE.json and records the opt-in', async () => {
  const root = mkProjectRoot();
  await runIntake(root, { styleSamples: PAPER_A, yolo: true });
  const parsed = JSON.parse(fs.readFileSync(path.join(root, '.paper', 'STYLE.json'), 'utf8')) as { fingerprint: string };
  assert.match(parsed.fingerprint, /^[0-9a-f]{64}$/, 'STYLE.json carries a 64-hex fingerprint');
  const intake = fs.readFileSync(path.join(root, '.paper', 'INTAKE.md'), 'utf8');
  assert.match(intake, /^style_match: true$/m);
  const config = fs.readFileSync(path.join(root, '.paper', 'config.toml'), 'utf8');
  assert.match(config, /^match_past_writing = true$/m);
  assert.ok(config.includes(`samples_dir = ${JSON.stringify(PAPER_A)}`), config);
});

test('PRODUCER (1b): the answers-file key `style_samples` opts in too', async () => {
  const root = mkProjectRoot();
  const answers = path.join(root, 'answers.toml');
  fs.writeFileSync(answers, `style_samples = ${JSON.stringify(PAPER_A)}\n`);
  await runIntake(root, { answers, yolo: true });
  assert.ok(fs.existsSync(path.join(root, '.paper', 'STYLE.json')));
});

test('PRODUCER (2): the cross-paper-reuse notice fires UNCONDITIONALLY — in a fully answered run without --yolo', async () => {
  const root = mkProjectRoot();
  const prior = await buildStyleProfile(PAPER_A);
  await checkAndRegisterFingerprint(prior.fingerprint, 'prior-paper', 'A Prior Paper');
  const out = await runIntake(root, { ...ALL_ANSWERED, styleSamples: PAPER_A, yolo: false });
  assert.match(out, /NOTICE — these writing samples were already used to style a prior paper: A Prior Paper/);
  assert.doesNotMatch(out, /--yolo accepted/, 'every question was answered; nothing was defaulted');
});

test('PRODUCER (3): without the opt-in there is no STYLE.json and config.toml says match_past_writing = false', async () => {
  const root = mkProjectRoot();
  await runIntake(root, { yolo: true });
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'STYLE.json')), 'style-match is opt-in only');
  assert.match(fs.readFileSync(path.join(root, '.paper', 'config.toml'), 'utf8'), /^match_past_writing = false$/m);
});

test('PRODUCER (4): a samples folder that does not exist is EXIT_USAGE before anything is written', async () => {
  const root = mkProjectRoot();
  await assert.rejects(
    runIntake(root, { styleSamples: path.join(root, 'no-such-folder'), yolo: true }),
    (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && /--style-samples: .*no-such-folder: no such folder/.test(e.message),
  );
  assert.ok(!fs.existsSync(path.join(root, '.paper')), 'nothing was written');
});
