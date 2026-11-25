#!/usr/bin/env node
// hooks/session-start.ts — the plugin's SessionStart hook (bundled to
// plugin/dist/hook.mjs).
//
// Claude Code runs this at session start, resume and after /compact in every
// project where the plugin is enabled. Outside a paper workspace it prints
// nothing and touches nothing. Inside one it prints a single JSON frame whose
// hookSpecificOutput.additionalContext tells Claude the paper's next step.
//
// stdout is the hook protocol channel: empty, or exactly one JSON line.
// Diagnostics go to stderr. The hook always exits 0 so it can never block a
// session from starting.

import { statSync } from 'node:fs';
import path from 'node:path';

const STDIN_TIMEOUT_MS = 1000;

/** Read the hook's JSON input; resolves to '' when there is none. */
function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const done = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

/** The session's project directory: hook input `cwd`, then CLAUDE_PROJECT_DIR, then our own cwd. */
function projectDirFrom(raw: string): string {
  try {
    const input: unknown = JSON.parse(raw);
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const cwd = (input as { cwd?: unknown }).cwd;
      if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
    }
  } catch {
    // Not JSON: fall through to the environment.
  }
  const envDir = process.env['CLAUDE_PROJECT_DIR'];
  if (envDir && path.isAbsolute(envDir)) return envDir;
  return process.cwd();
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const projectDir = projectDirFrom(await readStdin());
  // The gate: no .paper/ directory means this is not a paper project.
  if (!isDirectory(path.join(projectDir, '.paper'))) return;

  // Load the router only for paper projects, and resolve paths the way the
  // CLI does when it runs from the project directory.
  process.chdir(projectDir);
  const { buildSessionContext } = await import('./session-context.js');
  const additionalContext = await buildSessionContext(projectDir);
  const frame = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } };
  await new Promise<void>((resolve) => process.stdout.write(JSON.stringify(frame) + '\n', () => resolve()));
}

try {
  await main();
} catch (err) {
  process.stderr.write(`[pensmith session-start] skipped: ${err instanceof Error ? err.message : String(err)}\n`);
}
process.exit(0);
