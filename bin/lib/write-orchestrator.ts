// bin/lib/write-orchestrator.ts — wave-driven multi-section write orchestrator.
//
// Phase 4 Plan 04-03 (ARCH-19 / ARCH-20). This is the glue between the Plan
// 04-01 read-only wave scheduler and the EXISTING per-section writer: when
// `pensmith write` is invoked WITHOUT a section number, it loads the outline,
// builds the wave graph, and drains the waves one at a time — running each
// wave's sections in bounded parallel, at most `maxParallel` at a time, by
// calling `opts.writeSection` for each node.
//
// Phase 18 (GRND-16, D-18-27): each section's PLAN.md is read and validated
// here. A malformed PLAN.md never aborts the wave with a raw ZodError: it is
// reported through `onInvalidPlan` as one line naming the file and the field,
// and the section stays out of the graph while independent sections still
// draft. A stub PLAN.md (the outline's, `stub: true`) is not planned yet and
// is reported through `onUnplanned`. Sections are taken in (n, suffix) order.
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
//   - Both tiers honor maxParallel (a fresh Semaphore per wave); a serial run
//     (maxParallel === 1) is simply that — no warning (GRND-16 superseded the
//     Phase 4 "--max-parallel ignored" WARN, which was never true).
//   - A thrown non-Error from writeSection is normalized to an Error by runWave
//     (Research §P-5); we never nest Semaphore.withLock (§P-4).
//   - A failure the caller marks FATAL (opts.stopOn — e.g. the session cost cap
//     or a missing key: every later call would fail the same way) stops the
//     run: sections not yet started — queued in this wave or in later waves —
//     are `skipped`, never attempted (RUN-09: one failure, one exit code).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { Semaphore } from './budget.js';
import { loadOutline } from './outline.js';
import { orderedOutlineSections, outlineSectionId, parseOutline } from './outline-parse.js';
import { loadFrontmatterDocSync } from './frontmatter.js';
import { sectionPlan } from './paths.js';
import { PlanFrontmatterSchema, type PlanFrontmatter } from './schemas/plan-frontmatter.js';
import { buildWaveGraph, runWave } from './scheduler.js';
import type { SectionNode } from './schemas/wave-graph.js';

/** Per-section outcome within a wave (final settled status only). */
export interface SectionResult {
  slug: string;
  n: number;
  /** Terminal status: 'done' (write succeeded), 'failed' (write threw),
   *  'blocked' (a transitive dependency failed, so the write was skipped), or
   *  'skipped' (not attempted: an earlier section failed fatally, opts.stopOn). */
  status: 'done' | 'failed' | 'blocked' | 'skipped';
  /** Error message when status === 'failed'. */
  error?: string;
  /** The thrown value when status === 'failed' (the caller classifies it). */
  cause?: unknown;
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

/** A section left out of the wave, and why (GRND-16). */
export interface SectionSkip {
  n: number;
  slug: string;
  /** The section id as printed (`1`, `1a`). */
  id: string;
  /** The PLAN.md path relative to the project root (forward slashes). */
  planPath: string;
  /** One line: the file and the field for an invalid PLAN.md. */
  reason: string;
}

export interface RunAllSectionsOpts {
  /** Per-wave concurrency cap (1 = one section at a time). */
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
  /**
   * Optional: true for a failure that must stop the whole run (every later
   * section would fail the same way). Sections not yet started are `skipped`.
   */
  stopOn?: (reason: unknown) => boolean;
  /** A section whose PLAN.md is malformed (named by file and field); it is left out. */
  onInvalidPlan?: (skip: SectionSkip) => void;
  /** A section whose PLAN.md is still the outline's stub; it is left out until planned. */
  onUnplanned?: (skip: SectionSkip) => void;
}

/** Thrown for a section that was never started because the run stopped. */
class SkippedAfterFatalError extends Error {
  constructor() {
    super('not attempted: an earlier section failed fatally');
    this.name = 'SkippedAfterFatalError';
  }
}

/** A single section's PLAN.md, read and validated (GRND-16). */
type PlanRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; plan: PlanFrontmatter };

/**
 * Read a single section's PLAN.md frontmatter and validate it against
 * PlanFrontmatterSchema. `absent` — the scheduler treats a not-yet-planned
 * section as "skip this run" (D-04); `invalid` — one line naming the field.
 */
