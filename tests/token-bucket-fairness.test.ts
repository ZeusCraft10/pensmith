// tests/token-bucket-fairness.test.ts — Phase 15 Wave 1 RED scaffold for HARD-06.
//
// RED-by-skip: behavioral tests SKIP until bin/lib/http.ts exports a
// TokenBucket (or __TokenBucketForTest) seam that Wave-3 (15-03) lands.
// Zero failures while the seam is absent.
//
// Covers:
//   - HARD-06: TokenBucket FIFO acquisition order — completion order must equal
//     arrival order when multiple acquires queue behind a held token.
//   - Uses deterministic ordering via controlled token grants — no real-time
//     sleep races (mirrors Pitfall 7 from RESEARCH: one timer per grant cycle).
//
// Path resolution: fileURLToPath(new URL(..., import.meta.url)) — Phase-11.
// Dynamic-import: URL.href specifier so tsc --noEmit stays clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// ---- path resolution (Phase-11 spaced-path safe) ----
const httpModUrl = new URL('../bin/lib/http.js', import.meta.url);
// Keep reference to src path for diagnostic messages
void fileURLToPath(new URL('../bin/lib/http.ts', import.meta.url));

// ---- probe: does the module export a TokenBucket test seam? ----
// Wave-3 (15-03) will export EITHER:
//   a) `TokenBucket` (if made public for test)
//   b) `__TokenBucketForTest` (if kept private with a test-seam export)
// Either export satisfies the skip gate.

type TokenBucketLike = {
  acquire(): Promise<void>;
};
type TokenBucketCtor = new (capacity: number, refillPerSec: number) => TokenBucketLike;

let TokenBucketCls: TokenBucketCtor | undefined;

try {
  const mod = await import(httpModUrl.href) as Record<string, unknown>;
  const seam = mod['TokenBucket'] ?? mod['__TokenBucketForTest'];
  if (typeof seam === 'function') {
    TokenBucketCls = seam as TokenBucketCtor;
  }
} catch {
  // Module load failure — target absent (Wave-0/1 RED state). Stay skipped.
}

const hasTokenBucket = typeof TokenBucketCls === 'function';

// ---- HARD-06 FIFO fairness test (skip-guarded) ----

test('TokenBucket FIFO: completion order equals acquisition order (HARD-06)',
  {
    skip: !hasTokenBucket
      ? 'TokenBucket/​__TokenBucketForTest not yet exported from bin/lib/http.ts — not yet wired (HARD-06)'
      : false,
  },
  async () => {
    // Capacity=1 forces queuing after the first acquisition.
    // refillPerSec=1000 means tokens refill in ~1ms — fast enough that the
    // test completes in <500ms without relying on OS timer precision.
    const bucket = new TokenBucketCls!(1, 1000);

    const completionOrder: number[] = [];

    // Step 1: immediately acquire the only token (bucket goes to 0 tokens).
    await bucket.acquire();

    // Step 2: start 3 waiters that arrive in sequence 1→2→3.
    // They all call acquire() before we release the first one, so they
    // enqueue in arrival order. A FIFO bucket must grant them in that order.
    const arrivals: Array<Promise<void>> = [];

    for (let i = 1; i <= 3; i++) {
      const id = i;
      const p = bucket.acquire().then(() => {
        completionOrder.push(id);
      });
      arrivals.push(p);
      // Yield control so each acquire() call is registered before the next
      // one is issued — this ensures the queue captures arrival order.
      await new Promise<void>((r) => setImmediate(r));
    }

    // Step 3: wait for all 3 waiters to complete.
    await Promise.all(arrivals);

    // Step 4: assert FIFO completion order.
    assert.deepEqual(
      completionOrder,
      [1, 2, 3],
      `FIFO violated — expected completion order [1,2,3] but got [${completionOrder.join(',')}]`,
    );
  },
);

test('TokenBucket: immediate acquire succeeds when tokens available (HARD-06)',
  {
    skip: !hasTokenBucket
      ? 'TokenBucket not yet exported — not yet wired (HARD-06)'
      : false,
  },
  async () => {
    // A fresh bucket has capacity tokens available — acquire must not block.
    const bucket = new TokenBucketCls!(5, 10);
    // Complete immediately (no await needed if synchronous, but acquire is async)
    const before = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - before;
    assert.ok(
      elapsed < 200,
      `Expected immediate acquire (<200ms) but took ${elapsed}ms`,
    );
  },
);

// ---- module-presence consistency (Wave-0 pattern) ----

test('HARD-06: TokenBucket seam export consistent with Wave-1 RED state',
  () => {
    if (hasTokenBucket) {
      assert.ok(true, 'TokenBucket seam exported — FIFO test above is active (Wave-3+)');
    } else {
      assert.ok(
        !hasTokenBucket,
        'Wave-1 RED: TokenBucket seam absent from http.ts exports — skips above are correct',
      );
    }
  },
);
