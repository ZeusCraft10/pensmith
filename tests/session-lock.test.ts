// tests/session-lock.test.ts — RUN-23 (D-17-37): a per-paper session lock with
// a real owner record. A second mutating session refuses with the holder's PID
// and start time; read-only verbs never take it; a dead holder (kill -9) or a
// record older than 6 h is cleared with a notice; our own PID re-enters; MCP
// tool calls take it per call with per-section sub-locks (different sections
// run in parallel, the same section serializes); a mutating MCP tool refuses
// during a CLI session with no file change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';
import { staleReason, STALE_SESSION_MS, type SessionOwner } from '../bin/lib/session-lock.js';
import {
  REPO,
  MCP_BIN,
  sandbox,
  runCli,
  runLibScript,
  lastJson,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  snapshot,
  changedPaths,
  type Sandbox,
} from './helpers/paper-cli-harness.js';

const TSX_LOADER = import.meta.resolve('tsx');
const IGNORE_LOGS = /^\.paper[\\/](SESSION\.log|sessions)/;
// The lock is taken by a write; it drafts without the chained verify, whose
// verdict on a PENSMITH_NO_LLM stub draft is PLACEHOLDER (VRFY-24, exit 4).
const WRITE_1 = ['write', '1', '--no-verify'];

function paperWithSection(sb: Sandbox, name: string): string {
  const root = sb.project(name);
  writeState(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'body' }, { n: 3, slug: 'end' }]);
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeOutline(root, [{ n: 1, slug: 'intro' }, { n: 2, slug: 'body' }, { n: 3, slug: 'end' }]);
  writePlan(root, 1, 'intro', { status: 'writing' });
  writePlan(root, 2, 'body', { status: 'writing' });
  writePlan(root, 3, 'end', { status: 'writing' });
  return root;
}

interface Holder {
  child: ChildProcess;
  pid: number;
  file: string;
}

/** Spawn a process that takes the paper's session lock and keeps it. */
async function holdLock(sb: Sandbox, root: string, kind: 'cli' | 'mcp', claude?: string): Promise<Holder> {
  const script = join(REPO, 'tests', 'fixtures', 'paper-cli', 'hold-session.ts');
  const child = spawn(process.execPath, ['--import', TSX_LOADER, script, root, kind, ...(claude ? [claude] : [])], {
    env: sb.env(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let err = '';
  child.stderr?.on('data', (c: Buffer) => { err += c.toString(); });
  return new Promise<Holder>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`holder did not take the lock: ${err}`)), 20_000);
    child.stdout?.on('data', (c: Buffer) => {
      buf += c.toString();
      // Complete lines only: the text after the last newline may be the first
      // chunk of a line still arriving, and parsing it would throw.
      const line = buf.split('\n').slice(0, -1).find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      const parsed = JSON.parse(line) as { pid: number; file: string };
      resolve({ child, pid: parsed.pid, file: parsed.file });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`holder exited ${String(code)}: ${err}`));
    });
  });
}

async function release(h: Holder): Promise<void> {
  if (h.child.exitCode !== null || h.child.signalCode !== null) return;
  const exited = new Promise<void>((r) => h.child.once('exit', () => r()));
  h.child.stdin?.write('release\n');
  await exited;
}

async function kill9(h: Holder): Promise<void> {
  const exited = new Promise<void>((r) => h.child.once('exit', () => r()));
  h.child.kill('SIGKILL');
  await exited;
}

test('RUN-23: while another session holds the paper, `write 1` refuses with the holder PID; status still works', async () => {
  const sb = sandbox('lock-holder');
  const root = paperWithSection(sb, 'p');
  const holder = await holdLock(sb, root, 'cli');
  try {
    const before = snapshot(root);
    const w = runCli(sb, root, WRITE_1);
    assert.equal(w.status, EXIT_ERROR, `${w.stdout}\n${w.stderr}`);
    assert.match(
      w.stderr,
      new RegExp(`^pensmith: another pensmith session \\(pid ${holder.pid}, started \\d{4}-\\d{2}-\\d{2}T[^)]+\\) is working on this paper; run pensmith resume once it ends$`, 'm'),
    );
    assert.ok(!existsSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md')), 'section 1 was not written');
    assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'a refused session changes nothing');

    for (const readOnly of [['status'], ['list'], ['--estimate']]) {
      const r = runCli(sb, root, readOnly);
      assert.doesNotMatch(r.stderr, /another pensmith session/, `${readOnly.join(' ')} does not take the lock`);
    }
  } finally {
    await release(holder);
  }
  assert.ok(!existsSync(holder.file), 'the holder removed its record on release');
  const after = runCli(sb, root, WRITE_1);
  assert.equal(after.status, 0, `once the holder ends, write works: ${after.stderr}`);
  assert.ok(!existsSync(holder.file), 'the CLI releases the lock when it exits');
});

