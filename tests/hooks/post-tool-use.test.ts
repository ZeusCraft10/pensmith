// tests/hooks/post-tool-use.test.ts — the PostToolUse hook bundle (PLUG-14,
// D-23a-15; throttle T-3-DOS-04, lock CR-04), spawned as Claude Code runs it:
// `node plugin/dist/hooks/post-tool-use.mjs` with the documented stdin JSON
// (`tool_name`, `session_id`, …).
//
// In a paper, five invocations within 60 s write exactly ONE checkpoint line
// `{ts, session_id, tool_name, next}` to pensmithDataDir()/checkpoints/
// <projectHash>.jsonl — nothing under the user's `.claude/` or the paper's
// `.paper/`, nothing on stdout. A checkpoint older than a minute lets the next
// one through; within the minute a call that moved the paper replaces the
// minute's line (the trailing edge, review round 3), so the last line always
// names the paper's current step; every spelling of a paper (a symlink or
// junction) shares one file; two papers get two files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedPaths, sandbox, sandboxDataPath, snapshot, type Sandbox } from '../helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { assertBundlesPresent, hookInput, PLUGIN_TOOL, runHook } from './hook-runner.js';

assertBundlesPresent();

interface Checkpoint {
  ts: string;
  session_id: string | null;
  tool_name: string;
  next: string;
}

function checkpointDir(sb: Sandbox): string {
  return sandboxDataPath(sb, 'checkpoints');
}

function checkpointFiles(sb: Sandbox): string[] {
  const dir = checkpointDir(sb);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
}

function lines(file: string): Checkpoint[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Checkpoint);
}

test('PLUG-14: five PostToolUse runs within 60 s write exactly one checkpoint, in the data dir, never under .claude/ or .paper/', async () => {
  const sb = sandbox('hook-posttool');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const before = snapshot(root);
  const started = Date.now();
  for (let i = 0; i < 5; i += 1) {
    const r = runHook(sb, 'post-tool-use', { cwd: root, input: hookInput('post-tool-use', root, { session_id: `claude-${i}` }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', 'PostToolUse prints nothing on stdout');
  }
  assert.ok(Date.now() - started < 60_000, 'the five runs fell inside one throttle window');
  const files = checkpointFiles(sb);
  assert.equal(files.length, 1, `one checkpoint file: ${files.join(', ')}`);
  assert.match(files[0]!, /^[0-9a-f]{12}\.jsonl$/, 'named by the 12-char project hash');
  const got = lines(join(checkpointDir(sb), files[0]!));
  assert.equal(got.length, 1, 'exactly one checkpoint line');
  assert.equal(got[0]!.session_id, 'claude-0');
  assert.equal(got[0]!.tool_name, PLUGIN_TOOL, 'reads stdin tool_name (never the v0 `tool` field)');
  assert.equal(got[0]!.next, 'write 2', 'the router step after the call');
  assert.ok(!Number.isNaN(Date.parse(got[0]!.ts)));
  assert.equal(existsSync(join(root, '.claude')), false, 'nothing under the project .claude/');
  assert.equal(existsSync(join(sb.data, '.claude')), false, 'nothing under the user .claude/');
  assert.deepEqual(changedPaths(before, snapshot(root), /^\.paper[\\/]SESSION\.log$/), [], 'the project folder is unchanged (the SESSION.log read events aside)');
});

test('PLUG-14: a checkpoint older than a minute lets the next one through; a torn last line does not break the throttle', async () => {
  const sb = sandbox('hook-posttool-window');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  assert.equal(runHook(sb, 'post-tool-use', { cwd: root }).status, 0);
  const [name] = checkpointFiles(sb);
  const file = join(checkpointDir(sb), name!);
  const old = { ts: new Date(Date.now() - 120_000).toISOString(), session_id: 'earlier', tool_name: PLUGIN_TOOL, next: 'plan 2' };
  writeFileSync(file, JSON.stringify(old) + '\n');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: root }).status, 0);
  assert.equal(lines(file).length, 2, 'a minute later a new checkpoint is appended');
  writeFileSync(file, readFileSync(file, 'utf8') + '{"ts":"torn');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: root }).status, 0);
  const text = readFileSync(file, 'utf8');
  assert.equal(text.split('\n').filter((l) => l.startsWith('{"ts":"20')).length, 2, 'the torn line does not reopen the window');

  // An old checkpoint followed by a torn line: the new record starts on its own line.
  writeFileSync(file, JSON.stringify(old) + '\n{"ts":"torn');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: root }).status, 0);
  const after = readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
  assert.equal(after.length, 3);
  assert.equal(after[1], '{"ts":"torn', 'the torn line is closed, not merged');
  assert.equal((JSON.parse(after[2]!) as Checkpoint).next, 'write 2');
});

