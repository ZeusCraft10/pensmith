// tests/wave-override.test.ts — RED (Wave 0) specs for the wave-override path
// of bin/lib/scheduler.ts::buildWaveGraph.
//
//   - PLAN-02: a valid `wave: N` override (N >= max(deps.wave)+1) is HONORED
//              (computed_wave is promoted to the override).
//   - PLAN-03: an INVALID override (N < max(deps.wave)+1) is REJECTED at
//              graph-build time. The suite name contains the literal token
//              `reject` so `-t reject` selects exactly the PLAN-03 case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaveGraph } from '../bin/lib/scheduler.js';
import type { ParsedOutline } from '../bin/lib/outline-parse.js';
import type { PlanFrontmatter } from '../bin/lib/schemas/plan-frontmatter.js';

function outlineOf(
  sections: Array<{ n: number; slug: string; depends_on?: string[] }>,
): ParsedOutline {
  return {
    paper_title: 'fixture',
    sections: sections.map((s) => ({
      n: s.n,
      slug: s.slug,
      title: s.slug,
      depends_on: s.depends_on ?? [],
    })),
  };
}

function planOf(slug: string, depends_on: string[], wave?: number): PlanFrontmatter {
  const base = {
    section: 1,
    slug,
    title: slug,
    depends_on,
    assigned_sources: [],
    verified_against_draft_hash: null,
    status: 'planned' as const,
  };
  return (wave === undefined ? base : { ...base, wave }) as PlanFrontmatter;
}

// ---- PLAN-02 — honors override ----

test('honors override: a section declaring wave:3 with wave-1 deps gets computed_wave 3', () => {
  const outline = outlineOf([
    { n: 1, slug: 'root', depends_on: [] },
    { n: 2, slug: 'deferred', depends_on: ['root'] },
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['root', planOf('root', [])],
    ['deferred', planOf('deferred', ['root'], 3)],
  ]);
  const graph = buildWaveGraph(outline, plans);

  assert.equal(graph.nodes.get('root')!.computed_wave, 1);
  // Kahn depth would be 2; the valid override promotes it to 3.
  assert.equal(graph.nodes.get('deferred')!.computed_wave, 3);
});

test('honors override: an override equal to the Kahn depth is accepted as-is', () => {
  const outline = outlineOf([
    { n: 1, slug: 'root', depends_on: [] },
    { n: 2, slug: 'child', depends_on: ['root'] },
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['root', planOf('root', [])],
    ['child', planOf('child', ['root'], 2)], // 2 == max(deps.wave)+1
  ]);
  const graph = buildWaveGraph(outline, plans);
  assert.equal(graph.nodes.get('child')!.computed_wave, 2);
});

// ---- PLAN-03 — reject override ----

test('reject override below max(deps.wave)+1 throws at graph-build', () => {
  const outline = outlineOf([
    { n: 1, slug: 'root', depends_on: [] },
    { n: 2, slug: 'child', depends_on: ['root'] },
  ]);
  // child depends on a wave-1 node so the floor is wave 2; declaring wave:1
  // is illegal and must be rejected (D-01 / PLAN-03 — never silently bump).
  const plans = new Map<string, PlanFrontmatter>([
    ['root', planOf('root', [])],
    ['child', planOf('child', ['root'], 1)],
  ]);
  let err: unknown;
  try {
    buildWaveGraph(outline, plans);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'an illegal override must throw');
  assert.match(
    (err as Error).message,
    /child/,
    'reject error must name the offending section slug',
  );
});

test('reject override names the violated bound in the error message', () => {
  const outline = outlineOf([
    { n: 1, slug: 'a', depends_on: [] },
    { n: 2, slug: 'b', depends_on: ['a'] },
    { n: 3, slug: 'c', depends_on: ['b'] }, // floor is wave 3
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['a', planOf('a', [])],
    ['b', planOf('b', ['a'])],
    ['c', planOf('c', ['b'], 2)], // illegal: 2 < 3
  ]);
  let err: unknown;
  try {
    buildWaveGraph(outline, plans);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error);
  // The minimum legal wave (3) should appear in the message.
  assert.match((err as Error).message, /3/);
});

// ---- audit #33 — a promoted dependency must lift its dependents ----

test('audit #33: an override PROMOTING a dependency lifts its dependent past it (topo preserved)', () => {
  const outline = outlineOf([
    { n: 1, slug: 'root', depends_on: [] },
    { n: 2, slug: 'child', depends_on: ['root'] },
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['root', planOf('root', [], 3)], // promote root from Kahn wave 1 → 3
    ['child', planOf('child', ['root'])], // no override
  ]);
  const graph = buildWaveGraph(outline, plans);
  assert.equal(graph.nodes.get('root')!.computed_wave, 3);
  // Before the fix `child` stayed at its Kahn depth 2 — i.e. BEFORE its
  // dependency root (wave 3). It must now be lifted to 4.
  assert.equal(graph.nodes.get('child')!.computed_wave, 4);
  assert.ok(
    graph.nodes.get('child')!.computed_wave > graph.nodes.get('root')!.computed_wave,
    'a dependent must run in a LATER wave than its promoted dependency',
  );
});

test('audit #33: promoting an upstream dependency lifts the whole transitive chain', () => {
  const outline = outlineOf([
    { n: 1, slug: 'a', depends_on: [] },
    { n: 2, slug: 'b', depends_on: ['a'] },
    { n: 3, slug: 'c', depends_on: ['b'] },
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['a', planOf('a', [], 5)], // promote a to wave 5
    ['b', planOf('b', ['a'])],
    ['c', planOf('c', ['b'])],
  ]);
  const graph = buildWaveGraph(outline, plans);
  assert.equal(graph.nodes.get('a')!.computed_wave, 5);
  assert.equal(graph.nodes.get('b')!.computed_wave, 6);
  assert.equal(graph.nodes.get('c')!.computed_wave, 7);
});

test('reject override (audit #33): a dependent override below a PROMOTED dependency floor throws', () => {
  const outline = outlineOf([
    { n: 1, slug: 'a', depends_on: [] },
    { n: 2, slug: 'b', depends_on: ['a'] },
  ]);
  const plans = new Map<string, PlanFrontmatter>([
    ['a', planOf('a', [], 5)], // a → wave 5, so b's floor becomes 6
    ['b', planOf('b', ['a'], 3)], // 3 < 6 → illegal once the dependency is promoted
  ]);
  assert.throws(() => buildWaveGraph(outline, plans), /invalid wave override.*b/is);
});
