// tests/http-binary-body.test.ts — audit #29 regression.
//
// http.ts decoded every response body with body.text() (UTF-8), so URL-fetched
// PDF bytes were corrupted before extraction — `add <url>.pdf` could never work
// even after the routing fix (#12). http.ts now exposes byte-faithful bodyBytes
// alongside the (lossy-for-binary) text body.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { fetch, _resetBucketsForTest } from '../bin/lib/http.js';

test('audit #29: bodyBytes is byte-faithful for binary content the UTF-8 body corrupts', async () => {
  const prev: Dispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  try {
    // Bytes that are NOT valid UTF-8: %PDF-1.5 magic then a lone 0xFF / 0x80 etc.
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a, 0xff, 0x00, 0x80, 0xfe, 0x89]);
    const url = 'https://api.crossref.org/binary-probe';
    const u = new URL(url);
    agent
      .get(u.origin)
      .intercept({ path: u.pathname, method: 'GET' })
      .reply(200, bytes, { headers: { 'content-type': 'application/pdf' } });

    _resetBucketsForTest();
    // source:'crossref' is a trusted host → bypasses the SSRF pre-flight (no DNS).
    const res = await fetch(url, { source: 'crossref', noCache: true });

    assert.ok(res.bodyBytes, 'a live fetch must populate bodyBytes');
    assert.deepEqual([...res.bodyBytes], [...bytes], 'bodyBytes must be byte-for-byte faithful');

    // The old path (Buffer.from(utf8-body, 'binary')) is LOSSY — prove the bug
    // the new field fixes: re-encoding the text body does NOT recover the bytes.
    assert.notDeepEqual([...Buffer.from(res.body, 'utf8')], [...bytes],
      'the UTF-8 text body is lossy for these bytes (why bodyBytes is required)');
  } finally {
    setGlobalDispatcher(prev);
  }
});
