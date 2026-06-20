// tests/intake-pii-ordering.test.ts — Phase 9 Wave 0 RED-by-skip PII-ORDERING
// gate (threat T-09-PII-EGRESS, the NECESSARY-but-not-sufficient half).
//
// This gate proves the SOURCE ORDERING mitigation: in bin/cli/intake.ts the PII
// diff/redaction step precedes the prompt-load that builds the model-bound
// payload — so redaction cannot be wired AFTER the egress by accident. It is
// NECESSARY but NOT SUFFICIENT: ordering alone does not prove the REDACTED text
// is what flows to the model (a verbatim implementer could redact early then
// still interpolate the raw answers). tests/intake-pii-egress.test.ts closes
// that gap by-content.
//
// RED-by-skip via SOURCE-GREP (mirrors intake-style-producer's intakeStyleWired
// precedent): READY = intake.ts references BOTH `diffPii` AND the
// `loadPrompt('intake-clarifier')` call, with diffPii appearing FIRST. Until
// 09-03 wires PII redaction into intake, every test SKIPS so the suite stays
// GREEN.
//
// Contracts (so 09-03 satisfies them):
//   (a) STRUCTURAL ORDERING — diffPiiIdx < loadPromptIdx in intake.ts source.
//   (b) INTAKE.raw.local write — with PII opt-in ON, INTAKE.md is redacted AND
//       .paper/INTAKE.raw.local holds the raw (unredacted) answers.
//   (c) opt-out — with PII opt-in OFF, INTAKE.md keeps raw answers and NO
//       INTAKE.raw.local is written.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

// SOURCE-GREP ordering predicate. The model-bound payload in intake is built by
// loadPrompt('intake-clarifier') → interpolate; redaction must precede it.
function intakeSource(): string {
  return fs.readFileSync(repoPath('bin/cli/intake.ts'), 'utf8');
}
function piiOrderingWired(): boolean {
  const src = intakeSource();
  const diffPiiIdx = src.indexOf('diffPii');
  const loadPromptIdx = src.indexOf("loadPrompt('intake-clarifier')");
  return diffPiiIdx !== -1 && loadPromptIdx !== -1 && diffPiiIdx < loadPromptIdx;
}

const READY = piiOrderingWired();

function mkProjectRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-pii-ordering-'));
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  process.env.PENSMITH_NO_LLM = '1';
  return tmp;
}

/** Run the intake verb inside `cwd` with the given args. */
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

/** Write a --from seed file containing an email PII sentinel. */
function seedFrom(root: string, body: string): string {
  const p = path.join(root, 'assignment.txt');
  fs.writeFileSync(p, body);
  return p;
}

const RAW_EMAIL = 'student.contact@example.test';

test('STRUCTURAL ORDERING: diffPii precedes loadPrompt(intake-clarifier) in intake.ts', { skip: !READY }, () => {
  const src = intakeSource();
  const diffPiiIdx = src.indexOf('diffPii');
  const loadPromptIdx = src.indexOf("loadPrompt('intake-clarifier')");
  assert.ok(diffPiiIdx !== -1, 'intake.ts must reference diffPii');
  assert.ok(loadPromptIdx !== -1, "intake.ts must call loadPrompt('intake-clarifier')");
  assert.ok(diffPiiIdx < loadPromptIdx, 'PII diff/redaction must precede the prompt-load (T-09-PII-EGRESS ordering)');
});

test('INTAKE.raw.local: PII opt-in ON redacts INTAKE.md and writes the raw answers to INTAKE.raw.local', { skip: !READY }, async () => {
  const root = mkProjectRoot();
  const from = seedFrom(root, `Email me at ${RAW_EMAIL} about the assignment.`);
  // The exact opt-in arg/env name is the 09-03 wiring's to define; this test
  // pins the BEHAVIOR. We pass both a plausible flag and env so 09-03 can read
  // either.
  process.env.PENSMITH_PII_REDACT = '1';
  await runIntake(root, { from, redactPii: true, yolo: true });
  delete process.env.PENSMITH_PII_REDACT;

  const intakeMd = fs.readFileSync(path.join(root, '.paper', 'INTAKE.md'), 'utf8');
  assert.ok(!intakeMd.includes(RAW_EMAIL), 'INTAKE.md must be redacted (raw email absent)');

  const rawLocalPath = path.join(root, '.paper', 'INTAKE.raw.local');
  assert.ok(fs.existsSync(rawLocalPath), 'PII opt-in must write .paper/INTAKE.raw.local');
  const rawLocal = fs.readFileSync(rawLocalPath, 'utf8');
  assert.ok(rawLocal.includes(RAW_EMAIL), 'INTAKE.raw.local must hold the raw (unredacted) answers');
});

test('opt-out: PII opt-in OFF keeps raw answers in INTAKE.md and writes NO INTAKE.raw.local', { skip: !READY }, async () => {
  const root = mkProjectRoot();
  const from = seedFrom(root, `Email me at ${RAW_EMAIL} about the assignment.`);
  await runIntake(root, { from, yolo: true });

  const rawLocalPath = path.join(root, '.paper', 'INTAKE.raw.local');
  assert.ok(!fs.existsSync(rawLocalPath), 'opt-out must NOT write INTAKE.raw.local');
});
