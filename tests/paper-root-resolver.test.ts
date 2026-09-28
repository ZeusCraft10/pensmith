// tests/paper-root-resolver.test.ts — RUN-14 (S-21, D-17-33): one
// active-paper resolver that never hijacks a fresh folder, and honours
// `pensmith open`.
//
// Order: --paper / PENSMITH_PAPER_ROOT → the cwd's .paper/ → a new paper in
// the cwd (`new`, `sketch`, or a bare run with assignment.{txt,md,pdf}) → the
// open pointer: read-only verbs use it with a banner; mutating runs and
// bare/next/resume ask in a terminal and refuse (EXIT_USAGE) otherwise;
// --yolo never follows it. MCP and hooks: PENSMITH_PAPER_ROOT or the cwd only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePaperRoot, servicePaperRoot, findAssignmentFile, activePaperBanner } from '../bin/lib/paths.js';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';
import {
  ASSIGNMENT_FIXTURE,
  STACK_LINE,
  sandbox,
  runCli,
  writeOutline,
  writePlan,
  seedCompiledPaper,
  snapshot,
  changedPaths,
  REPO,
  sandboxDataPath,
  type Sandbox,
} from './helpers/paper-cli-harness.js';
import { loadChokepointRow, rowPattern, scopedFiles, violations } from './helpers/chokepoint-row.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { readdirSync } from 'node:fs';

const IGNORE_LOGS = /^\.paper[\\/](SESSION\.log|sessions)/;

// ---------------------------------------------------------------------------
// Pure resolver branches (no pointer involved)
// ---------------------------------------------------------------------------

test('RUN-14: resolver order — flag/env, the cwd paper, a new paper; MCP/hooks never follow the pointer', () => {
  const sb = sandbox('resolver-unit');
  const withPaper = sb.project('with-paper');
  writeFileSync(join(sb.project('with-paper/.paper'), 'STATE.json'), '{}');
  const withAssignment = sb.project('with-assignment');
  writeFileSync(join(withAssignment, 'assignment.md'), '# Assignment\n');
  const empty = sb.project('empty');

  assert.deepEqual(
    resolvePaperRoot({ verb: 'status', mode: 'cli', cwd: empty, env: { PENSMITH_PAPER_ROOT: withPaper } }),
    { kind: 'root', root: withPaper, source: 'env' },
  );
  assert.deepEqual(
    resolvePaperRoot({ verb: 'write', mode: 'cli', cwd: withPaper, env: {} }),
    { kind: 'root', root: withPaper, source: 'cwd' },
  );
  assert.deepEqual(resolvePaperRoot({ verb: 'new', mode: 'cli', cwd: empty, env: {} }), { kind: 'root', root: empty, source: 'new' });
  assert.deepEqual(resolvePaperRoot({ verb: 'sketch', mode: 'cli', cwd: empty, env: {} }), { kind: 'root', root: empty, source: 'new' });
  assert.deepEqual(resolvePaperRoot({ verb: null, mode: 'cli', cwd: withAssignment, env: {} }), { kind: 'root', root: withAssignment, source: 'new' });
  assert.equal(findAssignmentFile(withAssignment), join(withAssignment, 'assignment.md'));
  // --paper by path: a folder containing .paper/, or the .paper folder itself.
  assert.deepEqual(
    resolvePaperRoot({ verb: 'status', mode: 'cli', paperFlag: withPaper, cwd: empty, env: {} }),
    { kind: 'root', root: withPaper, source: 'flag' },
  );
  assert.deepEqual(
    resolvePaperRoot({ verb: 'status', mode: 'cli', paperFlag: join(withPaper, '.paper'), cwd: empty, env: {} }),
    { kind: 'root', root: withPaper, source: 'flag' },
  );
  // MCP / hooks: PENSMITH_PAPER_ROOT or the cwd — even for an empty cwd.
  assert.deepEqual(resolvePaperRoot({ verb: null, mode: 'mcp', cwd: empty, env: {} }), { kind: 'root', root: empty, source: 'cwd' });
  assert.deepEqual(
    resolvePaperRoot({ verb: null, mode: 'hook', cwd: empty, env: { PENSMITH_PAPER_ROOT: withPaper } }),
    { kind: 'root', root: withPaper, source: 'env' },
  );
  assert.equal(servicePaperRoot({ PENSMITH_PAPER_ROOT: withPaper }), withPaper);
  // Step 5 (no paper, no pointer): read-only and bare/next/resume fall back to
  // the cwd; any other verb is EXIT_USAGE (it would build a partial paper).
  assert.deepEqual(resolvePaperRoot({ verb: 'status', mode: 'cli', readOnly: true, cwd: empty, env: {} }), { kind: 'root', root: empty, source: 'fallback' });
  // (GRND-01: a bare run with an assignment piped on stdin starts a new paper
  // here instead — the stdin condition is stated, never read from the runner.)
  for (const verb of [null, 'next', 'resume']) {
    assert.deepEqual(resolvePaperRoot({ verb, mode: 'cli', cwd: empty, env: {}, stdinAssignment: false }), { kind: 'root', root: empty, source: 'fallback' });
  }
  assert.deepEqual(resolvePaperRoot({ verb: null, mode: 'cli', cwd: empty, env: {}, stdinAssignment: true }), { kind: 'root', root: empty, source: 'new' });
  assert.throws(() => resolvePaperRoot({ verb: 'write', mode: 'cli', cwd: empty, env: {} }),
    (e: unknown) => (e as { exitCode?: number }).exitCode === EXIT_USAGE && /no paper in /.test((e as Error).message));
  assert.equal(activePaperBanner({ name: 'p2', root: '/x/p2' }), '(active paper "p2" at /x/p2)');
});

