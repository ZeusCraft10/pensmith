#!/usr/bin/env node
// scripts/run-tests.mjs — the test runner (`npm test`).
//
// Why this file exists (do not replace it with a shell glob or a bare
// `node --test`):
//   - cmd.exe does not expand `tests/**/*.test.ts`, so a glob runs zero tests
//     on Windows and passes. The files are found here with readdir, and zero
//     files is a failure.
//   - Tests must never touch the developer's machine. Every run gets its own
//     folder holding HOME, the XDG folders, LOCALAPPDATA/APPDATA, the Claude
//     config and the temp folder, and the folder is removed afterwards with
//     whatever the tests left in it. HTTP is answered from the committed
//     cassettes (PENSMITH_TEST_CASSETTES=1); the live lane opts out with
//     PENSMITH_NETWORK_TESTS=1.
//   - The tests run with the repository as their working directory, so a test
//     that writes a paper's files where the cwd is would put a .paper folder
//     in the repository. The run fails when one appears, naming the files that
//     were running.
//   - Counts and the exit status come from the test events, not from TAP.
//     Each file runs in its own process with scripts/test-reporter.mjs, which
//     writes that file's results as JSON; a test that prints TAP-looking text
//     cannot add a pass or hide a failure. A file that crashes before it
//     reports, exits non-zero, or runs no test at all fails the run.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');
const reporter = pathToFileURL(path.join(__dirname, 'test-reporter.mjs')).href;
const leakedPaper = path.join(repoRoot, '.paper');
// A file that runs longer than this is stopped and fails the run.
const FILE_TIMEOUT_MS = Number(process.env['PENSMITH_TEST_FILE_TIMEOUT_MS'] ?? '') || 600_000;

// Every *.test.ts file under tests/, at any depth (a missing tests/ dir
// finds none, which fails below).
function discoverTestFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.test.ts'))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

// Explicit test files may be passed (npm run test:cassettes, the export
// lane); otherwise every tests/**/*.test.ts is run.
const explicit = process.argv.slice(2).filter((a) => a.endsWith('.test.ts'));
const files = explicit.length > 0 ? explicit.map((f) => path.resolve(repoRoot, f)) : discoverTestFiles(testsDir);
console.log(`discovered ${files.length} test files`);
if (files.length === 0) {
  console.error('FATAL: zero *.test.ts files found under tests/. Failing to avoid vacuous CI pass.');
  process.exit(1);
}

// A .paper folder from before the run would hide a test that writes one.
if (existsSync(leakedPaper)) {
  console.error(
    `FATAL: ${leakedPaper} exists before the tests start. It is not part of the repository; ` +
      'remove it (a test or a pensmith run in the repository root left it) and run again.',
  );
  process.exit(1);
}

// One folder for everything a test could write outside its own temp folders.
const runRoot = mkdtempSync(path.join(tmpdir(), 'pensmith-test-run-'));
const isolated = {
  HOME: 'home',
  USERPROFILE: 'home',
  XDG_DATA_HOME: 'xdg-data',
  XDG_CONFIG_HOME: 'xdg-config',
  XDG_CACHE_HOME: 'xdg-cache',
  XDG_STATE_HOME: 'xdg-state',
  LOCALAPPDATA: 'localappdata',
  APPDATA: 'appdata',
  CLAUDE_CONFIG_DIR: 'claude-config',
  TMPDIR: 'tmp',
  TMP: 'tmp',
  TEMP: 'tmp',
};
const env = { ...process.env };
for (const [k, sub] of Object.entries(isolated)) {
  const dir = path.join(runRoot, sub);
  mkdirSync(dir, { recursive: true });
  env[k] = dir;
}
// Tests answer HTTP from the committed cassettes. Production never sets this
// variable, so real users always get the live registries.
if (env['PENSMITH_NETWORK_TESTS'] !== '1') env['PENSMITH_TEST_CASSETTES'] = '1';
const resultsDir = path.join(runRoot, 'results');
mkdirSync(resultsDir);

