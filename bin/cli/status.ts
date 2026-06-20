// bin/cli/status.ts — `pensmith status` verb entrypoint (UX-01, UX-02).
//
// THIN ORCHESTRATOR: reads STATE.json + walks each section's PLAN.md frontmatter
// THROUGH the SHARED guarded readSectionState helper (C6-HIGH — the literal
// "reuse the router's read helper" target; status.ts MUST NOT do a raw
// parseFrontmatter(readFileSync(planPath))) and prints a status table plus the
// resolved next action.
//
// NEVER CRASHES: status is the verb the router routes BOTH a corrupt STATE.json
// (C4-HIGH attention terminus) AND a corrupt per-section PLAN.md (C6-HIGH) into,
// so it must survive both. A StateNotFoundError prints "no active paper"; any
// other load error prints "STATE.json unreadable/corrupt"; a corrupt PLAN.md is
// rendered as an attention row (readSectionState never throws).
//
// stdout-only (no console.* — keeps a future stdio/MCP frame clean).

import { defineCommand } from 'citty';
import { loadState, StateNotFoundError } from '../lib/state.js';
import type { State } from '../lib/schemas/state.js';
import { resolveNextAction, readSectionState } from '../lib/router.js';
import { sectionPlan } from '../lib/paths.js';
import { readGoalFromConfig, stopAfterResearchFor } from './goal.js';

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show the active paper state: phase, per-section status, and the next action.',
  },
  async run() {
    const paperRoot = process.cwd();

    // Load STATE.json. C4-HIGH: never crash — classify the failure.
    let state: State;
    try {
      state = await loadState(paperRoot);
    } catch (e) {
      if (e instanceof StateNotFoundError) {
        process.stdout.write('pensmith status: no active paper — run `pensmith new` to start.\n');
        return { ok: false, reason: 'no-paper' };
      }
      process.stdout.write(
        `pensmith status: STATE.json is unreadable/corrupt — inspect or restore it. (${(e as Error).message})\n`,
      );
      return { ok: false, reason: 'corrupt-state' };
    }

    const sections = state.sections ?? [];
    const lines: string[] = ['pensmith status:', `  paper: ${state.paperId}`, '  sections:'];

    if (sections.length === 0) {
      lines.push('    (none yet)');
    } else {
      for (const { n, slug } of [...sections].sort((a, b) => a.n - b.n)) {
        // C6-HIGH: the ONE guarded per-section read path — NEVER a raw
        // parseFrontmatter(readFileSync(planPath)). readSectionState never throws.
        const r = readSectionState(sectionPlan(n, slug, paperRoot));
        const cell = r.absent
          ? 'not planned'
          : r.corrupt
            ? 'corrupt/unreadable PLAN.md — needs attention'
            : r.status;
        lines.push(`    §${n} ${slug}: ${cell}`);
      }
    }

    // resolveNextAction NEVER throws (C4/C5-HIGH); surface the next action.
    // Goal-aware tier: pass the goal→stopAfterResearch mapping so the surfaced
    // "next" line reflects the learning hard-stop. status is a READ-ONLY view —
    // it does NOT render TUTORIAL.md (rendering belongs to the action-taking
    // callers next/resume/bare; status only reports).
    const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
    const decision = await resolveNextAction(paperRoot, { stopAfterResearch: stop });
    const next =
      decision.verb === 'status'
        ? `status (${decision.reason})`
        : 'n' in decision
          ? `${decision.verb} §${decision.n}`
          : decision.verb;
    lines.push(`  next: ${next}`);

    process.stdout.write(lines.join('\n') + '\n');
    return { ok: true, next: decision.verb };
  },
});

export default statusCommand;
