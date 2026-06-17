// tests/wave-scheduler.test.ts — RED (Wave 0) specs for bin/lib/scheduler.ts.
//
// Covers:
//   - ARCH-19: runWave honors a Semaphore concurrency cap (bounded parallel)
//              and a single rejection does NOT prevent sibling resolution (D-03).
//   - COMP-06: buildWaveGraph topologically sorts by depends_on (Kahn), proven
//              by a fixture where depends_on order ≠ appearance order
//              (suite name includes the literal token `topo` so `-t topo` selects).
//
// No real timeouts/sleeps: concurrency is observed via a synchronous live
// counter and Promise.resolve() microtask ticks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../bin/lib/budget.js';
import { buildWaveGraph, runWave } from '../bin/lib/scheduler.js';
import type { ParsedOutline } from '../bin/lib/outline-parse.js';
import type { PlanFrontmatter } from '../bin/lib/schemas/plan-frontmatter.js';

// ---- helpers ----

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

function plansFor(
  outline: ParsedOutline,
  overrides: Record<string, number> = {},
): Map<string, PlanFrontmatter> {
  const m = new Map<string, PlanFrontmatter>();
  for (const s of outline.sections) {
    m.set(s.slug, planOf(s.slug, s.depends_on, overrides[s.slug]));
  }
  return m;
}

// ---- ARCH-19: bounded-parallel runWave ----

test('ARCH-19: runWave never exceeds the Semaphore cap', async () => {
  const sem = new Semaphore(2);
  let live = 0;
  let peak = 0;
  const nodes = [0, 1, 2, 3, 4, 5];

  await runWave(nodes, sem, async () => {
    live += 1;
    peak = Math.max(peak, live);
    // yield several microtask ticks so siblings interleave without real time.
    await Promise.resolve();
    await Promise.resolve();
    live -= 1;
  });

  assert.ok(peak <= 2, `peak concurrency ${peak} must be <= cap 2`);
  assert.ok(peak >= 1, 'at least one task must have run');
});

test('ARCH-19: runWave resolves all nodes (settled results, in order)', async () => {
  const sem = new Semaphore(3);
  const nodes = ['a', 'b', 'c'];
  const results = await runWave(nodes, sem, async (n) => `done:${n}`);
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
    ['done:a', 'done:b', 'done:c'],
  );
});

test('ARCH-19 / D-03: one rejection does not cancel sibling resolution', async () => {
  const sem = new Semaphore(2);
  const nodes = ['ok1', 'boom', 'ok2'];
  const results = await runWave(nodes, sem, async (n) => {
    if (n === 'boom') throw new Error('intentional failure');
    return n;
  });

  assert.equal(results[0]!.status, 'fulfilled');
  assert.equal(results[1]!.status, 'rejected');
  assert.equal(results[2]!.status, 'fulfilled');
  assert.equal((results[0] as PromiseFulfilledResult<string>).value, 'ok1');
  assert.equal((results[2] as PromiseFulfilledResult<string>).value, 'ok2');
});

test('ARCH-19 / D-03: a thrown non-Error is normalized so allSettled has a reason', async () => {
  const sem = new Semaphore(1);
  const results = await runWave(['x'], sem, async () => {
    // throw a non-Error value (Research §P pitfall 5)
    // eslint-disable-next-line no-throw-literal
    throw 'string failure';
  });
  assert.equal(results[0]!.status, 'rejected');
  assert.ok(results[0]!.status === 'rejected' && results[0]!.reason !== undefined);
});

// ---- COMP-06: Kahn topological sort by depends_on ----

test('topo COMP-06: buildWaveGraph assigns waves by depends_on depth, not file order', () => {
  // Appearance order is [leaf, root]; the DEP edge forces root → wave 1,
  // leaf → wave 2. If the builder used file order it would (wrongly) put
  // `leaf` in wave 1.
  const outline = outlineOf([
    { n: 1, slug: 'leaf', depends_on: ['root'] },
    { n: 2, slug: 'root', depends_on: [] },
  ]);
  const graph = buildWaveGraph(outline, plansFor(outline));

  assert.equal(graph.nodes.get('root')!.computed_wave, 1, 'root is a wave-1 node');
  assert.equal(graph.nodes.get('leaf')!.computed_wave, 2, 'leaf depends on root → wave 2');
});

test('topo COMP-06: diamond graph computes correct depths', () => {
  // a (root) ; b←a ; c←a ; d←{b,c}
  const outline = outlineOf([
    { n: 1, slug: 'a', depends_on: [] },
    { n: 2, slug: 'b', depends_on: ['a'] },
    { n: 3, slug: 'c', depends_on: ['a'] },
    { n: 4, slug: 'd', depends_on: ['b', 'c'] },
  ]);
  const graph = buildWaveGraph(outline, plansFor(outline));
  assert.equal(graph.nodes.get('a')!.computed_wave, 1);
  assert.equal(graph.nodes.get('b')!.computed_wave, 2);
  assert.equal(graph.nodes.get('c')!.computed_wave, 2);
  assert.equal(graph.nodes.get('d')!.computed_wave, 3);
});

test('topo COMP-06: waves[] groups siblings at the same depth', () => {
  const outline = outlineOf([
    { n: 1, slug: 'a', depends_on: [] },
    { n: 2, slug: 'b', depends_on: ['a'] },
    { n: 3, slug: 'c', depends_on: ['a'] },
  ]);
  const graph = buildWaveGraph(outline, plansFor(outline));
  // waves[0] = wave-1 nodes, waves[1] = wave-2 nodes
  assert.deepEqual(graph.waves[0]!.map((nde) => nde.slug), ['a']);
  assert.deepEqual(
    graph.waves[1]!.map((nde) => nde.slug).sort(),
    ['b', 'c'],
  );
});

test('topo COMP-06: a dependency cycle is detected and surfaced', () => {
  const outline = outlineOf([
    { n: 1, slug: 'x', depends_on: ['y'] },
    { n: 2, slug: 'y', depends_on: ['x'] },
  ]);
  // Build plans whose depends_on mirror the cyclic outline.
  const plans = new Map<string, PlanFrontmatter>([
    ['x', planOf('x', ['y'])],
    ['y', planOf('y', ['x'])],
  ]);
  let err: unknown;
  try {
    buildWaveGraph(outline, plans);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, 'a cycle must throw, never be silently accepted');
  assert.match((err as Error).message, /x|y/, 'cycle error names the residual slugs');
});
