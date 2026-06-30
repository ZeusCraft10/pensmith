// bin/lib/scheduler.ts — read-only wave scheduler (Phase 4 Plan 04-01).
//
// This module is the canonical home of COMP-06 (`computeWaves()`): it
// topologically sorts sections by `depends_on` via Kahn's algorithm so
// independent sections can be written in parallel waves (Tier 1) or serially
// (Tier 2). It also validates optional PLAN.md `wave:` overrides (PLAN-02 /
// PLAN-03) and runs siblings in bounded parallel via the existing in-repo
// `Semaphore` (ARCH-19 / D-02).
//
// HARD INVARIANTS:
//   - READ-ONLY (D-04 / ARCH-20): this module performs NO fs I/O and persists
//     NOTHING. The caller supplies the parsed outline + a slug→PlanFrontmatter
//     map; wave assignment is recomputed in memory each run.
//   - Reuse the in-repo Semaphore (budget.ts) — NO new dependency (D-15).
//   - Kahn assigns computed_wave = max(deps.computed_wave) + 1; roots = wave 1.
//   - A valid override (>= floor) PROMOTES computed_wave; an invalid override
//     (< floor) THROWS (never silently bumps).
//   - A dependency cycle is detected after Kahn and THROWS with the residual
//     slug list (Research §P pitfall 1) — never silently accepted.
//   - runWave uses Promise.allSettled so one rejection never cancels siblings
//     (D-03), and normalizes a thrown non-Error before allSettled sees it
//     (Research §P pitfall 5).

import type { Semaphore } from './budget.js';
import type { ParsedOutline } from './outline-parse.js';
import type { PlanFrontmatter } from './schemas/plan-frontmatter.js';
import {
  SectionNodeSchema,
  type SectionNode,
  type WaveGraph,
} from './schemas/wave-graph.js';

/**
 * Build the in-memory wave graph (COMP-06 `computeWaves()`): Kahn topological
 * sort by `depends_on`, optional-override validation, and grouping into waves.
 *
 * @param outline  parsed OUTLINE.md (reader order, slug + depends_on per section)
 * @param plans    slug → PLAN.md frontmatter (source of `wave:` overrides).
 *                 A section whose PLAN.md is ABSENT from this map is skipped
 *                 ("not yet planned" — INFO, not an error).
 * @throws if an override is below its dependency floor (PLAN-03) or the
 *         dependency graph contains a cycle.
 */
