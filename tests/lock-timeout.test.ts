// tests/lock-timeout.test.ts — audit #26 regression.
//
// withLock translated timeoutMs into a node-retry schedule but only set
// maxTimeout (the per-delay cap), NOT maxRetryTime (the total cap). So the real
// acquisition wait was the SUM of the geometric delays — for the defaults
// (timeoutMs 60s, retryDelayMs 100, factor 1.5) ≈ 131s, more than 2x the
// documented 60s. buildPlfOpts now sets maxRetryTime = timeoutMs so the TOTAL
// wait is genuinely bounded by timeoutMs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlfOpts, withLock, tryAcquire } from '../bin/lib/lock.js';

test('audit #26: buildPlfOpts bounds TOTAL wait at timeoutMs via maxRetryTime', () => {
  const opts = buildPlfOpts({ timeoutMs: 1234, retryDelayMs: 100, retryFactor: 1.5 }) as {
    retries: { maxRetryTime?: number; maxTimeout?: number; minTimeout?: number };
  };
  assert.equal(opts.retries.maxRetryTime, 1234, 'maxRetryTime must equal timeoutMs (the real total cap)');
  assert.equal(opts.retries.maxTimeout, 1234, 'maxTimeout (per-delay cap) stays at timeoutMs');
});

test('audit #26: withLock under contention gives up near timeoutMs (no >2x overshoot)', async () => {
  const r = 'test:contend:' + Date.now() + ':' + Math.random();
  // Hold the lock in-process and never release until the finally below, so the
  // second acquisition exhausts its bounded retry window and rejects.
  const hold = await tryAcquire(r, { timeoutMs: 5000 });
  try {
    const t0 = Date.now();
    await assert.rejects(
      withLock(r, async () => 1, { timeoutMs: 1000, retryDelayMs: 100, retryFactor: 1.5 }),
      'withLock must give up when the lock is held',
    );
    const elapsed = Date.now() - t0;
    // Pre-fix: the geometric delay sum (~2.1s) ran regardless of timeoutMs.
    // Post-fix: maxRetryTime caps the total near timeoutMs (1000ms). A generous
    // 1900ms ceiling distinguishes the two without being flaky.
    assert.ok(elapsed < 1900, `withLock must not overshoot ~2x timeoutMs; elapsed=${elapsed}ms`);
  } finally {
    await hold();
  }
});
