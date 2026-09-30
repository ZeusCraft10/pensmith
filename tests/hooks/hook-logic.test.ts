// tests/hooks/hook-logic.test.ts — the hook logic modules in bin/lib/hooks/
// (PLUG-14, D-23a-15), unit-tested in-process: the stdin reader (bounded in
// time and size, TTY and garbage tolerant), the paper resolution every entry
// shares, and the SessionStart / PreCompact / PostToolUse / Stop functions
// with injected time. The acceptance tests spawn the committed bundles
// (tests/hooks/{session-start,pre-compact,post-tool-use,stop}.test.ts); the
// last case here spawns the TypeScript entries under tsx and checks that they
// behave exactly like their bundles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookInputCwd, parseHookInput, readHookInput, HOOK_STDIN_MAX_BYTES, type HookStdin } from '../../bin/lib/hooks/stdin.js';
import { hookPaperRoot } from '../../bin/lib/hooks/entry.js';
import { buildSessionStartContext, sessionStartOutput } from '../../bin/lib/hooks/session-start.js';
import { collectSectionPointers, readBreadcrumbs, writePreCompactHandoff } from '../../bin/lib/hooks/pre-compact.js';
import { checkpointFile, recordCheckpoint, CHECKPOINT_KEEP_LINES, CHECKPOINT_MAX_BYTES } from '../../bin/lib/hooks/post-tool-use.js';
import { stopHook } from '../../bin/lib/hooks/stop.js';
import { HandoffSchema } from '../../bin/lib/handoff.js';
import { acquireSessionLock, readSessionLock } from '../../bin/lib/session-lock.js';
import { activePaperRoot, setActivePaperRoot } from '../../bin/lib/paths.js';
import { REPO, sandbox } from '../helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { hookBundle, hookInput, type HookName } from './hook-runner.js';

function tmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `pensmith-${prefix}-`)));
}

async function paper(): Promise<string> {
  const root = tmpDir('hook-logic');
  await seedThreeSectionPaper(root);
  return root;
}

// ---------------------------------------------------------------------------
// stdin
// ---------------------------------------------------------------------------

class FakeStdin extends EventEmitter implements HookStdin {
  isTTY: boolean | undefined = undefined;
  paused = false;
  pause(): this {
    this.paused = true;
    return this;
  }
}

test('hooks/stdin: parseHookInput keeps the known string fields of a JSON object, nothing else', () => {
  assert.deepEqual(parseHookInput(JSON.stringify({ session_id: 's', cwd: '/p', tool_name: 't', tool_input: { a: 1 }, source: 'startup', trigger: 'auto', hook_event_name: 'Stop', transcript_path: '/t' })), {
    session_id: 's', cwd: '/p', tool_name: 't', source: 'startup', trigger: 'auto', hook_event_name: 'Stop', transcript_path: '/t',
  });
  for (const junk of ['', '{', '[]', 'null', '42', '"s"']) assert.equal(parseHookInput(junk), null, junk);
  assert.deepEqual(parseHookInput(JSON.stringify({ session_id: 7, cwd: '', tool_name: 'x'.repeat(5000) })), {}, 'wrong types, empty and oversized values are dropped');
  assert.equal(hookInputCwd({ cwd: '/abs' }), '/abs');
  assert.equal(hookInputCwd({ cwd: 'relative/dir' }), null, 'only an absolute cwd is used');
  assert.equal(hookInputCwd(null), null);
});

test('hooks/stdin: readHookInput reads until end, stops at the deadline with what arrived, and refuses a TTY or an oversized body', async () => {
  const s1 = new FakeStdin();
  const p1 = readHookInput(s1, 1_000);
  s1.emit('data', Buffer.from('{"session_id":'));
  s1.emit('data', '"abc"}');
  s1.emit('end');
  assert.deepEqual(await p1, { session_id: 'abc' });
  assert.equal(s1.paused, true, 'stdin is paused and released afterwards');

  const s2 = new FakeStdin();
  const p2 = readHookInput(s2, 30);
  s2.emit('data', '{"session_id":"late-close"}');
  assert.deepEqual(await p2, { session_id: 'late-close' }, 'a pipe left open still yields the body at the deadline');

  const s3 = new FakeStdin();
  assert.equal(await readHookInput(s3, 30), null, 'nothing arrives: null at the deadline');

  const tty = new FakeStdin();
  tty.isTTY = true;
  assert.equal(await readHookInput(tty, 1_000), null);

  const big = new FakeStdin();
  const p4 = readHookInput(big, 1_000);
  big.emit('data', Buffer.alloc(HOOK_STDIN_MAX_BYTES + 1, 0x20));
  assert.equal(await p4, null, 'an oversized body is not parsed');

  const err = new FakeStdin();
  const p5 = readHookInput(err, 1_000);
  err.emit('error');
  assert.equal(await p5, null);
});

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

