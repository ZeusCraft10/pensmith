// bin/lib/dry-run-paper.ts — keep a --dry-run and a real paper apart (RUN-27).
//
// Until GRND-19 gives --dry-run its own scratch workspace, a dry run writes
// into `.paper/` of the folder it runs in: synthetic sources
// (10.0000/pensmith-dryrun.*), stub drafts, dry-run verifications and exports.
// Two things must therefore never happen:
//   1. a --dry-run over a REAL paper — it would overwrite the user's drafts and
//      add synthetic sources to their library;
//   2. a normal run continuing a DRY-RUN paper — its synthetic sources would be
//      written back, assigned to sections and cited as if they were real.
// A paper a dry run creates is marked with `.paper/DRY-RUN.md`. For a mutating
// run (the CLI pre-flight and every mutating MCP tool call):
//   - --dry-run on a folder whose `.paper/` holds paper files and no marker →
//     refused (EXIT_USAGE), nothing touched;
//   - --dry-run on a folder with no paper → the marker is written first;
//   - a normal run on a marked paper → refused (EXIT_ERROR) naming how to start
//     a real paper; a marker left alone by a dry run that never created a paper
//     (e.g. it stopped at the first question) is removed and the run proceeds.
// The marker is internal state: exports never contain it (zero trace).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { paperDir, paperStateFile } from './paths.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from './exit-codes.js';

/** The marker's file name inside `.paper/`. */
export const DRY_RUN_MARKER = 'DRY-RUN.md';

const MARKER_TEXT = [
  '# This paper was made by `pensmith --dry-run`',
  '',
  'Its sources are synthetic (`10.0000/pensmith-dryrun.*`) and its text is stub output.',
  'It cannot become a real paper: pensmith refuses every normal (non --dry-run) command here.',
  'Delete this `.paper/` folder, or use another folder, and run `pensmith new` to start a real paper.',
  '',
].join('\n');

export function dryRunMarkerPath(root: string): string {
  return path.join(paperDir(root), DRY_RUN_MARKER);
}

/** True when the paper at `root` was made by --dry-run. */
export function isDryRunPaper(root: string): boolean {
  return existsSync(dryRunMarkerPath(root));
}

/**
 * The files and folders that make `.paper/` a paper (or part of one): what
 * intake, research, outline, the section steps, compile and done write. A
 * `.paper/` holding only settings or bookkeeping (config.toml, .gitignore,
 * SESSION.log, COSTS.jsonl — e.g. what a `pensmith new` that stopped before
 * any model call left) is not a paper: there is nothing a dry run could
 * overwrite.
 */
const PAPER_ARTIFACTS: ReadonlySet<string> = new Set([
  path.basename(paperStateFile('.')),
  'INTAKE.md',
  'INTAKE.raw.local',
  'LIBRARY.json',
  'CITATIONS.bib',
  'CITATIONS.ris',
  'RESEARCH.md',
  'OUTLINE.md',
  'STYLE.json',
  'TUTORIAL.md',
  'DRAFT.md',
  'COMPILE-REPORT.md',
  'VERIFICATION.md',
  'FINAL.md',
  'HANDOFF.json',
  'sections',
  'export',
]);

/** True when `.paper/` holds a paper, or part of one (any PAPER_ARTIFACTS entry). */
export function hasPaperFiles(root: string): boolean {
  let names: string[];
  try {
    names = readdirSync(paperDir(root));
  } catch {
    return false;
  }
  return names.some((n) => PAPER_ARTIFACTS.has(n));
}

/**
 * Enforce the boundary for one MUTATING run on the paper at `root` (see the
 * module header). `dryRun` is whether this run is a --dry-run.
 */
export async function enforceDryRunBoundary(root: string, dryRun: boolean): Promise<void> {
  const marked = isDryRunPaper(root);
  if (dryRun) {
    if (marked) return;
    if (hasPaperFiles(root)) {
      throw new PensmithError(
        `--dry-run would overwrite the paper at ${root} (its drafts, library and verifications) — ` +
          'run the dry run in an empty folder; this paper was not touched',
        EXIT_USAGE,
      );
    }
    await atomicWriteFile(dryRunMarkerPath(root), MARKER_TEXT);
    return;
  }
  if (!marked) return;
  if (!hasPaperFiles(root)) {
    // A dry run that stopped before it created anything: nothing to protect.
    rmSync(dryRunMarkerPath(root), { force: true });
    return;
  }
  throw new PensmithError(
    `the paper at ${root} was made by --dry-run (synthetic sources, stub text) and cannot become a real paper — ` +
      `delete ${paperDir(root)} or use another folder, then run pensmith new (pass --dry-run to keep previewing it)`,
    EXIT_ERROR,
  );
}
