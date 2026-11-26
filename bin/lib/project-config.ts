// bin/lib/project-config.ts — read a table of a config.toml.
//
// Every reader of a paper's settings (goal, class, title, PII opt-in, citation
// style, the cost cap) reads its table the same best-effort way: a missing or
// malformed file means "nothing configured", never an error.

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';

/**
 * The `[table]` table of the config.toml at `file`. Empty when the file is
 * missing, unreadable or malformed, or has no such table. Never throws.
 */
export function readConfigTable(file: string, table: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const value = (parseToml(readFileSync(file, 'utf8')) as Record<string, unknown>)[table];
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The `[project]` table of the config.toml at `file` (see readConfigTable). */
export function readProjectConfig(file: string): Record<string, unknown> {
  return readConfigTable(file, 'project');
}
