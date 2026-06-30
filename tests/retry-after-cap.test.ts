// tests/retry-after-cap.test.ts — audit #22 regression.
//
// Retry-After is server-controlled. Before the fix, http.ts slept the parsed
// value verbatim, so a hostile or misconfigured endpoint could send
// `Retry-After: 86400` and stall the CLI for hours on a single retry. The value
// is now clamped to RETRY_AFTER_CAP_MS (the same ceiling the fullJitter backoff
// uses).

import test from 'node:test';
import assert from 'node:assert/strict';
import { cappedRetryAfterMs, RETRY_AFTER_CAP_MS } from '../bin/lib/http.js';

const NOW = 1_700_000_000_000; // fixed epoch ms (deterministic, no Date.now())

test('audit #22: a huge delta-seconds Retry-After is clamped to the cap', () => {
  // 86400s = 1 day → 86_400_000 ms, far over the cap.
  assert.equal(cappedRetryAfterMs('86400', NOW), RETRY_AFTER_CAP_MS);
});

test('audit #22: a far-future HTTP-date Retry-After is clamped to the cap', () => {
  const farFuture = new Date(NOW + 7 * 24 * 3600 * 1000).toUTCString(); // +7 days
  assert.equal(cappedRetryAfterMs(farFuture, NOW), RETRY_AFTER_CAP_MS);
});

test('audit #22: a small Retry-After passes through unclamped', () => {
  // 5s is well under the cap and must be honored as-is.
  assert.equal(cappedRetryAfterMs('5', NOW), 5_000);
});

test('audit #22: an absent/garbage Retry-After yields no extra delay (<= cap)', () => {
  assert.ok(cappedRetryAfterMs(undefined, NOW) <= RETRY_AFTER_CAP_MS);
  assert.ok(cappedRetryAfterMs('not-a-number', NOW) <= RETRY_AFTER_CAP_MS);
});
