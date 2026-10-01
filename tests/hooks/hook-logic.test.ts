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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { hostname as hostname_, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hookInputCwd, parseHookInput, readHookInput, HOOK_STDIN_MAX_BYTES, type HookStdin } from '../../bin/lib/hooks/stdin.js';
import { hookPaperRoot } from '../../bin/lib/hooks/entry.js';
import { buildSessionStartContext, sessionStartOutput } from '../../bin/lib/hooks/session-start.js';
import { collectSectionPointers, writePreCompactHandoff } from '../../bin/lib/hooks/pre-compact.js';
import { checkpointFile, recordCheckpoint, CHECKPOINT_KEEP_LINES, CHECKPOINT_MAX_BYTES } from '../../bin/lib/hooks/post-tool-use.js';
import { stopHook } from '../../bin/lib/hooks/stop.js';
import { HandoffSchema } from '../../bin/lib/handoff.js';
import { writeOutlineDoneRecord } from '../../bin/lib/done-record.js';
import { acquireSessionLock, readSessionLock, sessionLockFile, type SessionOwner } from '../../bin/lib/session-lock.js';
import { activePaperRoot, setActivePaperRoot } from '../../bin/lib/paths.js';
import { out, resetOutputSink } from '../../bin/lib/output-sink.js';
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

    // A pre-v1 layout (a root-level pensmith STATE.json, with or without a
    // `.paper/` beside it) is not addressed: the legacy move is the next CLI or
    // MCP run's, under the session lock — never a hook's.
    const legacy = tmpDir('hook-logic-legacy');
    const legacyState = JSON.stringify({ $schemaVersion: 1, paperId: 'legacy-paper', createdAt: '2025-01-01T00:00:00.000Z' });
    writeFileSync(join(legacy, 'STATE.json'), legacyState);
    assert.equal(hookPaperRoot({ cwd: legacy }, {}), null, 'a root-level STATE.json only');
    mkdirSync(join(legacy, '.paper', 'sections'), { recursive: true });
    assert.equal(hookPaperRoot({ cwd: legacy }, {}), null, 'a .paper/ beside a legacy STATE.json still awaiting the move');
    assert.equal(readFileSync(join(legacy, 'STATE.json'), 'utf8'), legacyState, 'nothing moved');
    assert.equal(existsSync(join(legacy, '.paper', 'STATE.json')), false);
    // A root-level STATE.json that is not pensmith's is the user's own: the paper in .paper/ is addressed.
    writeFileSync(join(root, 'STATE.json'), JSON.stringify({ app: 'someone else' }));
    assert.equal(hookPaperRoot({ cwd: root }, {}), root);
  } finally {
    setActivePaperRoot(before);
    resetOutputSink();
  }
});

