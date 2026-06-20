// bin/lib/write-orchestrator.ts — wave-driven multi-section write orchestrator.
//
// Phase 4 Plan 04-03 (ARCH-19 / ARCH-20). This is the glue between the Plan
// 04-01 read-only wave scheduler and the EXISTING per-section writer: when
// `pensmith write` is invoked WITHOUT a section number, it loads the outline,
// builds the wave graph, and drains the waves one at a time — running each
// wave's sections in bounded parallel (Tier 1) or serially (Tier 2) by calling
// `opts.writeSection` for each node.
//
// HARD INVARIANTS:
//   - READ-ONLY orchestrator (ARCH-20 / D-04): this module persists NOTHING of
//     its own. It reads OUTLINE.md + each section's PLAN.md frontmatter (to
//     supply the scheduler its `wave:` overrides), then delegates ALL writes to
//     `opts.writeSection`, which performs the existing per-section atomic writes.
//     No wave-state / progress file is ever written here.
//   - Each wave drains FULLY before the next begins (D-02 — no cross-wave
//     pipelining). A fresh Semaphore is constructed per wave.
//   - Within-wave failure does NOT cancel siblings (D-03) — runWave uses
//     Promise.allSettled.
//   - After a wave settles, any downstream node whose `depends_on` (transitively)
//     includes a failed/blocked slug is marked `blocked` and SKIPPED in later
//     waves (D-03). Orthogonal subtrees proceed normally.
//   - Tier 2 forces maxParallel 1; when maxParallel === 1 we emit EXACTLY ONE
//     WARN to stderr ("--max-parallel ignored") — stderr, never stdout, to keep
//     the MCP stdio frame clean (T-04-13).
//   - A thrown non-Error from writeSection is normalized to an Error by runWave
//     (Research §P-5); we never nest Semaphore.withLock (§P-4).

import { Semaphore } from './budget.js';
import { loadOutline } from './outline.js';
import { parseOutline } from './outline-parse.js';
import { parseFrontmatter } from './frontmatter.js';
import { sectionPlan, paperDir } from './paths.js';
import { PlanFrontmatterSchema, type PlanFrontmatter } from './schemas/plan-frontmatter.js';
import { buildWaveGraph, runWave } from './scheduler.js';
import type { SectionNode } from './schemas/wave-graph.js';
import { readFile } from 'node:fs/promises';

/** Per-section outcome within a wave (final settled status only). */
export interface SectionResult {
  slug: string;
  n: number;
  /** Terminal status: 'done' (write succeeded), 'failed' (write threw), or
   *  'blocked' (a transitive dependency failed, so the write was skipped). */
  status: 'done' | 'failed' | 'blocked';
  /** Error message when status === 'failed'. */
  error?: string;
}

/** The settled outcome of a single wave. */
export interface WaveResult {
  /** 1-based wave index (matches SectionNode.computed_wave). */
  wave: number;
  sections: SectionResult[];
}

/**
 * Additive, GOAL-UNAWARE observer seam (Plan 09-02). Invoked once after each
 * FULFILLED section with the section's identity + its assigned source citekeys.
 * Foundation knows NOTHING about who consumes this or why — the CLI tier wires a
 * consumer (or leaves it `undefined`). This is a callback-invocation seam, NOT a
 * mode/branch check: the only guard this module adds is `if (opts.onSectionWritten)`.
 */
export type SectionWrittenCallback = (opts: {
  n: number;
  slug: string;
  planPath: string;
  assignedSources: string[];
}) => void;

export interface RunAllSectionsOpts {
  /** Per-wave concurrency cap. Tier 2 forces 1 (with a single WARN). */
  maxParallel: number;
  /** The existing per-section writer, invoked once per non-blocked node. */
  writeSection: (node: SectionNode) => Promise<void>;
  /**
   * Optional slug allow-list. When present, only these sections are written
   * (a re-run of one or more named sections); the rest are left untouched.
   * Sections NOT in the list are omitted from the wave graph entirely, so the
   * section-as-phase isolation invariant holds by construction.
   */
  only?: string[];
  /**
   * Optional additive observer (09-02). When set, invoked once after each
   * fulfilled section. Foundation stays GOAL-UNAWARE — it never inspects this
   * callback's behavior; a goal-aware CLI caller decides whether to supply one.
   */
  onSectionWritten?: SectionWrittenCallback;
}

/**
 * Read a single section's PLAN.md frontmatter and validate it against
 * PlanFrontmatterSchema. Returns `null` when the PLAN.md is absent — the
 * scheduler treats a not-yet-planned section as "skip this run" (D-04).
 */
