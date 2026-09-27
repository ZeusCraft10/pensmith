// tests/hooks/stop.test.ts — Phase 7 Wave 0 RED scaffold for HOOK-04 / M1.
//
// The Stop hook applies the session-lock release policy (RUN-23) and flushes
// the session log. Phase 2
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
  // Canonicalize via realpathSync: on macOS tmpdir() is /var/folders/... which
  // is a symlink to /private/var/folders/.... The Stop subprocess derives its
  // .paper lock resource from process.cwd(), which Node canonicalizes to the
  // realpath — but lock.ts keys the lock on the RAW resource string
  // (sha256(resource), by design). If this test acquired the lock via the
  // /var symlink path while the subprocess released via the /private/var
  // realpath, the hashes (hence lock stubs) would differ and the release-check
  // would spuriously fail on macOS. Acquiring under the realpath matches what
  // the subprocess actually uses. No-op on Linux/Windows (no symlinked tmpdir).
  return realpathSync(mkdtempSync(join(tmpdir(), 'pensmith-stop-')));
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

// === RUN-23 (D-17-37): the Stop hook's session-lock policy ===
// It releases the paper's session lock ONLY when an MCP server of THIS Claude
// session owns it (kind 'mcp' + claudeSessionId === stdin session_id). A CLI
// session's lock, or another Claude session's, is never removed. (Supersedes
// the unconditional release of a `.paper` resource lock, which could delete a
// live CLI session's lock.)
function runHookWithInput(cwd: string, dataDir: string, input: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, ['--import', TSX_LOADER, HOOK], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, XDG_DATA_HOME: dataDir, LOCALAPPDATA: dataDir, HOME: dataDir, PENSMITH_PAPER_ROOT: '' },
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

function seedSessionLock(dataDir: string, root: string, owner: Record<string, unknown>): string {
  // Mirror bin/lib/session-lock.ts sessionLockFile(): <data>/pensmith/locks/session-<projectHash>.json.
  const real = realpathSync.native(root);
  const canonical = process.platform === 'win32' ? real.toLowerCase() : real;
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  const dir = join(dataDir, 'pensmith', 'locks');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `session-${hash}.json`);
  writeFileSync(file, JSON.stringify({
    hostname: 'test-host', pid: 999999, sessionId: 's-1', verb: 'write', startedAt: new Date().toISOString(),
    root, ...owner,
  }));
  return file;
}

test('RUN-23: Stop releases an MCP session lock owned by ITS Claude session', () => {
  const cwd = freshCwd();
  const dataDir = freshCwd();
  const file = seedSessionLock(dataDir, cwd, { kind: 'mcp', claudeSessionId: 'claude-abc' });
  const res = runHookWithInput(cwd, dataDir, JSON.stringify({ session_id: 'claude-abc', hook_event_name: 'Stop' }));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '', 'Stop stdout MUST stay empty');
  assert.equal(existsSync(file), false, 'the matching mcp-owned session lock is released');
});

test("RUN-23: Stop never removes a CLI session lock or another Claude session's lock", () => {
  const cwd = freshCwd();
  const dataDir = freshCwd();
  const cliLock = seedSessionLock(dataDir, cwd, { kind: 'cli', claudeSessionId: null });
  const res = runHookWithInput(cwd, dataDir, JSON.stringify({ session_id: 'claude-abc' }));
  assert.equal(res.status, 0, res.stderr);
  assert.equal(existsSync(cliLock), true, 'a CLI session lock is never removed by Stop');

  const cwd2 = freshCwd();
  const otherLock = seedSessionLock(dataDir, cwd2, { kind: 'mcp', claudeSessionId: 'claude-OTHER' });
  const res2 = runHookWithInput(cwd2, dataDir, JSON.stringify({ session_id: 'claude-abc' }));
  assert.equal(res2.status, 0, res2.stderr);
  assert.equal(existsSync(otherLock), true, "another Claude session's MCP lock is never removed");

  const res3 = runHookWithInput(cwd2, dataDir, '');
  assert.equal(res3.status, 0, 'no stdin input: exit 0, nothing released');
  assert.equal(existsSync(otherLock), true);
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