export function buildWaveGraph(
  outline: ParsedOutline,
  plans: Map<string, PlanFrontmatter>,
): WaveGraph {
  // 1. Materialize nodes ONLY for sections that have a PLAN.md (D-04: skip
  //    not-yet-planned sections silently). depends_on comes from the outline
  //    (the canonical dependency graph); the plan supplies the wave override.
  const nodes = new Map<string, SectionNode>();
  for (const s of outline.sections) {
    const plan = plans.get(s.slug);
    if (!plan) continue; // not yet planned — skip this run (INFO)
    const node: SectionNode = SectionNodeSchema.parse({
      n: s.n,
      slug: s.slug,
      title: s.title,
      depends_on: s.depends_on,
      ...(plan.wave !== undefined ? { wave_override: plan.wave } : {}),
      computed_wave: 1, // provisional; assigned below
      status: 'pending',
    });
    nodes.set(s.slug, node);
  }

  // 2. Kahn's algorithm — assign computed_wave by topological depth.
  //    in-degree counts only dependencies that are themselves materialized
  //    nodes (a dep on a not-yet-planned section is treated as already
  //    satisfied for THIS run).
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep slug -> [slugs that depend on it]
  for (const [slug, node] of nodes) {
    const realDeps = node.depends_on.filter((d) => nodes.has(d));
    indegree.set(slug, realDeps.length);
    for (const dep of realDeps) {
      const list = dependents.get(dep) ?? [];
      list.push(slug);
      dependents.set(dep, list);
    }
  }

  // Process roots first; assign each node a wave = max(deps.computed_wave)+1.
  let frontier: string[] = [...nodes.keys()].filter((s) => (indegree.get(s) ?? 0) === 0);
  // Roots are wave 1 by definition.
  for (const slug of frontier) nodes.get(slug)!.computed_wave = 1;

  let processed = 0;
  // Record the topological finalization order so override re-propagation (step 4)
  // can walk dependencies-before-dependents (audit #33).
  const topoOrder: string[] = [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const slug of frontier) {
      processed += 1;
      topoOrder.push(slug);
      const node = nodes.get(slug)!;
      for (const child of dependents.get(slug) ?? []) {
        const childNode = nodes.get(child)!;
        // child's wave is at least (this dep's wave + 1)
        childNode.computed_wave = Math.max(childNode.computed_wave, node.computed_wave + 1);
        const remaining = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, remaining);
        if (remaining === 0) next.push(child);
      }
    }
    frontier = next;
  }

  // 3. Cycle detection (Research §P pitfall 1): any node not processed by Kahn
  //    is part of (or downstream of) a cycle.
  if (processed !== nodes.size) {
    const residual = [...nodes.keys()].filter((s) => (indegree.get(s) ?? 0) > 0);
    throw new Error(
      `scheduler: dependency cycle detected — unresolved sections: ${residual.join(', ')}`,
    );
  }

  // 4. Override application + dependency re-propagation in TOPOLOGICAL order
  //    (PLAN-02 / PLAN-03 / D-01, audit #33). Walking topoOrder guarantees every
  //    dependency is FINAL before its dependents. For each node the legal floor
  //    is max(deps.computed_wave) + 1 computed from the now-FINAL dependency
  //    waves — so when a `wave:` override PROMOTES a dependency to a later wave,
  //    its dependents are lifted past it and the topo invariant (dependent wave >
  //    dependency wave) still holds. The old single pass validated each override
  //    against its Kahn depth only and never re-propagated promotions, so a valid
  //    override on a dependency could leave a dependent scheduled in the same or
  //    an earlier wave. An override below the (post-override) floor is illegal.
  for (const slug of topoOrder) {
    const node = nodes.get(slug)!;
    const realDeps = node.depends_on.filter((d) => nodes.has(d));
    const depFloor =
      realDeps.length === 0
        ? 1
        : Math.max(...realDeps.map((d) => nodes.get(d)!.computed_wave)) + 1;
    if (node.wave_override !== undefined) {
      if (node.wave_override < depFloor) {
        throw new Error(
          `scheduler: invalid wave override for section "${node.slug}": ` +
            `declared wave ${node.wave_override} is below the minimum legal wave ${depFloor} ` +
            `(must be >= max(deps.computed_wave) + 1) (PLAN-03 / D-01)`,
        );
      }
      node.computed_wave = node.wave_override;
    } else {
      node.computed_wave = depFloor;
    }
  }

  // 5. Group into waves[] (waves[0] = wave-1 nodes). After overrides, a wave
  //    index may be empty (e.g. an override skips wave 2); we keep dense rows
  //    by collecting all distinct wave numbers in ascending order.
  const maxWave = [...nodes.values()].reduce((m, nde) => Math.max(m, nde.computed_wave), 0);
  const waves: SectionNode[][] = [];
  for (let w = 1; w <= maxWave; w += 1) {
    waves.push([...nodes.values()].filter((nde) => nde.computed_wave === w));
  }

  return { nodes, waves };
}

/**
 * Run a wave's nodes in bounded parallel under `sem` (ARCH-19 / D-02).
 *
 * Uses Promise.allSettled so one rejection never cancels its siblings (D-03).
 * A thrown non-Error is normalized to an Error before allSettled records the
 * rejection reason (Research §P pitfall 5). Does NOT nest withLock calls
 * (pitfall 4) — each node is a single top-level acquire.
 *
 * @returns settled results in the SAME order as `nodes`.
 */
export async function runWave<T, R>(
  nodes: T[],
  sem: Semaphore,
  run: (node: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return Promise.allSettled(
    nodes.map((node) =>
      sem.withLock(async () => {
        try {
          return await run(node);
        } catch (err) {
          // Normalize non-Error throws so allSettled has a usable reason.
          throw err instanceof Error ? err : new Error(String(err));
        }
      }),
    ),
  );
}
