// bin/lib/outline.ts — chokepoint for reading approved outline markdown.
// mcp/ MUST NOT call node:fs directly (D-09); it calls loadOutline() here.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Load the approved outline markdown from `paperRoot/OUTLINE.md`.
 * Returns an empty string when the file is absent (fresh paper).
 * Permission errors and other I/O failures propagate unchanged.
 */
export async function loadOutline(paperRoot: string): Promise<string> {
  const outlinePath = join(paperRoot, 'OUTLINE.md');
  try {
    return await readFile(outlinePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''; // empty outline acceptable for fresh papers
    }
    throw err;
  }
}
