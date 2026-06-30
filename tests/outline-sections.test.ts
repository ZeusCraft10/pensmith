// tests/outline-sections.test.ts — audit #1/#4 regression.
//
// #1: the outline verb writes OUTLINE.md but NEVER populated state.sections, and
//     the router gates pipeline advancement on state.sections (router.ts:182-183)
//     — so bare `pensmith`/next/resume looped on `outline` forever in both tiers.
// #4: re-dispatching `outline` (which happens whenever state.sections is empty)
//     overwrote a valid OUTLINE.md with the regenerated/placeholder text.
//
// With a valid OUTLINE.md already present, the #4 guard fires BEFORE any LLM call,
// so this exercises the real wiring fully offline: registering the sections and
// preserving the outline, after which the router advances to `plan`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outlineCommand } from '../bin/cli/outline.js';
import { initState, loadState } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';

const VALID_OUTLINE = [
  '# Social Media and Adolescent Anxiety',
  '',
  '| # | slug | title | depends_on | word target | assigned_sources |',
  '|---|------|-------|------------|-------------|------------------|',
  '| 1 | 01-introduction | Introduction | | 400 | |',
  '| 2 | 02-literature | Literature Review | 01-introduction | 800 | |',
  '',
].join('\n');

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test('outline (audit #1/#4): a valid existing OUTLINE.md is preserved and its sections register in STATE.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-outline-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root); // intake normally seeds STATE.json
  // Research-stage artifacts so the router reaches the sections check regardless
  // of which sentinel it uses (RESEARCH.md and/or LIBRARY.json).
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), VALID_OUTLINE);

  // Run outline with the valid outline present — the #4 guard returns before any
  // LLM call (no key needed).
  const res = await withCwd(root, async () =>
    (outlineCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>)({
      args: { yolo: true, force: false },
    }),
  );
  // Assert field-wise (NOT a deepEqual on the absolute path): on macOS os.tmpdir()
  // is a /var → /private/var symlink, so process.cwd()-derived res.path resolves
  // differently from `root` (the documented macOS /var hazard). Compare the path
  // by suffix instead.
  const r = res as { ok?: boolean; mode?: string; sections?: number; path?: string };
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'existing');
  assert.equal(r.sections, 2);
  assert.match(String(r.path).replace(/\\/g, '/'), /\.paper\/OUTLINE\.md$/);

  // #4: OUTLINE.md is byte-for-byte preserved (not overwritten).
  assert.equal(readFileSync(join(root, '.paper', 'OUTLINE.md'), 'utf8'), VALID_OUTLINE);

  // #1: STATE.json now carries both sections.
  const state = await loadState(root);
  assert.deepEqual(
    (state.sections ?? []).map((s) => ({ n: s.n, slug: s.slug })),
    [{ n: 1, slug: '01-introduction' }, { n: 2, slug: '02-literature' }],
  );

  // Router now advances PAST outline to the per-section pipeline.
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'plan', `router must advance to plan; got ${JSON.stringify(decision)}`);
});

test('outline (audit #1): registration is idempotent across repeated runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-outline-idem-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root);
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), VALID_OUTLINE);

  await withCwd(root, async () => {
    const run = outlineCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { yolo: true, force: false } });
    await run({ args: { yolo: true, force: false } });
  });

  const state = await loadState(root);
  assert.equal((state.sections ?? []).length, 2, 'sections must not duplicate on a second outline run');
});
