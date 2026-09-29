#!/usr/bin/env node
// scripts/run-tests.mjs
// Portable cross-platform test runner for pensmith.
//
// Usage:
//   node scripts/run-tests.mjs                      # every tests/**/*.test.ts
//   node scripts/run-tests.mjs tests/tier-contract/ tests/tier-contract.test.ts
//   node scripts/run-tests.mjs --test-name-pattern=idempot tests/doi.test.ts
// Positional arguments are test files or directories (searched recursively for
// *.test.ts); arguments starting with `--` are passed to `node --test`.
//
// Why this file exists (do not replace with a shell glob):
//   - D-10 mandates a windows-x64 CI matrix entry. cmd.exe does NOT expand
//     `tests/**/*.test.ts` — the literal string is passed to Node, which
//     interprets it as a single non-existent file and silently runs zero
//     tests (vacuous pass). This is a Pitfall 8 cross-platform landmine.
//   - `node --test` glob support differs across the supported Node lines
//     (22 and 24, engines.node >=22.12.0 — CI-06 / D-17-39), and a glob that
//     matches nothing is still a vacuous pass. This script enumerates the test
//     files itself via a recursive readdir, passes them explicitly to
//     `node --import tsx --test`, and exits 1 if zero matches are found
//     (vacuous-pass mitigation, 00-CONTEXT D-10 + RESEARCH Pitfall 8).
//
// Test isolation (CI-09 / D-17-40) — every run gets a fresh, private data dir:
//   - A per-run temp dir is created under os.tmpdir(). XDG_DATA_HOME,
//     LOCALAPPDATA and PENSMITH_TEST_DATA_DIR all point at it, so
//     pensmithDataDir() (locks, the HTTP cache, the global paper registry,
//     runtime.json, COSTS, session logs) resolves inside it on every OS.
//     macOS derives its data dir from HOME, which is never redirected here
//     (npm, git and the humanizer probe need the real HOME); bin/lib/paths.ts
//     instead refuses, under a test context, any platform data dir that is not
//     inside os.tmpdir() and falls back to PENSMITH_TEST_DATA_DIR. The real
//     data dir is therefore unreachable from tests, including spawned CLI
//     children, which inherit these variables.
//   - PENSMITH_TEST=1 marks the test context (alongside NODE_TEST_CONTEXT,
//     which node:test sets in each test-file process). Under a test context
//     sources are OFFLINE (exact recorded fixtures) unless
//     PENSMITH_NETWORK_TESTS=1 (the maintainer's live lane) — D-V1-01.
//   - The per-run dir is deleted when the run ends. Set
//     PENSMITH_KEEP_TEST_DATA=1 to keep it for debugging (its path is printed).
//   - The runner also fingerprints the REAL data dir (scripts/
//     data-dir-fingerprint.mjs, the same guard CI runs around the whole job)
//     before and after the run, and fails the run if it changed. A test that
//     drops the test context (to run like a user) must redirect every
//     platform's data-dir variable itself — HOME included, since macOS derives
//     its data dir from HOME — and this is where a missed one shows up
//     locally. Skipped when the real data dir already lies inside os.tmpdir()
//     (a runner started by a test, inside another run's sandbox) or when
//     dist/ is not built (the fingerprint resolves the dir through the built
//     bin/lib/paths.js).
//
// CI assertion: the workflow greps the stdout of `npm test` for the
// "discovered N test files" line and asserts N >= 1.

import { readdir, stat } from 'node:fs/promises';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');

// Depth-first walker with the parent path tracked explicitly (does not rely on
// Dirent.parentPath / Dirent.path, whose availability differs across Node
// releases). Sorted so the file list — and the output order — is stable.
async function discoverTestFiles(dir) {
  const matches = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return matches;
    throw err;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await discoverTestFiles(full);
      for (const m of sub) matches.push(m);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      matches.push(full);
    }
  }
  return matches;
}

/** Resolve positional args (files or directories) to test files. */
async function resolveTargets(targets) {
  const out = [];
  for (const t of targets) {
    const abs = path.resolve(repoRoot, t);
    let st;
    try {
      st = await stat(abs);
    } catch {
      console.error(`FATAL: test path not found: ${t}`);
      process.exit(1);
    }
    if (st.isDirectory()) out.push(...(await discoverTestFiles(abs)));
    else out.push(abs);
  }
  return [...new Set(out)];
}

const argv = process.argv.slice(2);
const nodeTestFlags = argv.filter((a) => a.startsWith('--'));
const targets = argv.filter((a) => !a.startsWith('--'));

