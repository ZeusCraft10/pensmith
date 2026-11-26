// tests/lib/cli-env.ts — the environment for a spawned pensmith CLI, shared by
// the CLI tests, and the real CLI run with a scripted model (journey,
// section-isolation).
//
// Not a test file (the runner collects only *.test.ts).

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PENSMITH_TS = fileURLToPath(new URL('../../bin/pensmith.ts', import.meta.url));
const TSX = import.meta.resolve('tsx');

/**
 * Environment for a spawned CLI: a copy of this process's, with HOME, the XDG
 * directories and LOCALAPPDATA pointed at one fresh temp directory, then
 * `overrides` applied (undefined deletes the variable).
 */
export function isolatedCliEnv(
  overrides: Record<string, string | undefined>,
  homePrefix = 'pensmith-cli-home-',
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const home = mkdtempSync(join(tmpdir(), homePrefix));
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** A spawned CLI's exit status and output. */
export interface CliStreams { status: number | null; stdout: string; stderr: string }

/**
 * The real CLI (bin/pensmith.ts under tsx) with the scripted model that
 * `generator` installs (a preload module, tests/lib/scripted-model.ts), on the
 * recorded registry answers. Every run shares one isolated home; `overrides`
 * are applied to its environment as in isolatedCliEnv.
 */
export function scriptedCli(
  generator: string,
  overrides: Record<string, string | undefined> = {},
): (cwd: string, args: readonly string[]) => CliStreams {
  const env = isolatedCliEnv({
    PENSMITH_NO_LLM: undefined,
    PENSMITH_OFFLINE: undefined,
    OPENAI_API_KEY: undefined,
    GPTZERO_API_KEY: undefined,
    PENSMITH_CONTACT_EMAIL: undefined,
    PENSMITH_COST_CAP_USD: undefined,
    PENSMITH_TEST_CASSETTES: '1',
    // complete() asks for a key before any model call; the scripted model never sends it.
    ANTHROPIC_API_KEY: 'sk-ant-scripted-not-sent',
    ...overrides,
  }, 'pensmith-scripted-home-');
  env['USERPROFILE'] = env['APPDATA'] = env['HOME']!;
  return (cwd, args) => {
    const r = spawnSync(process.execPath, ['--import', TSX, '--import', generator, PENSMITH_TS, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}
