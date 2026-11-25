// bin/lib/project-config.ts — read the `[project]` table of a config.toml.
//
// Every reader of a paper's settings (goal, class, title, PII opt-in, citation
// style) reads the same table the same best-effort way: a missing or malformed
// file means "nothing configured", never an error.

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';

/**
 * The `[project]` table of the config.toml at `file`. Empty when the file is
 * missing, unreadable or malformed, or has no such table. Never throws.
 */
export function readProjectConfig(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const project = (parseToml(readFileSync(file, 'utf8')) as { project?: unknown }).project;
    return project !== null && typeof project === 'object' ? (project as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