test('RUN-23: after kill -9 of the holder, the next run prints "cleared stale lock" and proceeds', async () => {
  const sb = sandbox('lock-stale');
  const root = paperWithSection(sb, 'p');
  const holder = await holdLock(sb, root, 'cli');
  await kill9(holder);
  assert.ok(existsSync(holder.file), 'a killed holder leaves its record behind');
  const r = runCli(sb, root, WRITE_1);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, new RegExp(`^pensmith: cleared stale lock \\(pid ${holder.pid}, started [^)]+\\) — process not running\\.$`, 'm'));
  assert.ok(existsSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md')));
});

test('RUN-23: a record older than 6 h is stale; a young record from another host is not', async () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  const base: SessionOwner = {
    hostname: hostname(), pid: process.pid, sessionId: 's', kind: 'cli', verb: 'write',
    startedAt: new Date(now - STALE_SESSION_MS - 60_000).toISOString(), claudeSessionId: null, root: '/x',
  };
  assert.equal(staleReason(base, now), 'older than 6 h');
  assert.equal(staleReason({ ...base, startedAt: new Date(now - 60_000).toISOString() }, now), null, 'young + live pid');
  assert.equal(staleReason({ ...base, hostname: 'another-host', pid: 1, startedAt: new Date(now - 60_000).toISOString() }, now), null);

  // Through the CLI: an old record held by a LIVE process (this test) is cleared.
  const sb = sandbox('lock-old');
  const root = paperWithSection(sb, 'p');
  const acquire = lastJson<{ ok: boolean; result: { lockAfter: boolean } }>(runLibScript(sb, 'session-ops.ts', ['acquire', root]));
  assert.ok(acquire.ok && acquire.result.lockAfter === false);
  const holder = await holdLock(sb, root, 'cli');
  await kill9(holder);
  const rec = JSON.parse(readFileSync(holder.file, 'utf8')) as SessionOwner;
  writeFileSync(holder.file, JSON.stringify({ ...rec, pid: process.pid, startedAt: new Date(Date.now() - STALE_SESSION_MS - 60_000).toISOString() }));
  const r = runCli(sb, root, WRITE_1);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /cleared stale lock \(pid \d+, started [^)]+\) — older than 6 h\./);

  // A young record from another host is honoured (its PID cannot be checked here).
  mkdirSync(join(holder.file, '..'), { recursive: true });
  writeFileSync(holder.file, JSON.stringify({ ...rec, hostname: 'another-host', pid: 424242, startedAt: new Date().toISOString() }));
  const refused = runCli(sb, root, WRITE_1);
  assert.equal(refused.status, EXIT_ERROR);
  assert.match(refused.stderr, /another pensmith session \(pid 424242,/);
});

test('RUN-23: our own PID re-enters; the record goes when the last hold is released', () => {
  const sb = sandbox('lock-reentrant');
  const root = paperWithSection(sb, 'p');
  const r = lastJson<{ ok: boolean; result: { sameFile: boolean; afterFirstRelease: boolean; afterSecondRelease: boolean } }>(
    runLibScript(sb, 'session-ops.ts', ['reentrant', root]),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.result, { sameFile: true, afterFirstRelease: true, afterSecondRelease: false });
});

