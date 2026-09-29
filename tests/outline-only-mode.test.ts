// tests/outline-only-mode.test.ts — GRND-02 "Outline only" (review round 3 of
// Phase 18). The intake answer `mode = outline` is not only recorded: bare runs
// stop once the outline is approved (router.ts stopAfterOutline, set by
// bin/cli/route-options.ts from `[project] mode`), so an outline-only paper
// never pays for planning, drafting or verifying a section. Through the BUILT
// CLI, the RUN-21 mock LLM and the recorded e2e corpus.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

test('GRND-02: an outline-only paper stops at status (done) after outline approval — no section-planner or section-drafter call, no draft', async () => {
  const sb = await openChainSandbox({ prefix: 'outline-only', assignment: true });
  sandboxes.push(sb);
  sb.applyCorpusScript();
  const paper = join(sb.root, '.paper');

  const intake = await sb.run(['new', '--mode', 'outline', '--yolo']);
  assert.equal(intake.status, 0, `${intake.stdout}\n${intake.stderr}`);
  assert.match(readFileSync(join(paper, 'config.toml'), 'utf8'), /^mode = "outline"$/m);

  const chain = await sb.loop(['--yolo'], { maxRuns: 4, until: (r) => /next: status \(done/.test(r.stderr) });
  for (const r of chain) assert.equal(r.status, 0, r.stderr);
  const last = chain.at(-1)!;
  assert.match(last.stderr, /^pensmith: ran outline; next: status \(done: outline only: the approved outline is \.paper\/OUTLINE\.md/m, last.stderr);

  // The outline is approved and registered; no section went further.
  assert.ok(existsSync(join(paper, 'OUTLINE.md')));
  const sections = readdirSync(join(paper, 'sections')).filter((d) => d !== '_archive');
  assert.ok(sections.length >= 3, `sections registered: ${sections.join(', ')}`);
  for (const dir of sections) {
    assert.match(readFileSync(join(paper, 'sections', dir, 'PLAN.md'), 'utf8'), /^stub: true$/m, `${dir} is still the outline's stub`);
    assert.equal(existsSync(join(paper, 'sections', dir, 'DRAFT.md')), false, `${dir} has no draft`);
  }
  const slugs = new Set(sb.mock.requests.map((r) => r.slug));
  assert.ok(slugs.has('outline-author'), 'the outline was written');
  for (const slug of ['section-planner', 'section-drafter']) assert.equal(slugs.has(slug), false, `no ${slug} call`);

  // Another bare run, `next` and `status` all report the same stop, and bill nothing.
  const before = sb.mock.requests.length;
  const again = await sb.run(['--yolo']);
  assert.equal(again.status, 0, again.stderr);
  const status = await sb.run(['status']);
  assert.match(status.stdout, /next: status \(done\)/);
  assert.match(status.stdout, /note: outline only: .*mode = "draft"/);
  assert.equal(sb.mock.requests.length, before, 'a finished outline-only paper makes no model call');

  // An explicit section verb still runs (the stop is routing only).
  const plan = await sb.run(['plan', '1', '--yolo']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(sb.mock.requests.some((r) => r.slug === 'section-planner'), 'an explicit `plan 1` calls the planner');
});
