#!/usr/bin/env node
// scripts/run-tests.mjs
// Portable cross-platform test runner for pensmith.
//
// Why this file exists (do not replace with a shell glob):
//   - D-10 mandates a windows-x64 CI matrix entry. cmd.exe does NOT expand
//     `tests/**/*.test.ts` — the literal string is passed to Node, which
//     interprets it as a single non-existent file and silently runs zero
//     tests (vacuous pass). This is a Pitfall 8 cross-platform landmine.
//   - Node 20.10 (D-10) lacks native `--test` glob support; that lands in
//     Node 21+. We cannot wait for it.
//   - This script enumerates `tests/**/*.test.ts` programmatically via
//     fs.readdir({recursive:true}), passes the matched files explicitly to
//     `node --import tsx --test`, and exits 1 if zero matches are found
//     (mitigates vacuous-pass failure mode).
//
// CI assertion: the workflow greps the stdout of `npm test` for the
// "discovered N test files" line and asserts N >= 1.

import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');

// Manual recursive walker — does NOT rely on Dirent.parentPath (Node 20.12+)
// or Dirent.path (Node 20.5+ for recursive readdir). We use a depth-first
// traversal where the parent path is tracked explicitly. This works on any
// supported Node version (engines.node = ">=20.10.0"). See
// 00-CONTEXT.md D-10 + RESEARCH.md Pitfall 8: vacuous-pass mitigation.
async function discoverTestFiles(dir) {
  const matches = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return matches;
    throw err;
  }
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

const files = await discoverTestFiles(testsDir);
console.log(`discovered ${files.length} test files`);
if (files.length === 0) {
  console.error('FATAL: zero *.test.ts files found under tests/. Failing to avoid vacuous CI pass.');
  process.exit(1);
}

// Spawn `node --import tsx --test <files>` and inherit stdio.
const args = ['--import', 'tsx', '--test', ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });
child.on('exit', (code, signal) => {
  if (signal) { console.error(`test runner killed by signal ${signal}`); process.exit(1); }
  process.exit(code ?? 1);
});
