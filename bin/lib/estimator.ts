// bin/lib/estimator.ts — the `--estimate` token and USD projection, and the
// 50%-of-cap predicate the --yolo pre-flight reads.
//
// projectEstimate counts only the work still to do: for a verb, what that verb
// will run (one section's plan, the sections a wave write would draft, the
// Pass 4 run of done); for a bare `pensmith`, next or resume, what the rest of
// the paper needs, by each section's PLAN.md status. A verb that makes no model
// call (compile, status, add, ...) costs nothing. Each step is priced with the
// model its role would use (bin/lib/llm-config.ts), so a configured cheaper or
// dearer model changes the figure.
//
// It is a forecast: no model call, no network request, no COSTS.jsonl row.
// The refusal itself lives in the dispatcher; this module only computes
// `exceedsHalfCap`. Any failure to read the paper (no STATE.json, a corrupt
// one, an unreadable runtime.json) gives the empty projection, never a throw,
// so the pre-flight can never crash a command.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadState } from './state.js';
import { readOutline } from './outline-read.js';
import { paperDir, sectionPlan } from './paths.js';
import { readSectionState, recordedSectionDecision, researchDone, sectionVerb, type RouterDecision } from './router.js';
import { callCost, resolveCall } from './llm-config.js';
import type { LlmRole } from './generator.js';
import { DEFAULT_COST_CAP_USD } from './budget.js';

