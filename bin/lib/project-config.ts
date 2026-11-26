// bin/lib/project-config.ts — read a table of the paper's config.toml.
//
// Every reader of a paper's settings (goal, class, title, PII opt-in, citation
// style, the cost cap) reads .paper/config.toml (PRD §10) the same
// best-effort way: a missing or malformed file means "nothing configured",
// never an error. A config.toml in the project root is the user's own file and
// is never read (an older pensmith's is moved by migrations/layout.ts).

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { paperConfigFile } from './paths.js';

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

/** The `[table]` table of the paper at `root`'s .paper/config.toml (see readConfigTable). */
export function readPaperConfig(root: string, table: string): Record<string, unknown> {
  return readConfigTable(paperConfigFile(root), table);
}

/** The `[project]` table of the paper at `root`. */
export function readProjectConfig(root: string): Record<string, unknown> {
  return readPaperConfig(root, 'project');
}
