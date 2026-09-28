// tests/section-registry.test.ts — D-18-38 (review round 2): STATE.json is the
// one authority on a section's identity, and OUTLINE.md's rows must list the
// same sections. Through the BUILT CLI (no model is needed: every path here
// refuses or registers before any model call):
//   - a user-renamed OUTLINE.md row: the router reports attention naming the
//     divergence and `pensmith outline`; `plan 2` refuses (no second folder for
//     §2); compile refuses; `outline` (no --force) asks the reoutline gate in a
//     paper with drafts (exit 3 without a terminal, nothing changed), and with
//     --yolo archives the old section, registers the renamed one with a stub
//     and leaves every other section byte- and mtime-identical;
//   - a renumbered row is refused (a section keeps its number for good);
//   - a deleted row (the old compile loop): the router reports attention
//     instead of re-dispatching compile, and applying the outline archives the
//     section, after which the paper recompiles;
//   - an existing OUTLINE.md with a dependency cycle or an unknown citekey is a
//     named refusal, never registered; the scheduler's own cycle error is a
//     named one-line refusal too (RUN-12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sandbox,
  runCli,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  snapshot,
  changedPaths,
  STACK_LINE,
} from './helpers/paper-cli-harness.js';
import { fingerprint, writeLibrary } from './helpers/section-fixture.js';
import { sectionRegistryDivergence } from '../bin/lib/section-registry.js';
import { buildWaveGraph } from '../bin/lib/scheduler.js';
import { isPensmithError, EXIT_APPROVAL, EXIT_BLOCKED, EXIT_ERROR, EXIT_OK } from '../bin/lib/exit-codes.js';

const THREE = [{ n: 1, slug: 'introduction' }, { n: 2, slug: 'discussion' }, { n: 3, slug: 'conclusion' }];
const IGNORE_LOGS = /(^|[\\/])(SESSION\.log|COSTS\.jsonl|\.session\.lock.*|.*\.lock([\\/].*)?)$/;

/** A three-section paper: every section verified with a draft (optionally compiled). */
function finishedPaper(root: string): void {
  writeState(root, THREE);
  writeLibrary(root, []);
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeOutline(root, THREE);
  for (const t of THREE) {
    writePlan(root, t.n, t.slug, { status: 'verified' });
    writeFileSync(join(sectionDirOf(root, t.n, t.slug), 'DRAFT.md'), `# ${t.slug}\n\nNo citations here.\n`);
    writeFileSync(join(sectionDirOf(root, t.n, t.slug), 'VERIFICATION.md'), `# VERIFICATION (Section ${t.n}, ${t.slug})\n\nStatus: verified\n`);
  }
}

function status(sb: ReturnType<typeof sandbox>, root: string): string {
  const r = runCli(sb, root, ['status']);
  return `${r.stdout}${r.stderr}`;
}

test('D-18-38: sectionRegistryDivergence names a renamed, renumbered, deleted and added row', () => {
  const reg = [{ n: 1, slug: 'introduction' }, { n: 2, slug: 'discussion' }, { n: 3, slug: 'conclusion' }];
  assert.deepEqual(sectionRegistryDivergence(reg, reg), []);
  assert.deepEqual(sectionRegistryDivergence(reg, [reg[0]!, { n: 2, slug: 'mechanisms' }, reg[2]!]), [
    'OUTLINE.md lists §2 as "mechanisms", but STATE.json registers §2 as "discussion"',
  ]);
  assert.deepEqual(sectionRegistryDivergence(reg, [reg[0]!, reg[1]!, { n: 4, slug: 'conclusion' }]), [
    'OUTLINE.md numbers "conclusion" §4, but STATE.json registers it as §3',
  ]);
  assert.deepEqual(sectionRegistryDivergence(reg, [reg[0]!, reg[1]!]), ['STATE.json registers §3 "conclusion", which OUTLINE.md does not list']);
  assert.deepEqual(sectionRegistryDivergence(reg, [...reg, { n: 3, suffix: 'a', slug: 'extra' }]), ['OUTLINE.md lists §3a "extra", which STATE.json does not register']);
});

