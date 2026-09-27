// tests/sources/unpaywall.test.ts — Unpaywall adapter (RSCH-04, T-3-13, CI-07).
//
// The recorded cassette is TODAY's live shape: `z_authors` carries only
// `raw_author_name`, which the current parser cannot read, so a real lookup
// hydrates nothing (the known SRC-03 gap, Phase 19 — the fixture is recorded
// faithfully, never edited to look parseable). The OA-PDF extraction path is
// covered by the hand-written SYNTHETIC pre-2025-shape fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as unpaywall from '../../bin/lib/sources/unpaywall.js';
import { RECORDED_DOI, recorded, assertOfflineMiss } from './recorded.js';

test('unpaywall: the recorded cassette is the current live shape (raw_author_name only)', () => {
  const [entry] = recorded('unpaywall', 'doi-nphys1170');
  const body = entry!.response as { doi: string; z_authors?: Array<Record<string, unknown>> };
  assert.equal(body.doi, RECORDED_DOI);
  assert.ok((body.z_authors ?? []).length > 0);
  assert.ok((body.z_authors ?? []).every((a) => typeof a['raw_author_name'] === 'string'));
  assert.ok(!entry!.path.includes('email='), 'the contact email param is scrubbed from the recording');
});

test('unpaywall.fetchById() replays the recorded answer for exactly that DOI (current shape → no candidate until SRC-03)', async () => {
  assert.equal(await unpaywall.fetchById(RECORDED_DOI), null);
});

test('unpaywall.fetchById() extracts oa_pdf_url from the synthetic pre-2025 shape (RSCH-04)', async () => {
  const r = await unpaywall.fetchById('10.48550/arxiv.1706.03762');
  assert.ok(r);
  assert.equal(r.source, 'unpaywall');
  assert.equal(r.oa_pdf_url, 'https://arxiv.org/pdf/1706.03762.pdf');
});

test('unpaywall.search() is inert (DOI-lookup service)', async () => {
  assert.deepEqual(await unpaywall.search('attention mechanisms'), []);
});

test('RUN-03: an unrecorded DOI is a typed offline miss — never the first cassette entry', async () => {
  await assertOfflineMiss(() => unpaywall.fetchById('10.1093/nar/gkab1112'), 'fetchById miss');
});
