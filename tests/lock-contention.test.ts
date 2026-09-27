// tests/lock-contention.test.ts — RUN-22 / D-17-42: withLock survives
// realistic contention.
//
// AUD-26 measured the pre-RUN-22 lock with each caller holding ~5 ms:
// N=20 → 5 ELOCKED, N=40 → 25 ELOCKED (58 s). The reworked lock (in-process
// FIFO + one proper-lockfile attempt + jittered 5→250 ms backoff until
// timeoutMs + owner.json) must:
//   - let 40 contenders holding ~5 ms each ALL succeed within 10 s — in one
//     process, and spread across 4 processes (the cross-process backoff path);
//   - keep mutual exclusion (no two holders at once);
//   - time out a waiter on a never-releasing holder at timeoutMs ±20% with a
//     LockTimeoutError naming the resource path and the holder PID;
//   - record the holder in owner.json inside the lock directory;
//   - clear a lock whose recorded holder was killed (kill -9) without waiting
//     the 45 s stale window.
// Cross-process children run the REAL bin/lib/lock.ts (tests/lock-conflict.cjs
// through the tsx loader) against the same data dir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import { withLock, tryAcquire, lockOwner, stubFor, LockTimeoutError } from '../bin/lib/lock.js';
import { pensmithLockDir } from '../bin/lib/paths.js';

const HELPER = path.resolve('tests/lock-conflict.cjs');

function uniqueResource(tag: string): string {
  // A real-looking file path (the common case: STATE.json, LIBRARY.json, PLAN.md).
  return path.join(os.tmpdir(), `pensmith-contention-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`, 'LIBRARY.json');
}

function spawnHelper(env: Record<string, string>): { child: ChildProcess; lines: string[]; exited: Promise<number | null> } {
  void pensmithLockDir(); // export a single-file run's per-process data dir to the child (CI-09)
  const child = spawn(process.execPath, ['--import', 'tsx', HELPER], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  let buf = '';
  child.stdout!.on('data', (c: Buffer) => {
    buf += c.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) !== -1) {
      lines.push(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
  });
  let stderr = '';
  child.stderr!.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      if (buf.trim()) lines.push(buf.trim());
      if (code !== 0 && stderr) lines.push(`STDERR ${stderr.trim()}`);
      resolve(code);
    });
  });
  return { child, lines, exited };
}

async function waitForLine(lines: string[], re: RegExp, ms: number): Promise<RegExpMatchArray> {
  const t0 = Date.now();
  for (;;) {
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m;
    }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${re}; got: ${lines.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('RUN-22: 40 in-process contenders holding ~5 ms each all succeed within 10 s, mutually exclusive', async () => {
  const r = uniqueResource('inproc');
  let inside = 0;
  let maxInside = 0;
  const order: number[] = [];
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) =>
      withLock(r, async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await new Promise((res) => setTimeout(res, 5));
        order.push(i);
        inside -= 1;
      }, { timeoutMs: 10_000 }),
    ),
  );
  const elapsed = Date.now() - t0;
  const failed = results.filter((x) => x.status === 'rejected');
  assert.equal(failed.length, 0, `every contender must succeed: ${failed.map((f) => String((f as PromiseRejectedResult).reason)).join('; ')}`);
  assert.equal(maxInside, 1, 'mutual exclusion: never two holders at once');
  assert.ok(elapsed < 10_000, `40 contenders must finish within 10 s (took ${elapsed} ms)`);
  // FIFO: in-process callers are served in arrival order.
  assert.deepEqual(order, Array.from({ length: 40 }, (_, i) => i), 'in-process waiters are served FIFO');
});

test('RUN-22: 40 contenders across 4 processes (10 each, ~5 ms holds) all succeed within 10 s', async () => {
  const r = uniqueResource('xproc');
  const t0 = Date.now();
  const kids = Array.from({ length: 4 }, () => spawnHelper({ RESOURCE: r, CONTEND: '10', HOLD_MS: '5', TIMEOUT_MS: '10000' }));
  const codes = await Promise.all(kids.map((k) => k.exited));
  const elapsed = Date.now() - t0;
  for (const [i, k] of kids.entries()) {
    const done = k.lines.find((l) => l.startsWith('DONE'));
    assert.equal(codes[i], 0, `child ${i} must exit 0: ${k.lines.join(' | ')}`);
    assert.match(done ?? '', /^DONE ok=10 fail=0 /, `child ${i}: every contender succeeded: ${k.lines.join(' | ')}`);
  }
  // Process startup (tsx transpile) dominates on slow CI; the lock work itself
  // must fit comfortably inside the same 10 s budget.
  assert.ok(elapsed < 10_000 + 20_000, `cross-process contention must not stall (took ${elapsed} ms)`);
  const lockMs = Math.max(...kids.map((k) => Number(/ms=(\d+)/.exec(k.lines.find((l) => l.startsWith('DONE')) ?? '')?.[1] ?? 'NaN')));
  assert.ok(lockMs < 10_000, `the 40 cross-process acquisitions must complete within 10 s (slowest child: ${lockMs} ms)`);
});

