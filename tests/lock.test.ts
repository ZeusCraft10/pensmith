// tests/lock.test.ts — functional + cross-process tests for bin/lib/lock.ts
// (ARCH-06 / D-26 / TEST-07).
//
// Coverage:
//   1. withLock returns inner value
//   2. withLock releases on inner throw (try/finally)
//   3. tryAcquire / release / isLocked roundtrip
//   4. same-process serialization (two parallel withLock calls)
//   5. cross-process spawn conflict (TEST-07 — the high-value case)
//   6. lock files live in pensmithLockDir(), NOT inside .paper/ (D-40)
//
// All tests use unique resource strings (test name + Date.now()) so
// concurrent test runs (e.g. `node --test --test-concurrency=4`) don't
// collide on shared lock files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { withLock, tryAcquire, isLocked } from '../bin/lib/lock.js';
import { pensmithLockDir } from '../bin/lib/paths.js';

// ---- 1. withLock returns inner value ----

test('withLock returns inner value', async () => {
  const v = await withLock('test:rv:' + Date.now() + ':' + Math.random(), async () => 42);
  assert.equal(v, 42);
});

// ---- 2. withLock releases on inner throw ----

test('withLock releases the lock when fn throws (try/finally)', async () => {
  const r = 'test:throw:' + Date.now() + ':' + Math.random();
  await assert.rejects(
    withLock(r, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  // Lock must be released after the inner throw — isLocked() returns false.
  assert.equal(await isLocked(r), false, 'lock must be released after inner throw');
});

// ---- 3. tryAcquire / release / isLocked roundtrip ----

test('tryAcquire / release / isLocked roundtrip', async () => {
  const r = 'test:try:' + Date.now() + ':' + Math.random();
  assert.equal(await isLocked(r), false, 'fresh resource must be unlocked');
  const releaseFn = await tryAcquire(r);
  assert.equal(await isLocked(r), true, 'isLocked must be true while held');
  await releaseFn();
  assert.equal(await isLocked(r), false, 'isLocked must be false after release');
});

// ---- 4. same-process serialization ----

test('serialized within same process — second withLock waits for first', async () => {
  const r = 'test:serial:' + Date.now() + ':' + Math.random();
  const order: string[] = [];
  const a = withLock(r, async () => {
    order.push('A-start');
    await new Promise((res) => setTimeout(res, 150));
    order.push('A-end');
    return 'a';
  });
  // Tiny delay to ensure A starts first; not load-bearing — proper-lockfile's
  // mkdir-then-rename would still serialize correctly even if both raced
  // exactly here, but ordering A-then-B in the assertion is cleaner.
  await new Promise((res) => setTimeout(res, 20));
  const b = withLock(r, async () => {
    order.push('B-start');
    return 'b';
  });
  const [va, vb] = await Promise.all([a, b]);
  assert.equal(va, 'a');
  assert.equal(vb, 'b');
  assert.deepEqual(
    order,
    ['A-start', 'A-end', 'B-start'],
    `expected B to start after A ended; got ${order.join(',')}`,
  );
});

// ---- 5. cross-process spawn conflict (TEST-07) ----

test('cross-process: child holds, parent waits (TEST-07)', async () => {
  const r = 'test:xp:' + Date.now() + ':' + Math.random();
  const helper = path.resolve('tests/lock-conflict.cjs');
  const HOLD_MS = 1500;
  const child = spawn(process.execPath, [helper], {
    env: { ...process.env, RESOURCE: r, HOLD_MS: String(HOLD_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let childAcquiredAt = 0;
  let childReleasingAt = 0;
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    const line = chunk.toString();
    const ackd = line.match(/ACQUIRED (\d+)/);
    if (ackd) childAcquiredAt = parseInt(ackd[1] ?? '0', 10);
    const rel = line.match(/RELEASING (\d+)/);
    if (rel) childReleasingAt = parseInt(rel[1] ?? '0', 10);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // Wait for child to acquire (poll its stdout signal). 5s upper bound is
  // generous — Node startup on warm CI is ~200ms.
  await new Promise<void>((res, rej) => {
    const startedAt = Date.now();
    const i = setInterval(() => {
      if (childAcquiredAt) {
        clearInterval(i);
        res();
      } else if (Date.now() - startedAt > 5000) {
        clearInterval(i);
        rej(new Error(`child failed to ACQUIRE within 5s; stderr=${stderr}`));
      }
    }, 50);
  });

  // Parent attempts to acquire — must wait for child to release.
  const parentStart = Date.now();
  const v = await withLock(r, async () => 'parent', { timeoutMs: 10_000, staleMs: 45_000 });
  const parentAcquiredAt = Date.now();
  assert.equal(v, 'parent');

  // Parent should have waited at least HOLD_MS - slack since the child
  // started a bit before we measured parentStart. We allow 500ms slack to
  // absorb the gap between child ACQUIRED and parentStart on slow CI.
  const waitMs = parentAcquiredAt - parentStart;
  assert.ok(
    waitMs >= HOLD_MS - 500,
    `parent should have waited ~${HOLD_MS}ms; actually waited ${waitMs}ms (childAcquiredAt=${childAcquiredAt}, childReleasingAt=${childReleasingAt}, parentStart=${parentStart}, parentAcquiredAt=${parentAcquiredAt})`,
  );

  // Drain child cleanly.
  await new Promise<void>((res) => {
    if (child.exitCode !== null) {
      res();
    } else {
      child.on('exit', () => res());
    }
  });
});

// ---- 6. lock-file location: pensmithLockDir(), NOT .paper/ (D-40) ----

test('lock file lives in pensmithLockDir() and NOT inside .paper/', async () => {
  const r = 'test:dir:' + Date.now() + ':' + Math.random();
  const releaseFn = await tryAcquire(r);
  try {
    const dir = pensmithLockDir();
    const hash = createHash('sha256').update(r).digest('hex').slice(0, 12);
    // proper-lockfile creates `${stub}.lock` alongside the stub. Either
    // the stub or the .lock file existing inside pensmithLockDir() is
    // proof that the lock landed in the right place.
    const lockEntry = path.join(dir, hash + '.lock');
    const stubEntry = path.join(dir, hash);
    const lockExists = await fsp
      .stat(lockEntry)
      .then(() => true)
      .catch(() => false);
    const stubExists = await fsp
      .stat(stubEntry)
      .then(() => true)
      .catch(() => false);
    assert.ok(
      lockExists || stubExists,
      `expected stub or .lock under ${dir} for resource hash ${hash}`,
    );

    // Defensive: scan the project's .paper/ (if it exists) for any *.lock
    // files. There must be none — D-40 says locks NEVER go in-tree.
    const paperPath = path.resolve('.paper');
    const paperExists = await fsp
      .stat(paperPath)
      .then(() => true)
      .catch(() => false);
    if (paperExists) {
      const collected: string[] = [];
      async function walk(d: string): Promise<void> {
        const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            await walk(full);
          } else if (e.name.endsWith('.lock')) {
            collected.push(full);
          }
        }
      }
      await walk(paperPath);
      assert.deepEqual(
        collected,
        [],
        `D-40 violation: found .lock files inside .paper/: ${collected.join(', ')}`,
      );
    }
  } finally {
    await releaseFn();
  }
});