const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');

/** Run one test file in its own process; resolves with its outcome. */
function runFile(file, index) {
  const resultFile = path.join(resultsDir, `${index}.json`);
  const args = [
    '--import', 'tsx',
    `--test-reporter=${reporter}`, `--test-reporter-destination=${resultFile}`,
    '--test-reporter=tap', '--test-reporter-destination=stdout',
    file,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => out.push(c));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, FILE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let tests = null;
      try {
        const parsed = JSON.parse(readFileSync(resultFile, 'utf8'));
        if (parsed.complete === true && Array.isArray(parsed.tests)) tests = parsed.tests;
      } catch {
        // no results: the file crashed or was killed before its reporter finished
      }
      resolve({ file, code, signal, timedOut, tests, output: Buffer.concat(out).toString('utf8') });
    });
  });
}

const results = [];
const leaks = [];
const running = new Set();
const queue = files.map((f, i) => ({ f, i }));
const workers = Math.max(1, Math.min(files.length, availableParallelism() - 1));

/** After a file finishes: a .paper in the repository came from it or a file running alongside. */
function checkLeak(file) {
  if (!existsSync(leakedPaper)) return;
  leaks.push([file, ...running].map(rel));
  rmSync(leakedPaper, { recursive: true, force: true });
}

async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    running.add(job.f);
    const r = await runFile(job.f, job.i);
    running.delete(job.f);
    checkLeak(job.f);
    process.stdout.write(`# file: ${rel(job.f)}\n${r.output}${r.output.endsWith('\n') || r.output === '' ? '' : '\n'}`);
    results.push(r);
  }
}
await Promise.all(Array.from({ length: workers }, worker));

// ---- Summary, from the reporter's events only ----
const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
const failures = [];
const skips = [];
for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) {
  const name = rel(r.file);
  if (r.tests === null) {
    // node:test starts no reporter in a file that registers no test.
    if (r.code === 0 && !r.signal && !r.timedOut) failures.push(`${name}: ran no tests`);
    else failures.push(`${name}: no results (${r.timedOut ? `stopped after ${FILE_TIMEOUT_MS} ms` : r.signal ? `killed by ${r.signal}` : `exited with code ${r.code}`} before reporting)`);
    continue;
  }
  let ran = 0;
  for (const t of r.tests) {
    if (t.kind === 'test') ran++;
    if (t.outcome === 'fail') {
      if (t.kind === 'test') counts.fail++;
      failures.push(`${name} › ${t.name} — ${t.error}`);
    } else if (t.kind === 'test') {
      counts[t.outcome]++;
      if (t.outcome === 'skip') skips.push(`${name} › ${t.name}${t.reason ? ` — ${t.reason}` : ''}`);
    }
  }
  if (ran === 0) failures.push(`${name}: ran no tests${r.code !== 0 ? ` (exited with code ${r.code})` : ''}`);
  else if (r.code !== 0 && !r.tests.some((t) => t.outcome === 'fail')) {
    failures.push(`${name}: exited with code ${r.code}${r.signal ? ` (${r.signal})` : ''} although every test passed`);
  }
}
for (const files of leaks) {
  failures.push(`a test wrote ${leakedPaper}; it is one of: ${files.join(', ')}. Give it a temp paper root (or chdir into one).`);
}

const total = counts.pass + counts.fail + counts.skip + counts.todo;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(
  `# pensmith tests: ${plural(results.length, 'file')}, ${plural(total, 'test')}: ` +
    `${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped, ${counts.todo} todo`,
);
for (const s of skips) console.log(`# skipped: ${s}`);
for (const f of failures) console.log(`# FAILED: ${f}`);

if (process.env['PENSMITH_KEEP_TEST_RUN'] === '1') console.log(`# kept the run folder ${runRoot}`);
else rmSync(runRoot, { recursive: true, force: true });
process.exit(failures.length > 0 ? 1 : 0);