test('RUN-22: a never-releasing holder in another process → LockTimeoutError at timeoutMs ±20% naming the path and PID', async () => {
  const r = uniqueResource('forever');
  const holder = spawnHelper({ RESOURCE: r, HOLD_MS: 'forever' });
  try {
    const m = await waitForLine(holder.lines, /^ACQUIRED (\d+) (\d+)$/, 20_000);
    const holderPid = Number(m[2]);
    assert.equal(holderPid, holder.child.pid);

    // owner.json inside the lock directory records the holder (D-17-42).
    const owner = await lockOwner(r);
    assert.ok(owner, 'owner.json must exist inside the lock directory');
    assert.equal(owner.pid, holderPid);
    assert.equal(owner.hostname, os.hostname());
    assert.ok(!Number.isNaN(Date.parse(owner.acquiredAt)), 'acquiredAt is an ISO time');
    assert.ok(!Number.isNaN(Date.parse(owner.processStartedAt)), 'processStartedAt is an ISO time');
    const stub = await stubFor(r);
    const ownerRaw = await fsp.readFile(path.join(`${stub}.lock`, 'owner.json'), 'utf8');
    assert.ok(!ownerRaw.includes(path.basename(path.dirname(r))), 'owner.json never records the locked path (T-01-INFO-03)');

    const timeoutMs = 1500;
    const t0 = Date.now();
    await assert.rejects(withLock(r, async () => 'never', { timeoutMs }), (e: unknown) => {
      assert.ok(e instanceof LockTimeoutError, `expected LockTimeoutError, got ${String(e)}`);
      assert.equal(e.holderPid, holderPid);
      assert.ok(e.message.includes(r), `message names the path: ${e.message}`);
      assert.ok(e.message.includes(`pid ${holderPid}`), `message names the holder PID: ${e.message}`);
      return true;
    });
    const elapsed = Date.now() - t0;
    assert.ok(
      elapsed >= timeoutMs * 0.8 && elapsed <= timeoutMs * 1.2,
      `timeout must fire at timeoutMs ±20% (${timeoutMs * 0.8}–${timeoutMs * 1.2} ms); took ${elapsed} ms`,
    );
  } finally {
    holder.child.kill('SIGKILL');
    await holder.exited;
  }
});

test('RUN-22: a never-releasing in-process holder → queued waiter times out at timeoutMs ±20%', async () => {
  const r = uniqueResource('inproc-forever');
  const hold = await tryAcquire(r);
  try {
    const timeoutMs = 1000;
    const t0 = Date.now();
    const waiters = await Promise.allSettled([
      withLock(r, async () => 1, { timeoutMs }),
      withLock(r, async () => 2, { timeoutMs }),
    ]);
    const elapsed = Date.now() - t0;
    for (const w of waiters) {
      assert.equal(w.status, 'rejected');
      const e = (w as PromiseRejectedResult).reason as unknown;
      assert.ok(e instanceof LockTimeoutError, `expected LockTimeoutError, got ${String(e)}`);
      assert.equal(e.holderPid, process.pid);
      assert.ok(e.message.includes(r));
    }
    assert.ok(elapsed >= timeoutMs * 0.8 && elapsed <= timeoutMs * 1.2, `took ${elapsed} ms`);
  } finally {
    await hold();
  }
  // Timed-out waiters left the queue — the next caller gets the lock at once.
  const t1 = Date.now();
  assert.equal(await withLock(r, async () => 'next', { timeoutMs: 1000 }), 'next');
  assert.ok(Date.now() - t1 < 500, 'the queue is not left blocked by timed-out waiters');
});

test('RUN-22: a lock whose recorded holder was killed (-9) is cleared without waiting for staleMs', async () => {
  const r = uniqueResource('killed');
  const holder = spawnHelper({ RESOURCE: r, HOLD_MS: 'forever' });
  const m = await waitForLine(holder.lines, /^ACQUIRED (\d+) (\d+)$/, 20_000);
  holder.child.kill('SIGKILL');
  await holder.exited;
  const stub = await stubFor(r);
  // The lock directory survives the kill (proper-lockfile's exit handler never ran).
  await fsp.stat(`${stub}.lock`);
  assert.equal((await lockOwner(r))?.pid, Number(m[2]));
  const t0 = Date.now();
  // staleMs is 45 s by default: without dead-holder detection this would time out.
  const v = await withLock(r, async () => 'recovered', { timeoutMs: 5000 });
  assert.equal(v, 'recovered');
  assert.ok(Date.now() - t0 < 2000, `a dead holder is cleared at once (took ${Date.now() - t0} ms)`);
});
