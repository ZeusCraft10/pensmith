// tests/budget.test.ts — assertBudget / appendCost / totalCost / Semaphore
// tests for bin/lib/budget.ts (ARCH-09 / ARCH-10 / ARCH-11; D-44/45/46/50).
//
// Strategy:
//   - paperDir() is rooted at process.cwd() via projectRoot() in paths.ts.
//     We isolate each test by mkdtemp + process.chdir + chdir-restore in
//     finally. The .paper/ subdir is pre-created so atomicAppendFile's
//     mkdir -p doesn't race the very first append.
//   - process.chdir is process-global; node:test runs tests sequentially
//     within a single process by default, so chdir+restore is safe. The
//     try/finally restore is mandatory — a failed test must not leak the
//     tmpdir cwd into the next test.
//   - We DO NOT rely on real provider pricing — every CostRecord uses
//     a hard-coded costUsd literal. The cost-fixture.test.ts file
//     covers the fixture pricing table.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  assertBudget,
  appendCost,
  totalCost,
  Semaphore,
  BudgetExceededError,
  type CostRecord,
} from '../bin/lib/budget.js';

async function withProjectRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-budget-'));
  const orig = process.cwd();
  try {
    process.chdir(root);
    // Pre-create .paper so atomicAppendFile's mkdir-p doesn't race the
    // first append. (Functionally redundant — atomicAppendFile mkdir's —
    // but it makes the test setup explicit.)
    await fsp.mkdir(path.join(root, '.paper'), { recursive: true });
    await fn(root);
  } finally {
    process.chdir(orig);
    await fsp.rm(root, { recursive: true, force: true });
  }
}

const REC = (over: Partial<CostRecord> = {}): CostRecord => ({
  ts: '2026-05-08T00:00:00.000Z',
  scope: 'section',
  scopeId: '01',
  provider: 'anthropic',
  costUsd: 0.10,
  ...over,
});

test('assertBudget: passes when spent + estimate < cap', async () => {
  await withProjectRoot(async () => {
    // No prior spend; estimate 0.30 against cap 0.50 → must not throw.
    await assertBudget({ scope: 'section', scopeId: '01', cap: 0.50 }, 0.30);
  });
});

test('assertBudget: throws BudgetExceededError when spent + estimate > cap', async () => {
  await withProjectRoot(async () => {
    await appendCost(REC({ costUsd: 0.40 }));
    let err: unknown;
    try {
      await assertBudget({ scope: 'section', scopeId: '01', cap: 0.50 }, 0.30);
    } catch (e) {
      err = e;
    }
    assert.ok(
      err instanceof BudgetExceededError,
      `expected BudgetExceededError; got ${String(err)}`,
    );
    const e = err as BudgetExceededError;
    assert.equal(e.scope, 'section');
    assert.equal(e.cap, 0.50);
    assert.equal(e.spent, 0.40);
    assert.equal(e.estimatedAdd, 0.30);
    assert.match(e.message, /Budget exceeded/);
  });
});

test('appendCost + totalCost: roundtrip sums match', async () => {
  await withProjectRoot(async () => {
    await appendCost(REC({ costUsd: 0.10 }));
    await appendCost(REC({ costUsd: 0.20 }));
    await appendCost(REC({ costUsd: 0.30 }));
    const total = await totalCost({ scope: 'section', scopeId: '01' });
    assert.equal(Number(total.toFixed(4)), 0.6);
  });
});

test('totalCost: filters by scopeId', async () => {
  await withProjectRoot(async () => {
    await appendCost(REC({ scopeId: '01', costUsd: 0.20 }));
    await appendCost(REC({ scopeId: '02', costUsd: 0.30 }));
    const a = await totalCost({ scope: 'section', scopeId: '01' });
    const b = await totalCost({ scope: 'section', scopeId: '02' });
    assert.equal(a, 0.20);
    assert.equal(b, 0.30);
  });
});

test('totalCost: returns 0 when COSTS.jsonl is missing', async () => {
  await withProjectRoot(async (root) => {
    // .paper exists but no COSTS.jsonl yet.
    const stat = await fsp.stat(path.join(root, '.paper', 'COSTS.jsonl')).catch(() => null);
    assert.equal(stat, null, 'COSTS.jsonl should not exist before any appendCost');
    const t = await totalCost({});
    assert.equal(t, 0);
  });
});

test('appendCost: parallel appends both persist (O_APPEND atomicity)', async () => {
  await withProjectRoot(async () => {
    await Promise.all([
      appendCost(REC({ costUsd: 0.10 })),
      appendCost(REC({ costUsd: 0.10 })),
    ]);
    const total = await totalCost({});
    assert.equal(Number(total.toFixed(4)), 0.20);
  });
});

test('Semaphore: enforces max-N concurrency', async () => {
  const sem = new Semaphore(2);
  let inFlight = 0;
  let maxSeen = 0;
  const tick = async () => {
    await sem.withLock(async () => {
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
    });
  };
  await Promise.all([tick(), tick(), tick(), tick(), tick()]);
  assert.equal(maxSeen, 2, `Semaphore allowed ${maxSeen} concurrent; expected 2`);
});

test('Semaphore: release without acquire throws', () => {
  const sem = new Semaphore(1);
  assert.throws(() => sem.release(), /more times than acquire/);
});

test('Semaphore: invalid maxConcurrency throws', () => {
  assert.throws(() => new Semaphore(0), /positive integer/);
  assert.throws(() => new Semaphore(-1), /positive integer/);
  assert.throws(() => new Semaphore(1.5 as unknown as number), /positive integer/);
  assert.throws(() => new Semaphore(NaN as unknown as number), /positive integer/);
});
