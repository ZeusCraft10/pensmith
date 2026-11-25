// tests/hooks/session-start.test.ts
//
// The plugin's only hook. It runs at session start (startup, resume, compact)
// in every project where the plugin is enabled, so:
//   - outside a paper workspace it must print nothing and write nothing;
//   - inside one it must hand Claude the next step as model context, via
//     hookSpecificOutput.additionalContext (a top-level systemMessage is shown
//     to the user only and never reaches the model);
//   - the next step must come from the router, the same decision the CLI
//     makes, not from a second state file;
//   - the context must stay small however many sections the paper has.
//
// Each case runs the real hook entry as a subprocess with hook JSON on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initState, initSection } from '../../bin/lib/state.js';
import { resolveNextAction } from '../../bin/lib/router.js';
import { describeNextStep } from '../../hooks/session-context.js';

const HOOK = fileURLToPath(new URL('../../hooks/session-start.ts', import.meta.url));
// Absolute loader URL so the child can load tsx from any cwd.
const TSX_LOADER = import.meta.resolve('tsx');

interface HookRun { status: number | null; stdout: string; stderr: string }

function runHook(opts: { processCwd: string; stdin: string; projectDir?: string }): HookRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['CLAUDE_PROJECT_DIR'];
  if (opts.projectDir !== undefined) env['CLAUDE_PROJECT_DIR'] = opts.projectDir;
  const res = spawnSync(process.execPath, ['--import', TSX_LOADER, HOOK], {
    cwd: opts.processCwd,
    input: opts.stdin,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function hookInput(cwd: string, source = 'startup'): string {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    hook_event_name: 'SessionStart',
    source,
  });
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `pensmith-hook-${prefix}-`));
}

/** A paper workspace created through the real state API, with `sections` registered. */
async function paperWorkspace(sections: number): Promise<string> {
  const root = tmp('paper');
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root, { paperId: 'hook-test' });
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), '# Outline\n');
  for (let n = 1; n <= sections; n++) await initSection(root, n, `section-${n}`);
  return root;
}

function parseContext(stdout: string): string {
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1, `hook stdout must be exactly one JSON line, got:\n${stdout}`);
  const frame = JSON.parse(lines[0]!) as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
  assert.equal(frame.hookSpecificOutput?.hookEventName, 'SessionStart');
  const ctx = frame.hookSpecificOutput?.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext must be a string');
  return ctx!;
}

test('outside a paper workspace the hook prints nothing and creates nothing', () => {
  const project = tmp('plain');
  writeFileSync(join(project, 'index.js'), 'console.log(1)\n');
  const before = readdirSync(project).sort();
  for (const source of ['startup', 'resume', 'compact']) {
    const r = runHook({ processCwd: project, stdin: hookInput(project, source) });
    assert.equal(r.status, 0, `hook must exit 0 (${source}); stderr: ${r.stderr}`);
    assert.equal(r.stdout, '', `hook must print nothing outside a paper workspace (${source})`);
  }
  assert.deepEqual(readdirSync(project).sort(), before, 'hook must not create files in an unrelated project');
});

test('inside a paper workspace the hook gives Claude the router\'s next step as additionalContext', async () => {
  const root = await paperWorkspace(2);
  const expected = await resolveNextAction(root);
  assert.notEqual(expected.verb, 'new', 'fixture must be a started paper');

  const r = runHook({ processCwd: root, stdin: hookInput(root) });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ctx = parseContext(r.stdout);
  assert.ok(ctx.includes(describeNextStep(expected)), `context must state the router's next step.\ncontext: ${ctx}`);
  assert.match(ctx, /pensmith skill/, 'context must point Claude at the pensmith skill');
  assert.ok(!/systemMessage/.test(r.stdout), 'the hook must not rely on a user-only systemMessage');
  assert.ok(!existsSync(join(root, '.paper', 'HANDOFF.json')), 'the hook must not write a handoff file');
});

test('the session cwd comes from the hook input, not the hook process cwd', async () => {
  const root = await paperWorkspace(1);
  const elsewhere = tmp('elsewhere');
  const r = runHook({ processCwd: elsewhere, stdin: hookInput(root) });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  parseContext(r.stdout);

  // And a paper in the process cwd is ignored when the session is elsewhere.
  const r2 = runHook({ processCwd: root, stdin: hookInput(elsewhere) });
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout, '');
});

test('compact is handled like startup, so context survives /compact', async () => {
  const root = await paperWorkspace(1);
  const r = runHook({ processCwd: root, stdin: hookInput(root, 'compact') });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(parseContext(r.stdout), /pensmith/);
});

test('malformed or empty stdin never crashes the hook', async () => {
  const plain = tmp('garbage');
  for (const stdin of ['', 'not json', '{"cwd": 42}', '[]']) {
    const r = runHook({ processCwd: plain, stdin });
    assert.equal(r.status, 0, `stdin ${JSON.stringify(stdin)}: stderr ${r.stderr}`);
    assert.equal(r.stdout, '');
  }
  // With unusable input it falls back to CLAUDE_PROJECT_DIR, then the process cwd.
  const root = await paperWorkspace(1);
  const viaEnv = runHook({ processCwd: plain, stdin: 'not json', projectDir: root });
  assert.equal(viaEnv.status, 0);
  parseContext(viaEnv.stdout);
  const viaCwd = runHook({ processCwd: root, stdin: '' });
  assert.equal(viaCwd.status, 0);
  parseContext(viaCwd.stdout);
});

test('the context stays small for a paper with many sections', async () => {
  const root = await paperWorkspace(40);
  const r = runHook({ processCwd: root, stdin: hookInput(root) });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ctx = parseContext(r.stdout);
  assert.ok(Buffer.byteLength(ctx, 'utf8') < 1500, `context is ${Buffer.byteLength(ctx, 'utf8')} bytes`);
});

test('a corrupt STATE.json still yields context, never a crash', async () => {
  const root = await paperWorkspace(1);
  // Corrupt whichever STATE.json location this layout uses.
  for (const p of [join(root, 'STATE.json'), join(root, '.paper', 'STATE.json')]) {
    if (existsSync(p)) writeFileSync(p, '{ not json');
  }
  const r = runHook({ processCwd: root, stdin: hookInput(root) });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(parseContext(r.stdout), /pensmith status/);
});