test('D-18-38: a renamed OUTLINE.md row — attention, plan/compile refuse (no second folder), outline applies it through the reoutline gate', () => {
  const sb = sandbox('registry-rename');
  const root = sb.project('p');
  finishedPaper(root);
  // The user renames §2 in OUTLINE.md after approval.
  const outlineFile = join(root, '.paper', 'OUTLINE.md');
  writeFileSync(outlineFile, readFileSync(outlineFile, 'utf8').replace('| 2 | discussion | discussion |', '| 2 | mechanisms | Attention Mechanisms |'));

  assert.match(status(sb, root), /attention: OUTLINE\.md and STATE\.json disagree: OUTLINE\.md lists §2 as "mechanisms", but STATE\.json registers §2 as "discussion" — run `pensmith outline`/);

  const before = snapshot(root);
  const plan = runCli(sb, root, ['plan', '2']);
  assert.equal(plan.status, EXIT_ERROR, `${plan.stdout}\n${plan.stderr}`);
  assert.match(plan.stderr, /^pensmith plan: section 2 is "discussion" in STATE\.json, but OUTLINE\.md lists §2 as "mechanisms" — run `pensmith outline` to apply the edited OUTLINE\.md/m);
  assert.doesNotMatch(plan.stderr, /drop --slug|PENSMITH_DEBUG/);
  assert.doesNotMatch(plan.stderr, STACK_LINE);
  const compile = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(compile.status, EXIT_BLOCKED, `${compile.stdout}\n${compile.stderr}`);
  assert.match(`${compile.stdout}${compile.stderr}`, /OUTLINE\.md and STATE\.json disagree/);
  // Without a terminal and without --yolo, applying the edit (which archives a drafted section) asks first.
  const asked = runCli(sb, root, ['outline']);
  assert.equal(asked.status, EXIT_APPROVAL, `${asked.stdout}\n${asked.stderr}`);
  assert.match(asked.stderr, /applying the edited OUTLINE\.md moves §2 discussion to sections\/_archive\//);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'plan, compile and the refused outline changed nothing');
  assert.deepEqual(readdirSync(join(root, '.paper', 'sections')).sort(), ['01-introduction', '02-discussion', '03-conclusion']);

  const kept = new Map(['01-introduction', '03-conclusion'].map((d) => [d, fingerprint(join(root, '.paper', 'sections', d))]));
  const applied = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(applied.status, EXIT_OK, `${applied.stdout}\n${applied.stderr}`);
  assert.match(applied.stdout, /archived §2 discussion → \.paper\/sections\/_archive\/02-discussion/);
  assert.deepEqual(readdirSync(join(root, '.paper', 'sections')).sort(), ['01-introduction', '02-mechanisms', '03-conclusion', '_archive']);
  assert.ok(existsSync(join(root, '.paper', 'sections', '_archive', '02-discussion', 'DRAFT.md')), 'the old section is archived, not lost');
  assert.match(readFileSync(join(root, '.paper', 'sections', '02-mechanisms', 'PLAN.md'), 'utf8'), /^stub: true$/m);
  for (const [d, fp] of kept) assert.deepEqual(fingerprint(join(root, '.paper', 'sections', d)), fp, `${d} untouched`);
  const state = JSON.parse(readFileSync(join(root, '.paper', 'STATE.json'), 'utf8')) as { sections: Array<{ slug: string }> };
  assert.deepEqual(state.sections.map((s) => s.slug), ['introduction', 'mechanisms', 'conclusion']);
  assert.match(status(sb, root), /next: plan #?§?2/);
});

test('D-18-38: a renumbered row is refused — a section keeps its number and folder for good', () => {
  const sb = sandbox('registry-renumber');
  const root = sb.project('p');
  finishedPaper(root);
  writeOutline(root, [THREE[0]!, THREE[1]!, { n: 4, slug: 'conclusion' }]);
  const before = snapshot(root);
  const r = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /OUTLINE\.md renumbers "conclusion" as §4 \(it is §3\) — a section keeps its number and folder for good/);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), []);
});

