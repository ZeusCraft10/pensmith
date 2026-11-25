// tests/lib/library-views.ts — CITATIONS.bib and CITATIONS.ris as research
// writes them.
//
// research, add and revise --research write the bibliography only through the
// library (bin/lib/library.ts), which writes CITATIONS.bib and CITATIONS.ris
// from LIBRARY.json. A test of what the bibliography holds goes the same way.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addToLibrary } from '../../bin/lib/library.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';

export interface LibraryViews {
  root: string;
  bibPath: string;
  risPath: string;
}

/**
 * Merge `candidates` into the library of the project at `root` (a new one by
 * default), as research does, and return where its views were written.
 */
export async function throughLibrary(candidates: SourceCandidate[], root = mkdtempSync(join(tmpdir(), 'pensmith-library-views-'))): Promise<LibraryViews> {
  await addToLibrary(root, candidates);
  return { root, bibPath: join(root, '.paper', 'CITATIONS.bib'), risPath: join(root, '.paper', 'CITATIONS.ris') };
}