test('PLUG-14 (review round 3): pensmith_status then a pensmith_write that moves the paper within the minute — the one checkpoint names the new step', async () => {
  const sb = sandbox('hook-posttool-trailing');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const status = 'mcp__plugin_pensmith_pensmith__pensmith_status';
  const first = runHook(sb, 'post-tool-use', { cwd: root, input: hookInput('post-tool-use', root, { tool_name: status }) });
  assert.equal(first.status, 0, first.stderr);
  const [name] = checkpointFiles(sb);
  const file = join(checkpointDir(sb), name!);
  assert.deepEqual(lines(file).map((c) => [c.tool_name, c.next]), [[status, 'write 2']]);
  // The write left §2 back at an outline stub (what a failed containment or a
  // re-outline can do): the router's step is now `plan 2`.
  writeFileSync(
    join(root, '.paper', 'sections', '02-methods', 'PLAN.md'),
    '---\nsection: 2\nslug: methods\ntitle: methods\ndepends_on: [intro]\nassigned_sources: []\nstatus: planned\nstub: true\nverified_against_draft_hash: null\n---\n## Brief\n\nx\n',
  );
  const second = runHook(sb, 'post-tool-use', { cwd: root, input: hookInput('post-tool-use', root, { session_id: 'claude-2' }) });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, '');
  const got = lines(file);
  assert.equal(got.length, 1, 'still one line in the minute');
  assert.deepEqual([got[0]!.session_id, got[0]!.tool_name, got[0]!.next], ['claude-2', PLUGIN_TOOL, 'plan 2'], 'the line names where the write left the paper');
  // A later read-only call that changes nothing leaves the line as it is.
  const text = readFileSync(file, 'utf8');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: root, input: hookInput('post-tool-use', root, { tool_name: status }) }).status, 0);
  assert.equal(readFileSync(file, 'utf8'), text);
});

test('PLUG-14: every spelling of a paper shares one checkpoint file; two papers get two', async () => {
  const sb = sandbox('hook-posttool-paths');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const link = join(sb.base, 'paper-link');
  symlinkSync(root, link, 'junction');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: link, input: hookInput('post-tool-use', link) }).status, 0);
  const inner = join(root, '.paper', 'sections');
  assert.equal(runHook(sb, 'post-tool-use', { cwd: inner, input: hookInput('post-tool-use', inner) }).status, 0);
  assert.equal(checkpointFiles(sb).length, 1, 'the symlinked and the in-.paper spellings are one paper');

  const second = sb.project('second');
  await seedThreeSectionPaper(second);
  assert.equal(runHook(sb, 'post-tool-use', { cwd: second }).status, 0);
  assert.equal(checkpointFiles(sb).length, 2, 'another paper, another file');
  mkdirSync(join(sb.base, 'no-paper'), { recursive: true });
  assert.equal(runHook(sb, 'post-tool-use', { cwd: join(sb.base, 'no-paper') }).status, 0);
  assert.equal(checkpointFiles(sb).length, 2, 'a folder without a paper records nothing');
});
