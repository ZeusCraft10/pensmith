// tests/section-status-stub.test.ts — 'stub' and 'planned' mean different things.
//
// 'planned' meant both "needs a plan" (the router, and outline's stub PLAN.md)
// and "the plan is done" (the Tier-1 plan workflow), so a planned section was
// routed back to plan and `pensmith plan` overwrote the finished PLAN.md. Now an
// outline entry not planned yet is 'stub', a finished plan is 'planned', and
// plan will not replace a finished plan unless asked to with --force.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSection, initState } from '../bin/lib/state.js';
import { resolveNextAction, sectionVerb } from '../bin/lib/router.js';
import { withoutWhy } from './lib/router-decision.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { isolatedCliEnv } from './lib/cli-env.js';
import { outlineTable } from './lib/outline-fixture.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

async function paper(status: string | null): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-stub-'));
  const pdir = join(root, '.paper');
  mkdirSync(join(pdir, 'sections', '01-intro'), { recursive: true });
  await initState(root);
  await initSection(root, 1, 'intro');
  writeFileSync(join(pdir, 'RESEARCH.md'), '# Research\n');
  writeFileSync(join(pdir, 'OUTLINE.md'), outlineTable([{ n: 1, slug: 'intro', title: 'Introduction' }], 'Paper'));
  const fm = ['section: 1', 'slug: intro', 'title: Introduction', ...(status ? [`status: ${status}`] : []), 'assigned_sources: []'];
  writeFileSync(join(pdir, 'sections', '01-intro', 'PLAN.md'), `---\n${fm.join('\n')}\n---\n\n## Brief\n\nThe plan the user worked on.\n`);
  return root;
}

test('the router plans a stub (or a PLAN.md with no status) and writes a planned section', async () => {
  assert.equal(sectionVerb('stub'), 'plan');
  assert.equal(sectionVerb('planned'), 'write');
  assert.equal(sectionVerb('writing'), 'write');
  assert.deepEqual(withoutWhy(await resolveNextAction(await paper('stub'))), { verb: 'plan', n: 1, slug: 'intro' });
  assert.deepEqual(withoutWhy(await resolveNextAction(await paper(null))), { verb: 'plan', n: 1, slug: 'intro' });
  assert.deepEqual(withoutWhy(await resolveNextAction(await paper('planned'))), { verb: 'write', n: 1, slug: 'intro' });
});

function runPlan(root: string, ...extra: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'plan', '1', ...extra], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1' }),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('plan refuses to replace a finished plan unless --force is given', async () => {
  const root = await paper('planned');
  const planPath = join(root, '.paper', 'sections', '01-intro', 'PLAN.md');
  const before = readFileSync(planPath, 'utf8');
  const r = runPlan(root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--force/);
  assert.equal(readFileSync(planPath, 'utf8'), before, 'the finished plan is untouched');

  const f = runPlan(root, '--force');
  assert.equal(f.status, 0, f.stdout + f.stderr);
  assert.notEqual(readFileSync(planPath, 'utf8'), before);
});

test('planning a stub marks it planned, so the router goes on to write it', async () => {
  const root = await paper('stub');
  const r = runPlan(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const fm = parseFrontmatter(readFileSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md'), 'utf8')).frontmatter;
  assert.equal(fm['status'], 'planned');
  // The plan was written under PENSMITH_NO_LLM, so it is a placeholder: the
  // router sends it to write in that mode, and to plan --force with a model.
  const saved = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    assert.equal((await resolveNextAction(root)).verb, 'write');
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM']; else process.env['PENSMITH_NO_LLM'] = saved;
  }
});

test('the workflow bodies name only statuses the schema has, with their meaning', async () => {
  const { SectionStateSchema } = await import('../bin/lib/schemas/state.js');
  const statuses = new Set<string>(SectionStateSchema.options);
  for (const name of ['plan', 'outline', 'write', 'verify', 'next', 'status']) {
    const body = readFileSync(fileURLToPath(new URL(`../workflows/${name}.md`, import.meta.url)), 'utf8');
    for (const m of body.matchAll(/\bstatus:?\s*[`'"]([a-z-]+)[`'"]/g)) {
      assert.ok(statuses.has(m[1]!), `workflows/${name}.md names status '${m[1]}', which is not one of ${[...statuses].join(', ')}`);
    }
  }
  const plan = readFileSync(fileURLToPath(new URL('../workflows/plan.md', import.meta.url)), 'utf8');
  assert.match(plan, /`stub`/);
  assert.match(plan, /`planned`/);
});
