#!/usr/bin/env node
// scripts/run-tests.mjs
// Portable cross-platform test runner for pensmith.
//
// Why this file exists (do not replace with a shell glob):
//   - D-10 mandates a windows-x64 CI matrix entry. cmd.exe does NOT expand
//     `tests/**/*.test.ts` — the literal string is passed to Node, which
//     interprets it as a single non-existent file and silently runs zero
//     tests (vacuous pass). This is a Pitfall 8 cross-platform landmine.
//   - `node --test` glob expansion differs between Node versions and shells;
//     enumerating the files here keeps every supported platform identical.
//   - This script enumerates `tests/**/*.test.ts` programmatically via
//     fs.readdir({recursive:true}), passes the matched files explicitly to
//     `node --import tsx --test`, and exits 1 if zero matches are found
//     (mitigates vacuous-pass failure mode).
//
// The runner exits 1 itself when it discovers zero test files, so a broken
// glob can never pass vacuously; CI needs no separate check.

import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');

// Every *.test.ts file under tests/, at any depth (a missing tests/ dir
// finds none, which fails below).
async function discoverTestFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.test.ts')).map((e) => path.join(e.parentPath, e.name));
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
