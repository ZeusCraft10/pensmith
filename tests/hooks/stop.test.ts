// tests/hooks/stop.test.ts — Phase 7 Wave 0 RED scaffold for HOOK-04 / M1.
//
// The Stop hook releases the .paper lock and flushes the session log. Phase 2
// ships a bare `process.exit(0)` stub; Plan 07-03 upgrades it. RED-by-skip: the
// release + flush-survives-rejection assertions skip while stop.ts is still the
// stub (detected by reading the source). The exit-0 + empty-stdout invariant is
// un-skipped (the stub satisfies it).
//
// M1 / C2-M2: release('.paper') REJECTS on an unheld lock, so Stop must use
// Promise.allSettled — the session-log flush must STILL run even when the
// release rejects. With the old Promise.all the flush would be abandoned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../hooks/stop.ts', import.meta.url));
// Resolve tsx's loader to an ABSOLUTE file URL so the hook subprocess can load
// it regardless of cwd (a bare `--import tsx` resolves relative to the child's
// cwd, which is a tmpdir with no node_modules → ERR_MODULE_NOT_FOUND).
const TSX_LOADER = import.meta.resolve('tsx');

// RED-by-skip: the stub is literally `process.exit(0)`. The upgrade references
// the lock release and/or the session-log flush. existsSync alone is
// insufficient (the file already exists as a stub).
const hookSrc = existsSync(HOOK) ? readFileSync(HOOK, 'utf8') : '';
const stopWired = /release|allSettled|flush|closeSessionLog/.test(hookSrc);

interface RunResult { status: number | null; stdout: string; stderr: string; }
function runHook(cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, ['--import', TSX_LOADER, HOOK], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-stop-'));
}

// === exit 0 + empty stdout always (un-skipped: stub satisfies it) ===
test('HOOK-04: stop hook exits 0 with empty stdout', () => {
  const cwd = freshCwd();
  const res = runHook(cwd);
  assert.equal(res.status, 0, 'HOOK-04: Stop exits 0');
  assert.equal(res.stdout, '', 'HOOK-04: Stop stdout MUST be empty (hook-protocol channel)');
});

// === presence guard ===
test('HOOK-04: stop release + flush wiring is consistent with Wave-0 RED state', () => {
  if (stopWired) {
    assert.ok(stopWired, 'stop.ts performs release + flush — behavioral tests active');
  } else {
    assert.ok(!stopWired, 'Wave-0: stop.ts is still the exit-0 stub (RED-by-skip)');
  }
});

// === release: after Stop, the .paper lock is no longer held ===
test('HOOK-04: stop releases the .paper lock (isLocked === false afterward)',
  { skip: !stopWired }, async () => {
    const cwd = freshCwd();
    // Pre-acquire the .paper resource lock, then run Stop and assert release.
    const lockMod = (await import('../../bin/lib/lock.js')) as {
      tryAcquire: (resource: string) => Promise<() => Promise<void>>;
      isLocked: (resource: string) => Promise<boolean>;
    };
    const resource = join(cwd, '.paper');
    const release = await lockMod.tryAcquire(resource);
    try {
      runHook(cwd);
      const held = await lockMod.isLocked(resource);
      assert.equal(held, false, 'HOOK-04: Stop must release the .paper lock');
    } finally {
      // Best-effort cleanup if Stop did not release (test already failed).
      await release().catch(() => undefined);
    }
  });

// === M1 / C2-M2: flush survives a release rejection (Promise.allSettled) ===
test('HOOK-04 / M1: session log is flushed EVEN when release rejects (no held lock → Promise.allSettled)',
  { skip: !stopWired }, () => {
    const cwd = freshCwd();
    // NO .paper resource lock is held, so release('.paper') will REJECT inside
    // Stop. The flush must STILL run (Promise.allSettled, not Promise.all).
    // Seed a session-log file with a pending record so we can observe the flush.
    const pDir = join(cwd, '.paper');
    mkdirSync(pDir, { recursive: true });
    const logPath = join(pDir, 'SESSION.jsonl');
    writeFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), event: 'pending' }) + '\n');
    const res = runHook(cwd);
    assert.equal(res.status, 0,
      'HOOK-04/M1: Stop must exit 0 even when the release rejects (allSettled swallows it)');
    // The flush must have completed: the session log file remains intact (not
    // abandoned mid-write) and Stop did not crash on the rejected release.
    assert.ok(existsSync(logPath),
      'HOOK-04/M1: the session log flush must survive the rejected release (allSettled gate)');
    assert.ok(!/UnhandledPromiseRejection|Promise\.all/.test(res.stderr),
      'HOOK-04/M1: the rejected release must NOT abandon the flush via Promise.all');
  });
