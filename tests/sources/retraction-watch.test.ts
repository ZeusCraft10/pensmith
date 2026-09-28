// tests/sources/retraction-watch.test.ts — Retraction Watch side-channel filter
// (T-3-13, D-15 LOCKED: fetchById only, no search()).
//
// The adapter reads the Retraction Watch data Crossref REST serves as
// `update-to` entries on the notices that update a work
// (GET api.crossref.org/works?filter=updates:<doi>). Both answers are REAL
// recordings (scripts/refresh-cassettes.mjs, CI-07): a work with no notice
// (10.1038/nphys1170 → null) and a retracted one (Wakefield et al. 1998 →
// retracted). A status that cannot be determined — a non-200, an error inside a
// 200, unreadable JSON, a transport failure — is RetractionLookupError, never
// "not retracted" (SRC-04, pulled into Phase 17); offline, a DOI with no fixture
// is the typed OfflineEgressError (RUN-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rw from '../../bin/lib/sources/retraction-watch.js';
import { _resetBucketsForTest } from '../../bin/lib/http.js';
import { installMockAgent } from '../helpers/local-servers/mock-agent.js';
import { RECORDED_DOI, recorded, assertOfflineMiss } from './recorded.js';

/** A retracted work with a Retraction Watch record (scripts/refresh-cassettes.mjs RECORDED_RETRACTED_DOI). */
const RECORDED_RETRACTED_DOI = '10.1016/S0140-6736(97)11096-0';

async function liveLane<T>(fn: (agent: ReturnType<typeof installMockAgent>['agent']) => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  _resetBucketsForTest();
  const { agent, restore } = installMockAgent();
  try {
    return await fn(agent);
  } finally {
    await restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
}

test('retraction-watch: NO search export (D-15 LOCKED: fetchById only)', () => {
  assert.equal((rw as Record<string, unknown>)['search'], undefined);
});

test('retraction-watch: the recordings are Crossref work lists (never an error document)', () => {
  for (const name of ['updates-nphys1170', 'updates-wakefield-1998']) {
    const [entry] = recorded('retraction-watch', name);
    assert.equal(entry!.scope, 'https://api.crossref.org');
    assert.equal(entry!.status, 200);
    const body = entry!.response as { status?: string; 'message-type'?: string };
    assert.equal(body.status, 'ok');
    assert.equal(body['message-type'], 'work-list');
  }
});

test('retraction-watch.fetchById() replays the recorded "no notice" answer → null (not retracted, a live answer)', async () => {
  assert.equal(await rw.fetchById(RECORDED_DOI), null);
});

test('retraction-watch.fetchById() turns the recorded retraction notice into a retracted SourceCandidate (D-15)', async () => {
  const r = await rw.fetchById(RECORDED_RETRACTED_DOI);
  assert.ok(r, 'the retracted work is found');
  assert.equal(r.retracted, true);
  assert.equal(r.source, 'retraction-watch');
  assert.equal(r.doi, RECORDED_RETRACTED_DOI);
  assert.match(r.retraction_details ?? '', /^2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)$/);
});

test('retraction-watch.fetchById() turns a synthetic hit into a retracted SourceCandidate (D-15)', async () => {
  const r = await rw.fetchById('10.0000/test');
  assert.ok(r);
  assert.equal(r.retracted, true);
  assert.equal(r.source, 'retraction-watch');
  assert.match(r.retraction_details ?? '', /^2015-03-15: Retraction /);
});

test('RUN-03: a DOI with no fixture is a typed offline miss, never "not retracted"', async () => {
  await assertOfflineMiss(() => rw.fetchById('10.0000/no-cassette-cr02'), 'fetchById miss');
});

test('SRC-04: a 200 carrying an error document is "retraction status unknown", never "not retracted"', async () => {
  await liveLane(async (agent) => {
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\?filter=updates/, method: 'GET' })
      .reply(200, { statusCode: '403', 'message-type': 'not-polite', body: 'Please add a mailto' }, { headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => rw.fetchById('10.5555/error-body'), (e: unknown) => {
      assert.ok(rw.isRetractionLookupError(e), String(e));
      assert.match((e as Error).message, /retraction status unknown for 10\.5555\/error-body: Crossref answered without a work list/);
      return true;
    });
  });
});

test('SRC-04: a non-200 or a transport failure is "retraction status unknown"', async () => {
  await liveLane(async (agent) => {
    agent
      .get('https://api.crossref.org')
      .intercept({ path: /^\/works\?filter=updates/, method: 'GET' })
      .reply(400, { status: 'failed', 'message-type': 'validation-failure' }, { headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => rw.fetchById('10.5555/bad-request'), /retraction status unknown for 10\.5555\/bad-request: Crossref answered HTTP 400/);
    // No interceptor left: the MockAgent refuses the connection.
    await assert.rejects(() => rw.fetchById('10.5555/unreachable'), (e: unknown) => rw.isRetractionLookupError(e));
  });
});

test('the contact email rides along as mailto (Crossref polite pool) and is never part of the fixture key', async () => {
  await liveLane(async (agent) => {
    const saved = process.env['PENSMITH_CONTACT_EMAIL'];
    process.env['PENSMITH_CONTACT_EMAIL'] = 'someone@example.org';
    let seenPath = '';
    agent
      .get('https://api.crossref.org')
      .intercept({ path: (p: string) => { seenPath = p; return p.startsWith('/works?filter=updates'); }, method: 'GET' })
      .reply(200, { status: 'ok', 'message-type': 'work-list', message: { items: [] } }, { headers: { 'content-type': 'application/json' } });
    try {
      assert.equal(await rw.fetchById('10.5555/polite'), null);
      assert.match(seenPath, /&mailto=someone%40example\.org$/);
    } finally {
      if (saved === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
      else process.env['PENSMITH_CONTACT_EMAIL'] = saved;
    }
  });
});
