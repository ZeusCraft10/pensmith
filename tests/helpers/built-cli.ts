// tests/helpers/built-cli.ts — spawn the BUILT CLI (dist/bin/pensmith.js)
// without blocking the event loop, so an in-process mock LLM
// (tests/helpers/local-servers/mock-llm.ts, started by withLlmSandbox) can
// answer the child. Used by the Phase 19 cross-stream acceptance suites
// (19-PLAN §7.4): research-cli-lane, byo-new-cli, add-identifiers-cli,
// plan-research-cli.
//
// The child inherits the sandbox's isolated data dir (XDG_DATA_HOME /
// LOCALAPPDATA / HOME) and the test context (PENSMITH_TEST=1 from the runner):
// sources are offline and every request is answered by a recorded cassette or
// refused. stdin is a pipe (never a terminal): `input` answers numbered prompts.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmSandbox } from './llm-sandbox.js';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const BUILT_CLI = join(REPO, 'dist', 'bin', 'pensmith.js');

export interface BuiltRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** True when `npm run build` has produced the CLI these suites spawn. */
export function builtCliExists(): boolean {
  return existsSync(BUILT_CLI);
}

/** Run `node dist/bin/pensmith.js <args>` in `cwd` (default: the sandbox's paper root). */
export function runBuilt(
  sb: LlmSandbox,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs?: number } = {},
): Promise<BuiltRun> {
  if (!builtCliExists()) throw new Error(`${BUILT_CLI} is missing — run \`npm run build\` first`);
  const env = sb.spawnEnv({ PENSMITH_PAPER_ROOT: undefined, PENSMITH_DEBUG: undefined, ...(opts.env ?? {}) });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUILT_CLI, ...args], { cwd: opts.cwd ?? sb.root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 180_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });
}