test('RUN-13 / RUN-14: a run from inside .paper/ (or deeper) addresses the paper in the parent folder — never .paper/.paper/', () => {
  const sb = sandbox('resolver-inside');
  const root = sb.project('p');
  seedCompiledPaper(root);
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writeFileSync(join(root, '.paper', 'INTAKE.md'), 'Topic: tidal power\n');
  writeFileSync(join(root, '.paper', 'FINAL.md'), '# Paper\n\nOne.\n\nTwo.\n');
  const inside = join(root, '.paper');
  const deeper = join(root, '.paper', 'sections', '01-one');
  // The resolver folds the cwd for every mode.
  for (const cwd of [inside, deeper]) {
    assert.deepEqual(resolvePaperRoot({ verb: 'status', mode: 'cli', cwd, env: {} }), { kind: 'root', root, source: 'cwd' });
    assert.deepEqual(resolvePaperRoot({ verb: null, mode: 'mcp', cwd, env: {} }), { kind: 'root', root, source: 'cwd' });
  }
  const fromRoot = runCli(sb, root, ['status']);
  assert.equal(fromRoot.status, 0, fromRoot.stderr);
  const before = snapshot(root);
  for (const cwd of [inside, deeper]) {
    const st = runCli(sb, cwd, ['status']);
    assert.equal(st.status, 0, st.stderr);
    assert.equal(st.stdout, fromRoot.stdout, 'status from inside .paper/ shows the real paper');
    // The paper is finished: the router's next action is the terminal status —
    // never `research` against a phantom .paper/.paper/.
    for (const args of [['next', '--yolo'], ['--yolo']]) {
      const r = runCli(sb, cwd, args);
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
      assert.doesNotMatch(`${r.stdout}${r.stderr}`, /pensmith research|wrote LIBRARY\.json/);
    }
    assert.ok(!existsSync(join(root, '.paper', '.paper')), 'no nested .paper/.paper/ is created');
    assert.ok(!existsSync(join(deeper, '.paper')), 'no .paper/ inside a section folder');
  }
  assert.deepEqual(changedPaths(before, snapshot(root)).filter((p) => !IGNORE_LOGS.test(p)), [], 'nothing in the paper changed');
});

// ---------------------------------------------------------------------------
// The open pointer through the real CLI
// ---------------------------------------------------------------------------

interface World {
  sb: Sandbox;
  p2: string;
  bannerRe: RegExp;
}

