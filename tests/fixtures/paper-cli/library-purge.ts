// Child-process driver for tests/dry-run-boundary.test.ts (RUN-27): a library
// holding a synthetic --dry-run source is upserted OUTSIDE --dry-run, and the
// one library writer drops the synthetic entry from LIBRARY.json and the
// rendered CITATIONS.bib. Prints one JSON line.
//
// usage: library-purge.ts <root>

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { upsertSources, loadLibrary } from '../../../bin/lib/library.js';
import { syntheticSource } from '../../../bin/lib/sources/dry-run.js';
import { setDryRunWorkspace } from '../../../bin/lib/paths.js';
import type { SourceCandidate } from '../../../bin/lib/schemas/source-candidate.js';

const [root] = process.argv.slice(2);
if (!root) throw new Error('usage: library-purge.ts <root>');

const real = (doi: string, title: string, family: string, key: string): SourceCandidate => ({
  source: 'crossref',
  id: doi,
  doi,
  title,
  authors: [`${family}, A.`],
  year: 2009,
  retracted: false,
  last_verified: new Date().toISOString(),
  citekey: key,
  raw: null,
});

async function main(): Promise<unknown> {
  mkdirSync(join(root!, '.paper'), { recursive: true });
  // As a Phase 17 dry run left it IN `.paper/` (before GRND-19 moved dry runs
  // to `.paper-dry-run/`): one real and one synthetic source. The workspace
  // switch is pinned off so the dry-run upsert lands in `.paper/` itself.
  setDryRunWorkspace(false);
  process.env['PENSMITH_DRY_RUN'] = '1';
  await upsertSources(root!, [real('10.5555/real-one', 'A Real Study of Tides', 'Marsh', 'marsh2009'), syntheticSource('00c0ffee')], { provenance: 'dry-run-research' });
  const before = (await loadLibrary(root!)).entries.length;
  // A normal (non --dry-run) research run adds a real source.
  delete process.env['PENSMITH_DRY_RUN'];
  await upsertSources(root!, [real('10.1038/nphys1170', 'Measured measurement', 'Aspelmeyer', 'aspelmeyer2009')], { provenance: 'research' });
  const after = (await loadLibrary(root!)).entries.length;
  return {
    before,
    after,
    library: readFileSync(join(root!, '.paper', 'LIBRARY.json'), 'utf8'),
    bib: readFileSync(join(root!, '.paper', 'CITATIONS.bib'), 'utf8'),
  };
}

try {
  process.stdout.write(JSON.stringify({ ok: true, ...(await main() as object) }) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, message: (e as Error).message }) + '\n');
}
