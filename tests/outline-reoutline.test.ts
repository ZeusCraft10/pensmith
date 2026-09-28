// tests/outline-reoutline.test.ts — GRND-09 / D-18-18: a re-outline matches
// sections by slug and never touches a kept section: kept folders keep every
// file byte- and mtime-identical, a dropped section moves to
// sections/_archive/, a section inserted after §1 while §3 is kept becomes §1a
// with the folder 01a-<slug>/, and no folder is renamed or renumbered.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { fingerprint, outlineSection, seedBriefPaper, threeSectionOutline } from './helpers/section-fixture.js';
import { planReoutline, numberFreshOutline, type ProposedSection } from '../bin/lib/section-stubs.js';
import { parseOutline } from '../bin/lib/outline-parse.js';
import { loadState } from '../bin/lib/state.js';
import { loadFrontmatterDocSync } from '../bin/lib/frontmatter.js';
import { buildStatusView } from '../bin/lib/status-view.js';
import { loadSection } from '../bin/lib/section.js';

const KEY = 'sk-test-reoutline-0001';

function p(slug: string): ProposedSection {
  const s = outlineSection(1, slug);
  return { slug: s.slug, title: s.title, purpose: s.purpose, depends_on: [], estimated_word_count: 100, assigned_sources: [], role: 'body' };
}

test('D-18-18: numbering — after a kept section with a kept follower → letter; at the end → next integer; first → largest free below', () => {
  const existing = [{ n: 1, slug: 'a' }, { n: 2, slug: 'b' }, { n: 3, slug: 'c' }];
  // Keep a and c, drop b, insert x after a.
  let r = planReoutline(existing, [p('a'), p('x'), p('c')]);
  assert.deepEqual(r.plan?.sections.map((s) => [s.slug, s.n, s.suffix]), [['a', 1, undefined], ['x', 1, 'a'], ['c', 3, undefined]]);
  assert.deepEqual(r.plan?.dropped.map((d) => d.slug), ['b']);
  assert.deepEqual(r.plan?.kept, ['a', 'c']);
  assert.deepEqual(r.plan?.added, ['x']);
  // Two new sections in a row between kept ones: 1a, 1b.
  r = planReoutline(existing, [p('a'), p('x'), p('y'), p('b'), p('c')]);
  assert.deepEqual(r.plan?.sections.map((s) => `${s.n}${s.suffix ?? ''}`), ['1', '1a', '1b', '2', '3']);
  // New sections after every kept one: the next integers.
  r = planReoutline(existing, [p('a'), p('b'), p('c'), p('x'), p('y')]);
  assert.deepEqual(r.plan?.sections.map((s) => `${s.n}${s.suffix ?? ''}`), ['1', '2', '3', '4', '5']);
  // A new first section when the first kept section is §3: the largest free integer below (2).
  r = planReoutline([{ n: 3, slug: 'c' }], [p('x'), p('c')]);
  assert.deepEqual(r.plan?.sections.map((s) => `${s.n}${s.suffix ?? ''}`), ['2', '3']);
  // No free number below §1 → an issue (the model gets one corrective turn).
  r = planReoutline(existing, [p('x'), p('a'), p('b'), p('c')]);
  assert.equal(r.plan, null);
  assert.match(r.issues[0]!.message, /new section "x" cannot be numbered: it comes before §1/);
  // A letter already used by a kept section is skipped.
  r = planReoutline([{ n: 1, slug: 'a' }, { n: 1, suffix: 'a', slug: 'aa' }, { n: 2, slug: 'b' }], [p('a'), p('aa'), p('x'), p('b')]);
  assert.deepEqual(r.plan?.sections.map((s) => `${s.n}${s.suffix ?? ''}`), ['1', '1a', '1b', '2']);
  // A kept section keeps its PLAN.md allocation (FEED-04).
  r = planReoutline([{ n: 1, slug: 'a', assignedSources: ['k1'] }], [{ ...p('a'), assigned_sources: ['model-pick'] }]);
  assert.deepEqual(r.plan?.sections[0]!.assigned_sources, ['k1']);
  assert.deepEqual(numberFreshOutline([p('a'), p('b')]).map((s) => s.n), [1, 2]);
});

