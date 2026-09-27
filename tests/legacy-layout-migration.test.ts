// tests/legacy-layout-migration.test.ts — RUN-13 (D-17-32): all paper state
// lives under .paper/. `pensmith new` writes .paper/STATE.json (never a
// root-level STATE.json); a pre-v1 paper with root-level STATE.json +
// config.toml is moved into .paper/ atomically under the per-file lock, with a
// one-time notice, never leaving two copies and never overwriting a differing
// copy. The router's decision is the same before and after the move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';
import {
  ASSIGNMENT_FIXTURE,
  sandbox,
  runCli,
  runLibScript,
  lastJson,
  REPO,
  type Sandbox,
} from './helpers/paper-cli-harness.js';
import { loadChokepointRow, rowPattern, scopedFiles, violations } from './helpers/chokepoint-row.js';

const LEGACY_STATE = JSON.stringify({
  $schemaVersion: 2,
  paperId: 'legacy-paper',
  createdAt: '2026-01-01T00:00:00.000Z',
  sections: [{ n: 1, slug: 'intro' }],
}) + '\n';
const LEGACY_CONFIG = '[project]\ngoal = "draft"\nclass = "History 101"\n';

function seedLegacy(sb: Sandbox, name: string): string {
  const root = sb.project(name);
  writeFileSync(join(root, 'STATE.json'), LEGACY_STATE);
  writeFileSync(join(root, 'config.toml'), LEGACY_CONFIG);
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), '# Outline\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n');
  return root;
}

test('RUN-13: `pensmith new --yolo --from a.txt` writes .paper/STATE.json and no root-level STATE.json', () => {
  const sb = sandbox('layout-new');
  const root = sb.project('p');
  const r = runCli(sb, root, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')), '.paper/STATE.json');
  assert.ok(existsSync(join(root, '.paper', 'INTAKE.md')), '.paper/INTAKE.md');
  assert.ok(!existsSync(join(root, 'STATE.json')), 'no root-level STATE.json');
  const st = JSON.parse(readFileSync(join(root, '.paper', 'STATE.json'), 'utf8')) as { $schemaVersion: number; paperId: string };
  assert.equal(st.$schemaVersion, 2);
  assert.ok(st.paperId.length > 0);
});

test('RUN-13: `status` on a legacy paper moves STATE.json + config.toml into .paper/ once, with a notice', () => {
  const sb = sandbox('layout-legacy');
  const root = seedLegacy(sb, 'legacy');
  const first = runCli(sb, root, ['status']);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stderr, /^pensmith: moved STATE\.json and config\.toml from .+ into \.paper\/ \(one-time layout migration\)\.$/m);
  assert.ok(!existsSync(join(root, 'STATE.json')), 'root STATE.json moved away (no second copy)');
  assert.ok(!existsSync(join(root, 'config.toml')), 'root config.toml moved away (no second copy)');
  assert.equal(readFileSync(join(root, '.paper', 'STATE.json'), 'utf8'), LEGACY_STATE, 'moved byte-for-byte');
  assert.equal(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), LEGACY_CONFIG, 'moved byte-for-byte');

  const second = runCli(sb, root, ['status']);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stderr, /moved STATE\.json/, 'the notice prints once');
});

test('RUN-13: the router decision is identical before and after the move', () => {
  const sb = sandbox('layout-router');
  const a = seedLegacy(sb, 'a');
  const b = seedLegacy(sb, 'b');
  // a: the router reads the legacy paper (loadState moves it on the way).
  const before = lastJson<{ ok: boolean; decision: unknown }>(runLibScript(sb, 'legacy-move.ts', [a, '--router']));
  // b: moved first by the CLI, then routed.
  assert.equal(runCli(sb, b, ['status']).status, 0);
  const after = lastJson<{ ok: boolean; decision: unknown }>(runLibScript(sb, 'legacy-move.ts', [b, '--router']));
  assert.ok(before.ok && after.ok);
  assert.deepEqual(before.decision, { verb: 'plan', n: 1, slug: 'intro' });
  assert.deepEqual(after.decision, before.decision);
  assert.ok(!existsSync(join(a, 'STATE.json')), 'loadState itself runs the move');
});

