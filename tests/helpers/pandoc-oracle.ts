// tests/helpers/pandoc-oracle.ts — pandoc as a test oracle (Phase 21: the
// locator differential, the Markdown-subset differential, the docx read-back).
//
// Like HARDEN-03 (tests/citation-integrity.property.test.ts): when pandoc is
// not on PATH a test that needs it is skipped with a loud note — except with
// CI=true, where it FAILS (ci.yml installs pandoc 3.x on every runner;
// D-21-29: the CI wiring that makes it required on every runner is HARDEN-04).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cached: string | null | undefined;

/** `pandoc --version`'s first line, or null when pandoc is not on PATH. */
export function pandocVersion(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = (execFileSync('pandoc', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0] ?? '').trim();
  } catch {
    cached = null;
  }
  return cached;
}

const announced = new Set<string>();

/** True when pandoc can run; otherwise skips `t` (or fails it when CI=true). */
export function requirePandoc(t: { skip(msg?: string): void }, label: string): boolean {
  if (pandocVersion() !== null) return true;
  if (process.env['CI'] === 'true') assert.fail(`${label}: pandoc is not on PATH, and CI=true requires it (ci.yml installs pandoc 3.x)`);
  if (!announced.has(label)) {
    announced.add(label);
    process.stderr.write(`\n*** ${label} SKIPPED: pandoc is not on PATH — install pandoc 3.x to run it (CI runs it) ***\n\n`);
  }
  t.skip('pandoc is not on PATH');
  return false;
}

/** Run pandoc in a fresh temporary directory holding `files`; returns stdout. */
export function runPandocIn(files: Readonly<Record<string, string | Buffer>>, args: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-pandoc-oracle-'));
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    return execFileSync('pandoc', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** pandoc reading `file` (a path), writing `to` to stdout. */
export function pandocRead(file: string, from: string, to: string): string {
  return runPandocIn({ ['in' + (file.match(/\.[a-z]+$/i)?.[0] ?? '')]: readFileSync(file) }, ['in' + (file.match(/\.[a-z]+$/i)?.[0] ?? ''), '-f', from, '-t', to, '--wrap=none']);
}