test('hooks/entry: hookPaperRoot resolves the stdin cwd or PENSMITH_PAPER_ROOT, and null outside a paper', async () => {
  const root = await paper();
  const empty = tmpDir('hook-logic-empty');
  const before = activePaperRoot();
  try {
    assert.equal(hookPaperRoot({ cwd: root }, {}), root);
    assert.equal(activePaperRoot(), root, 'recorded as the active root');
    assert.equal(hookPaperRoot({ cwd: join(root, '.paper', 'sections') }, {}), root, 'a cwd inside .paper/ is its project');
    assert.equal(hookPaperRoot({ cwd: empty }, {}), null);
    assert.equal(hookPaperRoot({ cwd: empty }, { PENSMITH_PAPER_ROOT: root }), root);
    assert.equal(hookPaperRoot({ cwd: root }, { PENSMITH_PAPER_ROOT: empty }), null, 'PENSMITH_PAPER_ROOT wins');
  } finally {
    setActivePaperRoot(before);
  }
});

// ---------------------------------------------------------------------------
// SessionStart
// ---------------------------------------------------------------------------

test('hooks/session-start: the context names the router step, a not-done handoff and /pensmith; the output is hookSpecificOutput only', async () => {
  const root = await paper();
  const ctx = await buildSessionStartContext(root, { routeOptions: {} });
  assert.match(ctx, /Next step \(the pensmith router\): Draft section §2 \(methods\)/);
  assert.match(ctx, /run \/pensmith/);
  assert.doesNotMatch(ctx, /Before the last context compaction/);
  const out = await sessionStartOutput(root);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');

  const r = await writePreCompactHandoff(root);
  assert.equal(r.written, true);
  assert.match(await buildSessionStartContext(root), /it was at phase sectioning, section 2 \(write\)/);

  // The CLI's stop flags reach the router: an outline-only paper names its own
  // end state, never "complete".
  const outlineOnly = await buildSessionStartContext(root, { routeOptions: { stopAfterOutline: true } });
  assert.match(outlineOnly, /Next step \(the pensmith router\): Nothing more is routed: outline only: the approved outline is \.paper\/OUTLINE\.md/);
  assert.match(outlineOnly, /Nothing more is routed for this paper; run \/pensmith status to review it\./);
  assert.doesNotMatch(outlineOnly, /complete/);
});

// ---------------------------------------------------------------------------
// PreCompact
// ---------------------------------------------------------------------------

test('hooks/pre-compact: pointers follow STATE.json; breadcrumbs are the last five valid ones; the deadline is honoured', async () => {
  const root = await paper();
  const pointers = await collectSectionPointers(root);
  assert.deepEqual(pointers.map((p) => [p.slug, p.state]), [['intro', 'verified'], ['methods', 'writing'], ['results', 'planned']]);
  assert.deepEqual(await collectSectionPointers(tmpDir('no-state')), [], 'no STATE.json: no pointers');

  const pDir = join(root, '.paper');
  const good = (i: number): string => JSON.stringify({ ts: `2026-09-0${i}T00:00:00.000Z`, verb: 'plan', section: String(i), ok: true });
  writeFileSync(join(pDir, 'BREADCRUMBS.jsonl'), [good(1), 'not json', good(2), JSON.stringify({ ts: 'x', verb: 1 }), good(3), good(4), good(5), good(6)].join('\r\n') + '\n');
  assert.deepEqual(readBreadcrumbs(pDir).map((b) => b.section), ['3', '4', '5', '6'], 'the last five lines, invalid ones skipped');

  const r = await writePreCompactHandoff(root, { now: new Date('2026-09-30T00:00:00.000Z') });
  assert.equal(r.written, true);
  const h = HandoffSchema.parse(JSON.parse(readFileSync(join(pDir, 'HANDOFF.json'), 'utf8')));
  assert.equal(h.last_updated, '2026-09-30T00:00:00.000Z');
  assert.equal(h.breadcrumbs.length, 4);

  const late = await writePreCompactHandoff(root, { deadlineMs: 0 });
  assert.deepEqual(late, { written: false, error: 'the HANDOFF.json write did not finish within 0s' });
});

// ---------------------------------------------------------------------------
// PostToolUse
// ---------------------------------------------------------------------------

