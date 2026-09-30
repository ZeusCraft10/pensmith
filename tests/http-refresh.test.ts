// tests/http-refresh.test.ts — FetchOptions.refresh and the answer's time
// (Phase 20, VRFY-28, D-20-15), through the one egress gate against an
// in-process MockAgent (the test-lane live seam).
//
//   - a live answer carries `answeredAt`; the cache entry written for it keeps
//     that same instant, so a later cached read reports `cachedAt` equal to it
//     (a registrar record is dated when it was obtained, never when re-read);
//   - `refresh: true` skips the cache READ — the request reaches the service —
//     and writes the fresh answer back, which the next plain request is served.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetch as httpFetch } from '../bin/lib/http.js';
import { liveLane, uniq } from './sources/three-way.js';

test('VRFY-28 (MockAgent): refresh skips the cache read and writes the fresh answer back; a cached answer keeps the time it was obtained', async () => {
  await liveLane(async (agent) => {
    const token = uniq('refresh');
    let served = 0;
    agent
      .get('https://api.crossref.org')
      .intercept({ path: `/works/10.5555%2F${token}`, method: 'GET' })
      .reply(() => {
        served += 1;
        return { statusCode: 200, data: JSON.stringify({ status: 'ok', 'message-type': 'work', message: { version: served } }), responseOptions: { headers: { 'content-type': 'application/json' } } };
      })
      .persist();
    const url = `https://api.crossref.org/works/10.5555%2F${token}`;
    const version = (body: string): number => (JSON.parse(body) as { message: { version: number } }).message.version;

    const first = await httpFetch(url, { source: 'crossref' });
    assert.equal(first.cached, false);
    assert.equal(version(first.body), 1);
    assert.ok(typeof first.answeredAt === 'string' && !Number.isNaN(Date.parse(first.answeredAt)), 'a live answer is dated');

    const cached = await httpFetch(url, { source: 'crossref' });
    assert.equal(cached.cached, true);
    assert.equal(version(cached.body), 1);
    assert.equal(cached.cachedAt, first.answeredAt, 'the cache entry is dated when the answer arrived');
    assert.equal(served, 1, 'the cached read reached nothing');

    const fresh = await httpFetch(url, { source: 'crossref', refresh: true });
    assert.equal(fresh.cached, false, 'refresh skips the cache read');
    assert.equal(version(fresh.body), 2);
    assert.equal(served, 2);

    const after = await httpFetch(url, { source: 'crossref' });
    assert.equal(after.cached, true, 'the refreshed answer was written back');
    assert.equal(version(after.body), 2);
    assert.equal(after.cachedAt, fresh.answeredAt);
    assert.equal(served, 2);
  });
});
