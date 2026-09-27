// tests/data-dir-isolation.test.ts — CI-09 / D-17-40 / AUD-M3: tests never
// touch the real user data dir or the global paper registry.
//
// AUD-M3 found 14 `/tmp/pensmith-gitignore-*`, `/tmp/pensmith-flags-*` …
// entries in a developer's real ~/.local/share/pensmith/library/index.json,
// written by running tests/intake-gitignore.test.ts directly. The fix has two
// halves:
//   - scripts/run-tests.mjs points XDG_DATA_HOME / LOCALAPPDATA /
//     PENSMITH_TEST_DATA_DIR at a per-run temp dir (tests/run-tests-offline);
//   - bin/lib/paths.ts localDataDir(): under a test context (NODE_TEST_CONTEXT
//     or PENSMITH_TEST=1) a platform data dir is honoured only inside
//     os.tmpdir(); otherwise PENSMITH_TEST_DATA_DIR, else a per-process temp
//     dir. That covers single-file runs and macOS, whose data dir derives
//     from HOME.
// The "real" data dir is simulated with a sandboxed HOME / LOCALAPPDATA that
// lies OUTSIDE the child's os.tmpdir() (the child gets its own TMPDIR), so the
// user's actual data dir is never at risk even if the guard regressed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDataDir, pensmithDataDir, pensmithGlobalLibraryIndexPath } from '../bin/lib/paths.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI_TS = path.join(REPO, 'bin', 'pensmith.ts');
const TSX = import.meta.resolve('tsx');
const ASSIGNMENT = 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.\n';

/** A sandbox whose HOME / LOCALAPPDATA sit OUTSIDE the child's temp dir. */
function sandbox(): { root: string; home: string; localAppData: string; childTmp: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-iso-'));
  const home = path.join(root, 'home');
  const localAppData = path.join(home, 'AppData', 'Local');
  const childTmp = path.join(root, 'tmp');
  for (const d of [home, localAppData, childTmp]) fs.mkdirSync(d, { recursive: true });
  return { root, home, localAppData, childTmp };
}

/** The env of a developer shell whose real data dir is the sandbox's. */
function sandboxEnv(sb: ReturnType<typeof sandbox>, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'NODE_TEST_CONTEXT' || k === 'PENSMITH_TEST' || k === 'PENSMITH_TEST_DATA_DIR') continue;
    if (k === 'XDG_DATA_HOME') continue; // the "real" Linux dir derives from HOME
    env[k] = v;
  }
  return {
    ...env,
    HOME: sb.home,
    USERPROFILE: sb.home,
    LOCALAPPDATA: sb.localAppData,
    TMPDIR: sb.childTmp,
    TEMP: sb.childTmp,
    TMP: sb.childTmp,
    ...extra,
  };
}

/** Every `pensmith` directory under the sandbox's "real" data locations. */
function realDataDirHits(sb: ReturnType<typeof sandbox>): string[] {
  const hits: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(d, e.name);
      if (e.name === 'pensmith') hits.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(sb.home, 0);
  return hits;
}

test('CI-09: under a test context a platform data dir outside os.tmpdir() is never used', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-iso-run-'));
  const outside = path.join(REPO, 'no-such-real-data-dir');
  // Linux/POSIX: XDG_DATA_HOME outside tmp → the runner's per-run dir.
  assert.equal(localDataDir('linux', { PENSMITH_TEST: '1', XDG_DATA_HOME: outside, PENSMITH_TEST_DATA_DIR: runDir }), runDir);
  // …and NODE_TEST_CONTEXT alone is a test context too.
  assert.equal(localDataDir('linux', { NODE_TEST_CONTEXT: 'child-v8', HOME: outside, PENSMITH_TEST_DATA_DIR: runDir }), runDir);
  // macOS: the data dir derives from HOME — a real HOME is redirected.
  assert.equal(localDataDir('darwin', { PENSMITH_TEST: '1', HOME: outside, PENSMITH_TEST_DATA_DIR: runDir }), runDir);
  // Windows: a real LOCALAPPDATA is redirected; an unset one does not throw.
  assert.equal(localDataDir('win32', { PENSMITH_TEST: '1', LOCALAPPDATA: outside, PENSMITH_TEST_DATA_DIR: runDir }), runDir);
  assert.equal(localDataDir('win32', { PENSMITH_TEST: '1', PENSMITH_TEST_DATA_DIR: runDir }), runDir);
});

test('CI-09: a platform data dir a test redirected into os.tmpdir() is honoured', () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-iso-xdg-'));
  assert.equal(localDataDir('linux', { PENSMITH_TEST: '1', XDG_DATA_HOME: tmpData }), tmpData);
  assert.equal(
    localDataDir('darwin', { PENSMITH_TEST: '1', HOME: tmpData }),
    path.join(tmpData, 'Library', 'Application Support'),
  );
  // A not-yet-created dir under tmp counts too (the nearest existing ancestor is resolved).
  const future = path.join(tmpData, 'not', 'yet', 'created');
  assert.equal(localDataDir('linux', { PENSMITH_TEST: '1', XDG_DATA_HOME: future }), future);
  // The realpath spelling of a temp dir (macOS /private/var…) is recognised.
  const real = fs.realpathSync.native(tmpData);
  assert.equal(localDataDir('linux', { PENSMITH_TEST: '1', XDG_DATA_HOME: real }), real);
});