test('GRND-09: outline --force --yolo keeps §1/§3 untouched, archives §2, inserts §1a — no folder renamed', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedBriefPaper(sb.root);
    sb.mock!.script('outline-author', { data: threeSectionOutline() });
    const first = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(first.status, 0, first.stderr);
    // Drafts exist: §1 and §3 have work in them.
    const sections = path.join(sb.paper, 'sections');
    for (const d of ['01-introduction', '03-conclusion', '02-background']) fs.writeFileSync(path.join(sections, d, 'DRAFT.md'), `Draft of ${d}.\n`);
    const keptBefore = new Map([['01-introduction', fingerprint(path.join(sections, '01-introduction'))], ['03-conclusion', fingerprint(path.join(sections, '03-conclusion'))]]);

    // Without --force: refused, nothing touched, no model call.
    const noForce = await sb.runTsx(null, ['outline', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(noForce.status, 0, noForce.stderr);
    assert.match(noForce.stdout, /Not regenerating — pass --force to re-outline/);
    assert.equal(sb.mock!.callCount('outline-author'), 1);

    // Keep introduction and conclusion, drop background, insert methods after introduction.
    const next = threeSectionOutline();
    next.sections = [
      next.sections[0]!,
      outlineSection(2, 'methods', { depends_on: ['introduction'], assigned_sources: ['luong2015'], estimated_word_count: 500 }),
      { ...next.sections[2]!, depends_on: ['methods'], title: 'Closing Remarks' },
    ];
    sb.mock!.script('outline-author', { data: next });
    const r = await sb.runTsx(null, ['outline', '--force', '--yolo'], { env: { ANTHROPIC_API_KEY: KEY } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /kept 2 section\(s\) untouched; added §1a methods; archived §2 background → \.paper\/sections\/_archive\/02-background/);

    // The request carried the existing sections so the model could keep slugs.
    const user = JSON.stringify(sb.mock!.bodiesFor('outline-author')[1]!['messages']);
    assert.match(user, /<existing_sections>/);
    assert.match(user, /\\"has_draft\\": true/);

    // Kept folders: every file byte- and mtime-identical.
    for (const [dir, before] of keptBefore) {
      assert.deepEqual(fingerprint(path.join(sections, dir)), before, `${dir} untouched`);
    }
    assert.deepEqual(fs.readdirSync(sections).sort(), ['01-introduction', '01a-methods', '03-conclusion', '_archive']);
    assert.deepEqual(fs.readdirSync(path.join(sections, '_archive')), ['02-background']);
    assert.equal(fs.readFileSync(path.join(sections, '_archive', '02-background', 'DRAFT.md'), 'utf8'), 'Draft of 02-background.\n');

    const state = await loadState(sb.root);
    assert.deepEqual(state.sections, [{ n: 1, slug: 'introduction' }, { n: 1, suffix: 'a', slug: 'methods' }, { n: 3, slug: 'conclusion' }]);
    const outline = parseOutline(fs.readFileSync(path.join(sb.paper, 'OUTLINE.md'), 'utf8'));
    assert.deepEqual(outline.sections.map((s) => [s.n, s.suffix, s.slug]), [[1, undefined, 'introduction'], [1, 'a', 'methods'], [3, undefined, 'conclusion']]);
    assert.equal(outline.sections[2]!.title, 'Closing Remarks', 'a kept row shows the new title');
    const stub = loadFrontmatterDocSync('plan', path.join(sections, '01a-methods', 'PLAN.md'));
    assert.equal(stub.frontmatter['suffix'], 'a');
    assert.equal(stub.frontmatter['stub'], true);

    // §1a is addressable everywhere: status, paper://section/1a.
    const view = await buildStatusView(sb.root, { tier: 'cli', glyphs: 'unicode' });
    assert.deepEqual(view.sections.map((s) => s.id), ['1', '1a', '3']);
    const payload = await loadSection(sb.root, '1a');
    assert.equal(payload.slug, 'methods');
    assert.deepEqual(payload.assigned_sources, ['luong2015']);
    const plan1a = await sb.runTsx(null, ['plan', '1a'], { env: { PENSMITH_NO_LLM: '1' } });
    assert.equal(plan1a.status, 0, plan1a.stderr);
    assert.match(plan1a.stdout, /01a-methods[/\\]PLAN\.md/);
  });
});
