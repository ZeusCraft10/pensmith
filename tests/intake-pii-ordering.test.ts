// tests/intake-pii-ordering.test.ts — T-09-PII-EGRESS, the NECESSARY half:
// in bin/cli/intake.ts the PII redaction runs before the clarifier request is
// built, and before INTAKE.md is written (GRND-05, D-18-12).
//
// tests/intake-pii-egress.test.ts is the SUFFICIENT half (it captures what the
// mock LLM receives). This file pins the source order and the on-disk result:
//   (a) the redaction (`redact(` / `diffPii(`) precedes buildPromptRequest(
//       'intake-clarifier', …) and complete(), and every write comes after the
//       clarifier call (a refused intake writes nothing);
//   (b) with the opt-in, INTAKE.md holds the redacted text (assignment, thesis
//       seed, class, follow-up answers) and INTAKE.raw.local the raw text;
//   (c) with the opt-in off, INTAKE.md keeps the raw text and no
//       INTAKE.raw.local is written.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIntakeBrief } from '../bin/lib/intake-brief.js';

function intakeSource(): string {
  return fs.readFileSync(fileURLToPath(new URL('../bin/cli/intake.ts', import.meta.url)), 'utf8');
}

function mkProjectRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-pii-ordering-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  process.env.PENSMITH_NO_LLM = '1';
  return tmp;
}

async function runIntake(cwd: string, args: Record<string, unknown>): Promise<void> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const { intakeCommand } = await import('../bin/cli/intake.js');
    const run = (intakeCommand as { run: (ctx: { args: Record<string, unknown> }) => Promise<unknown> }).run;
    await run({ args });
  } finally {
    process.chdir(prevCwd);
  }
}

const RAW_EMAIL = 'student.contact@example.test';
const RAW_NAME = 'Jane Q. Doe';

test('STRUCTURAL ORDERING: redaction precedes the clarifier request; every write follows the model call', () => {
  const src = intakeSource();
  const runAt = src.indexOf('async run(');
  const body = src.slice(runAt);
  const redactAt = body.indexOf('const modelText = redact(');
  const diffAt = body.indexOf('diffPii(');
  const requestAt = body.indexOf("buildPromptRequest('intake-clarifier'");
  const completeAt = body.indexOf('await complete<IntakeClarification>(');
  const firstWrite = Math.min(
    ...['atomicWriteFile(', 'initState(', 'writeIntakeConfig(', 'registerPaperNonFatal(', 'ensurePaperGitignore(']
      .map((w) => body.indexOf(w))
      .filter((i) => i >= 0),
  );
  for (const [name, at] of [['redact', redactAt], ['diffPii', diffAt], ['request', requestAt], ['complete', completeAt]] as const) {
    assert.ok(at > 0, `${name} found in run()`);
  }
  assert.ok(redactAt < requestAt && diffAt < requestAt, 'PII redaction precedes the model-bound request');
  assert.ok(requestAt < completeAt, 'the request is built, then sent');
  assert.ok(completeAt < firstWrite, 'nothing is written before the clarifier call (a refused intake leaves no trace)');
  assert.ok(!/\binterpolate\(/.test(src), 'no template interpolation at the intake call site (D-18-03)');
});

test('INTAKE.raw.local: PII opt-in ON redacts INTAKE.md (assignment, thesis seed, class) and keeps the raw text locally', async () => {
  const root = mkProjectRoot();
  const from = path.join(root, 'assignment.txt');
  fs.writeFileSync(from, `Email ${RAW_EMAIL} about the essay on the Weimar Republic.\n`);
  await runIntake(root, { from, 'pii-redact': true, yolo: true, thesis: `As ${RAW_NAME} argued, the Weimar Republic failed.`, class: `HIST 200 with ${RAW_NAME}` });

  const intakeMd = fs.readFileSync(path.join(root, '.paper', 'INTAKE.md'), 'utf8');
  assert.ok(!intakeMd.includes(RAW_EMAIL), 'INTAKE.md must be redacted (raw email absent)');
  assert.ok(!intakeMd.includes(RAW_NAME), 'INTAKE.md must be redacted (raw name absent from thesis and class)');
  assert.ok(intakeMd.includes('Weimar Republic'), 'entities survive');
  const brief = readIntakeBrief(root)?.brief;
  assert.equal(brief?.pii_redaction, true);
  assert.match(brief?.class ?? '', /^HIST 200 with \[REDACTED:NAME\]$/);

  const rawLocal = fs.readFileSync(path.join(root, '.paper', 'INTAKE.raw.local'), 'utf8');
  assert.ok(rawLocal.includes(RAW_EMAIL), 'INTAKE.raw.local holds the raw assignment');
  assert.ok(rawLocal.includes(RAW_NAME), 'INTAKE.raw.local holds the raw thesis seed and class');
});

test('opt-out: PII opt-in OFF keeps raw text in INTAKE.md and writes NO INTAKE.raw.local', async () => {
  const root = mkProjectRoot();
  const from = path.join(root, 'assignment.txt');
  fs.writeFileSync(from, `Email me at ${RAW_EMAIL} about the assignment.`);
  await runIntake(root, { from, yolo: true });
  assert.ok(!fs.existsSync(path.join(root, '.paper', 'INTAKE.raw.local')), 'opt-out must NOT write INTAKE.raw.local');
  assert.ok(fs.readFileSync(path.join(root, '.paper', 'INTAKE.md'), 'utf8').includes(RAW_EMAIL));
});
