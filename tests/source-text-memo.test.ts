// tests/source-text-memo.test.ts — Pass 3's in-process memo of source lookups
// and texts (VRFY-19; review round 2): a long-lived process (the MCP server)
// never keeps every text it read in memory — expired entries are dropped on
// every use and the memo is capped, oldest first; within its lifetime an entry
// still answers a second ask without a second fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMO_MAX_ENTRIES, _memoizedForTest, _resetSourceTextMemoForTest, _sourceTextMemoSizeForTest } from '../bin/lib/verify/source-text.js';

test('the memo answers a second ask within its lifetime, is capped at MEMO_MAX_ENTRIES (oldest first) and drops expired entries', async () => {
  _resetSourceTextMemoForTest();
  let calls = 0;
  const ask = (key: string): Promise<string> =>
    _memoizedForTest(key, false, async () => {
      calls += 1;
      return `text of ${key}`;
    });
  assert.equal(await ask('k0'), 'text of k0');
  assert.equal(await ask('k0'), 'text of k0');
  assert.equal(calls, 1, 'a second ask is served from the memo');

  for (let i = 1; i <= MEMO_MAX_ENTRIES * 2; i += 1) await ask(`k${i}`);
  assert.equal(_sourceTextMemoSizeForTest(), MEMO_MAX_ENTRIES, 'capped');
  const before = calls;
  await ask(`k${MEMO_MAX_ENTRIES * 2}`);
  assert.equal(calls, before, 'the newest entry is kept');
  await ask('k1');
  assert.equal(calls, before + 1, 'the oldest entries were dropped');

  // A minute later every entry has expired: the next use empties the memo of them.
  const realNow = Date.now;
  try {
    const later = realNow() + 61_000;
    Date.now = () => later;
    await ask('fresh');
    assert.equal(_sourceTextMemoSizeForTest(), 1, 'expired entries are dropped on use');
  } finally {
    Date.now = realNow;
    _resetSourceTextMemoForTest();
  }
});
