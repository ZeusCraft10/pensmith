// tests/sources/recorded.ts — shared helpers for the adapter tests (not a test file).
//
// The adapters replay EXACT recorded requests offline (D-17-06). These names are
// the queries and identifiers scripts/refresh-cassettes.mjs records; every
// assertion derives its expectations from the recorded cassette itself, so a
// re-recording (new search ranking, new metadata) never needs a test edit.

import assert from 'node:assert/strict';
import { loadCassetteFile, type Cassette } from '../../bin/lib/http-mock.js';
import { isOfflineEgressError } from '../../bin/lib/http.js';

/** The research query every search cassette records (scripts/refresh-cassettes.mjs RECORDED_QUERY). */
export const RECORDED_QUERY = 'attention mechanisms in neural networks';
/** The DOI with a recorded Crossref / Unpaywall / Retraction Watch answer. */
export const RECORDED_DOI = '10.1038/nphys1170';
/** A DataCite DOI Crossref answers 404 for (recorded). */
export const RECORDED_CROSSREF_404_DOI = '10.48550/arXiv.1706.03762';
/** The arXiv id recorded for fetchById. */
export const RECORDED_ARXIV_ID = '1706.03762';

/** The recorded cassette entries of `<adapter>/<basename>.json` (fails loudly when missing). */
export function recorded(adapter: string, basename: string): Cassette[] {
  const c = loadCassetteFile(adapter, basename);
  assert.ok(c && c.length > 0, `missing recorded cassette tests/fixtures/cassettes/${adapter}/${basename}.json`);
  for (const e of c) {
    assert.ok(e.provenance?.recorder === 'scripts/refresh-cassettes.mjs', `${adapter}/${basename}: not a recording`);
  }
  return c;
}

/** Assert `fn` rejects with the typed offline refusal (a fixture miss), never a record. */
export async function assertOfflineMiss(fn: () => Promise<unknown>, what: string): Promise<void> {
  await assert.rejects(fn, (e: unknown) => {
    assert.ok(isOfflineEgressError(e), `${what}: expected OfflineEgressError, got ${String(e)}`);
    assert.equal(e.mode, 'offline');
    assert.match(e.message, /no recorded fixture/);
    return true;
  });
}