test('CI-09: with no per-run dir, a test context gets a private per-process temp dir', () => {
  const outside = path.join(REPO, 'no-such-real-data-dir');
  const a = localDataDir('linux', { PENSMITH_TEST: '1', XDG_DATA_HOME: outside });
  const b = localDataDir('linux', { NODE_TEST_CONTEXT: 'child-v8', HOME: outside });
  assert.equal(a, b, 'one per-process dir, reused');
  const rel = path.relative(fs.realpathSync.native(os.tmpdir()), fs.realpathSync.native(a));
  assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `per-process dir ${a} must be inside os.tmpdir()`);
  assert.ok(fs.existsSync(a), 'the per-process dir exists');
});

test('CI-09: without a test context the platform logic is unchanged (real users)', () => {
  assert.equal(localDataDir('linux', { XDG_DATA_HOME: '/xdg' }), '/xdg');
  assert.equal(localDataDir('linux', { HOME: '/home/u' }), path.join('/home/u', '.local', 'share'));
  assert.equal(localDataDir('darwin', { HOME: '/Users/u' }), path.join('/Users/u', 'Library', 'Application Support'));
  assert.equal(localDataDir('win32', { LOCALAPPDATA: 'C:\\X' }), 'C:\\X');
  assert.throws(() => localDataDir('win32', {}), /LOCALAPPDATA is unset/);
});

test('CI-09: this test process itself resolves its data dir inside os.tmpdir()', () => {
  const rel = path.relative(fs.realpathSync.native(os.tmpdir()), path.resolve(pensmithDataDir()));
  const relRaw = path.relative(path.resolve(os.tmpdir()), path.resolve(pensmithDataDir()));
  const inside = (r: string): boolean => !r.startsWith('..') && !path.isAbsolute(r);
  assert.ok(inside(rel) || inside(relRaw), `pensmithDataDir() = ${pensmithDataDir()} must be inside os.tmpdir()`);
  assert.ok(pensmithGlobalLibraryIndexPath().startsWith(pensmithDataDir()));
});

test('CI-09 / AUD-M3: running tests/intake-gitignore.test.ts directly adds nothing to the real data dir or registry', () => {
  const sb = sandbox();
  try {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', path.join(REPO, 'tests', 'intake-gitignore.test.ts')], {
      cwd: REPO,
      env: sandboxEnv(sb),
      encoding: 'utf8',
      timeout: 180_000,
    });
    assert.equal(r.status, 0, `the single-file run must pass: ${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`);
    assert.deepEqual(realDataDirHits(sb), [], 'no pensmith data dir (registry, locks, logs) may appear under the real HOME / LOCALAPPDATA');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('CI-09: a CLI spawned with PENSMITH_TEST=1 (and nothing else redirected) keeps the real data dir untouched', () => {
  const sb = sandbox();
  try {
    const project = fs.mkdtempSync(path.join(sb.childTmp, 'paper-'));
    fs.writeFileSync(path.join(project, 'assignment.txt'), ASSIGNMENT);
    const r = spawnSync(process.execPath, ['--import', TSX, CLI_TS, 'new', '--yolo', '--from', 'assignment.txt'], {
      cwd: project,
      env: sandboxEnv(sb, { PENSMITH_TEST: '1', PENSMITH_NO_LLM: '1' }),
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(r.status, 0, `new must succeed: ${r.stderr.slice(-2000)}`);
    assert.ok(fs.existsSync(path.join(project, '.paper')), 'the paper was created');
    assert.deepEqual(realDataDirHits(sb), [], 'the global registry must not be written to the real data dir');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('CI-09 control: the same CLI run WITHOUT a test context does use the (sandboxed) real data dir', () => {
  // Proves the sandbox simulates a real data dir faithfully — without this the
  // two tests above could pass vacuously.
  const sb = sandbox();
  try {
    const project = fs.mkdtempSync(path.join(sb.childTmp, 'paper-'));
    fs.writeFileSync(path.join(project, 'assignment.txt'), ASSIGNMENT);
    const r = spawnSync(process.execPath, ['--import', TSX, CLI_TS, 'new', '--yolo', '--from', 'assignment.txt'], {
      cwd: project,
      env: sandboxEnv(sb, { PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: '1' }),
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(r.status, 0, `new must succeed: ${r.stderr.slice(-2000)}`);
    const hits = realDataDirHits(sb);
    assert.equal(hits.length, 1, `exactly one real pensmith data dir expected, got ${JSON.stringify(hits)}`);
    assert.ok(fs.existsSync(path.join(hits[0]!, 'library', 'index.json')), 'the registry landed in the real data dir');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
