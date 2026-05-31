/**
 * bin/lib/write-orchestrator.ts
 *
 * Multi-section write orchestrator (Plan 04-03).
 *
 * Drains wave graph serially wave-by-wave; within each wave, sections run
 * concurrently under the Semaphore cap (`opts.maxParallel`). A single
 * section failure never cancels its wave siblings (D-03). Downstream
 * sections whose dependency failed OR is missing/unplanned are marked
 * `blocked` and skipped (REVIEW HIGH).
 *
 * Tier-2 serial mode: when `opts.maxParallel === 1`, emits exactly ONE WARN
 * to stderr at the START of the run (not once-per-wave) via a `warnedOnce`
 * guard. The flag is parsed, never error'd (D-02).
 *
 * ARCH-20 / D-04: the orchestrator persists NOTHING. Wave state is
 * in-memory only; per-section atomic writes are the caller's
 * (`opts.writeSection`) responsibility.
 */

import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { Semaphore } from './budget.js';
import { buildWaveGraph, runWave } from './scheduler.js';
import { loadOutline } from './outline.js';
import { parseOutline } from './outline-parse.js';
import type { SectionNode } from './schemas/wave-graph.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WaveResult {
  /** Wave index (1-based, matches `computed_wave` on nodes). */
  waveIndex: number;
  /** Nodes that were scheduled in this wave (including blocked ones). */
  wave: SectionNode[];
  /** Settled outcomes for each non-blocked node in this wave. */
  settled: PromiseSettledResult<unknown>[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load PLAN.md frontmatter data for all sections in the outline.
 *
 * Returns a Map<slug, { wave?: number; status?: string }>.
 * Sections without a PLAN.md on disk are ABSENT from the map (signal:
 * missing/unplanned dependency — causes `buildWaveGraph` to mark dependents
 * as `blocked`, per REVIEW HIGH).
 *
 * We only need `wave` (override) and `status` fields from frontmatter.
 * We use a simple TOML-naive regex parse rather than importing the full
 * frontmatter parser (which has richer dependencies) — this avoids coupling
 * the orchestrator to the drafter stack.
 */
async function loadSectionPlans(
  paperDir: string,
  slugs: string[],
): Promise<Map<string, { wave?: number; status?: string }>> {
  const plans = new Map<string, { wave?: number; status?: string }>();

  // Try to read per-section PLAN.md for each slug in the outline.
  // We scan the sections directory for directories whose slug matches.
  let sectionEntries: string[] = [];
  try {
    const sectionsDir = join(paperDir, 'sections');
    const dirents = await readdir(sectionsDir);
    sectionEntries = dirents;
  } catch {
    // No sections directory — all sections are unplanned.
    return plans;
  }

  for (const slug of slugs) {
    // Find the directory for this slug: matches NN[letter]-slug pattern.
    const dirName = sectionEntries.find(d => {
      const m = /^(\d{2})([a-z])?-(.+)$/.exec(d);
      return m != null && m[3] === slug;
    });

    if (!dirName) {
      // Section has no directory on disk — treated as missing/unplanned.
      // Do NOT add to the map.
      continue;
    }

    // Try to read PLAN.md for this section.
    const planPath = join(paperDir, 'sections', dirName, 'PLAN.md');
    let planContent: string;
    try {
      const { readFile } = await import('node:fs/promises');
      planContent = await readFile(planPath, 'utf8');
    } catch {
      // PLAN.md absent — treated as missing/unplanned.
      continue;
    }

    // Minimal frontmatter extraction (YAML/TOML-naive regex):
    //   Extract `wave: <int>` and `status: <string>` if present.
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planContent);
    let wave: number | undefined;
    let status: string | undefined;

    if (fmMatch?.[1]) {
      const fm = fmMatch[1];
      const waveMatch = /^\s*wave\s*:\s*(\d+)\s*$/m.exec(fm);
      if (waveMatch?.[1]) {
        wave = parseInt(waveMatch[1], 10);
      }
      const statusMatch = /^\s*status\s*:\s*(.+?)\s*$/m.exec(fm);
      if (statusMatch?.[1]) {
        status = statusMatch[1].replace(/^['"]|['"]$/g, '');
      }
    }

    const planEntry: { wave?: number; status?: string } = {};
    if (wave !== undefined) planEntry.wave = wave;
    if (status !== undefined) planEntry.status = status;
    plans.set(slug, planEntry);
  }

  return plans;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Drain the wave graph for all sections in the outline.
 *
 * Waves are processed one at a time (serially). Within each wave, sections
 * run concurrently under `opts.maxParallel` (Semaphore). A rejected section
 * does not cancel its wave siblings. After each wave settles, any node whose
 * dependency FAILED or is MISSING/UNPLANNED is marked `blocked` and skipped
 * in subsequent waves (D-03 + REVIEW HIGH).
 *
 * Tier-2 (maxParallel === 1): emits a single WARN to stderr at the start of
 * the run (before the wave loop) via `warnedOnce` guard so the message fires
 * exactly once per invocation regardless of wave count (REVIEW M-04 / D-02).
 *
 * @param paperRoot  Absolute or relative project root (parent of `.paper/`).
 * @param opts.maxParallel  Concurrency cap. Tier-2 callers pass 1.
 * @param opts.writeSection  Async function to draft one section. Runs per node.
 *                           MUST NOT be called for `blocked` nodes.
 */
export async function runAllSections(
  paperRoot: string,
  opts: {
    maxParallel: number;
    writeSection: (node: SectionNode) => Promise<void>;
  },
): Promise<WaveResult[]> {
  // Tier-2 forced-serial WARN: emitted ONCE at run start, not per-wave (D-02 / M-04).
  let warnedOnce = false;
  if (opts.maxParallel === 1) {
    if (!warnedOnce) {
      process.stderr.write(
        'WARN pensmith write: Tier 2 runs sections serially; --max-parallel ignored\n',
      );
      warnedOnce = true;
    }
  }

  // Validate maxParallel as a positive integer (T-04-10).
  if (!Number.isInteger(opts.maxParallel) || opts.maxParallel < 1) {
    throw new Error(
      `runAllSections: maxParallel must be a positive integer; got ${opts.maxParallel}`,
    );
  }

  // Derive the .paper directory from the project root.
  const paperDir = join(paperRoot, '.paper');

  // Load and parse the outline.
  const rawOutline = await loadOutline(paperDir);
  if (!rawOutline) {
    // Empty/missing outline — nothing to schedule.
    return [];
  }

  const outline = parseOutline(rawOutline);
  if (outline.sections.length === 0) {
    return [];
  }

  // Load per-section PLAN.md data (slug → { wave?, status? }).
  // Sections with NO PLAN.md on disk are ABSENT from the map (= missing/unplanned).
  const plans = await loadSectionPlans(paperDir, outline.sections.map(s => s.slug));

  // Build wave graph: Kahn topological sort + blocked propagation.
  const graph = buildWaveGraph(outline, plans);

  // Group nodes by computed_wave into an ordered array of waves.
  // Some nodes may be blocked from the start (missing/failed deps at build time).
  const waveMap = new Map<number, SectionNode[]>();
  for (const node of graph.nodes.values()) {
    const w = node.computed_wave;
    if (!waveMap.has(w)) waveMap.set(w, []);
    waveMap.get(w)!.push(node);
  }

  // Sort waves by index ascending (wave 1, 2, 3, …).
  const waveIndices = Array.from(waveMap.keys()).sort((a, b) => a - b);

  const waveResults: WaveResult[] = [];

  for (const waveIndex of waveIndices) {
    const waveNodes = waveMap.get(waveIndex)!;

    // Propagate blocked status: if a node's dep was failed/blocked in a
    // prior wave, mark it blocked now (buildWaveGraph handles static
    // blocked state at construction; we re-check for runtime failures here).
    for (const node of waveNodes) {
      if (node.status === 'blocked') continue;
      for (const depSlug of node.depends_on) {
        const depNode = graph.nodes.get(depSlug);
        if (depNode && (depNode.status === 'failed' || depNode.status === 'blocked')) {
          node.status = 'blocked';
          break;
        }
      }
    }

    // Partition into active (pending) and already-blocked nodes.
    const active = waveNodes.filter(n => n.status !== 'blocked');
    const blocked = waveNodes.filter(n => n.status === 'blocked');

    // Create a new Semaphore per wave (not shared across waves — D-02).
    const sem = new Semaphore(opts.maxParallel);

    // Run this wave's active sections concurrently under the semaphore.
    const settled = await runWave(active, sem, opts.writeSection);

    // After the wave settles, mark downstream nodes blocked if their dep failed.
    // This is needed for multi-wave dependency chains (a→b→c: a fails,
    // b is blocked, c should also be blocked even though it's a wave-3 node).
    for (const result of settled) {
      if (result.status === 'rejected') {
        // Find the slug of the failed node by matching the rejection payload.
        // runWave normalizes rejections to { slug, error }.
        const payload = result.reason as { slug?: string; error?: string } | undefined;
        if (payload?.slug) {
          const failedSlug = payload.slug;
          // Propagate blocked status to all downstream nodes across all waves.
          for (const node of graph.nodes.values()) {
            if (node.status === 'blocked' || node.status === 'done' || node.status === 'failed') continue;
            if (node.depends_on.includes(failedSlug)) {
              node.status = 'blocked';
            }
          }
        }
      }
    }

    // Build blocked-settled items as rejected promises for reporting.
    // We include blocked nodes in the wave result so callers can inspect them.
    const blockedSettled: PromiseFulfilledResult<unknown>[] = blocked.map(n => ({
      status: 'fulfilled' as const,
      value: { slug: n.slug, status: 'blocked' },
    }));

    waveResults.push({
      waveIndex,
      wave: waveNodes,
      settled: [...settled, ...blockedSettled],
    });
  }

  return waveResults;
}
