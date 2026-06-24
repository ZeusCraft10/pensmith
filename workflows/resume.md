# pensmith resume

> Resume an interrupted workflow: summarize the last handoff, compute the next work verb, and dispatch it.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/HANDOFF.json') + direct readFileSync('.paper/STATE.json')
</capability_check>

## Overview

`pensmith resume` follows the H4 lifecycle: it reads HANDOFF.json for the SUMMARY only
(never routes from it — no resume→resume loop), then calls `resolveNextAction()` to
compute the next WORK verb (HANDOFF-blind), dispatches via `dispatchVerb()`, then
clears HANDOFF.json (best-effort `rmSync` — stale pointer must not re-trigger resume).

The resume verb MUST NEVER dispatch to itself (H4). `resolveNextAction()` is
structurally incapable of returning `{ verb:'resume' }`.

## Outputs

- Delegates entirely to the dispatched verb. HANDOFF.json cleared after dispatch.

## Body

1. **Read HANDOFF.json** (summary only, via `safeReadHandoff()` — `existsSync` + `JSON.parse` + `HandoffSchema.safeParse`, never throws). Print to stderr: `pensmith resume: last at phase='X', section='Y'. Next: Z`. If HANDOFF absent or done, skip the summary print.

2. **Resolve goal** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(goal)`.

3. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (HANDOFF-blind resolver — C3-HIGH-1 totality guaranteed). Returns the concrete next WORK verb.

4. **Learning hard-stop check**: if `stopAfterResearch && decision.verb === 'status' && decision.reason === 'done'`, call `renderLearningEndState(paperRoot)` → writes `TUTORIAL.md`. Then consume HANDOFF.json (best-effort rmSync) and return.

5. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `--dry-run`, `--estimate`, `--yolo`, `--show-prompts` flags (C3-HIGH-2).

6. **Consume HANDOFF.json** (best-effort `rmSync` in finally — stale pointer must not re-trigger a resume loop).

7. Shell fallback (TIER-06): `pensmith resume [--dry-run] [--estimate] [--yolo] [--show-prompts]`.
