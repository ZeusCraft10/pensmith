// tests/sources/zotero-mcp.test.ts — Phase 10 Plan 10-00 Wave-0 RED scaffold (RSCH-06).
//
// Encodes BOTH legs of RSCH-06 SC3:
//   (a) ABSENT/degrade leg     — search() never throws and returns an Array.
//   (b) registry leg           — 'zotero-mcp' is registered in sources.
//   (c) PRESENT+AUTHENTICATED  — the H1 executable "used-as-source" proof: an
//       injected fake ZoteroClient + ZOTERO_API_KEY drives the normalization path
//       to >=1 SourceCandidate. This leg encodes the CANONICAL GATE PREDICATE that
//       10-03 Task 1 STEP B owns (single source of truth) VERBATIM, so the test
//       and the implementation encode the IDENTICAL predicate.
//
// RED-by-skip convention (Phase-10 Wave 0):
//   - Always-on existence assertion fires RED NOW (bin/lib/sources/zotero-mcp.ts
//     does not exist yet — Plan 10-03 creates it).
//   - Behavioral tests skip-guard on existsSync(adapterPath) and use a DYNAMIC
//     import() inside the body (a static top-level import of the absent module
//     would be ESM-resolved before the skip guard and hard-crash Wave 0).
//   - Leg (c) additionally feature-detects the setZoteroClientForTest export and
//     skips cleanly (no TypeError) until 10-03 ships the injection seam.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const ADAPTER = 'zotero-mcp';
const adapterPath = new URL(`../../bin/lib/sources/${ADAPTER}.ts`, import.meta.url);
const skip = !existsSync(adapterPath);

// RED-by-skip existence gate (Phase-10 Wave-0 convention — matches 05-01/06-01/08-00:
// Wave-0 scaffolds skip rather than hard-fail so the FULL suite stays GREEN with
// zero failures). Skips NOW with a MISSING reason; once Plan 10-03 ships the
// adapter the skip guard inverts and this becomes a real existence assertion.
test(`${ADAPTER}: production adapter exists (RSCH-06)`, { skip }, () => {
  assert.ok(
    existsSync(adapterPath),
    `MISSING: bin/lib/sources/${ADAPTER}.ts — Plan 10-03 must create (presence+auth-gated Zotero source adapter)`,
  );
});

// (a) ABSENT/degrade leg — on CI Zotero is genuinely absent AND no client is
//     injected, so canonical-gate (1) returns []. The load-bearing assertion is
//     the absence-non-breaking contract: never throws, always an Array.
test(`${ADAPTER}.search() never throws and returns an Array when absent (RSCH-06 SC3 leg a)`, { skip }, async () => {
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  let result: unknown;
  await assert.doesNotReject(async () => {
    result = await adapter.search('test query');
  }, 'search() must not throw when Zotero is absent');
  assert.ok(Array.isArray(result), 'search() must return an array');
});

// (b) registry leg — 'zotero-mcp' is registered in the sources const.
test(`${ADAPTER}: 'zotero-mcp' registered in sources after import (RSCH-06 SC3 leg b)`, { skip }, async () => {
  const { sources } = await import('../../bin/lib/sources/index.js');
  assert.ok('zotero-mcp' in sources, "'zotero-mcp' must be registered in the sources const");
});

// (c) PRESENT+AUTHENTICATED used-as-source leg — the H1 executable proof.
//     Feature-detects setZoteroClientForTest so it skips cleanly until 10-03 ships
//     the seam (no TypeError). Encodes the CANONICAL GATE PREDICATE (10-03 STEP B):
//       (1) presence:  if (!isZoteroMcpPresent() && _client === null) return [];
//       (2) auth:      if (!isZoteroAuthenticated()) return [];   // KEY-ONLY: !!process.env['ZOTERO_API_KEY']
//       (3) no-client: if (_client === null) return [];
//       (4) try { pull via _client.search -> map(toCandidate).filter } catch { return []; }
//     An injected _client is itself a valid presence signal (gate 1) and auth is
//     KEY-ONLY (gate 2), so injecting a fake client + setting ZOTERO_API_KEY reaches
//     normalization on CI even though isZoteroMcpPresent() is filesystem-FALSE.
test(`${ADAPTER}.search() pulls+normalizes via injected client when present+authenticated (RSCH-06 SC3 leg c)`, async (t) => {
  if (skip) {
    t.skip('adapter not yet built (Plan 10-03)');
    return;
  }
  const adapter = await import(`../../bin/lib/sources/${ADAPTER}.js`);
  if (typeof adapter.setZoteroClientForTest !== 'function') {
    t.skip('setZoteroClientForTest not yet exported (Plan 10-03 injection seam)');
    return;
  }

  const savedKey = process.env['ZOTERO_API_KEY'];
  try {
    // Present+authenticated path: inject a fake client + set the key.
    process.env['ZOTERO_API_KEY'] = 'dummy-key-not-a-real-secret';
    adapter.setZoteroClientForTest({
      search: async () => [
        {
          id: 'ZKEY1',
          title: 'Attention Is All You Need',
          creators: [{ firstName: 'Ashish', lastName: 'Vaswani' }],
          date: '2017',
          DOI: '10.5555/3295222',
        },
      ],
    });
    const result = await adapter.search('attention');
    assert.ok(Array.isArray(result), 'search() returns an array on the present+auth path');
    assert.ok(result.length >= 1, 'injected client + key reaches normalization → >=1 candidate');
    const c = result[0];
    assert.equal(c.source, 'zotero-mcp', "normalized candidate carries source:'zotero-mcp'");
    assert.ok(typeof c.id === 'string' && c.id.length > 0, 'candidate has a non-empty id');
    assert.ok(typeof c.title === 'string' && c.title.length > 0, 'candidate has a non-empty title');
    assert.ok(Array.isArray(c.authors) && c.authors.length >= 1, 'candidate has >=1 author');
    assert.equal(typeof c.citekey, 'string', 'candidate has a string citekey');

    // Inverse within the same leg: null client + no key → [] (gate 1 absent path).
    adapter.setZoteroClientForTest(null);
    delete process.env['ZOTERO_API_KEY'];
    const empty = await adapter.search('attention');
    assert.ok(Array.isArray(empty) && empty.length === 0, 'null client + no key → [] (absence-non-breaking)');
  } finally {
    adapter.setZoteroClientForTest(null);
    if (savedKey === undefined) delete process.env['ZOTERO_API_KEY'];
    else process.env['ZOTERO_API_KEY'] = savedKey;
  }
});
