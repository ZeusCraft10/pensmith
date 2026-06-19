// bin/lib/estimator.ts — Phase 7 Plan 07-02. The `--estimate` token + USD
// projection (ERGO-02) and the 50%-cap PREDICATE the --yolo pre-flight reads
// (ERGO-03).
//
// projectEstimate is a PURE projection pass: it reads STATE.json to count the
// remaining sections, applies a static per-step token heuristic, and prices each
// step via estimateCost() from pricing.ts. ZERO LLM calls, ZERO network calls,
// ZERO COSTS.jsonl writes (Pitfall 8 / T-07-03 / T-07-06). It imports ONLY
// pricing.ts (pure math) + state.ts (read) — NEVER verify/pass2.ts /
// verify/pass4.ts / the Anthropic SDK / runtime.ts LLM paths.
//
// The 50%-cap REFUSAL (hard exit) lives in the dispatcher pre-flight, NOT here;
// this module computes only the pure `exceedsHalfCap` boolean (review H1 split).
//
// LOAD-ERROR GUARD (C2-H1 / C4-HIGH — load-bearing): the loadState call is
// wrapped in a CATCH-ALL try/catch. A paper-less dir (StateNotFoundError) AND a
// present-but-corrupt/schema-invalid STATE.json (SyntaxError / SchemaValidationError
// / ForwardIncompatError / EACCES) BOTH return the empty projection
// { rows:[], totalUsd:0, exceedsHalfCap:false } so the --yolo cap pre-flight sees
// "under cap" and NEVER crashes. Never re-thrown.

import { estimateCost } from './pricing.js';
import { loadState } from './state.js';

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

// Default provider + model for the projection. anthropic/claude-sonnet-4 exists
// in MODEL_PRICES (pricing.ts) and is the production-typical balanced default.
// Kept as a module constant (not a runtime.ts read) so projectEstimate stays a
// pure, IO-light projection that never touches the platform data dir.
const DEFAULT_PROVIDER_ID = 'anthropic';
const DEFAULT_MODEL_ID = 'claude-sonnet-4';

// Default session cap when the dispatcher does not pass a configured cap
// (mirrors the documented $5 default; the dispatcher passes
// PENSMITH_COST_CAP_USD when set so a lowered cap tightens the H1 threshold).
const DEFAULT_SESSION_CAP_USD = 5.0;

// STEP_HEURISTICS — static token-count estimates per workflow step. Conservative
// (≈2× expected; label output as "estimated ±50%"). plan/write/verify are
// PER-SECTION (multiplied by the section count). Calibrate via empirical runs.
const STEP_HEURISTICS = Object.freeze({
  new: { inputTokens: 5_000, outputTokens: 2_000 },
  research: { inputTokens: 50_000, outputTokens: 8_000 },
  outline: { inputTokens: 10_000, outputTokens: 3_000 },
  plan: { inputTokens: 8_000, outputTokens: 2_000 }, // per section
  write: { inputTokens: 15_000, outputTokens: 5_000 }, // per section
  verify: { inputTokens: 20_000, outputTokens: 3_000 }, // per section
  compile: { inputTokens: 20_000, outputTokens: 5_000 },
  done: { inputTokens: 30_000, outputTokens: 5_000 },
} as const);

// The per-section steps (one row per section in STATE.json).
const PER_SECTION_STEPS = ['plan', 'write', 'verify'] as const;
// The whole-paper steps (a single row each).
const WHOLE_PAPER_STEPS = ['research', 'outline', 'compile', 'done'] as const;

function rowFor(step: string, label: string): EstimateRow {
  const heur = STEP_HEURISTICS[step as keyof typeof STEP_HEURISTICS];
  const usd = estimateCost({
    providerId: DEFAULT_PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    inputTokens: heur.inputTokens,
    outputTokens: heur.outputTokens,
  });
  return { step: label, inputTokens: heur.inputTokens, outputTokens: heur.outputTokens, usd };
}

/**
 * Project the token + USD cost of completing the active paper at `paperRoot`.
 *
 * Returns { rows, totalUsd, exceedsHalfCap } where:
 *   - totalUsd === sum of rows[].usd
 *   - exceedsHalfCap === (totalUsd > (sessionCapUsd ?? 5.0) * 0.5)
 *
 * NEVER throws for ANY on-disk STATE.json — a paper-less dir AND a corrupt /
 * schema-invalid STATE.json both return the empty projection (C2-H1 / C4-HIGH).
 * NEVER bills (no COSTS.jsonl write, no LLM, no network).
 */
export async function projectEstimate(args: {
  paperRoot: string;
  sessionCapUsd?: number;
}): Promise<EstimateResult> {
  // C2-H1 / C4-HIGH LOAD-ERROR GUARD: any load/parse failure (absent file OR
  // present-but-corrupt) → empty projection. Never re-throw.
  let state;
  try {
    state = await loadState(args.paperRoot);
  } catch {
    return { rows: [], totalUsd: 0, exceedsHalfCap: false };
  }

  const sections = state.sections ?? [];
  const rows: EstimateRow[] = [];

  // Whole-paper steps (one row each).
  rows.push(rowFor('research', 'research'));
  rows.push(rowFor('outline', 'outline'));

  // Per-section steps (one row per section per step).
  for (const { n } of sections) {
    for (const step of PER_SECTION_STEPS) {
      rows.push(rowFor(step, `${step} §${n}`));
    }
  }

  // compile + done (whole-paper terminal steps).
  rows.push(rowFor('compile', 'compile'));
  rows.push(rowFor('done', 'done'));

  // Reference WHOLE_PAPER_STEPS so the const documents intent (and stays in step
  // with STEP_HEURISTICS) without an unused-binding lint failure.
  void WHOLE_PAPER_STEPS;

  const totalUsd = rows.reduce((acc, r) => acc + r.usd, 0);
  const sessionCap = args.sessionCapUsd ?? DEFAULT_SESSION_CAP_USD;
  const exceedsHalfCap = totalUsd > sessionCap * 0.5;

  return { rows, totalUsd, exceedsHalfCap };
}
