// tests/hooks/session-start.test.ts — the SessionStart hook bundle (PLUG-14,
// D-23a-15), spawned as Claude Code runs it: `node plugin/dist/hooks/
// session-start.mjs` with the documented stdin JSON.
//
// In a paper, stdout is exactly ONE JSON line
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}
// whose context names the router's next step, a not-done HANDOFF.json's
// position (v1 and v2) and the /pensmith instruction — for every matcher
// source (startup, resume, compact). It never emits `systemMessage` (shown to
// the user, never to Claude). Outside a paper it prints nothing (see
// tests/hooks-noop.test.ts for the timing and no-files checks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, sandboxDataPath } from '../helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { assertBundlesPresent, hookInput, runHook } from './hook-runner.js';

assertBundlesPresent();

interface Frame {
  hookSpecificOutput?: { hookEventName?: unknown; additionalContext?: unknown };
  systemMessage?: unknown;
}

/** Exactly one JSON line on stdout, parsed. */
function oneFrame(stdout: string): Frame {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `stdout must be exactly one JSON line, got: ${JSON.stringify(stdout)}`);
  assert.ok(stdout.endsWith('\n'));
  return JSON.parse(lines[0]!) as Frame;
}

function contextOf(frame: Frame): string {
  assert.deepEqual(Object.keys(frame), ['hookSpecificOutput'], 'only hookSpecificOutput — never systemMessage');
  assert.deepEqual(Object.keys(frame.hookSpecificOutput ?? {}).sort(), ['additionalContext', 'hookEventName']);
  assert.equal(frame.hookSpecificOutput?.hookEventName, 'SessionStart');
  const ctx = frame.hookSpecificOutput?.additionalContext;
  assert.equal(typeof ctx, 'string');
  assert.ok((ctx as string).length > 0 && (ctx as string).length < 10_000, 'within Claude Code\'s 10,000-char cap');
  return ctx as string;
}

test('PLUG-14: SessionStart in a paper emits one additionalContext line naming the next step and /pensmith (startup, resume, compact)', async () => {
  const sb = sandbox('hook-sessionstart');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  for (const source of ['startup', 'resume', 'compact']) {
    const r = runHook(sb, 'session-start', { cwd: root, input: hookInput('session-start', root, { source }) });
    assert.equal(r.status, 0, r.stderr);
    const ctx = contextOf(oneFrame(r.stdout));
    assert.match(ctx, /pensmith paper/);
    assert.match(ctx, /Next step \(the pensmith router\): Draft section §2 \(methods\): run \/pensmith \(or `pensmith write 2`\)/, ctx);
    assert.match(ctx, /To continue the paper, run \/pensmith/);
    assert.doesNotMatch(ctx, /Before the last context compaction/, 'no HANDOFF, no handoff summary');
    assert.doesNotMatch(r.stdout, /systemMessage/);
  }
});

test('PLUG-14: SessionStart adds the HANDOFF summary — v2 as written by PreCompact, and a migrated v1 file', async () => {
  const sb = sandbox('hook-sessionstart-handoff');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  // The real round trip: the PreCompact bundle writes the handoff, SessionStart reads it.
  assert.equal(runHook(sb, 'pre-compact', { cwd: root }).status, 0);
  const r = runHook(sb, 'session-start', { cwd: root, input: hookInput('session-start', root, { source: 'compact' }) });
  assert.equal(r.status, 0, r.stderr);
  const ctx = contextOf(oneFrame(r.stdout));
  assert.match(ctx, /Before the last context compaction \([^)]+\) it was at phase sectioning, section 2 \(write\): Draft section §2/, ctx);

  // A v1 HANDOFF (phase 'verify') is migrated in memory.
  writeFileSync(join(root, '.paper', 'HANDOFF.json'), JSON.stringify({
    schema_version: 1,
    last_updated: '2026-09-01T00:00:00.000Z',
    current_section: 'methods',
    phase: 'verify',
    next_action: 'Resume verify on section methods. Last verb: write.',
    breadcrumbs: [],
    section_pointers: [{ slug: 'methods', plan_path: join(root, '.paper', 'sections', '02-methods', 'PLAN.md'), draft_path: null, verification_path: null, state: 'written' }],
  }));
  const r1 = runHook(sb, 'session-start', { cwd: root });
  assert.match(contextOf(oneFrame(r1.stdout)), /it was at phase sectioning, section 2 \(verify\): Resume verify on section methods/);

  // A done HANDOFF, or one written by a newer pensmith, adds no summary.
  for (const body of [
    { schema_version: 2, last_updated: '2026-09-01T00:00:00.000Z', phase: 'done', section: null, position: null, current_section: null, next_action: 'x', breadcrumbs: [], section_pointers: [] },
    { schema_version: 3, whatever: true },
  ]) {
    writeFileSync(join(root, '.paper', 'HANDOFF.json'), JSON.stringify(body));
    const rn = runHook(sb, 'session-start', { cwd: root });
    assert.equal(rn.status, 0);
    assert.doesNotMatch(contextOf(oneFrame(rn.stdout)), /Before the last context compaction/);
  }
});

test('PLUG-14: SessionStart in a paper whose STATE.json is corrupt still exits 0 and reports attention', async () => {
  const sb = sandbox('hook-sessionstart-states');
  const attention = sb.project('attention');
  mkdirSync(join(attention, '.paper'), { recursive: true });
  writeFileSync(join(attention, '.paper', 'STATE.json'), '{ corrupt');
  const r = runHook(sb, 'session-start', { cwd: attention });
  assert.equal(r.status, 0, r.stderr);
  assert.match(contextOf(oneFrame(r.stdout)), /Needs attention/);
});

test('PLUG-14: SessionStart follows the stdin cwd and PENSMITH_PAPER_ROOT, never the `open` pointer', async () => {
  const sb = sandbox('hook-sessionstart-root');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const elsewhere = sb.project('elsewhere');
  const viaStdin = runHook(sb, 'session-start', { cwd: elsewhere, input: hookInput('session-start', root) });
  assert.match(contextOf(oneFrame(viaStdin.stdout)), /write 2/);
  const viaEnv = runHook(sb, 'session-start', { cwd: elsewhere, input: hookInput('session-start', elsewhere), env: { PENSMITH_PAPER_ROOT: root } });
  assert.match(contextOf(oneFrame(viaEnv.stdout)), /write 2/);

  const pointer = sandboxDataPath(sb, 'active.json');
  mkdirSync(join(pointer, '..'), { recursive: true });
  writeFileSync(pointer, JSON.stringify({ paperId: 'x', folderPath: root }));
  const viaPointer = runHook(sb, 'session-start', { cwd: elsewhere, input: hookInput('session-start', elsewhere) });
  assert.equal(viaPointer.status, 0);
  assert.equal(viaPointer.stdout, '', 'the open pointer is never followed: no paper here, no output');
});
