// tests/cassette-index.test.ts — how bin/lib/http-mock.ts indexes cassettes.
//
// Two guards keep cassette replay honest:
//   - Two recordings of one request that disagree are refused, never picked
//     by file order. They disagree when the recorded `response` values differ,
//     even when they replay the same body: an object replays with
//     content-type application/json, its JSON string with no content-type.
//   - A malformed entry (no string `method`) fails every replay loudly, like an
//     invalid `scope`. It must not drop out of the index while the rest of the
//     cassettes keep answering.
//
// Each case writes its cassettes to a temp root and replays them through
// _replayFromRootForTest, which indexes that root exactly as replayCassette
// indexes the committed tests/fixtures/cassettes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _replayFromRootForTest, CassetteMissError } from '../bin/lib/http-mock.js';

const SCOPE = 'https://api.example.test';

/** A cassette root holding `files` (name -> entries) in one adapter folder. */
function cassetteRoot(files: Record<string, unknown[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-cassette-index-'));
  mkdirSync(join(root, 'adapter'));
  for (const [name, entries] of Object.entries(files)) {
    writeFileSync(join(root, 'adapter', name), JSON.stringify(entries));
  }
  return root;
}

/** One recording of GET <SCOPE><path>; `response` is left out when undefined. */
function entry(path: string, response: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const e: Record<string, unknown> = { scope: SCOPE, method: 'GET', path, status: 200, ...extra };
  if (response !== undefined) e['response'] = response;
  return e;
}

const AMBIGUOUS = /several different recordings match; refusing to pick one/;

test('cassette index: recordings whose raw responses differ but replay the same body are ambiguous', () => {
  const pairs: Array<[string, unknown, unknown]> = [
    ['object vs its JSON string', { a: 1 }, '{"a":1}'],
    ['JSON string vs its object', '{"a":1}', { a: 1 }],
    ['null vs no response', null, undefined],
    ['empty string vs null', '', null],
    ['number vs its string', 5, '5'],
  ];
  for (const [label, first, second] of pairs) {
    const root = cassetteRoot({
      'a.json': [entry('/works/x', first)],
      'b.json': [entry('/works/x', second)],
    });
    assert.throws(
      () => _replayFromRootForTest(root, 'GET', `${SCOPE}/works/x`),
      (err: unknown) => err instanceof CassetteMissError && AMBIGUOUS.test(err.message),
      `${label}: replay must refuse to pick one recording`,
    );
  }
});

test('cassette index: recordings with different bodies are ambiguous; identical ones replay', () => {
  const differ = cassetteRoot({
    'a.json': [entry('/works/x', { a: 1 })],
    'b.json': [entry('/works/x', { a: 2 })],
  });
  assert.throws(() => _replayFromRootForTest(differ, 'GET', `${SCOPE}/works/x`), AMBIGUOUS);

  const same = cassetteRoot({
    'a.json': [entry('/works/x', { a: 1 })],
    'b.json': [entry('/works/x', { a: 1 })],
  });
  const hit = _replayFromRootForTest(same, 'GET', `${SCOPE}/works/x`);
  assert.equal(hit.status, 200);
  assert.equal(hit.body, '{"a":1}');
  assert.equal(hit.headers['content-type'], 'application/json');
});

test('cassette index: an entry with no string method fails every replay, naming the file', () => {
  for (const [label, method] of [['missing', undefined], ['a number', 123], ['null', null]] as const) {
    const bad = entry('/works/broken', { b: 1 });
    if (method === undefined) delete bad['method'];
    else bad['method'] = method;
    const root = cassetteRoot({
      'good.json': [entry('/works/fine', { a: 1 })],
      'zz-bad.json': [bad],
    });
    assert.throws(
      () => _replayFromRootForTest(root, 'GET', `${SCOPE}/works/fine`),
      (err: unknown) => err instanceof Error && /zz-bad\.json has an invalid method/.test(err.message),
      `method ${label}: a request recorded elsewhere must not replay past the broken entry`,
    );
  }
});