test('hooks/entry: once a paper is found, out() goes to stderr, never the hook-protocol stdout (PLUG-13)', async () => {
  const root = await paper();
  const empty = tmpDir('hook-logic-sink');
  const before = activePaperRoot();
  const written: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const capture = (into: string[]) =>
    ((chunk: string | Uint8Array): boolean => {
      into.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
  try {
    assert.equal(hookPaperRoot({ cwd: empty }, {}), null);
    process.stdout.write = capture(written.stdout);
    out('no paper: the default sink\n');
    process.stdout.write = realOut;
    assert.deepEqual(written.stdout, ['no paper: the default sink\n'], 'outside a paper the sink is untouched');

    written.stdout.length = 0;
    assert.equal(hookPaperRoot({ cwd: root }, {}), root);
    process.stdout.write = capture(written.stdout);
    process.stderr.write = capture(written.stderr);
    out('pensmith: a verb line\n');
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    setActivePaperRoot(before);
    resetOutputSink();
  }
  assert.deepEqual(written.stdout, [], 'nothing reached stdout');
  assert.deepEqual(written.stderr, ['pensmith: a verb line\n']);
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
  assert.match(await buildSessionStartContext(root, { source: 'compact' }), /it was at phase sectioning, section 2 \(write\)/);
  // Only the SessionStart after a compaction reads the HANDOFF (review round 2).
  for (const source of ['startup', 'resume', undefined]) {
    assert.doesNotMatch(await buildSessionStartContext(root, { source }), /Before the last context compaction/, String(source));
  }

  // The CLI's stop flags reach the router: an outline-only paper goes to done
  // (its outline export, GRND-11), then names its own end state — the
  // deliverables, quoted because the router builds them from validated names
  // only — never "the paper is complete".
  const outlineOnly = await buildSessionStartContext(root, { routeOptions: { stopAfterOutline: true } });
  assert.match(outlineOnly, /Next step \(the pensmith router\): Export the paper: run \/pensmith \(or `pensmith done`\)\./);
  const sha = (name: string): string => createHash('sha256').update(readFileSync(join(root, '.paper', name))).digest('hex');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{a2020,\n  title = {A},\n  year = {2020},\n  doi = {10.5555/a},\n}\n');
  writeFileSync(join(root, '.paper', 'ANNOTATED-BIBLIOGRAPHY.md'), '# Paper — Annotated Bibliography\n');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  for (const f of ['OUTLINE.md', 'ANNOTATED-BIBLIOGRAPHY.md']) writeFileSync(join(root, '.paper', 'export', f), '# Paper\n');
  await writeOutlineDoneRecord(root, {
    doneAt: new Date().toISOString(),
    outlineSha256: sha('OUTLINE.md'),
    bibSha256: sha('CITATIONS.bib'),
    annotatedSha256: sha('ANNOTATED-BIBLIOGRAPHY.md'),
    exports: ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md'],
  });
  const outlineDone = await buildSessionStartContext(root, { routeOptions: { stopAfterOutline: true } });
  assert.match(outlineDone, /Next step \(the pensmith router\): Nothing more is routed: outline only — complete: export\/OUTLINE\.md and export\/ANNOTATED-BIBLIOGRAPHY\.md/);
  assert.match(outlineDone, /Nothing more is routed for this paper; run \/pensmith status to review it\./);
  assert.doesNotMatch(outlineDone, /The paper is complete/);
});

// ---------------------------------------------------------------------------
// PreCompact
// ---------------------------------------------------------------------------

test('hooks/pre-compact: pointers follow STATE.json; a newer HANDOFF is kept; the deadline is honoured', async () => {
  const root = await paper();
  const pointers = await collectSectionPointers(root);
  assert.deepEqual(pointers.map((p) => [p.slug, p.state]), [['intro', 'verified'], ['methods', 'writing'], ['results', 'planned']]);
  assert.deepEqual(await collectSectionPointers(tmpDir('no-state')), [], 'no STATE.json: no pointers');

  const pDir = join(root, '.paper');
  const r = await writePreCompactHandoff(root, { now: new Date('2026-09-30T00:00:00.000Z') });
  assert.equal(r.written, true);
  const h = HandoffSchema.parse(JSON.parse(readFileSync(join(pDir, 'HANDOFF.json'), 'utf8')));
  assert.equal(h.last_updated, '2026-09-30T00:00:00.000Z');
  assert.equal('breadcrumbs' in JSON.parse(readFileSync(join(pDir, 'HANDOFF.json'), 'utf8')), false, 'v2 carries no breadcrumbs');

  const newer = JSON.stringify({ schema_version: 3, future: true });
  writeFileSync(join(pDir, 'HANDOFF.json'), newer);
  const kept = await writePreCompactHandoff(root);
  assert.equal(kept.written, false);
  assert.match(kept.written ? '' : kept.error, /written by a newer pensmith \(schema_version 3\); left in place, never downgraded/);
  assert.equal(readFileSync(join(pDir, 'HANDOFF.json'), 'utf8'), newer);

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

/** Put §2 of the three-section fixture back to an outline stub: the router's step becomes `plan 2`. */
function stubSection2(root: string): void {
  writeFileSync(
    join(root, '.paper', 'sections', '02-methods', 'PLAN.md'),
    '---\nsection: 2\nslug: methods\ntitle: methods\ndepends_on: [intro]\nassigned_sources: []\nstatus: planned\nstub: true\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n',
  );
}

test('hooks/post-tool-use (review round 3): within the minute, a call that moved the paper replaces the last line (trailing edge); one that did not writes nothing', async () => {
  const root = await paper();
  let clock = Date.parse('2026-09-30T00:00:00.000Z');
  const now = (): number => clock;
  const status = 'mcp__plugin_pensmith_pensmith__pensmith_status';
  const write = 'mcp__plugin_pensmith_pensmith__pensmith_write';
  const first = await recordCheckpoint(root, { sessionId: 's1', toolName: status }, { now });
  assert.equal(first.kind === 'written' && first.record.next, 'write 2');
  const file = checkpointFile(root);

  // Seconds later a mutating call moves the paper: the minute's line now says where it is.
  clock += 5_000;
  stubSection2(root);
  const moved = await recordCheckpoint(root, { sessionId: 's1', toolName: write }, { now });
  assert.equal(moved.kind, 'updated');
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { ts: string; tool_name: string; next: string });
  assert.equal(lines.length, 1, 'still one line in the minute');
  assert.deepEqual(lines[0], { ts: new Date(clock).toISOString(), session_id: 's1', tool_name: write, next: 'plan 2' });

  // A call that leaves the step where it is writes nothing.
  clock += 5_000;
  const before = readFileSync(file, 'utf8');
  assert.equal((await recordCheckpoint(root, { sessionId: 's1', toolName: status }, { now })).kind, 'throttled');
  assert.equal(readFileSync(file, 'utf8'), before);

  // Lines stay a minute apart: the next append comes a minute after the last line.
  clock += 54_999;
  assert.equal((await recordCheckpoint(root, { sessionId: 's1', toolName: status }, { now })).kind, 'throttled');
  clock += 1;
  assert.equal((await recordCheckpoint(root, { sessionId: 's1', toolName: status }, { now })).kind, 'written');
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);

  // A torn last line is kept below the replaced record, never merged into it.
  writeFileSync(file, readFileSync(file, 'utf8') + '{"ts":"torn');
  clock += 1_000;
  writeFileSync(
    join(root, '.paper', 'sections', '02-methods', 'PLAN.md'),
    '---\nsection: 2\nslug: methods\ntitle: methods\ndepends_on: [intro]\nassigned_sources: []\nstatus: writing\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n',
  );
  assert.equal((await recordCheckpoint(root, { sessionId: 's2', toolName: write }, { now })).kind, 'updated');
  const after = readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
  assert.equal(after.length, 3);
  assert.equal((JSON.parse(after[1]!) as { next: string; session_id: string }).next, 'write 2');
  assert.equal(after[2], '{"ts":"torn');
});

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

/** A PID that belonged to a process which has exited (a holder killed before it could release). */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.pid!;
}

test('hooks/stop: releases only the MCP lock of the given Claude session that its server left behind — never a live call\'s, never a CLI lock', async () => {
  const root = await paper();
  // A live holder (this process) is a tool call still in flight: kept, even for its own session (review round 3).
  const handle = await acquireSessionLock(root, { kind: 'mcp', verb: 'pensmith_write', claudeSessionId: 'claude-xyz' });
  try {
    assert.deepEqual(await stopHook(root, 'claude-other'), { released: false, errors: [] });
    assert.deepEqual(await stopHook(root, null), { released: false, errors: [] });
    assert.deepEqual(await stopHook(root, 'claude-xyz'), { released: false, errors: [] }, 'an in-flight call keeps its lock');
    assert.equal(readSessionLock(root)?.claudeSessionId, 'claude-xyz');
  } finally {
    await handle.release();
  }
  assert.equal(readSessionLock(root), null, 'the call itself releases it when it ends');

  // A record whose server is gone (killed before its release ran) is left behind: released for its own session only.
  const file = sessionLockFile(root);
  const leftBehind = (hostname: string): SessionOwner => ({
    hostname, pid: deadPid(), sessionId: 'server-session', kind: 'mcp', verb: 'pensmith_write',
    startedAt: new Date().toISOString(), claudeSessionId: 'claude-xyz', root,
  });
  for (const hostname of [hostname_(), 'a-name-this-host-had-before']) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(leftBehind(hostname)));
    assert.deepEqual(await stopHook(root, 'claude-other'), { released: false, errors: [] });
    assert.deepEqual(await stopHook(root, 'claude-xyz'), { released: true, errors: [] }, `left behind (${hostname})`);
    assert.equal(readSessionLock(root), null);
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
      cwd, env: sb.env(loader ? {} : { NODE_V8_COVERAGE: undefined }), input: JSON.stringify(hookInput(name, cwd)), encoding: 'utf8', timeout: 60_000,
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
