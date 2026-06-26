// tests/section-status-transitions.test.ts — audit #8/#9 regression.
//
// The router's per-section walk reads each section PLAN.md `status` frontmatter
// to advance the pipeline (router.ts:188-211). The write verb never set
// status:'written' (#9) and the verify verb never updated PLAN.md at all (#8),
// so a freshly-drafted section was re-routed back to plan/write and a verified
// section looped on verify — the per-section pipeline could not advance in
// Tier 2. This drives write then verify offline and asserts the PLAN.md
// transitions planned -> written -> verified, after which the router reaches
// compile.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState, initSection } from '../bin/lib/state.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { writeCommand } from '../bin/cli/write.js';
import { verifyCommand } from '../bin/cli/verify.js';

const PLAN = [
  '---',
  'status: planned',
  'assigned_sources: []',
  '---',
  '',
  '## Brief',
  '',
  'Introduce the question.',
  '',
].join('\n');

// Non-empty bib so verify does not short-circuit on the empty-bib placeholder
// path; the offline draft has no [@citekey] tokens, so Pass-1/Pass-3 are empty
// and the verdict is a clean `verified`.
const BIB = '@article{smith2020, title={A Source}, author={Smith, A}, doi={10.0/x}, year={2020}}\n';

function planStatus(planPath: string): { status?: unknown; hash?: unknown } {
  const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
  return { status: frontmatter['status'], hash: frontmatter['verified_against_draft_hash'] };
}

async function withEnvCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prevCwd = process.cwd();
  const prevNoLlm = process.env['PENSMITH_NO_LLM'];
  process.chdir(dir);
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
    if (prevNoLlm === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = prevNoLlm;
  }
}

test('section status (audit #8/#9): write -> "written", verify -> "verified", router reaches compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-status-'));
  mkdirSync(join(root, '.paper', 'sections', '01-intro'), { recursive: true });
  await initState(root);
  await initSection(root, 1, 'intro');
  // research + outline stages satisfied so the router reaches the section walk.
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), [
    '# Paper',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|------------|-------------|------------------|',
    '| 1 | intro | Introduction | | 300 | |',
    '',
  ].join('\n'));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const planPath = join(root, '.paper', 'sections', '01-intro', 'PLAN.md');
  writeFileSync(planPath, PLAN);

  await withEnvCwd(root, async () => {
    const wrun = writeCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await wrun({ args: { n: 1, slug: 'intro', yolo: true } });
  });

  // #9: write set status -> 'written' and produced the section DRAFT.md.
  assert.ok(existsSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md')), 'write must produce DRAFT.md');
  assert.equal(planStatus(planPath).status, 'written', 'write must set PLAN.md status to written');

  await withEnvCwd(root, async () => {
    const vrun = verifyCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await vrun({ args: { n: 1, slug: 'intro', yolo: true } });
  });

  // #8: verify set status -> 'verified' and stamped the D-07 draft hash.
  const after = planStatus(planPath);
  assert.equal(after.status, 'verified', 'verify must set PLAN.md status to verified');
  assert.equal(typeof after.hash, 'string', 'verify must stamp verified_against_draft_hash');
  assert.match(String(after.hash), /^[0-9a-f]{64}$/, 'hash must be a sha-256 hex digest');

  // The router now advances past the verified section to compile (project-level
  // DRAFT.md absent → next is compile).
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'compile', `router must reach compile; got ${JSON.stringify(decision)}`);
});
