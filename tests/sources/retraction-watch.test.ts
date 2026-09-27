// tests/sources/retraction-watch.test.ts — Retraction Watch side-channel filter
// (T-3-13, D-15 LOCKED: fetchById only, no search()).
//
// The RECORDED cassette is what the live endpoint answers today: an HTTP 200
// wrapping an inner "not-polite" error, which the adapter reads as "no hit"
// (the fail-open behaviour SRC-04 replaces in Phase 19). Retraction HITS are
// exercised with the hand-written synthetic fixtures. Offline, a DOI with no
// fixture is a typed OfflineEgressError — "status unavailable", never the old
// silent "not retracted" (RUN-03; supersedes the CR-02 empty-cassette guard,
// whose adapter-level cassette scan no longer exists).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rw from '../../bin/lib/sources/retraction-watch.js';
import { RECORDED_DOI, recorded, assertOfflineMiss } from './recorded.js';

test('retraction-watch: NO search export (D-15 LOCKED: fetchById only)', () => {
  assert.equal((rw as Record<string, unknown>)['search'], undefined);
});

test('retraction-watch: the recorded cassette is the live endpoint answer (200 wrapping an inner error)', () => {
  const [entry] = recorded('retraction-watch', 'record-nphys1170');
  assert.equal(entry!.status, 200);
  assert.ok(!('items' in (entry!.response as object)), 'the live answer carries no items');
});

test('retraction-watch.fetchById() replays the recorded answer → null for that DOI', async () => {
  assert.equal(await rw.fetchById(RECORDED_DOI), null);
});

test('retraction-watch.fetchById() turns a synthetic hit into a retracted SourceCandidate (D-15)', async () => {
  const r = await rw.fetchById('10.0000/test');
  assert.ok(r);
  assert.equal(r.retracted, true);
  assert.equal(r.source, 'retraction-watch');
  assert.match(r.retraction_details ?? '', /2015-03-15: fabricated data/);
});

test('RUN-03: a DOI with no fixture is a typed offline miss, never "not retracted"', async () => {
  await assertOfflineMiss(() => rw.fetchById('10.0000/no-cassette-cr02'), 'fetchById miss');
});