/** A registered, opened paper "p2" with a 1-section outline and plan. */
function openedP2(prefix: string): World {
  const sb = sandbox(prefix);
  const p2 = sb.project('p2');
  const created = runCli(sb, p2, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]);
  assert.equal(created.status, 0, created.stderr);
  writeOutline(p2, [{ n: 1, slug: 'intro' }]);
  const st = JSON.parse(readFileSync(join(p2, '.paper', 'STATE.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(p2, '.paper', 'STATE.json'), JSON.stringify({ ...st, sections: [{ n: 1, slug: 'intro' }] }, null, 2) + '\n');
  writeFileSync(join(p2, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writePlan(p2, 1, 'intro', { status: 'writing' });
  const opened = runCli(sb, p2, ['open', 'p2']);
  assert.equal(opened.status, 0, opened.stderr);
  const esc = p2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { sb, p2, bannerRe: new RegExp(`^\\(active paper "p2" at ${esc}\\)$`, 'm') };
}

test('RUN-14: after `open p2`, a read-only verb in an empty folder prints the active-paper banner', () => {
  const { sb, bannerRe } = openedP2('resolver-banner');
  const empty = sb.project('empty');
  const status = runCli(sb, empty, ['status']);
  assert.match(status.stderr, bannerRe, `status: ${status.stderr}`);
  const list = runCli(sb, empty, ['list']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stderr, bannerRe);
  assert.ok(!existsSync(join(empty, '.paper')), 'a read-only verb creates nothing in the folder');
});

test('RUN-14: a fresh folder with assignment.txt + `pensmith --yolo` starts a NEW paper; p2 is untouched', () => {
  const { sb, p2 } = openedP2('resolver-fresh');
  const before = snapshot(p2);
  const mtimes = new Map([...before.keys()].map((k) => [k, statSync(join(p2, k)).mtimeMs]));
  const fresh = sb.project('fresh');
  writeFileSync(join(fresh, 'assignment.txt'), 'Write a 1500-word essay on tidal power.\n');
  const r = runCli(sb, fresh, ['--yolo']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(join(fresh, '.paper', 'STATE.json')), 'the new paper lives in the fresh folder');
  assert.deepEqual(changedPaths(before, snapshot(p2)), [], 'every file of p2 keeps its sha256');
  for (const [k, m] of mtimes) assert.equal(statSync(join(p2, k)).mtimeMs, m, `${k} keeps its mtime`);
});

test('RUN-14: with no assignment, bare `--yolo` and a non-interactive `write 1` exit 2 naming --paper and pensmith new', () => {
  const { sb, p2 } = openedP2('resolver-refuse');
  const empty = sb.project('empty');
  const before = snapshot(p2);
  for (const args of [['--yolo'], ['write', '1'], ['next'], ['resume']]) {
    const r = runCli(sb, empty, args);
    assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /^pensmith: no paper in .+, and the active paper "p2" is at .+\. Pass --paper "p2" to work on it, or run pensmith new to start a paper here/m);
    assert.doesNotMatch(r.stderr, STACK_LINE);
  }
  const yolo = runCli(sb, empty, ['write', '1', '--yolo']);
  assert.match(yolo.stderr, /--yolo never follows the active-paper pointer/);
  assert.deepEqual(changedPaths(before, snapshot(p2), IGNORE_LOGS), [], 'p2 is untouched');
  assert.ok(!existsSync(join(empty, '.paper')), 'nothing created in the empty folder');
});

test('RUN-14 / S-21: with no paper and no pointer, a mutating verb exits 2 and creates nothing and calls no model', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-no-paper-0001', PENSMITH_NO_LLM: undefined }, paper: false }, async (sb) => {
    const cases: string[][] = [
      ['write', '1'],
      ['plan', '1'],
      ['verify', '1'],
      ['research', '--yolo'],
      ['add', '10.1145/3442188.3445922'],
      ['outline', '--yolo'],
      ['compile', '--yolo'],
      ['done', '--yolo'],
    ];
    for (const args of cases) {
      const r = await sb.runTsx(null, args);
      assert.equal(r.status, EXIT_USAGE, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /^pensmith: no paper in .+ — run pensmith new to start one here, or pass --paper <name\|path>/m, args.join(' '));
      assert.doesNotMatch(r.stderr, STACK_LINE);
      assert.deepEqual(readdirSync(sb.root), [], `${args.join(' ')}: the folder is unchanged (no .paper/)`);
    }
    // An --estimate preview is read-only (it prints the projection) — but
    // "proceed" turns it into the mutating run, which is refused the same way.
    const est = await sb.runTsx(null, ['write', '1', '--estimate'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: 'y\n' });
    assert.equal(est.status, EXIT_USAGE, `${est.stdout}\n${est.stderr}`);
    assert.match(est.stderr, /^pensmith: no paper in /m);
    assert.deepEqual(readdirSync(sb.root), [], 'estimate → proceed created nothing');
    assert.equal(sb.mock!.callCount(), 0, 'no model request was made');
    // Read-only verbs still answer "no active paper", and bare/new are the way in.
    const status = await sb.runTsx(null, ['status']);
    assert.notEqual(status.status, EXIT_USAGE, status.stderr);
    assert.match(status.stdout + status.stderr, /no active paper/);
    assert.deepEqual(readdirSync(sb.root), []);
  });
});

test('RUN-14: `--paper p2 write 1` works non-interactively from anywhere', () => {
  const { sb, p2 } = openedP2('resolver-flag');
  const empty = sb.project('empty');
  const r = runCli(sb, empty, ['--paper', 'p2', 'write', '1']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(join(p2, '.paper', 'sections', '01-intro', 'DRAFT.md')), "p2's section 1 was drafted");
  assert.ok(!existsSync(join(empty, '.paper')), 'nothing written where the command was typed');
  const byPath = runCli(sb, empty, ['write', '1', `--paper=${p2}`]);
  assert.equal(byPath.status, 0, byPath.stderr);
  const unknown = runCli(sb, empty, ['--paper', 'nope', 'status']);
  assert.equal(unknown.status, EXIT_USAGE);
  assert.match(unknown.stderr, /^pensmith: --paper nope: no paper by that name \(run pensmith list\) and no \.paper\/ folder at /m);
});

