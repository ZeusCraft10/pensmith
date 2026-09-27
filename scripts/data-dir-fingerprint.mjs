#!/usr/bin/env node
// scripts/data-dir-fingerprint.mjs — CI-09 / D-17-40 guard.
//
// Prints a deterministic fingerprint of the REAL pensmith data dir (the one a
// user gets: %LOCALAPPDATA%\pensmith, ~/Library/Application Support/pensmith,
// or $XDG_DATA_HOME/pensmith / ~/.local/share/pensmith): its path, then one
// `<relative path> <sha256>` line per file, sorted — or `absent`. CI records it
// before the test steps and diffs it afterwards; any difference means a test
// reached the user's real data dir (the global paper registry
// library/index.json, active.json, runtime.json, locks, the HTTP cache, …).
//
// The path comes from the BUILT bin/lib/paths.ts (dist/, so run `npm run build`
// first) — the single source of truth — with every test-context marker removed
// from this process's env so the guard in localDataDir() does not redirect it.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pathsJs = path.join(repoRoot, 'dist', 'bin', 'lib', 'paths.js');
if (!existsSync(pathsJs)) {
  console.error(`data-dir-fingerprint: ${pathsJs} is missing — run \`npm run build\` first.`);
  process.exit(2);
}

delete process.env.NODE_TEST_CONTEXT;
delete process.env.PENSMITH_TEST;
delete process.env.PENSMITH_TEST_DATA_DIR;

const { pensmithDataDir } = await import(pathToFileURL(pathsJs).href);
const root = pensmithDataDir();

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      out.push(`${rel} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
    }
  }
  return out;
}

console.log(`pensmith data dir: ${root}`);
if (!existsSync(root)) {
  console.log('absent');
} else {
  const lines = walk(root, []);
  console.log(lines.length === 0 ? '(empty)' : lines.join('\n'));
}