export interface EstimateRow {
  step: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface EstimateResult {
  rows: EstimateRow[];
  totalUsd: number;
  exceedsHalfCap: boolean;
}

type Step = 'new' | 'research' | 'outline' | 'plan' | 'write' | 'verify' | 'revise' | 'done';

// Static token counts per step: conservative (about twice what a run usually
// uses), so label the output "estimated ±50%". plan, write and verify are per
// section; verify and done are the advisory Pass 2 and Pass 4 calls.
const STEP_HEURISTICS: Readonly<Record<Step, { inputTokens: number; outputTokens: number }>> = {
  new: { inputTokens: 5_000, outputTokens: 2_000 },
  research: { inputTokens: 50_000, outputTokens: 8_000 },
  outline: { inputTokens: 10_000, outputTokens: 3_000 },
  plan: { inputTokens: 8_000, outputTokens: 2_000 },
  write: { inputTokens: 15_000, outputTokens: 5_000 },
  verify: { inputTokens: 20_000, outputTokens: 3_000 },
  revise: { inputTokens: 8_000, outputTokens: 2_000 },
  done: { inputTokens: 30_000, outputTokens: 5_000 },
};

/** The role whose model prices each step. */
const STEP_ROLE: Readonly<Record<Step, LlmRole>> = {
  new: 'intake',
  research: 'research',
  outline: 'outline',
  plan: 'plan',
  write: 'write',
  verify: 'verify',
  revise: 'revise',
  done: 'verify',
};

const SECTION_PIPELINE: readonly Step[] = ['plan', 'write', 'verify'];

/**
 * The steps a section still needs: from the verb the router would run for its
 * PLAN.md status to the end of the pipeline. No PLAN.md counts as 'stub',
 * and a status pensmith does not know as the whole pipeline.
 */
function remainingSteps(status: string | null): readonly Step[] {
  const verb = sectionVerb(status ?? 'stub');
  if (verb === 'verified') return [];
  return SECTION_PIPELINE.slice(verb === null ? 0 : SECTION_PIPELINE.indexOf(verb));
}

/**
 * The steps a router decision for a section leads to: the step it names,
 * then verify for the draft that step changes. Nothing runs for a section
 * that is through, or one that needs the person first.
 */
function stepsAfter(d: RouterDecision | null): readonly Step[] {
  switch (d?.verb) {
    case 'plan':
      return d.revise ? ['revise', 'verify'] : SECTION_PIPELINE;
    case 'write':
      return ['write', 'verify'];
    case 'verify':
      return ['verify'];
    default:
      return [];
  }
}

/** A section's PLAN.md status, and the steps the rest of the paper needs for it. */
interface Section { n: number; status: string | null; steps: readonly Step[] }

/** Which steps, with which labels, `verb` (null: the rest of the paper) would run. */
function plannedSteps(
  verb: string | null,
  n: number | null,
  sections: readonly Section[],
  paper: { researched: boolean; outlined: boolean; finished: boolean },
): Array<[Step, string]> {
  const section = (s: Step): Array<[Step, string]> => [[s, n !== null ? `${s} §${n}` : s]];
  switch (verb) {
    case 'new':
    case 'research':
    case 'outline':
    case 'done':
      return [[verb, verb]];
    case 'plan':
    case 'verify':
      return section(verb);
    case 'write':
      if (n !== null) return section('write');
      return sections.filter((s) => remainingSteps(s.status).includes('write')).map((s) => ['write', `write §${s.n}`]);
    case null:
    case 'next':
    case 'resume': {
      const steps: Array<[Step, string]> = [];
      if (!paper.researched) steps.push(['research', 'research']);
      if (!paper.outlined) steps.push(['outline', 'outline']);
      for (const s of sections) {
        for (const step of s.steps) steps.push([step, `${step} §${s.n}`]);
      }
      if (!paper.finished) steps.push(['done', 'done']);
      return steps;
    }
    default:
      // compile, status, list, doctor, open, ack, add, sketch: no model call.
      return [];
  }
}

/**
 * Project the token and USD cost of what `verb` (or, with none, the rest of
 * the paper at `paperRoot`) would still run.
 *
 * Returns { rows, totalUsd, exceedsHalfCap }, where totalUsd is the sum of the
 * rows and exceedsHalfCap is totalUsd > (sessionCapUsd ?? $5) * 0.5. Never
 * throws, never bills.
 */
export async function projectEstimate(args: {
  paperRoot: string;
  sessionCapUsd?: number;
  /** The verb that will run; null or absent for a bare `pensmith`. */
  verb?: string | null;
  /** The section number given to a section verb, if any. */
  n?: number | null;
}): Promise<EstimateResult> {
  const empty: EstimateResult = { rows: [], totalUsd: 0, exceedsHalfCap: false };
  try {
    await loadState(args.paperRoot);
    const pDir = paperDir(args.paperRoot);
    const outline = readOutline(args.paperRoot);
    const sections: Section[] = [...(outline.ok ? outline.outline.sections : [])]
      .sort((a, b) => a.n - b.n)
      .map(({ n, slug }) => {
        const r = readSectionState(sectionPlan(n, slug, args.paperRoot));
        const status = r.absent ? null : r.status;
        // A failed or unverifiable section goes where its recorded verdicts
        // send it (plan --revise, write --force, verify, or the person).
        const recorded = status === 'failed' || status === 'unverifiable';
        const steps = recorded
          ? stepsAfter(recordedSectionDecision(args.paperRoot, { n, slug }, status, r.assignedSources))
          : remainingSteps(status);
        return { n, status, steps };
      });
    const steps = plannedSteps(args.verb ?? null, args.n ?? null, sections, {
      researched: researchDone(pDir) === true,
      outlined: sections.length > 0,
      finished: existsSync(path.join(pDir, 'FINAL.md')),
    });

    const rows: EstimateRow[] = [];
    for (const [step, label] of steps) {
      const heur = STEP_HEURISTICS[step];
      const usd = callCost(await resolveCall({ role: STEP_ROLE[step] }), heur);
      rows.push({ step: label, inputTokens: heur.inputTokens, outputTokens: heur.outputTokens, usd });
    }
    const totalUsd = rows.reduce((acc, r) => acc + r.usd, 0);
    const cap = args.sessionCapUsd ?? DEFAULT_COST_CAP_USD;
    return { rows, totalUsd, exceedsHalfCap: totalUsd > cap * 0.5 };
  } catch {
    return empty;
  }
}
