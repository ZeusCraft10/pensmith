# pensmith resume

> Resume an interrupted workflow: summarize the last handoff, then take the next step — the same step bare `/pensmith` takes (a section: plan → write → verify).

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('.paper/HANDOFF.json') + direct readFileSync('.paper/STATE.json')
</capability_check>

## Overview

`pensmith resume` follows the H4 lifecycle: it reads HANDOFF.json for the SUMMARY only
(never routes from it — no resume→resume loop), then runs ONE step through the same
chain as bare `pensmith` and `pensmith next` (`runNextStep`, GRND-18, D-18-28):
`resolveNextAction()` computes the next WORK verb (HANDOFF-blind); a section's step is
plan → write → verify, each stage only after the previous one succeeded and the router
names the same section's next stage; any other decision is its one verb. It ends with the
`pensmith: ran …; next: …` line and the last verb's exit code, then clears HANDOFF.json
(best-effort `rmSync` — a stale pointer must not re-trigger resume). Under `--dry-run` it
loops like `next` (the dry-run workspace `./.paper-dry-run/`, D-18-30).

The resume verb MUST NEVER dispatch to itself (H4). `resolveNextAction()` is
structurally incapable of returning `{ verb:'resume' }`.

## Outputs

- Delegates entirely to the dispatched verbs. HANDOFF.json cleared after the step (also after a failed one).
- stderr: `pensmith resume: → <verb>` (the first decision), then `pensmith: ran <steps>; next: <step>`.
- Exit code: the last dispatched verb's (RUN-09).

## Replay (`--replay <entryId>`, Tier 2 only)

`pensmith resume --replay <entryId>` re-runs the step that logged a SESSION.log model-call record (RUN-17). `<entryId>` is the record's `id` (`<run_id>:<seq>`). The verb and section come from the record and the flags from the invocation argv logged once per session; for `plan`, `write` and `verify` only the logged section is replayed (a record from a wave `write` re-drafts that one section). That run's `--runtime` / `--model` are re-applied (never passed to the verb), so the replayed request is the same request. A replay never inherits the logged `--yolo`: the replayed verb's approval gates run exactly as in a live run, so without a terminal they refuse (exit 3) unless you pass `--yolo` to the replay itself (`pensmith resume --replay <entryId> --yolo`). A drafter request carries the section plan without its lifecycle fields (`status`, `verified_against_draft_hash`), so a `write` step still replays after a later verify; a replay that finds no matching response changes nothing. With sources offline (`PENSMITH_OFFLINE=1` or the test runner) the transport serves the LOGGED responses — in a source checkout and in the installed package alike (replay needs no recorded source fixture; a source request made during the replay still fails closed without one) — matched by prompt slug and the sha256 of the request body, and never calls the model: the artifact is reproduced byte-for-byte at $0. A request whose inputs changed since the log was written has no match and fails with one line. Online, the step calls the model again. Records written with `[logging] session_bodies = "redacted"` keep only hashes and previews, so they report `not replayable`. The replay path skips the HANDOFF summary and the router below. In this release the plugin's `pensmith_plan` and `pensmith_write` call the provider configured for pensmith and log each call to `.paper/SESSION.log` exactly as the CLI does, so their records replay the same way.

## Body

0. **`--replay <entryId>`** → the Replay section above; nothing below runs.

1. **Read HANDOFF.json** (summary only, via `readHandoff()` in `bin/lib/handoff.ts` — never throws). HANDOFF.json v2 (written by the PreCompact hook from the router's decision) carries `phase` (intake, research, outline, sectioning, compile, export, done or attention), `section` (the section id as `status` prints it, e.g. `2` or `1a`), `position` (plan, write or verify while `phase` is sectioning), `current_section` (the slug), `next_action` and `section_pointers`. A v1 file is migrated in memory (its `plan`/`write`/`verify` phase becomes `sectioning` with that position, and its never-written `breadcrumbs` are dropped); a file written by a newer pensmith is ignored and left in place — the PreCompact hook never overwrites it either. Print to stderr: `pensmith resume: last at phase='sectioning', section='2', position='write'. Next: <next_action>`. If HANDOFF is absent, invalid, newer or done, skip the summary print.

2. **Read the paper mode** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(config)`.

3. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (HANDOFF-blind resolver — C3-HIGH-1 totality guaranteed). Returns the concrete next WORK verb.

4. **Mode-specific end-state check**: if `stopAfterResearch` is active and the resolved action is `{ verb:'status', reason:'done' }`, call the mode end-state renderer → writes `TUTORIAL.md`. Then consume HANDOFF.json (best-effort rmSync) and return.

5. **Run the step** via `runRouted` (`bin/pensmith.ts`): each verb is dispatched with `dispatchVerb(verb, verbArgs)` forwarding `--dry-run`, `--estimate`, `--yolo`, `--show-prompts` (C3-HIGH-2); a section's step is plan → write → verify; under `--dry-run` steps repeat until done, attention, a failure or a refused gate. In Tier 1, run the same step with the per-verb workflows.

6. **Consume HANDOFF.json** (best-effort `rmSync` in finally — stale pointer must not re-trigger a resume loop). A newer pensmith's HANDOFF.json is not consumed.

7. Shell fallback (TIER-06): `pensmith resume [--dry-run] [--estimate] [--yolo] [--show-prompts] [--replay <entryId>]`.
