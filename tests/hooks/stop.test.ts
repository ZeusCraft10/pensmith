// tests/hooks/stop.test.ts — the Stop hook bundle (PLUG-14, RUN-23, D-17-37;
// HOOK-04 / M1 / C2-M2), spawned as Claude Code runs it: `node plugin/dist/
// hooks/stop.mjs` with the documented stdin JSON.
//
// The session-lock policy: Stop releases the paper's session lock ONLY when
// the pensmith MCP server of THIS Claude session left it behind (owner kind
// 'mcp', claudeSessionId === stdin session_id, and the server process no
// longer running). A lock held by a running CLI session (a live process that
// took it through session-lock.ts, as `pensmith write` does), a lock a live
// server holds for a call still in flight (review round 3: an interrupted
// pensmith_write keeps drafting after the turn's Stop), another Claude
// session's lock, or a call without a session id leaves the lock in place.
// The hook prints nothing and always exits 0, also when there is nothing to
// release (the session-log flush still runs: Promise.allSettled, M1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSessionLock, sessionLockFile, type SessionOwner } from '../../bin/lib/session-lock.js';
import { REPO, sandbox, type Sandbox } from '../helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { assertBundlesPresent, hookInput, runHook } from './hook-runner.js';

assertBundlesPresent();

const TSX = import.meta.resolve('tsx');
const SESSION_LOCK = pathToFileURL(join(REPO, 'bin', 'lib', 'session-lock.ts')).href;

/**
 * A live process holding the paper's session lock through session-lock.ts —
 * the record `pensmith write` (kind 'cli') or the plugin's MCP server during a
 * tool call (kind 'mcp') writes. Resolves once the lock is held.
 */