function loadPlanFrontmatter(planPath: string): PlanRead {
  if (!existsSync(planPath)) return { kind: 'absent' };
  let frontmatter: Record<string, unknown>;
  try {
    // CONF-04: the versioned reader (a v0 PLAN.md is migrated in memory; the
    // per-section writer persists it when it updates the section's status). The
    // scheduler itself stays stateless — it writes nothing.
    ({ frontmatter } = loadFrontmatterDocSync('plan', planPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'invalid', reason: ((err as Error).message.split('\n')[0] ?? 'unreadable').trim() };
  }
  const r = PlanFrontmatterSchema.safeParse(frontmatter);
  if (r.success) return { kind: 'ok', plan: r.data };
  const issue = r.error.issues[0];
  const where = issue && issue.path.length > 0 ? issue.path.join('.') : 'frontmatter';
  return { kind: 'invalid', reason: `invalid field "${where}": ${issue?.message ?? 'invalid'}` };
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
  // 1. Load + parse the outline (reader-order section list + dependency graph).
  const raw = await loadOutline(paperRoot);
  const outline = parseOutline(raw);

  // 2. Build the slug→PlanFrontmatter map, in (n, suffix) order. A section with
  //    NO PLAN.md is skipped (buildWaveGraph omits it); a malformed one is
  //    reported (onInvalidPlan) and skipped; the outline's stub is reported
  //    (onUnplanned) and skipped. Honor an `only` allow-list by skipping any
  //    section not named — those sections never enter the graph, so their
  //    artifacts are never touched (section-as-phase isolation).
  const allow = opts.only ? new Set(opts.only) : null;
  const plans = new Map<string, PlanFrontmatter>();
  const ordered = orderedOutlineSections(outline);
  for (const s of ordered) {
    if (allow && !allow.has(s.slug)) continue;
    const planPath = sectionPlan(s.n, s.slug, paperRoot);
    const skip = (reason: string): SectionSkip => ({
      n: s.n,
      slug: s.slug,
      id: outlineSectionId(s),
      planPath: path.relative(paperRoot, planPath).split(path.sep).join('/'),
      reason,
    });
    const read = loadPlanFrontmatter(planPath);
    if (read.kind === 'absent') continue;
    if (read.kind === 'invalid') {
      opts.onInvalidPlan?.(skip(read.reason));
      continue;
    }
    if (read.plan.stub === true) {
      opts.onUnplanned?.(skip('not planned yet'));
      continue;
    }
    plans.set(s.slug, read.plan);
  }

  // 3. Build the wave graph (Kahn topo-sort + override validation + cycles).
  const graph = buildWaveGraph({ ...outline, sections: ordered }, plans);

  // 4. Drain waves serially. Track slugs that ended `failed` or `blocked` so a
  //    downstream node whose deps include one is pruned from later waves (D-03).
  const failedOrBlocked = new Set<string>();
  const results: WaveResult[] = [];
  // Set by the first failure opts.stopOn marks fatal: no later section starts.
  let fatal = false;
  const writeOrSkip = async (node: SectionNode): Promise<void> => {
    if (fatal) throw new SkippedAfterFatalError();
    try {
      await opts.writeSection(node);
    } catch (err) {
      if (opts.stopOn?.(err) === true) fatal = true;
      throw err;
    }
  };

  for (const waveNodes of graph.waves) {
    if (waveNodes.length === 0) continue;
    const wave = waveNodes[0]!.computed_wave;

    // Partition this wave into runnable vs. blocked (transitive dep failed).
    const runnable: SectionNode[] = [];
    const blocked: SectionNode[] = [];
    const skipped: SectionNode[] = [];
    for (const node of waveNodes) {
      const depFailed = node.depends_on.some((d) => failedOrBlocked.has(d));
      if (fatal) {
        // The run stopped on a fatal failure: this section is never attempted.
        node.status = 'blocked';
        failedOrBlocked.add(node.slug);
        skipped.push(node);
      } else if (depFailed) {
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
    const settled = await runWave(runnable, sem, writeOrSkip);

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
      } else if (r.reason instanceof SkippedAfterFatalError) {
        node.status = 'blocked';
        failedOrBlocked.add(node.slug);
        sections.push({ slug: node.slug, n: node.n, status: 'skipped' });
      } else {
        node.status = 'failed';
        failedOrBlocked.add(node.slug);
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        sections.push({ slug: node.slug, n: node.n, status: 'failed', error: reason, cause: r.reason });
      }
    }
    for (const node of blocked) {
      sections.push({ slug: node.slug, n: node.n, status: 'blocked' });
    }
    for (const node of skipped) {
      sections.push({ slug: node.slug, n: node.n, status: 'skipped' });
    }

    results.push({ wave, sections });
  }

  return results;
}
