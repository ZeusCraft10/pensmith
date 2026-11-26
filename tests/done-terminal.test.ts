// tests/done-terminal.test.ts — audit #15 regression.
//
// The router counts a paper done once FINAL.md is the recorded export of the
// current compile (FINAL.md + .paper/EXPORT.json). In Tier 2 there is no
// humanizer, so runHumanizer returns null; done must still write FINAL.md and
// the export record from the text it exported, or bare `pensmith`/next/resume
// re-run the whole export pipeline on every invocation instead of reaching the
// done terminus.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState, initSection } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { withoutWhy } from './lib/router-decision.js';
import { doneCommand } from '../bin/cli/done.js';
import { writeCompileManifestFixture, writeVerificationFixture } from './lib/verification-fixture.js';

async function withEnvCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prevCwd = process.cwd();
  const prev = process.env['PENSMITH_NO_LLM'];
  process.chdir(dir);
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
    if (prev === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = prev;
  }
}

test('audit #15: Tier-2 done writes FINAL.md so the router reaches the terminal state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-doneterm-'));
  mkdirSync(join(root, '.paper', 'sections', '01-intro'), { recursive: true });
  await initState(root);
  await initSection(root, 1, 'intro');
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), [
    '# Paper', '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|------------|-------------|------------------|',
    '| 1 | intro | Introduction | | 300 | |',
    '',
  ].join('\n'));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '@article{x, title={X}, author={Y}, year={2020}}\n');
  // A verified, compiled paper: section PLAN.md verified, VERIFICATION.md clean,
  // DRAFT.md present, FINAL.md absent.
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md'), '---\nstatus: verified\nassigned_sources: []\n---\n# intro\n');
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'A grounded claim.\n');
  writeVerificationFixture(join(root, '.paper', 'sections', '01-intro'), { n: 1, slug: 'intro', draft: 'A grounded claim.\n' });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nA grounded claim.\n');
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);

  // Precondition: with DRAFT.md present but FINAL.md absent, the router wants done.
  assert.equal((await resolveNextAction(root)).verb, 'done', 'precondition: router should want done');

  await withEnvCwd(root, async () => {
    const run = doneCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    // raw = skip humanizer (the Tier-2 condition); md = deterministic offline export.
    await run({ args: { yolo: true, raw: true, format: 'md' } });
  });

  assert.ok(existsSync(join(root, '.paper', 'FINAL.md')), 'done must write FINAL.md when no humanizer ran');
  const decision = await resolveNextAction(root);
  assert.deepEqual(withoutWhy(decision), { verb: 'status', reason: 'done' }, `router must reach terminal; got ${JSON.stringify(decision)}`);
});