test('D-18-38 / review round 2: a deleted row no longer loops the router on compile — attention, then outline archives it and the paper recompiles', () => {
  const sb = sandbox('registry-delete');
  const root = sb.project('p');
  finishedPaper(root);
  const compiled = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(compiled.status, EXIT_OK, `${compiled.stdout}\n${compiled.stderr}`);
  assert.match(status(sb, root), /next: done/);
  writeOutline(root, [THREE[0]!, THREE[1]!]);
  for (let i = 0; i < 2; i += 1) {
    const bare = runCli(sb, root, ['--yolo']);
    assert.match(bare.stderr, /ran status \(attention: OUTLINE\.md and STATE\.json disagree: STATE\.json registers §3 "conclusion", which OUTLINE\.md does not list/, bare.stderr);
    assert.doesNotMatch(bare.stderr, /ran compile/);
  }
  const applied = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(applied.status, EXIT_OK, `${applied.stdout}\n${applied.stderr}`);
  assert.match(applied.stdout, /archived §3 conclusion/);
  assert.match(status(sb, root), /next: compile/, 'the compiled draft held a section the paper no longer has');
  const recompiled = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(recompiled.status, EXIT_OK, `${recompiled.stdout}\n${recompiled.stderr}`);
  assert.match(recompiled.stdout, /2 sections/);
  assert.match(status(sb, root), /next: done/);
});

test('GRND-08 / RUN-12 (review round 2): an existing OUTLINE.md with a cycle or an unknown citekey is a named refusal, never registered', () => {
  const sb = sandbox('registry-invalid');
  const root = sb.project('p');
  writeState(root, []);
  writeLibrary(root, []);
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writeOutline(root, [{ n: 1, slug: 'alpha', deps: ['beta'], sources: ['ghost2099'] }, { n: 2, slug: 'beta', deps: ['alpha'] }]);
  const before = snapshot(root);
  const r = runCli(sb, root, ['outline', '--yolo']);
  assert.equal(r.status, EXIT_ERROR, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith outline: \.paper\/OUTLINE\.md cannot be registered: the depends_on links form a cycle through "alpha", "beta"; citekey "ghost2099" \(assigned to "alpha"\) is not in the sources block \/ LIBRARY\.json — fix the table/m);
  assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/);
  assert.deepEqual(changedPaths(before, snapshot(root), IGNORE_LOGS), [], 'nothing registered');
});

test('RUN-12 (review round 2): the scheduler\'s dependency-cycle error is a named refusal (PensmithError), not an internal error', () => {
  const plans = new Map([
    ['a', { section: 1, slug: 'a', title: 'a', depends_on: ['b'], assigned_sources: [], status: 'planned' }],
    ['b', { section: 2, slug: 'b', title: 'b', depends_on: ['a'], assigned_sources: [], status: 'planned' }],
  ]) as unknown as Parameters<typeof buildWaveGraph>[1];
  const outline = { title: '', sections: [{ n: 1, slug: 'a', title: 'a', depends_on: ['b'] }, { n: 2, slug: 'b', title: 'b', depends_on: ['a'] }] } as unknown as Parameters<typeof buildWaveGraph>[0];
  assert.throws(() => buildWaveGraph(outline, plans), (e: unknown) => isPensmithError(e) && e.exitCode === EXIT_ERROR && /dependency cycle detected — unresolved sections: a, b/.test(e.message));

  const sb = sandbox('registry-scheduler-cycle');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'alpha' }, { n: 2, slug: 'beta' }]);
  writeOutline(root, [{ n: 1, slug: 'alpha', deps: ['beta'] }, { n: 2, slug: 'beta', deps: ['alpha'] }]);
  writePlan(root, 1, 'alpha', { depends_on: '[beta]' });
  writePlan(root, 2, 'beta', { depends_on: '[alpha]' });
  const w = runCli(sb, root, ['write', '--yolo'], { env: { ANTHROPIC_API_KEY: 'sk-test-registry-0001' } });
  assert.equal(w.status, EXIT_ERROR, `${w.stdout}\n${w.stderr}`);
  assert.match(w.stderr, /^pensmith: scheduler: dependency cycle detected — unresolved sections: alpha, beta/m);
  assert.doesNotMatch(w.stderr, /PENSMITH_DEBUG/, 'an expected refusal, not an unexpected error');
});
