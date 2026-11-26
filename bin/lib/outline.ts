// bin/lib/outline.ts — chokepoint for reading approved outline markdown.
// Callers read the outline through loadOutline() here, not node:fs (D-09).

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
