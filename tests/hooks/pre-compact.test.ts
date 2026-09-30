// tests/hooks/pre-compact.test.ts — the PreCompact hook bundle (PLUG-14,
// D-23a-15, D-23a-16), spawned as Claude Code runs it:
// `node plugin/dist/hooks/pre-compact.mjs` with the documented stdin JSON.
//
// In a paper it writes `.paper/HANDOFF.json` v2 from the router's decision —
// with §2 `writing`: {phase:'sectioning', section:'2', position:'write'} —
// within its 10 s timeout, prints nothing, exits 0, and changes nothing else in
// `.paper/` (its lock lives in the data dir). Section pointers are relative
// paths. A pre-v1 root-level paper resolves too; the stdin `cwd` and
// PENSMITH_PAPER_ROOT pick the paper; the `open` pointer never does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HandoffSchema, HANDOFF_MAX_BYTES } from '../../bin/lib/handoff.js';
import { changedPaths, sandbox, sandboxDataPath, snapshot, writeState } from '../helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from '../helpers/status-fixture.js';
import { assertBundlesPresent, hookInput, runHook } from './hook-runner.js';

assertBundlesPresent();

function readHandoffFile(root: string): unknown {
  return JSON.parse(readFileSync(join(root, '.paper', 'HANDOFF.json'), 'utf8'));
}

test('PLUG-14: PreCompact in a paper with §2 writing writes a valid v2 HANDOFF {sectioning, 2, write} within 10 s', async () => {
  const sb = sandbox('hook-precompact');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const before = snapshot(join(root, '.paper'));
  const r = runHook(sb, 'pre-compact', { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'PreCompact prints nothing on stdout');
  assert.ok(r.ms < 10_000, `finished within the 10 s hook timeout (${r.ms.toFixed(0)} ms)`);
  const file = join(root, '.paper', 'HANDOFF.json');
  assert.ok(existsSync(file), `HANDOFF.json written (stderr: ${r.stderr})`);
  assert.ok(statSync(file).size <= HANDOFF_MAX_BYTES);
  const h = HandoffSchema.parse(readHandoffFile(root));
  assert.equal(h.schema_version, 2);
  assert.equal(h.phase, 'sectioning');
  assert.equal(h.section, '2');
  assert.equal(h.position, 'write');
  assert.equal(h.current_section, 'methods');
  assert.match(h.next_action, /Draft section §2 \(methods\)/);
  assert.deepEqual(
    h.section_pointers.map((p) => [p.slug, p.state, p.plan_path]),
    [
      ['intro', 'verified', '.paper/sections/01-intro/PLAN.md'],
      ['methods', 'writing', '.paper/sections/02-methods/PLAN.md'],
      ['results', 'planned', '.paper/sections/03-results/PLAN.md'],
    ],
    'one pointer per registered section, relative POSIX paths, PLAN.md status',
  );
  // SESSION.log is the paper's own session log: every STATE.json read appends a
  // `state.load` event there (as `pensmith status` does). Nothing else changes.
  assert.deepEqual(
    changedPaths(before, snapshot(join(root, '.paper')), /^SESSION\.log$/),
    ['HANDOFF.json'],
    'only HANDOFF.json changes in .paper/ (no lock file beside it)',
  );
});

test('PLUG-14: PreCompact reflects the router — a paper before research is at phase research; a finished section moves the position', async () => {
  const sb = sandbox('hook-precompact-phase');
  const early = sb.project('early');
  writeState(early, []);
  assert.equal(runHook(sb, 'pre-compact', { cwd: early }).status, 0);
  const e = HandoffSchema.parse(readHandoffFile(early));
  assert.deepEqual([e.phase, e.section, e.position], ['research', null, null]);

  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const plan = join(root, '.paper', 'sections', '02-methods', 'PLAN.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('status: writing', 'status: written'));
  writeFileSync(join(root, '.paper', 'sections', '02-methods', 'DRAFT.md'), '# Methods\n\nA draft.\n');
  assert.equal(runHook(sb, 'pre-compact', { cwd: root }).status, 0);
  const h = HandoffSchema.parse(readHandoffFile(root));
  assert.deepEqual([h.phase, h.section, h.position], ['sectioning', '2', 'verify']);
  assert.equal(h.section_pointers[1]?.draft_path, '.paper/sections/02-methods/DRAFT.md');
});

test('PLUG-14: PreCompact addresses the stdin cwd or PENSMITH_PAPER_ROOT, never the `open` pointer', async () => {
  const sb = sandbox('hook-precompact-root');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const elsewhere = sb.project('elsewhere');

  // Claude Code passes the session's cwd on stdin.
  assert.equal(runHook(sb, 'pre-compact', { cwd: elsewhere, input: hookInput('pre-compact', root) }).status, 0);
  assert.ok(existsSync(join(root, '.paper', 'HANDOFF.json')), 'written for the stdin cwd');
  assert.equal(existsSync(join(elsewhere, '.paper')), false);

  const other = sb.project('other');
  await seedThreeSectionPaper(other);
  assert.equal(runHook(sb, 'pre-compact', { cwd: elsewhere, input: hookInput('pre-compact', elsewhere), env: { PENSMITH_PAPER_ROOT: other } }).status, 0);
  assert.ok(existsSync(join(other, '.paper', 'HANDOFF.json')), 'written for PENSMITH_PAPER_ROOT');

  const pointed = sb.project('pointed');
  await seedThreeSectionPaper(pointed);
  const pointer = sandboxDataPath(sb, 'active.json');
  mkdirSync(join(pointer, '..'), { recursive: true });
  writeFileSync(pointer, JSON.stringify({ paperId: 'x', folderPath: pointed }));
  const r = runHook(sb, 'pre-compact', { cwd: elsewhere, input: hookInput('pre-compact', elsewhere) });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(pointed, '.paper', 'HANDOFF.json')), false, 'the open pointer is never followed');
  assert.equal(existsSync(join(elsewhere, '.paper')), false, 'and nothing is created where the hook ran');
});

test('PLUG-14: PreCompact with a corrupt STATE.json still exits 0 and records attention', async () => {
  const sb = sandbox('hook-precompact-corrupt');
  const root = sb.project('paper');
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'STATE.json'), '{ not json');
  const r = runHook(sb, 'pre-compact', { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const h = HandoffSchema.parse(readHandoffFile(root));
  assert.equal(h.phase, 'attention');
  assert.deepEqual(h.section_pointers, []);
});
