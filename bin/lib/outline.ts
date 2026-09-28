// bin/lib/outline.ts — chokepoint for reading the approved outline markdown.
// mcp/ MUST NOT call node:fs directly (D-09); it calls loadOutline() here.
//
// Phase 18 (GRND-07, GRND-08): also the paths of the outline's side files —
// `.paper/OUTLINE.rejected.md`, where a failed `outline` saves the model's
// replies (the router reports attention while it exists and no section is
// registered, so a bare run never re-bills a failed outline) — and a
// synchronous parsed read for the section verbs.

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paperDir } from './paths.js';
import { parseOutline, type OutlineDocument } from './outline-parse.js';

/** `<root>/.paper/OUTLINE.md`. */
export function outlinePath(paperRoot: string): string {
  return join(paperDir(paperRoot), 'OUTLINE.md');
}

/** `<root>/.paper/OUTLINE.rejected.md` — the replies of the last failed `outline` (GRND-08). */
export function outlineRejectedPath(paperRoot: string): string {
  return join(paperDir(paperRoot), 'OUTLINE.rejected.md');
}

/**
 * Load the approved outline markdown from `<paperRoot>/.paper/OUTLINE.md`.
 * `paperRoot` is the PROJECT root (the folder that contains `.paper/`,
 * D-17-32) — the same root loadState, loadSection and the CLI verbs take.
 * Returns an empty string when the file is absent (fresh paper).
 * Permission errors and other I/O failures propagate unchanged.
 */
export async function loadOutline(paperRoot: string): Promise<string> {
  try {
    return await readFile(outlinePath(paperRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // empty outline acceptable for fresh papers
    }
    throw err;
  }
}

/**
 * The parsed OUTLINE.md, or null when it is absent or has no parseable
 * section table. Never throws.
 */
export function readOutlineSync(paperRoot: string): OutlineDocument | null {
  const file = outlinePath(paperRoot);
  if (!existsSync(file)) return null;
  try {
    return parseOutline(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
