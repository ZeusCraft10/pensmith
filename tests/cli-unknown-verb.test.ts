// tests/cli-unknown-verb.test.ts — an unknown first word is an error, not "run the next step".
//
// The dispatcher used to treat any first word it did not recognise as a bare
// `pensmith` call: `pensmith statsu`, the documented `pensmith intake --from
// <file>`, `pensmith export` and `pensmith revise 1` all dropped their flags and
// ran whatever the router picked next (in an empty folder, a new paper). These
// cases drive the real CLI and check both the exit code and that nothing was
// written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface RunResult { status: number | null; stdout: string; stderr: string; home: string }

function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-verb-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  delete env['ANTHROPIC_API_KEY'];
  delete env['OPENAI_API_KEY'];
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', home };
}

function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-verb-'));
}

function assertNothingWritten(dir: string, before: string[], r: RunResult): void {
  assert.deepEqual(readdirSync(dir).sort(), before, `the refused command wrote into the folder: ${r.stdout}${r.stderr}`);
  assert.deepEqual(readdirSync(r.home), [], 'the refused command wrote global state');
}

test('unknown verb: a misspelled verb exits 2, suggests the right one, and runs nothing', () => {
  const dir = emptyDir();
  const r = runCli(['statsu'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /unknown command 'statsu'/);
  assert.match(r.stderr, /pensmith status/, 'the error must suggest the closest verb');
  assertNothingWritten(dir, [], r);
});

test('unknown verb: a misspelled verb with flags and a section number is still refused', () => {
  const dir = emptyDir();
  const r = runCli(['wrtie', '1', '--yolo'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /unknown command 'wrtie'/);
  assert.match(r.stderr, /pensmith write/);
  assertNothingWritten(dir, [], r);
});

test('unknown verb: a bare number is not a verb', () => {
  const dir = emptyDir();
  const r = runCli(['3'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /unknown command '3'/);
  assertNothingWritten(dir, [], r);
});

test('unknown verb: `revise` points at `plan <N> --revise` instead of running the router', () => {
  const dir = emptyDir();
  const r = runCli(['revise', '1'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /pensmith plan <N> --revise/);
  assertNothingWritten(dir, [], r);
});

test('unknown verb: humanize, score and plagiarism point at `pensmith done`', () => {
  for (const word of ['humanize', 'score', 'plagiarism']) {
    const dir = emptyDir();
    const r = runCli([word], dir, { PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 2, `${word}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`unknown command '${word}'`));
    assert.match(r.stderr, /pensmith done/, `${word}: the hint must name pensmith done`);
    assertNothingWritten(dir, [], r);
  }
});

test('alias: `intake --from <file>` runs `new` and keeps --from', () => {
  const dir = emptyDir();
  const assignment = join(dir, 'assignment.txt');
  writeFileSync(assignment, 'Write a 2000-word essay on tidal energy policy in coastal towns.\n');
  const r = runCli(['intake', '--from', assignment], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /pensmith new: wrote INTAKE\.md/, 'the intake verb itself must run');
  const intake = readFileSync(join(dir, '.paper', 'INTAKE.md'), 'utf8');
  assert.match(intake, /tidal energy policy/, '--from must reach the intake verb');
});

test('alias: `export` runs `done`, not the router', () => {
  const dir = emptyDir();
  const r = runCli(['export', '--format', 'md'], dir, { PENSMITH_NO_LLM: '1' });
  assert.match(r.stdout, /pensmith done: no compiled draft/, `export must run done; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.ok(!existsSync(join(dir, 'STATE.json')), 'export must not start a new paper');
  assert.ok(!existsSync(join(dir, '.paper')), 'export must not create .paper/');
});

test('no positional: bare `pensmith` with only flags still asks the router', () => {
  const dir = emptyDir();
  const r = runCli(['--yolo'], dir, { PENSMITH_NO_LLM: '1' });
  // An empty folder routes to `new`, which writes INTAKE.md.
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pensmith new: wrote INTAKE\.md/);
});

test('unknown option: a flag pensmith does not have exits 2 instead of starting a paper', () => {
  for (const [flag, suggestion] of [['--verison', /--version/], ['--yollo', /--yolo/], ['--json', null]] as const) {
    const dir = emptyDir();
    const r = runCli([flag], dir, { PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 2, `${flag}: stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(`unknown option '${flag}'`), flag);
    if (suggestion) assert.match(r.stderr, suggestion, `${flag}: the error must suggest the closest option`);
    assertNothingWritten(dir, [], r);
  }
});

test('unknown option: an unknown flag next to a real one is still refused', () => {
  const dir = emptyDir();
  const r = runCli(['--yolo', '--dryrun'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /unknown option '--dryrun'/);
  assert.match(r.stderr, /--dry-run/);
  assertNothingWritten(dir, [], r);
});

test('option: `-v` prints the version and runs nothing', () => {
  const dir = emptyDir();
  const r = runCli(['-v'], dir, { PENSMITH_NO_LLM: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\d+\.\d+\.\d+/, `-v must print the version: ${r.stdout}`);
  assertNothingWritten(dir, [], r);
});