test('RUN-14: in a terminal-style run (numbered answers) the pointer is offered and "continue" proceeds on p2', () => {
  const { sb, p2 } = openedP2('resolver-ask');
  const empty = sb.project('empty');
  const r = runCli(sb, empty, ['write', '1'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '1\n' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /No paper here\. Continue "p2" at .+, or start a new paper in .+\? \(select\)/);
  assert.ok(existsSync(join(p2, '.paper', 'sections', '01-intro', 'DRAFT.md')), 'continued on p2');
});

test('RUN-14: a cwd with its own .paper/ wins over the pointer (no banner)', () => {
  const { sb } = openedP2('resolver-cwd-wins');
  const mine = sb.project('mine');
  const created = runCli(sb, mine, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]);
  assert.equal(created.status, 0, created.stderr);
  const status = runCli(sb, mine, ['status']);
  assert.doesNotMatch(status.stderr, /active paper/, 'no banner: the cwd paper is used');
});

test('RUN-14: a pointer to a deleted folder is cleared with a warning', () => {
  const { sb, p2 } = openedP2('resolver-stale');
  const pointer = sandboxDataPath(sb, 'active.json'); // <data>/Library/Application Support/pensmith on macOS
  assert.ok(existsSync(pointer));
  rmSync(p2, { recursive: true, force: true });
  const empty = sb.project('empty');
  const r = runCli(sb, empty, ['status']);
  assert.match(r.stderr, /^pensmith: cleared the active-paper pointer — "p2" at .+ no longer holds a paper\.$/m);
  assert.ok(!existsSync(pointer), 'the stale pointer file is removed');
  const again = runCli(sb, empty, ['status']);
  assert.doesNotMatch(again.stderr, /cleared the active-paper pointer/, 'cleared once');
});

test('RUN-14: the MCP server and hooks never follow the pointer', async () => {
  const { sb } = openedP2('resolver-mcp');
  const empty = sb.project('empty');
  // servicePaperRoot is what mcp/server.ts main() and every hook use.
  assert.equal(servicePaperRoot({}), process.cwd(), 'the working directory, not the pointer');
  const hook = runCli(sb, empty, ['status'], { env: { PENSMITH_PAPER_ROOT: empty } });
  assert.doesNotMatch(hook.stderr, /active paper/, 'PENSMITH_PAPER_ROOT outranks the pointer for the CLI too');
});

// The modules this stream moved off the working directory onto projectRoot() /
// servicePaperRoot(). (bin/cli/status.ts is rewritten on projectRoot() by the
// llm stream; the row's rule covers the whole scope once both land.)
const CONVERTED_TO_PROJECT_ROOT = [
  'bin/pensmith.ts',
  'bin/cli/add.ts',
  'bin/cli/compile.ts',
  'bin/cli/done.ts',
  'bin/cli/intake.ts',
  'bin/cli/next.ts',
  'bin/cli/outline.ts',
  'bin/cli/plan.ts',
  'bin/cli/resume.ts',
  'bin/cli/revise.ts',
  'bin/cli/verify.ts',
  'bin/cli/write.ts',
  'bin/lib/ecosystem-presence.ts',
  'bin/lib/handoff.ts',
  'bin/lib/session-log.ts',
  'bin/lib/doctor/probes/build-artifact-resolves.ts',
  'bin/lib/doctor/probes/mcp-sdk-presence.ts',
  'hooks/stop.ts',
  'hooks/session-start.ts',
  'hooks/pre-compact.ts',
  'mcp/server.ts',
  'mcp/resources.ts',
  'mcp/tools.ts',
];

test('RUN-14: the process-cwd-paper-root chokepoint row flags its fixture and none of the converted modules', () => {
  const row = loadChokepointRow('process-cwd-paper-root');
  assert.equal(row.id, 'process-cwd-paper-root');
  assert.equal(row.requirement, 'RUN-14');
  assert.equal(row.match.kind, 'file-regex');
  assert.deepEqual(row.allow, ['bin/lib/paths.ts']);
  const re = rowPattern(row);
  assert.match(readFileSync(join(REPO, row.fixture), 'utf8'), re, 'the violation fixture is flagged');
  assert.match(readFileSync(join(REPO, 'bin/lib/paths.ts'), 'utf8'), re, 'paths.ts is the one reader of the working directory');
  const scoped = scopedFiles(row);
  for (const f of CONVERTED_TO_PROJECT_ROOT) assert.ok(scoped.includes(f), `${f} is inside the row's scope`);
  assert.deepEqual(violations(row, CONVERTED_TO_PROJECT_ROOT), [], 'no converted module reads the working directory');
});
