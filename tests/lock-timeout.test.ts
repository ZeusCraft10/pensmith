// tests/lock-timeout.test.ts — audit #26 regression, updated for RUN-22 / D-17-42.
//
// Audit #26 (first half): withLock once handed proper-lockfile a node-retry
// schedule whose geometric delay SUM overshot timeoutMs by 2x (≈131 s for the
// 60 s default). RUN-22 replaced that schedule: proper-lockfile now makes ONE
// attempt (`retries: 0`) and bin/lib/lock.ts owns the retry loop — jittered
// exponential backoff (5 ms → 250 ms) bounded by a deadline computed from
// timeoutMs — so the total wait is timeoutMs by construction. These tests pin
// that contract; tests/lock-contention.test.ts covers the contention half.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlfOpts, backoffDelay, withLock, tryAcquire, LockTimeoutError } from '../bin/lib/lock.js';
import { PensmithError } from '../bin/lib/exit-codes.js';

test('RUN-22: proper-lockfile gets exactly one attempt (retries: 0); lock.ts owns the retry loop', () => {
  const opts = buildPlfOpts({ timeoutMs: 1234, staleMs: 9000 }) as { retries?: unknown; stale?: number; realpath?: boolean };
  assert.equal(opts.retries, 0, 'no node-retry schedule — the deadline loop in lock.ts retries');
  assert.equal(opts.stale, 9000, 'staleMs still maps to proper-lockfile stale');
  assert.equal(opts.realpath, false, 'the stub is already canonical');
});

test('RUN-22: backoff is jittered exponential, 5 ms growing to a 250 ms ceiling', () => {
  const lo = (n: number): number => backoffDelay(n, {}, () => 0);
  const hi = (n: number): number => backoffDelay(n, {}, () => 1);
  assert.equal(hi(0), 5, 'first delay ceiling is 5 ms');
  assert.equal(lo(0), 2.5, 'equal jitter: the draw is in [delay/2, delay]');
  assert.equal(hi(1), 10);
  assert.equal(hi(5), 160);
  assert.equal(hi(6), 250, 'capped at 250 ms');
  assert.equal(hi(40), 250, 'stays capped');
  for (let i = 0; i < 200; i += 1) {
    const d = backoffDelay(3);
    assert.ok(d >= 20 && d <= 40, `attempt-3 delay must be in [20, 40], got ${d}`);
  }
});

test('audit #26 / RUN-22: withLock under contention gives up near timeoutMs (no overshoot)', async () => {
  const r = 'test:contend:' + Date.now() + ':' + Math.random();
  // Hold the lock in-process and never release until the finally below, so the
  // second acquisition waits its whole window and rejects.
  const hold = await tryAcquire(r, { timeoutMs: 5000 });
  try {
    const t0 = Date.now();
    await assert.rejects(
      withLock(r, async () => 1, { timeoutMs: 1000 }),
      (e: unknown) => {
        assert.ok(e instanceof LockTimeoutError, `expected LockTimeoutError, got ${String(e)}`);
        assert.ok(e instanceof PensmithError, 'LockTimeoutError is a PensmithError (one-line CLI failure)');
        assert.equal(e.holderPid, process.pid, 'the in-process holder is this process');
        assert.match(e.message, new RegExp(`pid ${process.pid}`));
        assert.ok(e.message.includes(r), 'the message names the locked resource');
        return true;
      },
    );
    const elapsed = Date.now() - t0;
    // Pre-fix: the geometric delay sum (~2.1s) ran regardless of timeoutMs.
    assert.ok(elapsed >= 800 && elapsed < 1400, `withLock must give up at ~timeoutMs (1000 ms); elapsed=${elapsed}ms`);
  } finally {
    await hold();
  }
  // The timed-out waiter left the queue: the lock is immediately available.
  assert.equal(await withLock(r, async () => 'free', { timeoutMs: 500 }), 'free');
});
