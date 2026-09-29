// bin/cli/route-options.ts — the CLI tier's routing options (review round 3 of
// Phase 18). resolveNextAction (bin/lib/router.ts) takes feature-agnostic stop
// flags and never reads config; every routed caller — bare `pensmith`, `next`,
// `resume`, `status`, the --estimate / --yolo pre-flight — derives them here,
// once, from the paper's config:
//   - stopAfterResearch: the educator goal (bin/cli/goal.ts, the one goal-aware
//     mapping);
//   - stopAfterOutline: `[project] mode = "outline"` (GRND-02 — "Outline only"
//     at intake stops after the approved outline).
// An explicit verb (`pensmith plan 1`) is not routed and never stops.

import type { ResolveOptions } from '../lib/router.js';
import { readPaperModeSync } from '../lib/config.js';
import { readGoalFromConfig, stopAfterResearchFor } from './goal.js';

/** The router's stop flags for the paper at `root`. Never throws. */
export function routeOptionsFor(root: string): Required<ResolveOptions> {
  return {
    stopAfterResearch: stopAfterResearchFor(readGoalFromConfig(root)),
    stopAfterOutline: readPaperModeSync(root) === 'outline',
  };
}