async function loadPlanFrontmatter(
  paperRoot: string,
  n: number,
  slug: string,
): Promise<PlanFrontmatter | null> {
  let raw: string;
  try {
    raw = await readFile(sectionPlan(n, slug, paperRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const { frontmatter } = parseFrontmatter(raw);
  return PlanFrontmatterSchema.parse(frontmatter);
}

/**
 * Drain every planned section into waves and write them wave-by-wave under a
 * bounded-parallel cap. See module header for the full invariant set.
 *
 * @param paperRoot project root containing `.paper/`
 * @returns one WaveResult per wave, in ascending wave order.
 */
export async function runAllSections(
  paperRoot: string,
  opts: RunAllSectionsOpts,
): Promise<WaveResult[]> {
  // D-02: Tier 2 forces serial execution. Emit EXACTLY ONE WARN to stderr
  // (never stdout — keeps the MCP stdio frame clean, T-04-13).
  if (opts.maxParallel === 1) {
    process.stderr.write(
      'WARN: Tier 2 runs sections serially; --max-parallel ignored\n',
    );
  }

  // 1. Load + parse the outline (reader-order section list + dependency graph).
  const raw = await loadOutline(paperDir(paperRoot));
  const outline = parseOutline(raw);

  // 2. Build the slug→PlanFrontmatter map. A section with NO PLAN.md is skipped
  //    (buildWaveGraph omits it). Honor an `only` allow-list by skipping any
  //    section not named — those sections never enter the graph, so their
  //    artifacts are never touched (section-as-phase isolation).
  const allow = opts.only ? new Set(opts.only) : null;
  const plans = new Map<string, PlanFrontmatter>();
  for (const s of outline.sections) {
    if (allow && !allow.has(s.slug)) continue;
    const plan = await loadPlanFrontmatter(paperRoot, s.n, s.slug);
    if (plan) plans.set(s.slug, plan);
  }

  // 3. Build the wave graph (Kahn topo-sort + override validation + cycles).
  const graph = buildWaveGraph(outline, plans);

  // 4. Drain waves serially. Track slugs that ended `failed` or `blocked` so a
  //    downstream node whose deps include one is pruned from later waves (D-03).
  const failedOrBlocked = new Set<string>();
  const results: WaveResult[] = [];

  for (const waveNodes of graph.waves) {
    if (waveNodes.length === 0) continue;
    const wave = waveNodes[0]!.computed_wave;

    // Partition this wave into runnable vs. blocked (transitive dep failed).
    const runnable: SectionNode[] = [];
    const blocked: SectionNode[] = [];
    for (const node of waveNodes) {
      const depFailed = node.depends_on.some((d) => failedOrBlocked.has(d));
      if (depFailed) {
        node.status = 'blocked';
        failedOrBlocked.add(node.slug); // cascade to this node's own dependents
        blocked.push(node);
      } else {
        runnable.push(node);
      }
    }

    // Run the runnable nodes in bounded parallel. A FRESH Semaphore per wave
    // enforces "each wave drains fully before the next" (D-02). One rejection
    // never cancels siblings (D-03) — runWave uses Promise.allSettled.
    const sem = new Semaphore(opts.maxParallel);
    const settled = await runWave(runnable, sem, opts.writeSection);

    const sections: SectionResult[] = [];
    for (let i = 0; i < runnable.length; i += 1) {
      const node = runnable[i]!;
      const r = settled[i]!;
      if (r.status === 'fulfilled') {
        node.status = 'done';
        sections.push({ slug: node.slug, n: node.n, status: 'done' });
        // Additive observer seam (09-02): the ONE callback-invocation guard this
        // module adds. Pass the section identity + its assigned source citekeys
        // (already in the `plans` map — no re-read). This is NOT a mode check;
        // Foundation never learns what the consumer does with it.
        if (opts.onSectionWritten) {
          opts.onSectionWritten({
            n: node.n,
            slug: node.slug,
            planPath: sectionPlan(node.n, node.slug, paperRoot),
            assignedSources: plans.get(node.slug)?.assigned_sources ?? [],
          });
        }
      } else {
        node.status = 'failed';
        failedOrBlocked.add(node.slug);
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        sections.push({ slug: node.slug, n: node.n, status: 'failed', error: reason });
      }
    }
    for (const node of blocked) {
      sections.push({ slug: node.slug, n: node.n, status: 'blocked' });
    }

    results.push({ wave, sections });
  }

  return results;
}
