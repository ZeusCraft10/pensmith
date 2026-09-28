# pensmith next

> Take the next step of the paper — the bare `/pensmith` flow. For a section, the step is plan → write → verify.

<capability_check>
required:
  - MCP state.read

degrade_if_missing:
  - if no MCP tools: direct readFileSync('<project root>/.paper/STATE.json') + direct per-section PLAN.md reads
</capability_check>

## Overview

`pensmith next` is the bare `/pensmith` invocation: the state-aware next-step runner.
It works on the paper at the project root that contains `.paper/` — `--paper`,
`PENSMITH_PAPER_ROOT`, or the current folder. In a folder without a paper, while
`pensmith open` points at another one, it asks in a terminal whether to continue that
paper or start a new one here; without a terminal (or with `--yolo`) it refuses with
exit 2, naming `--paper <name>` and `pensmith new` (RUN-14). It holds the paper's
session lock while it runs (RUN-23).

It calls `resolveNextAction()` (`bin/lib/router.ts`) — a pure function over `.paper/STATE.json`
+ per-section PLAN.md frontmatter (read through the versioned loader without write-back). The resolver IGNORES HANDOFF.json (H4) and NEVER
returns `{ verb:'resume' }`.

**One invocation completes one step (GRND-18, D-18-28).** A step is one verb — intake,
research, outline, compile, done — except for a section, whose step is its whole
plan → write → verify: after `plan N` succeeds, `write N` runs if the router now names
section N's `write`; after `write N` succeeds, `verify N` runs if the router now names
section N's `verify` (`write` verifies the draft itself unless `--no-verify`, so this
stage is usually already done). The step stops at the first verb that does not succeed.
It ends with one stderr line naming what ran and what comes next:

```text
pensmith: ran plan §2, write §2; next: plan §3
pensmith: ran verify §1 (exit 4); next: verify §1
pensmith: ran done; next: status (done)
```

State machine: `new → research → outline → (plan → write → verify per section) → compile → done`.
The resolver reads the configured paper mode and may halt early for mode-specific termination
states (`{ verb:'status', reason:'done' }` or `{ verb:'status', reason:'attention' }`). An
attention decision carries a detail naming the command that fixes it (a rejected outline:
`pensmith outline`; a section whose draft was refused: `pensmith write N`; a section that
failed verification and whose draft has not changed since: `pensmith plan N --revise` or
`pensmith write N`), so a failed paid step is never re-run by the next bare invocation.
Once every section is verified, compile runs whenever the compiled `DRAFT.md` is missing
or older than a section's draft or verification (a redone or added section), and done runs
whenever `FINAL.md` is missing or older than the compiled draft.

**`--dry-run` loops (GRND-19, D-18-30).** Under `--dry-run` the paper lives in
`./.paper-dry-run/` (seeded from `.paper/`, which is never written) and `next` repeats
steps until the router reports done or attention, a step fails or a gate refuses, or a
decision repeats without progress. `pensmith next --dry-run --yolo` beside an assignment
goes from intake to `.paper-dry-run/export/DRAFT.dry-run.<ext>` in one invocation;
without `--yolo` it stops at the first gate it cannot answer (no terminal: exit 3).

## Outputs

- Delegates entirely to the dispatched verbs. No direct file writes.
- stderr: `pensmith next: → <verb>` (the first decision), then the `pensmith: ran …; next: …` line.
- Exit code: the last dispatched verb's (RUN-09) — e.g. 4 when the verify it ran failed.

## Body

1. **Read the paper mode** via `readGoalFromConfig(paperRoot)` + `stopAfterResearchFor(config)`.

2. **Call `resolveNextAction(paperRoot, { stopAfterResearch })`** (`bin/lib/router.ts`). NEVER throws (C3-HIGH-1 + C4-HIGH + C5-HIGH totality invariant — every fs/parse op is guarded with catch-all backstop).

3. **Map the decision:**
   - `{ verb:'new' }` → run intake
   - `{ verb:'research' }` → run research
   - `{ verb:'outline' }` → run outline
   - `{ verb:'plan', n, slug }` → plan section N, then write it, then verify it (each only after the previous succeeded)
   - `{ verb:'write', n, slug }` → write section N (write verifies it), then verify it if the router still names its verify
   - `{ verb:'verify', n, slug }` → verify section N
   - `{ verb:'compile' }` → run compile
   - `{ verb:'done' }` → run done (export; the export confirmation gate unless `--yolo`)
   - `{ verb:'status', reason:'done' }` → mode-specific end-state termination
   - `{ verb:'status', reason:'attention' }` → print the attention terminus and its detail (STATE.json or a section corrupt, a rejected outline, a refused draft, an unchanged draft that failed verification)

4. **Dispatch** each verb via `dispatchVerb(verb, verbArgs)` forwarding `yolo` + other global flags (C3-HIGH-2); the chain is `runNextStep` in `bin/pensmith.ts`, shared by bare `pensmith`, `next` and `resume`.

5. **Tier 1.** Run the same step with the per-verb workflows (`plan.md`, `write.md`, `verify.md`): for a section, plan it, then draft it, then verify it, stopping at the first failure, and tell the user what ran and what comes next.

6. Shell fallback (TIER-06): `pensmith next` (or bare `pensmith`).
