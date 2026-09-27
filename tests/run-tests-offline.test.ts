// tests/run-tests-offline.test.ts — CI-09 / D-17-40 / D-V1-01: the test
// runner lane.
//
// `npm test` (scripts/run-tests.mjs) must:
//   - mark the test context (PENSMITH_TEST=1), so sources are OFFLINE — exact
//     recorded fixtures — unless PENSMITH_NETWORK_TESTS=1 (the maintainer's
//     live lane). A real user, by contrast, is live by default (D-V1-01).
//   - point XDG_DATA_HOME, LOCALAPPDATA and PENSMITH_TEST_DATA_DIR at ONE
//     per-run temp dir, so pensmithDataDir() resolves inside it for every test
//     file and every spawned CLI child;
//   - delete that dir when the run ends;
//   - still refuse a vacuous run (zero test files).
// A probe test file (written to a temp dir) reports what it sees from inside
// the runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const RUNNER = path.join(REPO, 'scripts', 'run-tests.mjs');

function probeFile(dir: string, reportPath: string): string {
  const paths = pathToFileURL(path.join(REPO, 'bin', 'lib', 'paths.ts')).href;
  const httpMock = pathToFileURL(path.join(REPO, 'bin', 'lib', 'http-mock.ts')).href;
  const file = path.join(dir, 'probe.test.ts');
  fs.writeFileSync(
    file,
    [
      `import test from 'node:test';`,
      `import { writeFileSync } from 'node:fs';`,
      `import { pensmithDataDir } from ${JSON.stringify(paths)};`,
      `import { isOfflineMode } from ${JSON.stringify(httpMock)};`,
      `test('probe', () => {`,
      `  writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({`,
      `    PENSMITH_TEST: process.env.PENSMITH_TEST ?? null,`,
      `    PENSMITH_TEST_DATA_DIR: process.env.PENSMITH_TEST_DATA_DIR ?? null,`,
      `    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? null,`,
      `    LOCALAPPDATA: process.env.LOCALAPPDATA ?? null,`,
      `    NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? null,`,
      `    dataDir: pensmithDataDir(),`,
      `    offline: isOfflineMode(),`,
      `  }));`,
      `});`,
      '',
    ].join('\n'),
  );
  return file;
}

interface ProbeReport {
  PENSMITH_TEST: string | null;
  PENSMITH_TEST_DATA_DIR: string | null;
  XDG_DATA_HOME: string | null;
  LOCALAPPDATA: string | null;
  NODE_TEST_CONTEXT: string | null;
  dataDir: string;
  offline: boolean;
}

function runProbe(extraEnv: Record<string, string | undefined>): { report: ProbeReport; stdout: string; status: number | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-runner-probe-'));
  const reportPath = path.join(dir, 'report.json');
  const file = probeFile(dir, reportPath);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    // A fresh developer shell: no test context, no inherited runner dirs.
    if (k === 'NODE_TEST_CONTEXT' || k.startsWith('PENSMITH_')) continue;
    env[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [RUNNER, file], { cwd: REPO, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `runner must pass the probe: ${r.stdout.slice(-1500)}\n${r.stderr.slice(-1500)}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProbeReport;
  fs.rmSync(dir, { recursive: true, force: true });
  return { report, stdout: r.stdout, status: r.status };
}

test('CI-09 / D-V1-01: run-tests.mjs sets PENSMITH_TEST=1 and sources are offline under it', () => {
  const { report, stdout } = runProbe({ PENSMITH_NETWORK_TESTS: undefined });
  assert.match(stdout, /discovered 1 test files/);
  assert.equal(report.PENSMITH_TEST, '1');
  assert.ok(report.NODE_TEST_CONTEXT, 'node:test marks each test-file process too');
  assert.equal(report.offline, true, 'the test-runner lane replays fixtures (offline) by default');
});

test('CI-09: PENSMITH_NETWORK_TESTS=1 is the only way to take the runner lane live', () => {
  const { report } = runProbe({ PENSMITH_NETWORK_TESTS: '1' });
  assert.equal(report.PENSMITH_TEST, '1');
  assert.equal(report.offline, false, 'the maintainer live lane turns sources live inside the test context');
});

test('CI-09 / D-17-40: one per-run temp data dir for XDG_DATA_HOME, LOCALAPPDATA and PENSMITH_TEST_DATA_DIR, deleted afterwards', () => {
  // Even when the developer shell exports a REAL data dir, the runner overrides it.
  const { report } = runProbe({ XDG_DATA_HOME: path.join(REPO, 'not-a-temp-dir'), LOCALAPPDATA: path.join(REPO, 'not-a-temp-dir') });
  const runDir = report.PENSMITH_TEST_DATA_DIR;
  assert.ok(runDir, 'PENSMITH_TEST_DATA_DIR is set');
  assert.equal(report.XDG_DATA_HOME, runDir);
  assert.equal(report.LOCALAPPDATA, runDir);
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(runDir));
  assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `the per-run dir ${runDir} lives under os.tmpdir()`);
  assert.equal(path.resolve(report.dataDir), path.join(path.resolve(runDir), 'pensmith'), 'pensmithDataDir() resolves inside the per-run dir');
  assert.ok(!fs.existsSync(runDir), 'the per-run dir is removed when the run ends');
});

test('Pitfall 8: the runner refuses a vacuous run (no test files)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-runner-empty-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'NODE_TEST_CONTEXT') env[k] = v;
  const r = spawnSync(process.execPath, [RUNNER, empty], { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 });
  fs.rmSync(empty, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zero \*\.test\.ts files/);
});