const files = targets.length > 0 ? await resolveTargets(targets) : await discoverTestFiles(testsDir);
console.log(`discovered ${files.length} test files`);
if (files.length === 0) {
  console.error('FATAL: zero *.test.ts files found under tests/. Failing to avoid vacuous CI pass.');
  process.exit(1);
}

// CI-09: the per-run data dir. mkdtemp under os.tmpdir() — the one location
// bin/lib/paths.ts honours for a platform data-dir variable under a test context.
const runDataDir = mkdtempSync(path.join(os.tmpdir(), 'pensmith-test-run-'));
const keep = process.env.PENSMITH_KEEP_TEST_DATA === '1';
if (keep) console.log(`per-run test data dir (kept): ${runDataDir}`);

const env = {
  ...process.env,
  PENSMITH_TEST: '1',
  PENSMITH_TEST_DATA_DIR: runDataDir,
  XDG_DATA_HOME: runDataDir,
  LOCALAPPDATA: runDataDir,
};

// On Windows npm's default cache is %LOCALAPPDATA%\npm-cache, which the
// redirect above would point at the empty per-run dir. Tests that drive npm
// (tests/installed-bin.test.ts reads dependency tarballs from the cache) need
// the real one, so pin it first unless npm already exported it (`npm test`).
if (process.platform === 'win32' && !process.env.npm_config_cache) {
  const r = spawnSync('npm.cmd', ['config', 'get', 'cache'], { shell: true, encoding: 'utf8', env: process.env });
  const cache = r.status === 0 ? String(r.stdout).trim() : '';
  if (cache) env.npm_config_cache = cache;
}

function cleanup() {
  if (keep) return;
  try {
    rmSync(runDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* best-effort: a Windows handle may still be closing */
  }
}

// CI-09: fingerprint of the REAL data dir (this runner's own env, not the
// redirected one), or null when the guard does not apply (see the header).
function realDataDirFingerprint() {
  if (!existsSync(path.join(repoRoot, 'dist', 'bin', 'lib', 'paths.js'))) return null;
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'data-dir-fingerprint.mjs')], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  const dir = /^pensmith data dir: (.*)$/m.exec(r.stdout)?.[1];
  if (!dir || insideTmp(dir)) return null;
  return r.stdout;
}

/** Whether `p` lies inside os.tmpdir(), in either spelling (macOS /var → /private/var, Windows 8.3 names and case). */
function insideTmp(p) {
  const real = (q) => {
    // realpath of the nearest existing ancestor, re-joined with the missing tail.
    let head = path.resolve(q);
    const tail = [];
    for (;;) {
      try {
        return path.join(realpathSync.native(head), ...tail);
      } catch {
        const parent = path.dirname(head);
        if (parent === head) return path.resolve(q);
        tail.unshift(path.basename(head));
        head = parent;
      }
    }
  };
  const fold = (q) => (process.platform === 'win32' ? q.toLowerCase() : q);
  const roots = [path.resolve(os.tmpdir()), real(os.tmpdir())].map(fold);
  const forms = [path.resolve(p), real(p)].map(fold);
  return forms.some((f) =>
    roots.some((root) => {
      const rel = path.relative(root, f);
      return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    }),
  );
}

/** Lines only in `before` (-) or only in `after` (+). */
function fingerprintDiff(before, after) {
  const a = new Set(before.split(/\r?\n/));
  const b = new Set(after.split(/\r?\n/));
  return [...[...a].filter((l) => !b.has(l)).map((l) => `- ${l}`), ...[...b].filter((l) => !a.has(l)).map((l) => `+ ${l}`)];
}

const dataDirBefore = realDataDirFingerprint();

// Spawn `node --import tsx --test <files>` and inherit stdio.
const args = ['--import', 'tsx', '--test', ...nodeTestFlags, ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot, env });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code, signal) => {
  cleanup();
  if (signal) { console.error(`test runner killed by signal ${signal}`); process.exit(1); }
  if (dataDirBefore !== null) {
    const dataDirAfter = realDataDirFingerprint();
    if (dataDirAfter !== null && dataDirAfter !== dataDirBefore) {
      console.error(
        'FAIL (CI-09): the test run changed the REAL pensmith data dir. A test (or a CLI it spawned without a ' +
          'test context) resolved the user data dir — redirect XDG_DATA_HOME, LOCALAPPDATA and HOME (macOS) ' +
          'for it:\n' + fingerprintDiff(dataDirBefore, dataDirAfter).join('\n'),
      );
      process.exit(1);
    }
  }
  process.exit(code ?? 1);
});
