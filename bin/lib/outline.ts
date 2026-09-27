// bin/lib/outline.ts — chokepoint for reading approved outline markdown.
// mcp/ MUST NOT call node:fs directly (D-09); it calls loadOutline() here.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paperDir } from './paths.js';

/**
 * Load the approved outline markdown from `<paperRoot>/.paper/OUTLINE.md`.
 * `paperRoot` is the PROJECT root (the folder that contains `.paper/`,
 * D-17-32) — the same root loadState, loadSection and the CLI verbs take.
 * Returns an empty string when the file is absent (fresh paper).
 * Permission errors and other I/O failures propagate unchanged.
 */
export async function loadOutline(paperRoot: string): Promise<string> {
  const outlinePath = join(paperDir(paperRoot), 'OUTLINE.md');
  try {
    return await readFile(outlinePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // empty outline acceptable for fresh papers
    }
    throw err;
  }
}
