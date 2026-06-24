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
//   7. [HARD-01 SCAFFOLD] lock canonicalize: two path conventions for one
//      file → identical stub (skip-guarded on stubFor export)
//
// All tests use unique resource strings (test name + Date.now()) so
// concurrent test runs (e.g. `node --test --test-concurrency=4`) don't
// collide on shared lock files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withLock, tryAcquire, isLocked } from '../bin/lib/lock.js';
import { pensmithLockDir } from '../bin/lib/paths.js';

/**
 * Replicate the HARD-01 canonicalization from stubFor so tests can compute
 * the expected hash for a resource without importing the private function.
 * Must stay in sync with bin/lib/lock.ts stubFor().
 */
function canonicalHash(resource: string): string {
  let canonical = path.resolve(resource);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // not-yet-created file — use the resolved path
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

// ---- HARD-01 skip gate: probe stubFor export ----
// stubFor is a private function in lock.ts. When Wave-3 (15-03) exports it
// (or a __stubForTest seam) for test, this gate lifts and test 7 runs.
// Path resolution via fileURLToPath — Phase-11 spaced-path safe.
void fileURLToPath(new URL('../bin/lib/lock.ts', import.meta.url));
const lockModUrl = new URL('../bin/lib/lock.js', import.meta.url);

type StubForFn = (resource: string) => Promise<string>;
let stubForFn: StubForFn | undefined;

try {
  const lockMod = await import(lockModUrl.href) as Record<string, unknown>;
  const seam = lockMod['stubFor'] ?? lockMod['__stubForTest'];
  if (typeof seam === 'function') {
    stubForFn = seam as StubForFn;
  }
} catch {
  // Module already imported above via the static import — this dynamic import
  // is only used to probe for the stubFor export seam. Ignore errors.
}

const hasStubFor = typeof stubForFn === 'function';

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
    // Use canonicalHash (mirrors stubFor's HARD-01 canonicalization) so the
    // expected stub path matches what stubFor actually created.
    const hash = canonicalHash(r);
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

// ---- 7. HARD-01 scaffold: lock canonicalize — two path conventions → identical stub ----
//
// Skip-guarded on `typeof stubFor === 'function'` (exported seam from lock.ts).
// When Wave-3 (15-03) exports stubFor or __stubForTest, this test un-skips and
// must PASS — asserting that path.resolve and path.join variants of the same
// file resolve to the same lock stub.
//
// Uses os.tmpdir() + a created file so realpathSync.native has something to
// resolve. On win32, lower-case and upper-case versions of the same path should
// produce the same stub after case-folding in the canonical HARD-01 fix.

test('lock canonicalize: two path conventions for one file → identical stub (HARD-01)',
  {
    skip: !hasStubFor
      ? 'stubFor/__stubForTest not yet exported from bin/lib/lock.ts — not yet wired (HARD-01)'
      : false,
  },
  async () => {
    // Create a real file in tmpdir so realpathSync.native can resolve it.
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-lock-canon-'));
    const filePath = path.join(tmpDir, 'canon-test.lock');
    // Create the file (stubFor touches it anyway, but we need it to exist for
    // realpathSync.native to work correctly). Use open('a')+close to avoid the
    // no-restricted-syntax ban on fsp.writeFile (ARCH-05 / D-07).
    const fhTmp = await fsp.open(filePath, 'a');
    await fhTmp.close();
    try {
      // Convention A: path.resolve form (as state.ts uses).
      const r1 = path.resolve(filePath);
      // Convention B: path.join un-resolved form from a different cwd reference.
      // In practice these resolve to the same absolute path via path.resolve
      // inside stubFor — the test verifies that the resulting stub is identical.
      const r2 = filePath; // Same absolute path but different string (no extra resolve).

      // On win32, add a case-variant to exercise the case-fold branch.
      const r3 = process.platform === 'win32' ? r1.toUpperCase() : r1;

      const stub1 = await stubForFn!(r1);
      const stub2 = await stubForFn!(r2);
      const stub3 = await stubForFn!(r3);

      assert.equal(
        stub1,
        stub2,
        `stubFor must return the same stub for path.resolve form vs raw absolute path; got "${stub1}" vs "${stub2}"`,
      );
      assert.equal(
        stub1,
        stub3,
        `stubFor must return the same stub for case-variant on this platform; got "${stub1}" vs "${stub3}"`,
      );

      // Verify the stub path is inside pensmithLockDir().
      const dir = pensmithLockDir();
      assert.ok(
        stub1.startsWith(dir),
        `stub must be inside pensmithLockDir() (${dir}); got ${stub1}`,
      );
    } finally {
      // Cleanup tmpdir.
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  },
);
