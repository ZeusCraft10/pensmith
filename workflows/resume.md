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

## Replay (`--replay <entryId>`, Tier 2 only)

`pensmith resume --replay <entryId>` re-runs the step that logged a SESSION.log model-call record (RUN-17). `<entryId>` is the record's `id` (`<run_id>:<seq>`). The verb and section come from the record and the flags from the invocation argv logged once per session; that run's `--runtime` / `--model` are re-applied (never passed to the verb), so the replayed request is the same request. With sources offline (`PENSMITH_OFFLINE=1` or the test runner) the transport serves the LOGGED responses — in a source checkout and in the installed package alike (replay needs no recorded source fixture; a source request made during the replay still fails closed without one) — matched by prompt slug and the sha256 of the request body, and never calls the model: the artifact is reproduced byte-for-byte at $0. A request whose inputs changed since the log was written has no match and fails with one line. Online, the step calls the model again. Records written with `[logging] session_bodies = "redacted"` keep only hashes and previews, so they report `not replayable`. The replay path skips the HANDOFF summary and the router below. In Tier 1 the user's Claude session does the generation and nothing is logged to replay.

## Body

0. **`--replay <entryId>`** → the Replay section above; nothing below runs.

1. **Read HANDOFF.json** (summary only, via `safeReadHandoff()` — `existsSync` + `JSON.parse` + `HandoffSchema.safeParse`, never throws). Print to stderr: `pensmith resume: last at phase='X', section='Y'. Next: Z`. If HANDOFF absent or done, skip the summary print.

2. **Read the paper mode** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(config)`.

3. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (HANDOFF-blind resolver — C3-HIGH-1 totality guaranteed). Returns the concrete next WORK verb.

4. **Mode-specific end-state check**: if `stopAfterResearch` is active and the resolved action is `{ verb:'status', reason:'done' }`, call the mode end-state renderer → writes `TUTORIAL.md`. Then consume HANDOFF.json (best-effort rmSync) and return.

5. **Dispatch** via `dispatchVerb(decision.verb, verbArgs)` forwarding `--dry-run`, `--estimate`, `--yolo`, `--show-prompts` flags (C3-HIGH-2).

6. **Consume HANDOFF.json** (best-effort `rmSync` in finally — stale pointer must not re-trigger a resume loop).

7. Shell fallback (TIER-06): `pensmith resume [--dry-run] [--estimate] [--yolo] [--show-prompts] [--replay <entryId>]`.