test('RUN-23: two same-process acquisitions started together share one hold — releasing the first keeps the lock', () => {
  const sb = sandbox('lock-parallel-acquire');
  const root = paperWithSection(sb, 'p');
  const r = lastJson<{
    ok: boolean;
    result: {
      bothAcquired: boolean;
      afterFirstRelease: { file: boolean; owner: boolean };
      afterSecondRelease: { file: boolean; owner: boolean };
    };
  }>(runLibScript(sb, 'session-ops.ts', ['parallel-acquire', root]));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.bothAcquired, true);
  assert.deepEqual(r.result.afterFirstRelease, { file: true, owner: true }, 'the second call still holds the paper');
  assert.deepEqual(r.result.afterSecondRelease, { file: false, owner: false }, 'released with the last hold');
});

test('RUN-23: MCP-style calls — 3 different sections run in parallel, 2 writes to one section serialize', () => {
  const sb = sandbox('lock-mcp-parallel');
  const root = paperWithSection(sb, 'p');
  type Span = { n: number; start: number; end: number; ownerKind: string | null; ownerPid: number | null };
  const par = lastJson<{ ok: boolean; result: { pid: number; spans: Span[]; lockAfter: boolean } }>(
    runLibScript(sb, 'session-ops.ts', ['parallel', root, '1,2,3', '400']),
  );
  assert.ok(par.ok, JSON.stringify(par));
  const spans = par.result.spans;
  assert.equal(spans.length, 3);
  const latestStart = Math.max(...spans.map((s) => s.start));
  const earliestEnd = Math.min(...spans.map((s) => s.end));
  assert.ok(latestStart < earliestEnd, `different sections overlap in time (parallel): ${JSON.stringify(spans)}`);
  for (const s of spans) {
    assert.equal(s.ownerKind, 'mcp', 'the session record is mcp-owned');
    assert.equal(s.ownerPid, par.result.pid, 're-entrant within the server PID');
  }
  assert.equal(par.result.lockAfter, false, 'released after the last call');

  const same = lastJson<{ ok: boolean; result: { spans: Span[] } }>(runLibScript(sb, 'session-ops.ts', ['parallel', root, '2,2', '400']));
  assert.ok(same.ok, JSON.stringify(same));
  const [a, b] = [...same.result.spans].sort((x, y) => x.start - y.start);
  assert.ok(a && b && b.start >= a.end, `same-section calls serialize: ${JSON.stringify(same.result.spans)}`);
});

test('RUN-23: a mutating MCP tool during a CLI session is a structured refusal and changes no file', async () => {
  const sb = sandbox('lock-mcp-refusal');
  const root = paperWithSection(sb, 'p');
  const holder = await holdLock(sb, root, 'cli');
  const before = snapshot(root);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: sb.env({ PENSMITH_PAPER_ROOT: root }),
    cwd: root,
  });
  const client = new Client({ name: 'session-lock-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'pensmith_write', arguments: { n: 1, yolo: true } });
    assert.equal(res.isError, true, 'refused');
    const body = JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? '{}') as { exit_code: number; classification: string; message: string };
    assert.equal(body.exit_code, EXIT_ERROR);
    assert.equal(body.classification, 'EXIT_ERROR');
    assert.match(body.message, new RegExp(`another pensmith session \\(pid ${holder.pid},`));
    const init = await client.callTool({ name: 'paper_init_section', arguments: { paperRoot: root, n: 9, slug: 'extra' } });
    assert.equal(init.isError, true, 'every mutating tool refuses');
    // A `.paper` path names the same paper (asProjectRoot): it keys the SAME
    // session lock, so it is refused too — never a second, unlocked route in.
    for (const [name, args] of [
      ['paper_init_section', { n: 9, slug: 'extra' }],
      ['paper_set_status', { n: 1, status: 'in-progress' }],
      ['paper_advance_section', { n: 1, toState: 'writing' }],
      ['paper_record_verification', { n: 1, verdict: 'PASS' }],
    ] as const) {
      const res = await client.callTool({ name, arguments: { paperRoot: join(root, '.paper'), ...args } });
      assert.equal(res.isError, true, `${name} with <root>/.paper is refused under the CLI session`);
      const body = JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? '{}') as { message: string };
      assert.match(body.message, new RegExp(`another pensmith session \\(pid ${holder.pid},`));
    }
    // Read-only resources still work during the CLI session.
    const state = await client.readResource({ uri: 'paper://state' });
    assert.ok(state.contents.length > 0);
  } finally {
    await client.close();
    await release(holder);
  }
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'no file changed');
});
