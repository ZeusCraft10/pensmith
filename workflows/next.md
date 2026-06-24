# pensmith next

> Advance to the next workflow step based on current paper state — the bare `/pensmith` flow.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/STATE.json') + direct per-section PLAN.md reads
</capability_check>

## Overview

`pensmith next` is the bare `/pensmith` invocation: the state-aware next-step resolver.
It calls `resolveNextAction()` (`bin/lib/router.ts`) — a pure function over STATE.json
+ per-section PLAN.md frontmatter. The resolver IGNORES HANDOFF.json (H4) and NEVER
returns `{ verb:'resume' }`. It dispatches the resolved verb via `dispatchVerb()`.

State machine: `new → research → outline → (plan → write → verify per section) → compile → done`.
Goal-aware: `stopAfterResearch` maps `goal:'learning'` → hard-stop after research verb.

## Outputs

- Delegates entirely to the dispatched verb. No direct file writes.

## Body

1. **Resolve goal** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(goal)`.

2. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (`bin/lib/router.ts`). NEVER throws (C3-HIGH-1 + C4-HIGH + C5-HIGH totality invariant — every fs/parse op is guarded with catch-all backstop).

3. **Map the decision:**
   - `{ verb:'new' }` → run intake
   - `{ verb:'research' }` → run research
   - `{ verb:'outline' }` → run outline
   - `{ verb:'plan', n, slug }` → run plan for section N
   - `{ verb:'write', n, slug }` → run write for section N
   - `{ verb:'verify', n, slug }` → run verify for section N
   - `{ verb:'compile' }` → run compile
   - `{ verb:'done' }` → print "paper complete; run `pensmith compile` to export"
   - `{ verb:'status', reason:'done' }` → learning hard-stop (render TUTORIAL.md end-state if goal='learning')
   - `{ verb:'status', reason:'attention' }` → print the attention terminus (STATE.json or section corrupt)

4. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `yolo` + other global flags (C3-HIGH-2).

5. Shell fallback (TIER-06): `pensmith next` (or bare `pensmith`).
