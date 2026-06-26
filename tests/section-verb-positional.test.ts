// tests/section-verb-positional.test.ts — audit #10 regression.
//
// A section-scoped verb (plan/verify) typed WITHOUT its section number fell
// through to the bare router path and ran whatever DIFFERENT verb the router
// picked (bin/pensmith.ts:313-352) — so `pensmith verify` could silently run
// `outline`/`research`/etc. Now an explicitly-named section verb only runs THAT
// verb (its next pending section); otherwise it reports the real next step and
// exits non-zero, never running a command the user did not ask for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface RunResult { status: number | null; stdout: string; stderr: string }

function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...extraEnv })) {
    if (v !== undefined) env[k] = String(v);
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', TSX_LOADER, PENSMITH_TS, ...args],
      { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-secverb-'));
}

function writeState(root: string, sections: Array<{ n: number; slug: string }>): void {
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'secverb-test', createdAt: new Date().toISOString(), sections }),
  );
}

function writePaperFile(root: string, name: string): void {
  const pDir = join(root, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(join(pDir, name), `# ${name}\n`);
}

test('audit #10: `verify` (no N) does NOT silently run a different verb when none is ready', () => {
  const root = freshRoot();
  writeState(root, []);               // no sections
  writePaperFile(root, 'LIBRARY.json'); // research done; next action = outline
  // No OUTLINE.md → the router's next action is `outline`, NOT `verify`.

  const res = runCli(['verify'], root, { PENSMITH_NO_LLM: '1' });

  assert.equal(res.status, 1, `verify-with-no-ready-section must exit non-zero; stderr=${res.stderr}`);
  assert.match(res.stderr, /no section is ready to verify/i);
  assert.match(res.stderr, /pensmith outline/, 'must point the user at the real next step');
  // The crucial assertion: it must NOT have run `outline` (no OUTLINE.md written).
  assert.ok(!existsSync(join(root, '.paper', 'OUTLINE.md')), '`verify` must NOT silently run `outline`');
});

test('audit #10: `plan` (no N) runs plan for the next pending section', () => {
  const root = freshRoot();
  writeState(root, [{ n: 1, slug: 'intro' }]); // one registered section, no PLAN.md yet
  writePaperFile(root, 'LIBRARY.json');         // research done
  writePaperFile(root, 'OUTLINE.md');           // outline present → next action = plan(1)

  const res = runCli(['plan', '--yolo'], root, { PENSMITH_NO_LLM: '1' });

  assert.equal(res.status, 0, `plan must run for the next pending section; stderr=${res.stderr}`);
  assert.ok(
    existsSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md')),
    '`plan` with no N must plan the next pending section (01-intro)',
  );
});