async function holdLock(sb: Sandbox, root: string, kind: 'cli' | 'mcp', claudeSessionId: string | null): Promise<ChildProcess> {
  const script =
    `const m = await import(${JSON.stringify(SESSION_LOCK)});\n` +
    `await m.acquireSessionLock(${JSON.stringify(root)}, { kind: ${JSON.stringify(kind)}, verb: 'write', claudeSessionId: ${JSON.stringify(claudeSessionId)} });\n` +
    `process.stdout.write('held\\n');\n` +
    'setInterval(() => {}, 1000);\n';
  const child = spawn(process.execPath, ['--import', TSX, '--input-type=module', '-e', script], {
    cwd: root,
    env: sb.env(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr?.on('data', (c: Buffer) => {
    err += String(c);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lock holder did not start: ${err}`)), 30_000);
    child.stdout?.on('data', (c: Buffer) => {
      if (String(c).includes('held')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`lock holder exited ${code}: ${err}`));
    });
  });
  return child;
}

function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill(signal);
  });
}

/**
 * Kill the holder so its release never runs (SIGKILL: no exit handler) — the
 * lock a crashed or killed MCP server leaves behind.
 */
function crash(child: ChildProcess): Promise<void> {
  return stop(child, 'SIGKILL');
}

/** The lock record as the hook and the holder see it (the same isolated data dir). */
function lockOf(sb: Sandbox, root: string): SessionOwner | null {
  return inSandbox(sb, () => readSessionLock(root));
}

function lockFileOf(sb: Sandbox, root: string): string {
  return inSandbox(sb, () => sessionLockFile(root));
}

/** Run `fn` with this process's data-dir variables pointing at the sandbox's (where the hook and the holder lock). */
function inSandbox<T>(sb: Sandbox, fn: () => T): T {
  const keys = ['XDG_DATA_HOME', 'LOCALAPPDATA', 'HOME'] as const;
  const prev = keys.map((k) => process.env[k]);
  for (const k of keys) process.env[k] = sb.data;
  try {
    return fn();
  } finally {
    keys.forEach((k, i) => {
      const v = prev[i];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

test('PLUG-14 / RUN-23: Stop leaves a lock held by a running CLI session in place', async () => {
  const sb = sandbox('hook-stop-cli');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const cli = await holdLock(sb, root, 'cli', null);
  try {
    const owner = lockOf(sb, root);
    assert.equal(owner?.kind, 'cli');
    assert.equal(owner?.pid, cli.pid);
    const r = runHook(sb, 'stop', { cwd: root, input: hookInput('stop', root, { session_id: 'claude-abc' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', 'Stop prints nothing on stdout');
    assert.deepEqual(lockOf(sb, root), owner, 'the CLI session keeps its lock');
  } finally {
    await stop(cli);
  }
});

test('PLUG-14 / RUN-23 (review round 3): Stop keeps the lock of this Claude session\'s MCP server while its call is in flight', async () => {
  const sb = sandbox('hook-stop-mcp-live');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const server = await holdLock(sb, root, 'mcp', 'claude-abc');
  try {
    const owner = lockOf(sb, root);
    assert.equal(owner?.claudeSessionId, 'claude-abc');
    // The turn ends (Esc, or a background subagent's call still running) while
    // the server is inside a pensmith_write: its record must stay, or a CLI
    // verb could start on the paper beside it.
    for (const input of [hookInput('stop', root, { session_id: 'claude-abc' }), hookInput('stop', root, { session_id: 'claude-OTHER' }), '']) {
      const r = runHook(sb, 'stop', { cwd: root, input });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.deepEqual(lockOf(sb, root), owner, `kept for ${JSON.stringify(input).slice(0, 60)}`);
    }
  } finally {
    await stop(server);
  }
});

test('PLUG-14 / RUN-23: Stop releases the lock this Claude session\'s MCP server left behind, and only that one', async () => {
  const sb = sandbox('hook-stop-mcp');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const server = await holdLock(sb, root, 'mcp', 'claude-abc');
  await crash(server);
  assert.equal(lockOf(sb, root)?.claudeSessionId, 'claude-abc', 'the killed server left its record behind');
  // Another Claude session's Stop, and a Stop without a session id, leave it.
  for (const input of [hookInput('stop', root, { session_id: 'claude-OTHER' }), hookInput('stop', root, { session_id: undefined }), '']) {
    const r = runHook(sb, 'stop', { cwd: root, input });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lockOf(sb, root)?.kind, 'mcp', `kept for ${JSON.stringify(input).slice(0, 60)}`);
  }
  const r = runHook(sb, 'stop', { cwd: root, input: hookInput('stop', root, { session_id: 'claude-abc' }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(lockOf(sb, root), null, 'this session\'s left-behind MCP lock is released');
  assert.equal(existsSync(lockFileOf(sb, root)), false);
});

test('PLUG-14 / RUN-23: Stop finds the lock whichever spelling of the paper folder it is given', async () => {
  const sb = sandbox('hook-stop-spelling');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const link = join(sb.base, 'paper-link');
  symlinkSync(root, link, 'junction');
  const elsewhere = sb.project('elsewhere');
  const cases: Array<{ cwd: string; input: Record<string, unknown>; env: Record<string, string> }> = [
    { cwd: link, input: hookInput('stop', link, { session_id: 'claude-abc' }), env: {} },
    { cwd: elsewhere, input: hookInput('stop', elsewhere, { session_id: 'claude-abc' }), env: { PENSMITH_PAPER_ROOT: link } },
  ];
  for (const c of cases) {
    const server = await holdLock(sb, root, 'mcp', 'claude-abc');
    await crash(server);
    assert.ok(lockOf(sb, root), 'the killed server left its record behind');
    const r = runHook(sb, 'stop', { cwd: c.cwd, input: c.input, env: c.env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lockOf(sb, root), null, `released via ${c.env['PENSMITH_PAPER_ROOT'] ? 'PENSMITH_PAPER_ROOT' : 'the symlinked cwd'}`);
  }
});

test('HOOK-04 / M1: with no lock to release Stop still exits 0 with empty stdout (the flush runs regardless)', async () => {
  const sb = sandbox('hook-stop-none');
  const root = sb.project('paper');
  mkdirSync(join(root, '.paper'), { recursive: true });
  await seedThreeSectionPaper(root);
  const r = runHook(sb, 'stop', { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.doesNotMatch(r.stderr, /UnhandledPromiseRejection|Error:/);
});
