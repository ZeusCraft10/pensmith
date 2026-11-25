// tests/lib/cli-env.ts — the environment for a spawned pensmith CLI, shared by
// add-refusal-exit and offline-cli.
//
// Not a test file (the runner collects only *.test.ts).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
