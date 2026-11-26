// tests/run-tests.test.ts — the test runner keeps tests away from the
// developer's machine and counts results it can trust.
//
// Each case copies scripts/run-tests.mjs (and the reporter beside it) into a
// throwaway repository with its own tests/ folder, runs it there on a few
// fixture test files, and reads what it reports. The fixture repository links
// node_modules from this one, so tsx resolves as it does here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

interface Run { status: number | null; out: string; repo: string }

/** A throwaway repository holding the runner and `files` (name → source) under tests/. */
function fixtureRepo(files: Record<string, string>): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'pensmith-runner-repo-'));
  mkdirSync(path.join(repo, 'scripts'));
  for (const f of readdirSync(path.join(REPO, 'scripts'))) {
    if (f === 'run-tests.mjs' || f.startsWith('test-')) cpSync(path.join(REPO, 'scripts', f), path.join(repo, 'scripts', f));
  }
  symlinkSync(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'junction');
  mkdirSync(path.join(repo, 'tests'));
  for (const [name, src] of Object.entries(files)) writeFileSync(path.join(repo, 'tests', name), src);
  return repo;
}

function runRunner(repo: string, env: Record<string, string> = {}): Run {
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-tests.mjs')], {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, repo };
}

test('the runner points HOME, the XDG folders, LOCALAPPDATA, the Claude config and the temp folder at its own folder, and removes it', () => {
  const report = path.join(mkdtempSync(path.join(tmpdir(), 'pensmith-runner-report-')), 'env.json');
  const repo = fixtureRepo({
    'env.test.ts': [
      "import { test } from 'node:test';",
      "import { writeFileSync, existsSync } from 'node:fs';",
      "import { tmpdir, homedir } from 'node:os';",
      "test('reads its environment', () => {",
      '  const keys = ["HOME", "USERPROFILE", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "LOCALAPPDATA", "APPDATA", "CLAUDE_CONFIG_DIR", "TMPDIR", "TMP", "TEMP", "PENSMITH_TEST_CASSETTES"];',
      '  const env: Record<string, string | undefined> = {};',
      '  for (const k of keys) env[k] = process.env[k];',
      '  writeFileSync(process.env.REPORT_TO!, JSON.stringify({ env, tmp: tmpdir(), home: homedir(), homeExists: existsSync(homedir()) }));',
      '});',
      '',
    ].join('\n'),
  });
  const real = { HOME: process.env['HOME'] ?? '', XDG_DATA_HOME: process.env['XDG_DATA_HOME'] ?? '' };
  const r = runRunner(repo, { REPORT_TO: report, PENSMITH_TEST_CASSETTES: '' });
  assert.equal(r.status, 0, r.out);
  const seen = JSON.parse(readFileSync(report, 'utf8')) as { env: Record<string, string | undefined>; tmp: string; home: string; homeExists: boolean };
  const home = seen.env['HOME'];
  assert.ok(home, 'HOME is set');
  assert.notEqual(home, real.HOME, 'HOME is not the developer\'s');
  assert.equal(seen.homeExists, true, 'the isolated HOME exists while the tests run');
  // Everything lives under one folder the runner made for this run.
  const root = path.dirname(home);
  for (const k of ['USERPROFILE', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'LOCALAPPDATA', 'APPDATA', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'TMP', 'TEMP']) {
    const v = seen.env[k];
    assert.ok(v && v.startsWith(root + path.sep), `${k}=${v} is under the run folder ${root}`);
    assert.notEqual(v, real.XDG_DATA_HOME);
  }
  assert.ok(seen.tmp.startsWith(root + path.sep), `os.tmpdir() (${seen.tmp}) is under the run folder`);
  assert.equal(seen.env['PENSMITH_TEST_CASSETTES'], '1', 'tests answer HTTP from the cassettes');
  assert.equal(existsSync(root), false, 'the run folder, and every temp folder a test left in it, is removed');
});

test('a test that creates .paper in the repository fails the run, naming its file', () => {
  const repo = fixtureRepo({
    'clean.test.ts': "import { test } from 'node:test';\ntest('clean', () => {});\n",
    'leaky.test.ts': [
      "import { test } from 'node:test';",
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "test('writes a cost row where the cwd is', () => {",
      "  mkdirSync(path.join(process.cwd(), '.paper'), { recursive: true });",
      "  writeFileSync(path.join(process.cwd(), '.paper', 'COSTS.jsonl'), '{}\\n');",
      '});',
      '',
    ].join('\n'),
  });
  const r = runRunner(repo);
  assert.notEqual(r.status, 0, `a leak must fail the run:\n${r.out}`);
  assert.match(r.out, /\.paper/);
  assert.match(r.out, /leaky\.test\.ts/, 'the leaking file is named');
  assert.equal(existsSync(path.join(repo, '.paper')), false, 'the leaked folder is removed, so the next run starts clean');
});

test('a .paper already in the repository stops the run before any test', () => {
  const repo = fixtureRepo({ 'clean.test.ts': "import { test } from 'node:test';\ntest('clean', () => {});\n" });
  mkdirSync(path.join(repo, '.paper'));
  const r = runRunner(repo);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /\.paper/);
  assert.doesNotMatch(r.out, /ok 1 - clean/, 'no test ran');
  assert.equal(existsSync(path.join(repo, '.paper')), true, 'a folder the runner did not make is left alone');
});

test('counts come from the test events, so stray TAP-looking output can neither hide a failure nor add a pass', () => {
  const repo = fixtureRepo({
    'noisy.test.ts': [
      "import { test } from 'node:test';",
      "test('passes after printing a fake failure', () => { process.stdout.write('not ok 7 - fake\\n# fail 3\\n'); });",
      "test('prints a fake pass, then fails', () => { process.stdout.write('ok 9 - PRODUCER (2)'); throw new Error('the real failure'); });",
      '',
    ].join('\n'),
    'crash.test.ts': "throw new Error('broken at import');\n",
    'empty.test.ts': "import { test } from 'node:test';\nif (process.env.NEVER === '1') test('never runs', () => {});\n",
  });
  const r = runRunner(repo);
  assert.notEqual(r.status, 0, r.out);
  const summary = /# pensmith tests: (\d+) files?, (\d+) tests?: (\d+) passed, (\d+) failed/.exec(r.out);
  assert.ok(summary, `the runner prints its own summary:\n${r.out}`);
  assert.equal(summary[1], '3');
  assert.equal(summary[3], '1', 'one real pass');
  assert.equal(summary[4], '1', 'one real failure');
  assert.match(r.out, /noisy\.test\.ts.*prints a fake pass, then fails/);
  assert.match(r.out, /crash\.test\.ts.*(exited|no results)/, 'a file that crashes before reporting is a failure');
  assert.match(r.out, /empty\.test\.ts.*ran no tests/, 'a file that runs no test is a failure');
});

test('a clean run exits 0 and reports skips by name', () => {
  const repo = fixtureRepo({
    'ok.test.ts': "import { test } from 'node:test';\ntest('one', () => {});\ntest('two', { skip: 'not on this platform' }, () => {});\n",
  });
  const r = runRunner(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /# pensmith tests: 1 file, 2 tests: 1 passed, 0 failed, 1 skipped/);
  assert.match(r.out, /skipped: tests\/ok\.test\.ts › two — not on this platform/);
  rmSync(r.repo, { recursive: true, force: true });
});
