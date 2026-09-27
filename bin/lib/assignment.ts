// bin/lib/assignment.ts — locate and read the assignment `pensmith new` starts
// from (PRD §5.1 row 1; RUN-09 / RUN-12 / RUN-14).
//
// Sources, in order: `--from <file>`, else an `assignment.{txt,md,pdf}` in the
// paper folder (the same names the active-paper resolver treats as "start a
// new paper here" for a bare `pensmith`). A `--from` that does not exist is a
// usage error (EXIT_USAGE) — it used to be silently treated as an empty
// assignment. A run with no assignment at all and no terminal to discuss the
// topic in is also EXIT_USAGE (`pensmith new` enforces that).

import * as fs from 'node:fs';
import path from 'node:path';
import { findAssignmentFile, ASSIGNMENT_FILE_NAMES } from './paths.js';
import { extractPdfText } from './pdf-text.js';
import { PensmithError, EXIT_USAGE } from './exit-codes.js';

/**
 * The assignment file for a paper rooted at `root`: `--from` (resolved against
 * the working directory, as the user typed it), else the first
 * `assignment.{txt,md,pdf}` in `root`, else null.
 */
export function resolveAssignmentFile(fromArg: unknown, root: string): string | null {
  if (typeof fromArg === 'string' && fromArg.length > 0) {
    const p = path.resolve(fromArg);
    let isFile = false;
    try {
      isFile = fs.statSync(p).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new PensmithError(`--from ${fromArg}: no such file`, EXIT_USAGE);
    return p;
  }
  return findAssignmentFile(root);
}

/** The assignment's text (a PDF goes through the pdf-text chokepoint). */
export async function readAssignmentText(file: string): Promise<string> {
  if (file.toLowerCase().endsWith('.pdf')) {
    return extractPdfText(await fs.promises.readFile(file));
  }
  return fs.promises.readFile(file, 'utf8');
}

/** The one-line refusal for `new` without an assignment in a non-interactive run. */
export function missingAssignmentError(root: string): PensmithError {
  return new PensmithError(
    `no assignment: pass --from <file>, or put ${ASSIGNMENT_FILE_NAMES.join(' / ')} in ${root}`,
    EXIT_USAGE,
  );
}
