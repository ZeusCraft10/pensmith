/**
 * bin/lib/scheduler.ts
 * 
 * Wave scheduler: topological sort (Kahn) + bounded parallel execution.
 */

import { Semaphore } from './budget.js';
import type { ParsedOutline } from './outline-parse.js';
import type { SectionNode, WaveGraph } from './schemas/wave-graph.js';

/**
 * buildWaveGraph (COMP-06 computeWaves)
 * Topologically sorts sections by depends_on using Kahn's algorithm.
 * Honors PLAN.md wave overrides and detects cycles.
 */
export function buildWaveGraph(
  outline: ParsedOutline,
  plans: Map<string, { wave?: number; status?: string }>
): WaveGraph {
  const nodes = new Map<string, SectionNode>();
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // 1. Initialize nodes and adjacency list
  for (const s of outline.sections) {
    const plan = plans.get(s.slug);
    const node: SectionNode = {
      n: s.n,
      slug: s.slug,
      title: s.title,
      depends_on: s.depends_on,
      wave_override: plan?.wave,
      computed_wave: 0, // initially
      status: 'pending'
    };

    // Check if any dependency is missing or failed
    for (const depSlug of s.depends_on) {
      const depPlan = plans.get(depSlug);
      // We only care about dependencies that are PART of the outline.
      // If a dependency is NOT in the outline, it's a validation error 
      // already handled by outline validation, but we'll be safe here.
      if (!depPlan || depPlan.status === 'failed') {
        node.status = 'blocked';
      }
    }

    nodes.set(s.slug, node);
    adj.set(s.slug, []);
    inDegree.set(s.slug, 0);
  }

  // 2. Build graph and compute in-degrees
  for (const s of outline.sections) {
    for (const dep of s.depends_on) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(s.slug);
        inDegree.set(s.slug, (inDegree.get(s.slug) || 0) + 1);
      }
    }
  }

  // 3. Kahn's algorithm for computed_wave
  const queue: string[] = [];
  for (const [slug, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(slug);
      nodes.get(slug)!.computed_wave = 1;
    }
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    processedCount++;
    const uNode = nodes.get(u)!;

    // Honor override if valid
    if (uNode.wave_override) {
      if (uNode.wave_override < uNode.computed_wave) {
        throw new Error(`invalid wave override for ${u}: ${uNode.wave_override} < ${uNode.computed_wave}`);
      }
      uNode.computed_wave = uNode.wave_override;
    }

    for (const v of adj.get(u)!) {
      const vNode = nodes.get(v)!;
      vNode.computed_wave = Math.max(vNode.computed_wave, uNode.computed_wave + 1);
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  if (processedCount !== nodes.size) {
    const unprocessed = Array.from(nodes.keys()).filter(s => inDegree.get(s)! > 0);
    throw new Error(`Cycle detected in outline dependencies involving: ${unprocessed.join(', ')}`);
  }

  // 4. Propagate 'blocked' status transitively
  // We do this in wave order to ensure all descendants are caught.
  const sortedNodes = Array.from(nodes.values()).sort((a, b) => a.computed_wave - b.computed_wave);
  for (const node of sortedNodes) {
    if (node.status === 'blocked') continue;
    for (const depSlug of node.depends_on) {
      const depNode = nodes.get(depSlug);
      if (depNode && (depNode.status === 'blocked' || depNode.status === 'failed')) {
        node.status = 'blocked';
        break;
      }
    }
  }

  return { nodes };
}

/**
 * runWave
 * Executes a set of nodes concurrently under a semaphore cap.
 */
export async function runWave(
  nodes: SectionNode[],
  sem: Semaphore,
  run: (node: SectionNode) => Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> {
  const tasks = nodes.map(node => {
    if (node.status === 'blocked') {
      return Promise.reject({ slug: node.slug, error: 'blocked' });
    }
    return sem.withLock(async () => {
      try {
        node.status = 'in_flight';
        const res = await run(node);
        node.status = 'done';
        return res;
      } catch (err) {
        node.status = 'failed';
        throw { slug: node.slug, error: err instanceof Error ? err.message : String(err) };
      }
    });
  });

  return Promise.allSettled(tasks);
}