test('hooks/post-tool-use: one checkpoint per minute per paper; the file is trimmed past its size bound', async () => {
  const root = await paper();
  let clock = Date.parse('2026-09-30T00:00:00.000Z');
  const now = (): number => clock;
  const first = await recordCheckpoint(root, { sessionId: 's1', toolName: 'mcp__plugin_pensmith_pensmith__pensmith_plan' }, { now });
  assert.equal(first.kind, 'written');
  assert.equal(first.kind === 'written' && first.record.next, 'write 2');
  assert.equal((await recordCheckpoint(root, { sessionId: 's1', toolName: null }, { now })).kind, 'throttled');
  clock += 59_999;
  assert.equal((await recordCheckpoint(root, { sessionId: 's1', toolName: null }, { now })).kind, 'throttled');
  clock += 1;
  const second = await recordCheckpoint(root, { sessionId: null, toolName: null }, { now });
  assert.equal(second.kind === 'written' && second.record.tool_name, 'unknown');
  const file = checkpointFile(root);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);

  // Past CHECKPOINT_MAX_BYTES the file keeps its last CHECKPOINT_KEEP_LINES lines.
  const line = JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', session_id: 'old', tool_name: 'x'.repeat(300), next: 'plan 1' });
  const lines = Math.max(CHECKPOINT_KEEP_LINES + 500, Math.ceil(CHECKPOINT_MAX_BYTES / line.length) + 10);
  writeFileSync(file, `${line}\n`.repeat(lines));
  clock += 120_000;
  assert.equal((await recordCheckpoint(root, { sessionId: 's2', toolName: 't' }, { now })).kind, 'written');
  const kept = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(kept.length, CHECKPOINT_KEEP_LINES);
  assert.equal((JSON.parse(kept[kept.length - 1]!) as { session_id: string }).session_id, 's2');

  assert.equal(checkpointFile(join(root, '.paper')), file, 'the .paper folder names the same paper');
});

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

test('hooks/stop: releases only an MCP lock of the given Claude session', async () => {
  const root = await paper();
  const handle = await acquireSessionLock(root, { kind: 'mcp', verb: 'pensmith_write', claudeSessionId: 'claude-xyz' });
  try {
    assert.deepEqual(await stopHook(root, 'claude-other'), { released: false, errors: [] });
    assert.deepEqual(await stopHook(root, null), { released: false, errors: [] });
    assert.equal(readSessionLock(root)?.claudeSessionId, 'claude-xyz');
    assert.deepEqual(await stopHook(root, 'claude-xyz'), { released: true, errors: [] });
    assert.equal(readSessionLock(root), null);
  } finally {
    await handle.release();
  }
  const cli = await acquireSessionLock(root, { kind: 'cli', verb: 'write' });
  try {
    assert.equal((await stopHook(root, 'claude-xyz')).released, false, 'a CLI lock is never released');
    assert.equal(readSessionLock(root)?.kind, 'cli');
  } finally {
    await cli.release();
  }
});

// ---------------------------------------------------------------------------
// The TypeScript entries behave like their bundles.
// ---------------------------------------------------------------------------

const TSX = import.meta.resolve('tsx');

test('PLUG-14: each hooks/*.ts entry (under tsx) behaves exactly like its committed bundle', async () => {
  const sb = sandbox('hook-entries');
  const run = (name: HookName, file: string, cwd: string, loader: boolean): { status: number | null; stdout: string } => {
    const r = spawnSync(process.execPath, [...(loader ? ['--import', TSX] : []), file], {
      cwd, env: sb.env(), input: JSON.stringify(hookInput(name, cwd)), encoding: 'utf8', timeout: 60_000,
    });
    return { status: r.status, stdout: String(r.stdout ?? '') };
  };
  const src = (name: HookName): string => join(REPO, 'hooks', `${name}.ts`);
  const roots = { bundle: sb.project('bundle'), source: sb.project('source') };
  for (const root of Object.values(roots)) await seedThreeSectionPaper(root);
  const empty = sb.project('empty');
  for (const name of ['session-start', 'pre-compact', 'post-tool-use', 'stop'] as const) {
    const a = run(name, hookBundle(name), roots.bundle, false);
    const b = run(name, src(name), roots.source, true);
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    assert.equal(b.stdout.split(roots.source).join('<root>'), a.stdout.split(roots.bundle).join('<root>'), `${name}: the same stdout`);
    assert.equal(run(name, src(name), empty, true).stdout, '', `${name}: silent outside a paper`);
  }
  const handoff = (root: string): Record<string, unknown> => {
    const h = JSON.parse(readFileSync(join(root, '.paper', 'HANDOFF.json'), 'utf8')) as Record<string, unknown>;
    delete h['last_updated'];
    return h;
  };
  assert.deepEqual(handoff(roots.source), handoff(roots.bundle), 'the same HANDOFF.json');
  assert.equal(existsSync(join(empty, '.paper')), false);
});
