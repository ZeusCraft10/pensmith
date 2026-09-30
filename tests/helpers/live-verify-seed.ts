// tests/helpers/live-verify-seed.ts — seeds the papers scripts/live-verify.mjs
// runs `pensmith verify 1` on (Phase 20, D-20-33): one written section citing
// every key once, and — for the acceptance list and the controls — the
// bibliography a user wrote by hand. Test infrastructure (not shipped), like
// the paper-cli harness it builds on: the shipped program writes STATE.json
// only through state.ts and CITATIONS.bib only through library.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionDirOf, writeOutline, writePlan, writeState } from './paper-cli-harness.js';

/**
 * A project at `root` with section 1 (`body`) written: its draft cites every
 * key once. `bib` (a hand-written bibliography) replaces `.paper/CITATIONS.bib`
 * when given; null leaves the one library.ts rendered. Returns the section dir.
 */
export function seedVerifyPaper(root: string, keys: readonly string[], bib: string | null): string {
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeState(root, [{ n: 1, slug: 'body' }], 'live-verify');
  writeOutline(root, [{ n: 1, slug: 'body', sources: [...keys] }]);
  if (bib !== null) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  writePlan(root, 1, 'body', { status: 'written', assigned_sources: `[${keys.join(', ')}]` });
  const dir = sectionDirOf(root, 1, 'body');
  writeFileSync(join(dir, 'DRAFT.md'), `# Body\n\n${keys.map((k) => `A claim the source supports [@${k}].`).join('\n')}\n`);
  return dir;
}