test('RUN-13: identical copies collapse to one; differing copies are refused and nothing is overwritten', () => {
  const sb = sandbox('layout-conflict');
  const same = seedLegacy(sb, 'same');
  writeFileSync(join(same, '.paper', 'STATE.json'), LEGACY_STATE);
  const s = lastJson<{ ok: boolean; moved: string[] }>(runLibScript(sb, 'legacy-move.ts', [same]));
  assert.ok(s.ok);
  assert.deepEqual(s.moved, ['STATE.json', 'config.toml']);
  assert.ok(!existsSync(join(same, 'STATE.json')), 'the identical root copy is removed');

  const diff = seedLegacy(sb, 'diff');
  const newer = LEGACY_STATE.replace('legacy-paper', 'a-different-paper');
  writeFileSync(join(diff, '.paper', 'STATE.json'), newer);
  const d = lastJson<{ ok: boolean; name: string; message: string; exitCode: number }>(runLibScript(sb, 'legacy-move.ts', [diff]));
  assert.equal(d.ok, false);
  assert.equal(d.name, 'LegacyLayoutConflictError');
  assert.equal(d.exitCode, EXIT_ERROR);
  assert.match(d.message, /both .*STATE\.json \(pre-v1 layout\) and .*STATE\.json exist and differ/);
  assert.equal(readFileSync(join(diff, 'STATE.json'), 'utf8'), LEGACY_STATE, 'root copy kept');
  assert.equal(readFileSync(join(diff, '.paper', 'STATE.json'), 'utf8'), newer, '.paper copy kept');

  // Through the CLI: one line, EXIT_ERROR.
  const cli = runCli(sb, diff, ['status']);
  assert.equal(cli.status, EXIT_ERROR);
  assert.match(cli.stderr, /^pensmith: both .+ exist and differ — keep the one you want, delete the other, and re-run$/m);
});

test('RUN-13: nothing to move is a cheap no-op (idempotent)', () => {
  const sb = sandbox('layout-noop');
  const root = sb.project('fresh');
  const r = lastJson<{ ok: boolean; moved: string[] }>(runLibScript(sb, 'legacy-move.ts', [root]));
  assert.deepEqual(r, { ok: true, moved: [] });
  assert.ok(!existsSync(join(root, '.paper')), 'no .paper/ created for a folder with nothing to move');
});

test('RUN-13: PENSMITH_PAPER_ROOT names the PROJECT root for the CLI (not a .paper-style directory)', () => {
  const sb = sandbox('layout-env');
  const paper = sb.project('paper');
  const elsewhere = sb.project('elsewhere');
  const r = runCli(sb, elsewhere, ['new', '--yolo', '--from', ASSIGNMENT_FIXTURE], { env: { PENSMITH_PAPER_ROOT: paper } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(paper, '.paper', 'STATE.json')), 'written under PENSMITH_PAPER_ROOT/.paper/');
  assert.ok(!existsSync(join(elsewhere, '.paper')), 'nothing in the working directory');
});

test('RUN-13: the state-json chokepoint row flags its fixture and no shipped module outside state.ts / paths.ts', () => {
  const row = loadChokepointRow('state-json');
  assert.equal(row.id, 'state-json');
  assert.equal(row.requirement, 'RUN-13');
  assert.equal(row.match.kind, 'file-regex');
  assert.deepEqual([...row.allow].sort(), ['bin/lib/paths.ts', 'bin/lib/state.ts']);
  const re = rowPattern(row);
  assert.match(readFileSync(join(REPO, row.fixture), 'utf8'), re, 'the violation fixture is flagged');
  assert.match(readFileSync(join(REPO, 'bin/lib/paths.ts'), 'utf8'), re, 'paths.ts really is the resolver');
  const files = scopedFiles(row);
  for (const f of ['bin/pensmith.ts', 'bin/lib/state.ts', 'mcp/resources.ts', 'hooks/pre-compact.ts', 'hooks/stop.ts']) {
    assert.ok(files.includes(f), `${f} is inside the row's scope`);
  }
  assert.deepEqual(violations(row, files), [], 'no second STATE.json resolver');
});
