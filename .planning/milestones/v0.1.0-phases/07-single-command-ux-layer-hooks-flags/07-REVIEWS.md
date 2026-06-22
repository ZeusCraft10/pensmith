---
phase: 7
cycle: 1
reviewers: [codex, gemini, claude, opencode]
date: 2026-06-17
---

# Phase 7 — Cross-AI Plan Review (Cycle 1)

Reviewers run: **codex, gemini, claude, opencode** — all four produced usable output.
Gemini hit transient HTTP 429s (retried, completed). The orchestrator independently
verified the load-bearing technical claims (citty fall-through, `release()` semantics,
the `--yolo` gate placement, the flags skip-guard) directly against `node_modules/citty/dist/index.mjs`,
`bin/lib/lock.ts`, and the plan text before adjudicating severities.

Raw HIGH_COUNT per reviewer: codex 4, gemini 4, claude 3, opencode 3.

## Synthesized Findings

Severity is the orchestrator's adjudicated verdict (not a vote tally). Agreement noted per item.

### HIGH

**H1 — `--yolo` >50%-cap refusal is nested inside the `--estimate` branch, so plain `--yolo` never refuses. (07-02 Task 3)**
Agreement: **all 4 reviewers (codex, gemini, claude, opencode).** Verified against plan text.
07-02 Task 3 specifies the refusal as: `if args['estimate'] → projectEstimate(); if (exceedsHalfCap && args['yolo']) → exit(1)`.
The hard refusal therefore only fires when `--estimate` is *also* passed. The gate-bearing verbs
(`pensmith compile --yolo`, `pensmith done --yolo`, and bare `pensmith --yolo`) skip approval gates
*without* ever computing an estimate or refusing. This is a direct violation of the non-negotiable
"`--yolo` REFUSES when estimate > 50% of session cap" (SC5 / CLAUDE.md / ARCH-11). 07-PATTERNS even
shows the refusal coupled to `flags.yolo` alone, contradicting the plan's `--estimate`-gated placement.
**Fix direction:** make the 50%-cap pre-flight run whenever `--yolo` is active (compute estimate
unconditionally before any gate-skipping verb executes), independent of `--estimate`. The refusal must
be a hard `exit(1)`, and must be reachable from the actual approval-skipping paths (compile/done), not
only the bare-root estimate path.

**H2 — Adding a root `run()` to the citty command double-executes on every verb AND applies global flags too late. (07-02 Task 3; 07-RESEARCH Pitfall 4 is factually inverted)**
Agreement: **claude (primary, with source proof); codex + gemini reached the same defect from the "flag bypass" angle.** Verified against `node_modules/citty/dist/index.mjs:211-228`.
citty's `runCommand` runs a matched subcommand (line 217) and then **falls through and unconditionally
runs the parent command's `run()`** (line 228) — there is no early return. The plan's design (and
07-RESEARCH Pitfall 4) assumes the opposite: that bare invocation hits root `run()` while explicit
verbs bypass it. Consequences as planned:
  (a) `pensmith compile` runs `compile`, then falls into root `run()`, which — having no "a subcommand
      already ran" guard — hits the bare-invocation branch and **executes a second resolved verb**.
  (b) `setMirrorPromptsToStderr(true)` and the `PENSMITH_DRY_RUN` / `PENSMITH_NETWORK_TESTS` env
      mutations in root `run()` fire **after** the subcommand already made its LLM/adapter calls, so
      `--show-prompts` (ERGO-04) and `--dry-run` (ERGO-01) are **no-ops for any explicit verb**.
This is an incomplete/incorrect delivery of SC1 (bare router), SC2 (verb shortcuts in both tiers),
and SC5 (dry-run/show-prompts). **Fix direction:** do flag setup in a shared pre-dispatch seam
(`setup`/plugin hook or a wrapper around `runMain`) that runs before subcommands; gate the bare-router
dispatch on "no subcommand was matched" (e.g., inspect rawArgs), or move bare routing out of the
parent `run()` entirely. Correct 07-RESEARCH Pitfall 4 so executors don't build on the false model.

**H3 — `--dry-run` does not gate the LLM client; explicit verbs still make real LLM network calls. (07-02; gap across plans)**
Agreement: **gemini (primary); codex flags the analogous test-coverage gap; reinforced by H2(b).**
The plans wire `--dry-run` to `isOfflineMode()` (which gates source *adapters* via `http-mock.ts`), but
no task updates the LLM runtime client to honor `PENSMITH_DRY_RUN=1`. 07-RESEARCH Assumption A3 itself
flags "the LLM client isn't yet wired in Tier-2 for most verbs" and the dry-run stub behavior is
"ASSUMED." Combined with H2(b) (env set too late for explicit verbs), `pensmith write --dry-run` can
still hit a live LLM provider — violating ERGO-01 "zero external calls." The 07-01 RED tests only
assert env state + absence of `COSTS.jsonl`; they never drive a command path through `http.ts`, so a
leaking implementation passes CI. **Fix direction:** add an explicit LLM-client dry-run stub/guard
(check `PENSMITH_DRY_RUN` in the runtime client) and a test that exercises a verb path under
`--dry-run` and asserts zero network egress (cassette-only), not just env flags.

**H4 — Router returns `resume` for any non-done HANDOFF.json and `resume.ts` re-dispatches to the router → bare `/pensmith` gets stuck on `resume`. (07-02 Task 1 + Task 3)**
Agreement: **claude (primary); opencode raised the adjacent "stale HANDOFF" risk at MEDIUM.** Verified against plan behavior text.
`resolveNextAction` checks HANDOFF before the section walk and returns `{verb:'resume'}` whenever
`phase!=='done'`. `resume.ts` is specced to "dispatch to resolveNextAction's verb" — which resolves to
`resume` again → infinite re-entry; it never reaches `plan`/`write`/`verify`. No plan step clears or
advances `HANDOFF.json` after a resume, so once a HANDOFF exists, every bare `/pensmith` (SC1) and
`next` perpetually resolves to `resume`. This is a bare-router mis-routing of a state — an SC1 failure.
There is also an ordering inconsistency: the 07-RESEARCH code example checks HANDOFF *before*
RESEARCH/OUTLINE, while 07-02's behavior list places it before the section walk but after research/outline
— two orderings handed to the executor. **Fix direction:** give `resume`/`next` a "resolve next work
verb, ignoring HANDOFF" path to dispatch into, and add a HANDOFF lifecycle step (consume/clear on
resume, or advance phase) so routing makes progress. Pin one ordering.

### MEDIUM

**M1 — Stop's `Promise.all([release('.paper'), closeSessionLog()])` abandons the log flush when `release` rejects. (07-03 Task 2)**
Agreement: **claude (primary).** Verified against `bin/lib/lock.ts` `release()` docstring + proper-lockfile semantics.
At Stop time no per-op `.paper` lock is held (withLock is RAII, released per operation). `release()`
recomputes the stub and calls `proper-lockfile.unlock()`, which rejects when the resource isn't locked
(its own docstring says it's only for "cleanup of orphaned locks held by the current process").
`Promise.all` then rejects, the silent `catch` swallows it, and `process.exit(0)` fires before
`closeSessionLog()` is awaited — undermining the SC3 "flushes session log" half. The 07-01 `stop.test.ts`
asserts only lock-release + empty stdout, so it won't catch the lost flush. **Fix:** use
`Promise.allSettled` and await both; tolerate an unheld-lock rejection without truncating the flush.

**M2 — plugin.json `skills` array with colon-prefixed `name` fields + flat `skills/*.md` files is an unverified schema assumption (A1), and 07-01 hard-pins the possibly-wrong shape. (07-04 Task 2; 07-01 Task 3)**
Agreement: **claude (primary); codex + opencode flag the weak "CONTRIBUTING.md fallback" (they rated HIGH — see downgrade note).**
Claude Code conventionally auto-discovers skills as `skills/<name>/SKILL.md` directories and
auto-namespaces them as `plugin:skill` (the colon is not placed inside the skill's own `name`). If that
is the real schema, both the manifest edit and the flat `skills/pensmith.md` file are wrong, and
`tests/skill-descriptions.test.ts` (07-01) pins the wrong contract. The plan flags A1 with a fallback,
but the RED tests already encode the unverified shape. **Fix:** verify the exact plugin skill-registration
mechanism against the live Anthropic plugin schema BEFORE 07-01 locks the test contract; if colon-in-name
is rejected, choose a concrete working alternative (directory-based skills + auto-namespacing, or a
documented `plugin:skill` discovery path) rather than a docs-only fallback that leaves the plumbing
namespace non-functional.

**M3 — Global flags' applicability to verb shortcuts is unproven for the explicit-verb surface. (07-02 Task 3)**
Agreement: **codex + gemini + opencode.** (This is the same root cause as H2; kept separate as the test-coverage angle.)
Even setting aside the double-execution, the plans don't demonstrate that `pensmith write --dry-run`
or `pensmith compile --show-prompts` actually apply the flags. If flags only live in root `run()`, they
won't reach explicit verbs (per H2). **Fix:** subsumed by H2's shared pre-dispatch seam; add a test that
runs an explicit verb with each global flag and asserts the flag took effect.

**M4 — PreCompact 10s-timeout has no injection seam to exercise; HOOK-01 timeout stays unverified. (07-01 Task 2 / 07-03 Task 1)**
Agreement: **claude.**
`onPreCompact({paperDir})` exposes no way to make `writeHandoff` slow, so the planned "slow-write
injection must reject within ~10s" case can't drive the timeout without module mocking that 07-03 never
adds. The `Promise.race` is trivially correct, but the timeout firing is untested. **Fix:** add an
injectable delay seam (or fake timers / a mocked `writeHandoff`) so the timeout path is actually exercised.

**M5 — Router test fixtures for the section/compile cases are under-specified. (07-01 Task 1)**
Agreement: **claude.**
Cases (c)/(d) ("planned PLAN.md → plan", "all verified + no DRAFT.md → compile") only write
`STATE.json` + `PLAN.md`. But `resolveNextAction` returns `research`/`outline` first when
`RESEARCH.md`/`OUTLINE.md` are absent, so without those fixtures the section/compile cases will
mis-assert in 07-02. **Fix:** fixtures for the section cases must also create `RESEARCH.md` + `OUTLINE.md`.

**M6 — SessionStart emits a bare `{systemMessage}` frame, which may be the wrong key for injecting resume *context*. (07-03 Task 2)**
Agreement: **claude.**
Current Claude Code SessionStart hooks inject context via `hookSpecificOutput.additionalContext`;
`systemMessage` is generally surfaced as a user-facing notice rather than added to the model's turn
context. If so, auto-resume "fires" but doesn't actually feed the HANDOFF summary into the session
(HOOK-02). This is manual-verify-only in 07-VALIDATION, so CI won't catch it. **Fix:** confirm the
SessionStart stdout schema against the live hook contract; use `hookSpecificOutput.additionalContext`
if that is the context-injection channel.

**M7 — `next.ts` dynamic `import(...)`+invoke dispatch is under-specified and risks circular deps; also prints an extra stdout line breaking parity. (07-02 Task 3)**
Agreement: **opencode (dispatch fragility) + codex (extra-stdout parity).**
The plan's "at minimum print the resolved verb and execute it" under-specifies the mechanism; `next`
re-importing verb modules risks circular dependency with the REAL_VERB_LOADERS table, and the extra
`pensmith next: → <verb>` stdout line can make `next` output non-equivalent to the resolved verb
(tier/scripting parity). **Fix:** reuse the existing `REAL_VERB_LOADERS` dispatch table; route the
"resolved verb" diagnostic to stderr so stdout stays equivalent to the underlying verb.

**M8 — Skill-description test asserts only 3 phrases; "make it sound less AI" / "redo section" routing is untested. (07-04 Task 1 / 07-01 Task 3)**
Agreement: **opencode.**
`skill-descriptions.test.ts` asserts `/where am I/i`, `/what'?s next/i`, `/resume/i` (and plan-section's
`/redo section/i`), but there is no assertion that the "make it sound less AI" → humanize phrase appears
in any description. Per Pitfall 7, a missing phrase means the NL trigger won't route, yet CI stays green.
**Fix:** add assertions for every PRD §5.4 trigger phrase the phase claims to support (including the
humanize-under-done phrase).

**M9 — tier-contract parity helper (`assert-tier-equivalent`, ±20%) was built for numeric/timing comparisons, not skill→verb name mapping. (07-04 Task 2)**
Agreement: **opencode.**
The plan reuses a numeric-tolerance helper to assert that a plumbing skill resolves to the same verb in
both tiers; that helper likely can't express the assertion without modification. **Fix:** add a
purpose-built equivalence assertion for the name→verb mapping rather than overloading the ±20% helper.

### LOW

**L1 — `sessionCapUsd` defaults to 5.0 in the estimator and is not shown being read from configured `cost_cap_usd`. (07-02 Task 2/3)**
Agreement: claude. If a user lowers their cap, the 50%-refusal baseline is wrong. Root `run()` should
pass the configured cap into `projectEstimate`. (Material to H1's correctness once H1 is fixed.)

**L2 — module-scope `activeChain` tracks only the most-recently-opened logger. (07-03 Task 1)**
Agreement: claude + opencode. `closeSessionLog()` flushes only the last logger if more than one is open
(tests / parallel workstreams). Edge case for this phase; worth a `Map`-keyed approach or at least a comment.

**L3 — estimator output should carry the "estimated ±50%" disclaimer from RESEARCH.md. (07-02 Task 2)**
Agreement: gemini. Manage user expectations on the projection table.

## Adjudication notes (escalations / downgrades)

- **DOWNGRADED — opencode & codex "07-04 Task 2 CONTRIBUTING.md fallback" from HIGH → MEDIUM (M2).**
  The concern is real, but it is contingent on the plugin schema actually rejecting the registration
  mechanism — which the plan explicitly flags (A1 / Open Question 2) and gates with a "verify before
  shipping" step. It becomes a HIGH only if verification confirms rejection and no working alternative
  is adopted. As a *plan* defect it is "unverified assumption + weak fallback," which is MEDIUM. The
  stronger, certain defect (07-01 pinning the unverified test contract) is folded into M2.
- **DOWNGRADED — opencode "07-01 flags.test.ts skip-guard won't skip" from HIGH → not retained as HIGH.**
  Verified against 07-01 Task 1: the plan explicitly says "skip-guard on the args keys existing"
  (introspect `command.args`, skip if keys absent), not skip-guard on `existsSync(bin/pensmith.ts)`.
  Since `bin/pensmith.ts` already exists but the four flag keys do not, a key-presence guard skips
  correctly. The plan is self-consistent here; opencode mischaracterized the guard. Folded as a minor
  clarity note, not a HIGH.
- **ESCALATED — claude's citty-fall-through finding kept as HIGH (H2) after direct source verification.**
  `node_modules/citty/dist/index.mjs:211-228` confirms the parent `run()` executes after a matched
  subcommand with no early return. This also means 07-RESEARCH Pitfall 4 is factually inverted; the
  plan is built on a false execution model affecting SC1/SC2/SC5.
- **HOOK-03 (PostToolUse) NOT counted as a gap** — coverage-check-only is intentional, per the brief.
  No reviewer mis-flagged it.
- **H3 (dry-run LLM leak)** retained as HIGH because ERGO-01's contract is "zero external calls" and the
  plans demonstrably leave the LLM-client path ungated (A3 self-admits it), with tests that cannot catch
  a leak. It is a non-negotiable ("all network via http.ts / offline cassette") plus an SC5 failure.

## Final adjudicated HIGH set: 4 (H1, H2, H3, H4)


## Per-Reviewer Raw

### codex

```
[HIGH] 07-02 Task 3: `--yolo` only refuses over the 50% session cap inside the `--estimate` branch. A normal execution like `pensmith write --yolo` can skip approvals without first calling `projectEstimate()` or enforcing the hard refusal. This violates the non-negotiable “--yolo REFUSES when estimate > 50% session cap.”

[HIGH] 07-02 Task 3: the plan declares `--yolo` but never wires it into the outline/export approval gates it is supposed to skip. Phase success requires “--yolo skips outline+export approval”; this plan only handles estimate refusal and does not pass the flag to the workflows that contain those approvals.

[HIGH] 07-04 Task 2: the acceptance criteria allow a “documented CONTRIBUTING.md fallback” if `plugin.json` rejects colon-prefixed skill names. That would still leave `/pensmith:plan-section`, `/pensmith:write-section`, and `/pensmith:verify-section` non-functional, failing the required hidden plumbing namespace for scripting.

[HIGH] 07-02 Task 1: router behavior says `verified/failed/unverifiable → continue`, which can route to `compile` when sections are `failed` or `unverifiable`. The success criterion says compile after “all sections verified”; treating failed/unverifiable sections as complete risks bare `/pensmith` mis-routing a paper into compile/done before verification is actually satisfied.

[MEDIUM] 07-02 Task 3: global flags are wired in the root `run({ args })` path, but the plan does not prove they apply to verb shortcuts such as `pensmith write --dry-run` or `pensmith compile --show-prompts`. If the command framework bypasses root `run()` for subcommands, the required flags will only work on bare `pensmith`, not across the single-command/shortcut surface.

[MEDIUM] 07-02 Task 3: `next.ts` says “At minimum print the resolved verb to stdout and execute it.” That extra stdout line can make `pensmith next` output non-equivalent to the resolved verb and break scripting/parity expectations. If status/compile/write emit structured or user-facing output, `next` should dispatch cleanly or use stderr for diagnostics.

[MEDIUM] 07-01 Task 1 / 07-02 Task 2: dry-run and estimate tests only assert env state and absence of `COSTS.jsonl`; they do not execute a command path that would otherwise call network/LLM through `http.ts`. A downstream implementation could still make external calls under `--dry-run` and pass these tests.

HIGH_COUNT: 4

```

### gemini

```
- [HIGH] **Global Flag Bypass (07-02 Task 3):** The root `run()` handler in `bin/pensmith.ts` is only executed when no subcommand is provided. When a user runs a verb shortcut (e.g., `pensmith write --dry-run`), `citty` dispatches directly to the subcommand, bypassing the root `run()`. Consequently, critical global logic—such as setting `PENSMITH_DRY_RUN`, `setMirrorPromptsToStderr`, and the `--yolo` estimate refusal—will never execute for any direct verb invocation. These must be handled in a shared initialization path (e.g., a `setup` pattern or a wrapper around `runMain`) to apply to all commands.
- [HIGH] **Missing `--yolo` Enforcement (07-02 Task 3):** The non-negotiable requirement (Success Criterion 5) states that `--yolo` must refuse execution if the project estimate exceeds 50% of the session cap. However, the current plans only implement this check inside the explicit `if args['estimate']` block. There is no plan to automatically run the estimator and refuse execution during the actual `next`, `plan`, `write`, etc. commands when `--yolo` is active, allowing potentially expensive operations to bypass approval gates unverified.
- [HIGH] **Ineffective Hook Flushing (07-03 Task 2):** Hook scripts (like `stop.ts`) run as separate OS processes from the main agent/CLI process. The plan for `stop.ts` to call `closeSessionLog()` from `bin/lib/session-log.ts` to "flush the session log" is fundamentally impossible as it cannot access the pending write chain in the memory of the separate process that was actually writing the log. The primary process must handle its own flushing upon completion or exit.
- [HIGH] **`--dry-run` LLM Leak (07-02):** While the plans ensure source adapters use cassettes via `isOfflineMode()`, they do not include a task to update the LLM client (in `bin/lib/runtime.ts` or similar) to respect `PENSMITH_DRY_RUN=1`. Without an explicit stub or mock in the LLM runtime path, commands like `pensmith write --dry-run` will still attempt real network calls to LLM providers, violating the "zero external calls" requirement.
- [MEDIUM] **Plumbing Namespace Registration (07-04 Task 2):** The plan to register colon-prefix skill names (e.g., `pensmith:plan-section`) in `plugin.json` is central to the UX-03 requirement, but the plan lacks a definitive fallback strategy if the Claude Code platform manifest schema rejects this naming convention or the `skills` array itself.
- [LOW] **Estimator Disclaimer (07-02 Task 2):** The output of `projectEstimate` should include the "estimated ±50%" disclaimer recommended in RESEARCH.md to manage user expectations, which is not explicitly mentioned in the CLI rendering task.

HIGH_COUNT: 4

```

### claude

```
I verified the load-bearing assumption directly against `citty`'s source (`node_modules/citty/dist/index.mjs:210-228`). The result materially changes my assessment, so let me anchor it before the findings:

`runCommand` runs a matched subcommand at line 217, then **falls through to line 228 and runs the parent command's `run()` afterward** — unconditionally. The root `run()` is NOT an either/or with subcommands; it executes *after every verb*. The plans (and 07-RESEARCH Pitfall 4) assume the opposite. That breaks two of the five success criteria.

---

# Cross-AI Plan Review — Pensmith Phase 7

## HIGH

- **[HIGH] 07-02 Task 3 — adding a root `run()` to the citty command double-executes on every verb and applies flags too late.** The plan instructs: add a root `run({args})` that wires `--show-prompts`/`--dry-run`, and on bare invocation calls `resolveNextAction()` + dispatches. But citty (`index.mjs:211-228`) runs a matched subcommand *and then falls through to the parent's `run()`*. So `pensmith compile` will (1) run `compile`, then (2) fall into root `run()`, which — having no "a subcommand already ran" guard — hits the `otherwise (bare invocation) → resolveNextAction and dispatch` branch and **executes a second resolved verb**. Separately, `setMirrorPromptsToStderr(true)` and the `PENSMITH_DRY_RUN`/`PENSMITH_NETWORK_TESTS` env mutations run *after* the subcommand has already made its LLM/adapter calls, so `--show-prompts` (ERGO-04) and `--dry-run` (ERGO-01) are no-ops for any explicit verb. This is a wrong/incomplete delivery of SC5 and the plan's own "bare must hit root run(), NOT the next subcommand" note is built on a false model of citty.

- **[HIGH] 07-02 Task 3 — the `--yolo` >50%-cap refusal is nested inside the `if (args['estimate'])` branch, so plain `--yolo` never refuses.** The non-negotiable (CLAUDE.md + SC5) is "`--yolo` REFUSES when estimate > 50% of session cap." As written, `projectEstimate` + `exceedsHalfCap && args['yolo'] → exit(1)` only runs when `--estimate` is *also* passed. `pensmith --yolo`, `pensmith compile --yolo`, and `pensmith done --yolo` (the actual gate-bearing verbs, which already carry their own `yolo` arg and skip approval) never compute an estimate and never refuse. Compounded by the citty finding above, the refusal can fire in essentially no real path except `pensmith --estimate --yolo` (bare). The non-negotiable is not enforced.

- **[HIGH] 07-02 Task 1 + Task 3 — the router returns `resume` whenever a non-done `HANDOFF.json` exists, and `resume.ts` re-dispatches to the router, so bare `/pensmith` gets stuck on `resume` and cannot advance.** `resolveNextAction` checks HANDOFF before the section walk and returns `{verb:'resume'}` for any `phase!=='done'`. `resume.ts` is specced to "dispatch to resolveNextAction's verb" — which is `resume` again → infinite re-entry / never reaches `plan`/`write`/`verify`. Nothing in any plan deletes `HANDOFF.json` or advances its phase after a resume, so once a HANDOFF exists, every bare `/pensmith` (SC1) and every `next` invocation perpetually resolves to `resume` instead of the real next action. The router needs a "next work verb ignoring HANDOFF" path for `resume`/`next` to dispatch into, and a HANDOFF-lifecycle (consume/clear) step. (Note also: the 07-RESEARCH code example checks HANDOFF *before* RESEARCH/OUTLINE, while 07-02's behavior list places it "before section walk" but after research/outline — the executor is given two orderings.)

## MEDIUM

- **[MEDIUM] 07-03 Task 2 — `Stop` uses `Promise.all([release('.paper'), closeSessionLog()])`, which abandons the log flush if `release` rejects.** At `Stop` time no per-operation `.paper` lock is held (withLock is RAII and releases per-op), so `release('.paper')` will typically reject (proper-lockfile unlock of an unheld resource). `Promise.all` then rejects, the silent `catch` swallows it, and `process.exit(0)` fires without `closeSessionLog()` having been awaited to completion — undermining the SC3 "flushes session log" half. Use `Promise.allSettled` (and await both) so a release rejection can't truncate the flush. The 07-01 `stop.test.ts` only asserts lock-release + empty stdout, so it won't catch the lost flush.

- **[MEDIUM] 07-04 Task 2 — the plugin.json `skills` array with colon-prefixed `name` fields and flat `skills/*.md` files is an unverified assumption (A1), and 07-01 hard-pins that possibly-wrong structure.** Claude Code conventionally auto-discovers skills as `skills/<name>/SKILL.md` directories and auto-namespaces them as `plugin:skill` (you don't put the colon in the skill's own `name`). If that's the real schema, both the manifest edit and `skills/pensmith.md`-as-flat-file are wrong, and `tests/skill-descriptions.test.ts` (07-01) pins the wrong contract. The plan does flag A1 with a CONTRIBUTING.md fallback, but the RED tests already encode the unverified shape — verify against the actual plugin schema before 07-01 locks it.

- **[MEDIUM] 07-01 Task 2 — the PreCompact 10s-timeout assertion has no injection seam to exercise.** `onPreCompact({paperDir})` exposes no way to make `writeHandoff` slow, so the planned "slow-write injection must reject within ~10s" case cannot actually drive the timeout without module mocking that 07-03 doesn't add. HOOK-01's timeout behavior (SC3) therefore ends up unverified (the `Promise.race` code itself is trivially correct, but the test can't prove it fires).

- **[MEDIUM] 07-01 Task 1 — the router test fixtures for the section/compile cases are under-specified.** Cases (c)/(d) ("planned PLAN.md → plan", "all verified + no DRAFT.md → compile") only describe writing `STATE.json` + `PLAN.md`. But `resolveNextAction` returns `research`/`outline` first when `RESEARCH.md`/`OUTLINE.md` are absent, so without those fixtures the section-based cases will mis-assert in 07-02. The fixture spec must include `RESEARCH.md` + `OUTLINE.md` for those cases.

- **[MEDIUM] 07-03 Task 2 — SessionStart emits a bare `{systemMessage}` frame, which may be the wrong key for injecting resume *context* (HOOK-02).** Current Claude Code SessionStart hooks inject context via `hookSpecificOutput.additionalContext`; `systemMessage` is generally surfaced as a user-facing notice, not added to the model's turn context. If so, auto-resume "fires" but doesn't actually feed the HANDOFF summary into the session. This is manual-verify-only in 07-VALIDATION, so CI won't catch it — confirm the stdout schema against the live hook contract.

## LOW

- **[LOW] 07-02 Task 2/3 — `sessionCapUsd` defaults to `5.0` inside the estimator and is not shown being read from the project's configured `cost_cap_usd`.** If a user lowers their cap, the 50%-refusal threshold silently uses the wrong baseline. Root `run()` should pass the actual configured cap into `projectEstimate`.

- **[LOW] 07-03 Task 1 — module-scope `activeChain` tracks only the most-recently-opened logger.** If more than one session log is open, `closeSessionLog()` flushes only the last. Edge case for this phase, but worth a comment so a future multi-logger path doesn't silently drop a flush.

---

The three HIGH items are concentrated in 07-02's root-dispatcher design: the citty fall-through invalidates the "flags live in root `run()`" approach, the yolo-cap refusal is mis-scoped, and the router/resume HANDOFF handling is circular. All three are correctly/completely-delivering-SC failures, not style nits. 07-01, 07-03, and 07-04 are largely sound; their issues are MEDIUM test-fidelity and unverified-schema concerns.

HIGH_COUNT: 3

```

### opencode

```
# Cross-AI Plan Review — Phase 7

## HIGH Concerns

**[HIGH] 07-01, Task 1 (flags.test.ts): Skip-guard on `existsSync('bin/pensmith.ts')` will NOT skip because `bin/pensmith.ts` ALREADY exists. The four global flags don't exist in the file yet, so the assertion that introspects `command.args` will run and FAIL. The skip-guard must check for flag content within the file (e.g., grep for `dry-run`), not just file existence. Only `router.ts` and `estimator.ts` are new files whose non-existence provides a working skip-guard.**

**[HIGH] 07-02, Task 3 (bin/pensmith.ts root `run()` — ERGO-03/ARCH-11): The `--yolo` refusal logic is placed INSIDE the `if args['estimate']` block: `if exceedsHalfCap && args['yolo'] → exit(1)`. This means:**
- **`pensmith --yolo` without `--estimate` never runs the estimate check and never refuses**
- **`pensmith --estimate` (no yolo) with >50% cap just prints and exits 0 — no refusal**
- **The non-negotiable says `--yolo` itself "REFUSES when estimate > 50% session cap". The 50%-cap check must run whenever `--yolo` is active (or always as a pre-flight), not only when combined with `--estimate`. As written, a user running `pensmith --yolo` would silence approval gates without the mandated safety check.**

**[HIGH] 07-04, Task 2 (plugin.json skills array — UX-03): The fallback for schema rejection of colon-prefix names or `skills` array is "document in CONTRIBUTING.md and surface in SUMMARY." This does NOT satisfy success criterion 2 ("plumbing namespace works in BOTH tiers"). If the Anthropic plugin schema rejects the registration mechanism, the plan needs a concrete alternative (different naming convention like `pensmith_plan_section`, wrapper script, or MCP tool registration) — not just documentation. The plan acknowledges this is unresolved (Open Question 2) but has no Plan B.**

## MEDIUM Concerns

**[MEDIUM] 07-02, Task 1 (router.ts — UX-01): The router checks HANDOFF.json presence BEFORE the section walk (correct for resume), but doesn't validate HANDOFF freshness. If a stale HANDOFF.json exists from a previous session where sections have since been completed, the router returns `{ verb:'resume' }` and skips the section walk entirely, potentially missing work. Should cross-check HANDOFF's `section_pointers[].state` against current PLAN.md frontmatter states; only resume if they match.**

**[MEDIUM] 07-02, Task 3 (next.ts — UX-02): Dynamic verb dispatch via runtime `import(...)` + invoke is fragile and risks circular dependencies (next imports write, write might reference the dispatch table). Safer pattern: export a shared dispatch table from `pensmith.ts` (which already has REAL_VERB_LOADERS) and have `next` use that table. The plan's "at minimum print the resolved verb and execute it" under-specifies the dispatch mechanism.**

**[MEDIUM] 07-03, Task 1 (session-log.ts — HOOK-04): The module-level `let activeChain` pattern creates shared mutable state. If multiple handlers/sessions exist in the same Node process (possible in tests or parallel workstreams), one session's `openSessionLog()` call overwrites the `activeChain` from another. Should use a `Map<string, Promise<void>>` keyed on the log file path or handle identity.**

**[MEDIUM] 07-04, Task 1 (skills/pensmith.md — UX-05): The "make it sound less AI" → humanize mapping is mentioned as needing coverage in the description, but the automated test (`skill-descriptions.test.ts`) only asserts `/where am I/i`, `/what'?s next/i`, and `/resume/i`. There's no assertion that "make it sound less AI" or "redo section" appear in any skill description. Per Pitfall 7 (description anti-pattern), a missing phrase means the NL trigger won't route. The test gap means this can be completed without failing CI, but will fail in live routing.**

**[MEDIUM] 07-02, Task 3 (bin/pensmith.ts root `run()` — ERGO-01): The plan says `--dry-run` sets `process.env.PENSMITH_NETWORK_TESTS=''` but doesn't specify where/when this env mutation happens relative to `--estimate` processing. If `--dry-run` is set alongside `--estimate`, the env var must be set BEFORE `projectEstimate()` runs (the estimator asserts no network calls). The execution order of flag processing vs. dispatch isn't specified.**

**[MEDIUM] 07-04, Task 2 (tier-contract parity extension — UX-02): The plan says "plumbing namespace resolves to the same underlying verb in Tier 1 (skill) and Tier 2 (CLI)" using the existing `assert-tier-equivalent (±20%)` helper. That helper was designed for numeric/timing comparisons, not for checking that a skill name maps to the same verb as a CLI subcommand. The existing helper pattern likely cannot express this assertion without modification.**

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 3 |
| MEDIUM | 6 |
| LOW | 0 |

**HIGH_COUNT: 3**

```

---

## Cycle 2

phase: 7 | cycle: 2 | reviewers: [codex, gemini, claude, opencode] | date: 2026-06-18

Reviewers run: **codex, gemini, claude, opencode** — all four produced usable output.
Gemini again hit transient HTTP 429s (retried, completed). The orchestrator independently
verified the load-bearing claims directly against the codebase before adjudicating:
`node_modules/citty/dist/index.mjs:207-228` (H2 single-dispatch), `bin/lib/runtime.ts`
(no LLM seam — config-load only), `bin/lib/verify/pass2.ts:230-259` + `pass4.ts:392-444`
(the REAL `new Anthropic().messages.create()` callsites, gated on `PENSMITH_NO_LLM` /
`ANTHROPIC_API_KEY`, NOT `PENSMITH_DRY_RUN`), `bin/cli/write.ts` + `bin/cli/research.ts`
(Tier-2 placeholders that make ZERO LLM calls), and `bin/lib/lock.ts` `release()` (unlock
of an unheld stub rejects).

Raw HIGH_COUNT per reviewer: codex 3, gemini 1, claude 1, opencode 0.

### Synthesized Findings (cycle 2)

Severity is the orchestrator's adjudicated verdict, not a vote tally.

**Status of the four cycle-1 HIGHs:**

- **H1 (--yolo cap mis-scoped) — PARTIALLY RESOLVED → a NEW HIGH remains.** The *literal* cycle-1
  defect (refusal nested inside the `--estimate` branch) IS fixed: `estimator.ts` now computes only
  the pure `exceedsHalfCap` predicate, and the hard `exit(1)` lives in the bin/pensmith.ts pre-dispatch
  seam, gated on `--yolo` active independent of `--estimate`, with a RED test driving `compile --yolo`
  and bare `--yolo` WITHOUT `--estimate`. HOWEVER the revised plan re-scopes the refusal to
  "gate-skipping verbs (compile/done/outline) + bare invocation … so plain non-gate verbs are not
  surprised." That re-opens a financial-safety hole: `pensmith write --yolo` / `pensmith plan --yolo`
  over 50% cap are NOT refused, even though `--yolo` is a valid global flag on every verb. The
  non-negotiable ("`--yolo` REFUSES when estimate > 50% of session cap") is unqualified. **3 of 4
  reviewers flag this (codex HIGH, gemini HIGH; opencode raised the adjacent fresh-dir crash; claude
  rated H1 RESOLVED but logged the fresh-dir caveat).** Adjudicated **HIGH** (see C2-H1 below).

- **H2 (citty root run() double-exec + late flags) — RESOLVED (unanimous).** Verified against
  citty source: with NO root `run()` and an explicit subcommand, `runCommand` runs the subcommand at
  line 217 and line 228 (`if typeof cmd.run === 'function'`) is skipped → the verb runs exactly once.
  For bare invocation citty would `throw 'No command specified'` (line 225), which is exactly why the
  plan correctly routes bare via `resolveNextAction` directly and NOT through `runMain`. The argv
  pre-parse applies `--show-prompts`/`--dry-run` before dispatch, so they reach explicit verbs.
  Corrected Pitfall 4 matches reality. All four reviewers concur.

- **H3 (--dry-run didn't gate the LLM client) — NOT GENUINELY RESOLVED.** The fix is anchored to a
  seam that does not exist. `bin/lib/runtime.ts` is config/API-key load ONLY — there is no
  model-invocation function in it or anywhere in `bin/lib/` (`bin/cli/compile.ts` says verbatim
  "bin/lib has no model-transport client yet"). The ONLY verb that actually calls the Anthropic SDK is
  `verify` → `runPass2`/`runPass4`, which construct `new Anthropic()` inline and gate on
  `PENSMITH_NO_LLM` / `ANTHROPIC_API_KEY` — NOT on `PENSMITH_DRY_RUN` and NOT on `isOfflineMode()`. No
  plan sets `PENSMITH_NO_LLM`, so with a key present `pensmith verify N --dry-run` would STILL make a
  live `messages.create()` call. Worse, the H3 RED test drives `write`/`research`, which are Tier-2
  placeholders that make ZERO LLM calls in any mode — so the test passes VACUOUSLY and cannot
  distinguish dry-run from normal operation. **3 of 4 reviewers flag this (codex HIGH, claude HIGH,
  gemini MEDIUM, opencode MEDIUM); orchestrator code-trace confirms.** Adjudicated **HIGH** (C2-H3).
  Mitigating context: nothing leaks *today* because Tier-2 write/research are placeholders and source
  adapters are offline by default — but the gap H3 was filed to close is not closed and the regression
  gate gives false assurance for SC5's "incl. the LLM client" clause.

- **H4 (router/resume infinite loop) — RESOLVED (unanimous).** `resolveNextAction` ignores HANDOFF and
  never returns `{verb:'resume'}`; `resume.ts` reads HANDOFF for the summary only, dispatches the
  HANDOFF-blind next WORK verb via the shared loader table, then `rmSync(...,{force:true})` consumes the
  pointer. One pinned ordering is used by both router.ts and 07-02. The RED case asserts a non-done
  HANDOFF → `verb==='plan'` and explicit `verb !== 'resume'`. All four reviewers concur.

### HIGH (adjudicated, cycle 2)

**C2-H1 — `--yolo` >50%-cap refusal is scoped to gate-skipping verbs + bare, so `pensmith write --yolo` / `plan --yolo` over-cap are not refused. (07-02 Task 3c)**
Agreement: codex + gemini (HIGH); opencode (adjacent fresh-dir). The original estimate-nesting bug is
fixed, but the new scoping leaves explicit non-gate `--yolo` invocations outside the financial-safety
refusal. The non-negotiable is unqualified. **Fix direction:** run the >50%-cap pre-flight for ANY
command line where `--yolo` is present (before any verb dispatch), not only the gate-skipping subset; OR
explicitly amend the non-negotiable + SC5 to state that `--yolo` only refuses on gate-bearing verbs and
document why non-gate `--yolo` is a no-op. Also add the fresh-dir guard (projectEstimate→loadState
throws StateNotFoundError) so `--yolo` in a paper-less dir doesn't crash.

**C2-H3 — the `--dry-run` LLM-client guard is anchored to a nonexistent seam and its RED test passes vacuously; the real LLM callsites stay ungated. (07-02 Task 4 + 07-01 Task 1 H3 case)**
Agreement: codex + claude (HIGH); gemini + opencode (MEDIUM). `bin/lib/runtime.ts` has no
model-invocation function; the real `messages.create()` calls live in `bin/lib/verify/pass2.ts` +
`pass4.ts`, gated on `PENSMITH_NO_LLM` (which `--dry-run` never sets). The H3 test drives placeholder
`write`/`research` (zero egress in any mode), so it gates nothing. **Fix direction (pick one):**
(1) Honest deferral — wire `--dry-run` → `PENSMITH_DRY_RUN='1'` AND `PENSMITH_NO_LLM='1'` (the latter is
what the real seams already honor), rewrite the H3 test to drive `verify` with a key present and assert
the SDK is never constructed / zero network / no COSTS.jsonl append, and drop the "LLM client honors
dry-run via runtime.ts" claim; OR (2) Real anchor — add a genuine canonical model-call chokepoint,
migrate pass2/pass4 (and future verbs) to route through it, guard THAT on `PENSMITH_DRY_RUN`, and add
pass2/pass4 to `files_modified`. Either way the test must drive a path that WOULD egress absent the guard.

### MEDIUM (cycle 2, carried/new — not blocking but should be addressed)

- **C2-M1 — 07-04 doc-only plugin.json fallback (UX-03/SC2/SC4).** codex re-raised as HIGH; held at
  MEDIUM (consistent with cycle-1 M2 adjudication): a CONTRIBUTING.md fallback leaves
  `/pensmith:plan-section` non-functional. Contingent on the schema actually rejecting colon-in-name /
  `skills` array — the plan gates it with "verify before shipping (A1)." Becomes HIGH only if
  verification confirms rejection and no working alternative (directory `skills/<name>/SKILL.md` +
  auto-namespacing, wrapper, or MCP-tool registration) is adopted. Verify the live Anthropic plugin
  schema BEFORE 07-01 locks the test contract.
- **C2-M2 — Stop's `Promise.all([release('.paper'), closeSessionLog()])` still abandons the flush
  (07-03 Task 2).** UNFIXED from cycle-1 M1. `release('.paper')` unlocks an unheld stub (no code
  acquires a `.paper` resource lock — locks are per-file), so `unlock` rejects → `Promise.all` rejects →
  silent catch → `closeSessionLog()` may not complete, undermining SC3's "flush log" half. **Fix:** use
  `Promise.allSettled` and await both; tolerate the unheld-lock rejection. Also reconcile the
  "releases the concurrent-run lock" wording with the fact that no session-level lock is acquired
  (claude C2 + cycle-1 M1 + RESEARCH Open Question 1 / A2).
- **C2-M3 — configured session cap source underspecified (07-02).** `cost_cap_usd` is referenced but
  the runtime-config schema has no such field and no migration is planned; defaulting to $5 can ignore a
  user-lowered cap, weakening C2-H1's financial gate once fixed (codex MEDIUM; cycle-1 L1 escalation).
- **C2-M4 — "redo section N" maps only to `plan` (07-04 Task 1).** PRD §5.4 maps "redo section N" to
  plan + write; the plumbing skill routes only to the `plan`/`plan --revise` path, leaving the draft
  unrebuilt (gemini MEDIUM; cf. cycle-1 M8 phrase-coverage).
- **C2-M5 — H3 executor context: verb files not in `files_modified` (07-02 Task 4).** Even under the
  "real anchor" fix, write/research/plan/verify must be refactored to route through the new chokepoint to
  pass an egress assertion; only `runtime.ts` is listed (gemini + opencode). Subsumed by C2-H3's fix.

### LOW (cycle 2)

- Dead `{verb:'resume'}` arm in `RouterDecision` (never emitted; RESEARCH example omits it) — pick one
  representation (claude).
- Stale HANDOFF after a non-resume advance → SessionStart emits an outdated resume message (harmless;
  routing ignores it) (opencode).
- `GATE_SKIPPING_VERBS` is compiled procedurally — consider a named export so the list can't drift
  (opencode).
- Estimator `STEP_HEURISTICS` should cover/zero the remaining UX-02 verbs (add/sketch) so totalUsd stays
  a reliable safety signal (gemini); carry the "estimated ±50%" disclaimer (cycle-1 L3).

### Adjudication notes (cycle 2)

- **H2 + H4 confirmed RESOLVED by all four reviewers AND independent source verification.** The current
  `bin/pensmith.ts` already has no root `run()` (only `subCommands`), so the "do NOT add a root run()"
  instruction preserves correct single-dispatch; bare invocation must NOT go through `runMain` (citty
  would throw `E_NO_COMMAND`), which the plan does correctly.
- **C2-H3 escalated/retained as HIGH** despite "nothing leaks today," because (a) the fix is anchored to
  a seam that does not exist, (b) the real callsites (pass2/pass4) remain ungated by the dry-run signal,
  and (c) the regression gate is vacuous — it cannot catch the leak it was written to catch. That is an
  incomplete delivery of SC5's "incl. the LLM client" clause plus a false-assurance test.
- **C2-H1 adjudicated HIGH** as a NEW gap introduced by the H1 fix's scoping (3 reviewers), against an
  unqualified financial-safety non-negotiable. The original estimate-nesting H1 is genuinely resolved;
  this is a fresh scoping defect, not a regression of the old one.
- **codex's 07-04 doc-fallback HIGH held at MEDIUM** (C2-M1), consistent with cycle-1's M2
  adjudication — contingent on schema rejection that the plan gates with a verify-first step.
- **HOOK-03 (PostToolUse) not counted as a gap** — coverage-only is intentional. No reviewer mis-flagged.

### Final adjudicated HIGH set (cycle 2): 2 — C2-H1 (--yolo non-gate scoping), C2-H3 (dry-run seam nonexistent + vacuous test). H2 and H4 RESOLVED; H1 partially resolved (new scoping HIGH); H3 not resolved.

### Per-Reviewer Raw (cycle 2)

#### codex

```
**Prior HIGHs**

| ID | Status | Reason |
|---|---|---|
| H1 | NOT RESOLVED | The `--estimate` nesting bug is fixed in concept, but 07-02 narrows the pre-flight to “gate-skipping verbs + bare.” The stated fix says it runs whenever `--yolo` is active, and SC5 says flags apply to explicit verbs. |
| H2 | RESOLVED | The plan removes root `run()`, pre-parses flags before `runMain`, and gates bare routing on no explicit verb. This addresses double execution and late flags. |
| H3 | NOT RESOLVED | The claimed runtime LLM seam does not currently exist in [runtime.ts](<C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\bin\lib\runtime.ts>), and the proposed test drives placeholder `write`/`research` paths that do not exercise live model calls. |
| H4 | RESOLVED | `resolveNextAction` is explicitly pinned to ignore HANDOFF and never return `resume`; `resume` computes a work verb and consumes HANDOFF. That breaks the loop. |

**Findings**

[HIGH] `--yolo` refusal is still under-scoped. 07-02 says the pre-flight runs “whenever `--yolo` is active,” but Task 3 scopes it to gate-skipping verbs plus bare invocation “so plain non-gate verbs are not surprised.” That leaves explicit `--yolo` invocations outside the refusal path, violating SC5 and the stated H1 fix. The plan should run the >50% cap refusal for every command line where `--yolo` is present, before any verb dispatch.

[HIGH] The H3 fix is not anchored to real LLM callsites. `bin/lib/runtime.ts` is currently config/API-key loading, while live Anthropic calls happen directly in `bin/lib/verify/pass2.ts` and `bin/lib/verify/pass4.ts`; Tier-2 `write` and `research` are placeholders. Adding a new guarded function in `runtime.ts` without migrating those callsites will not stop dry-run LLM egress. The RED test must drive a real live-capable path, such as `verify` with `ANTHROPIC_API_KEY` set, and assert `PENSMITH_DRY_RUN=1` blocks before SDK construction/network/cost append.

[HIGH] 07-04 permits a documentation fallback if `plugin.json` rejects the `skills` array or colon-prefixed skill names. That fallback does not satisfy SC2/SC4: the hidden plumbing namespace must be registered, not merely documented. If the schema rejects the proposed shape, the plan needs a valid alternate registration mechanism or the phase remains incomplete.

[MEDIUM] The configured session cap source is underspecified. The plans refer to `cost_cap_usd`, but the current runtime config schema has no such field, and 07-02 does not list a schema/config migration. Defaulting to `$5` may pass narrow tests but can ignore a user-lowered cap, weakening the `--yolo` financial safety gate.

[MEDIUM] Stop hook lock release is probably too vague. 07-03 hardcodes `release('.paper')`, but existing lock resources are arbitrary strings and compile uses a `compile:<path>` resource. If Phase 7 intends a global concurrent-run lock, the plan should define the exact resource and require all acquisitions/releases to use it.

HIGH_COUNT: 3
```

#### gemini

```
The **Cycle 2** review of the Phase 7 plans confirms that all four prior **HIGH** concerns (H1-H4) are architecturally resolved in their primary scope, though one new **HIGH** risk is introduced by the implementation's scoping choice for H1.

### Verification of Prior HIGH Concerns
- **H1 (--yolo cap mis-scoped): RESOLVED.** The 50%-cap refusal is moved to a pre-dispatch pre-flight in `bin/pensmith.ts` that runs whenever `--yolo` is active, independent of the `--estimate` flag.
- **H2 (citty root run() double-exec): RESOLVED.** The plan removes the root `run()` handler entirely. Flag setup and bare-command routing are handled in a manual `argv` pre-parse seam before `runMain` is called, ensuring explicit verbs execute exactly once.
- **H3 (--dry-run LLM leak): RESOLVED.** Task 4 in `07-02-PLAN.md` adds a mandatory dry-run guard at the model-invocation chokepoint in `bin/lib/runtime.ts` which short-circuits to a canned response and skips billing. The RED test in `07-01-PLAN.md` explicitly drives a real verb path (`write --dry-run`) to verify zero network egress.
- **H4 (router/resume loop): RESOLVED.** `resolveNextAction` in `bin/lib/router.ts` is pinned to ignore `HANDOFF.json` and never return `resume`. `bin/cli/resume.ts` dispatches to a work verb and then deletes `HANDOFF.json` to prevent re-entry.

### Remaining or New Concerns

- **[HIGH] H1 Refusal Bypass for Non-Gate Verbs:** Task 3 in `07-02-PLAN.md` restricts the `--yolo` 50% cap refusal to "gate-skipping verbs" (compile/done/outline) and bare invocation. This creates a loophole where `pensmith plan --yolo` or `pensmith write --yolo` could exceed the safety threshold without being refused. The non-negotiable requirement states "`--yolo` REFUSES when estimate > 50% of session cap" without qualification. The refusal should apply to *any* verb invoked with the `--yolo` flag.
- **[MEDIUM] H3 Executor Context (Missing Verb Files):** `07-02-PLAN.md` Task 4 introduces the canonical LLM seam in `runtime.ts` to fix H3, but the plan does not list existing verbs (`write.ts`, `research.ts`, `plan.ts`, `verify.ts`) in `files_modified`. If these verbs do not already use `runtime.ts` as their primary model-invocation call point, they must be refactored to pass the `tests/flags.test.ts` H3 egress assertion.
- **[MEDIUM] NL Routing Mismatch for "Redo":** `07-04-PLAN.md` Task 1 maps "redo section N" to the `pensmith:plan-section` plumbing skill, which only invokes the `plan` verb. Per PRD §5.4, "redo" should map to "plan + write". This routing will leave the user with an updated plan but no updated draft.
- **[LOW] Estimator Heuristic Coverage:** The `STEP_HEURISTICS` in `07-02-PLAN.md` should include or explicitly zero the remaining UX-02 verbs (e.g., `add`, `sketch`) to ensure the `totalUsd` projection remains a reliable safety signal.

HIGH_COUNT: 1
```

#### claude

```
I've now verified the load-bearing facts against the actual codebase. Here is my cycle-2 review.

---

# Cross-AI Plan Review — Pensmith Phase 7, CYCLE 2

## Verification of the four cycle-1 HIGHs

### H1 (`--yolo` cap mis-scoped) — ✅ RESOLVED

The refusal is now correctly split from the `--estimate` branch. `estimator.ts` (07-02 Task 2) computes only the pure `exceedsHalfCap` predicate; the hard `process.exit(1)` lives in the bin/pensmith.ts PRE-DISPATCH seam (07-02 Task 3c) and is gated on `--yolo` being active **independent of `--estimate`**, scoped to gate-skipping verbs (compile/done/outline) + bare. 07-01 `flags.test.ts` drives `compile --yolo` *and* bare `--yolo` **without** `--estimate` and asserts non-zero exit, plus the converse (under-cap → exit 0). The predicate takes the configured `cost_cap_usd` so a lowered cap tightens the threshold. The seam (session-log/budget/pricing) all exist. Genuinely resolved.

### H2 (citty root `run()` double-exec + late flags) — ✅ RESOLVED

The corrected Pitfall 4 matches citty reality (I confirmed the current `bin/pensmith.ts` has **no** root `run()` — only `subCommands` — so the fix's "do NOT add a root run()" instruction preserves that). Flag setup + bare routing live in a manual argv pre-parse before `runMain`; explicit verbs dispatch via `runMain` exactly once; bare invocation calls `resolveNextAction` directly. `--show-prompts`/`--dry-run` are applied in the pre-parse before dispatch, so they take effect for explicit verbs. 07-01 H2 case asserts single-dispatch (signature line once, no `→ verb` leak to stdout) + flag-for-explicit-verb. The `setMirrorPromptsToStderr` seam exists. Genuinely resolved.

### H4 (router/resume infinite loop) — ✅ RESOLVED

`resolveNextAction` ignores HANDOFF and never returns `{verb:'resume'}` (confirmed against the 07-RESEARCH pinned ordering + code example). `resume.ts` reads HANDOFF for the summary only, computes the next WORK verb via the HANDOFF-blind resolver, dispatches it via the shared `REAL_VERB_LOADERS`, then `rmSync(...,{force:true})` consumes the pointer. 07-01 pins the regression case (non-done HANDOFF in a fixture with a `planned` section → `verb==='plan'` and explicit `verb !== 'resume'`). The ordering is pinned in one place used by both files. Genuinely resolved.

### H3 (`--dry-run` didn't gate the LLM client) — ❌ NOT GENUINELY RESOLVED

This is the one the review instructions flag, and the codebase confirms the problem:

- **`bin/lib/runtime.ts` is config-load ONLY.** It loads/merges runtime config, resolves API-key *names→values*, and logs presence. There is **no model-invocation / LLM-client function anywhere in it** (or anywhere in `bin/lib/` — `bin/cli/compile.ts` states verbatim: *"bin/lib has no model-transport client yet (Tier-2 placeholder era)"*). The "runtime LLM seam" the plan instructs the executor to guard does not exist; 07-02 Task 4 itself admits this ("if the seam is a thin wrapper not yet present, introduce it here as the canonical call point") — i.e. it asks the executor to invent the seam.

- **The verb paths the H3 test drives make ZERO LLM calls regardless of `--dry-run`.** `bin/cli/write.ts` writes a hard-coded `TIER2_DRAFT` placeholder via `atomicWriteFile` — no key resolution, no network. `bin/cli/research.ts` writes a placeholder `LIBRARY.json` + empty `.bib` via `writeBibtex([])` — no LLM, no network. Neither verb routes through any runtime call point, and 07-02's `files_modified` does **not** include `write.ts`/`research.ts`, so even after the plan runs, no verb calls the new guard.

**Consequence:** the H3 RED test — "drive `write`/`research` under `--dry-run`, assert zero network egress + no COSTS.jsonl append" — passes **vacuously**. It would be GREEN with the dry-run guard, without the guard, and with the guard wired to nothing, because the driven verbs never attempt egress in any mode. The plan's `must_haves.truths` ("LLM client honors dry-run … asserted by driving the verb — not by env state alone") overstates what the gate proves: it cannot distinguish dry-run from normal operation. This is a regression gate that gates nothing and gives false assurance for SC5's "incl. the LLM client" clause.

Mitigating context (why this is HIGH, not catastrophic): with no LLM client in Tier 2, `--dry-run` trivially makes zero external calls today, and source adapters are offline by default (`isOfflineMode()` is true unless `PENSMITH_NETWORK_TESTS==='1'`). So nothing *leaks* now. The defect is that the fix is anchored to a nonexistent seam and the test misrepresents its own strength — the gap H3 was filed to close is not actually closed, and the future leak it warns about remains uncaught.

**Concrete fix (pick one):**
1. **Honest deferral** — implement only the `--dry-run` → `PENSMITH_DRY_RUN='1'` env plumbing, and rewrite the H3 test/`must_haves` to assert *that*, explicitly documenting in the SUMMARY that no LLM client exists in Tier 2 yet so the verb-path egress test is a placeholder, not proof. Remove the "LLM client honors dry-run, asserted by driving the verb" claim.
2. **Real anchor** — introduce the canonical guarded call point in `runtime.ts` **and** route at least one driven verb through it with an instrumented network-attempt counter (a spy that throws/counts on any outbound attempt), so the test actually exercises a path that *would* egress absent the guard. Given Tier-2 verbs are deterministic placeholders, this likely means a synthetic test seam rather than `write`/`research`.

---

## Remaining / new findings

- **[MEDIUM] HOOK-04 lock-release is effectively cosmetic (SC3).** `hooks/stop.ts` calls `release('.paper')`, but no pensmith code acquires a lock on the resource string `'.paper'` — locks are per-file (STATE.json path, etc.) via `withLock`. `lockfile.unlock` on an unlocked stub throws and is swallowed by the silent try/catch; `isLocked('.paper')` is `false` regardless. The 07-RESEARCH Open Question 1 / A2 flagged this exact uncertainty and it remains unresolved. The substantive part of Stop (`closeSessionLog()` flush) is real; the "releases the concurrent-run lock" half is a no-op against a lock nobody holds. Either point Stop at the actual session-level lock resource (and confirm something acquires it), or downgrade HOOK-04's wording to "flush log + best-effort lock cleanup" and note the absence of a session lock in the SUMMARY.

- **[LOW] `--yolo` pre-flight may throw in a paper-less dir.** The H1 pre-flight calls `projectEstimate` → `loadState`, which throws `StateNotFoundError` when no `.paper/STATE.json` exists. For `compile --yolo` / `done --yolo` in a fresh dir the pre-flight could crash instead of cleanly proceeding/refusing. 07-02 doesn't specify estimator behavior on missing STATE. Add a defined fallback (treat as zero remaining steps → `exceedsHalfCap=false`, or surface a clean "no active paper" message).

- **[LOW] `RouterDecision` `{verb:'resume'}` arm is dead.** 07-01/07-02 keep `| {verb:'resume'; handoff}` "for the explicit resume verb's typing," but `resolveNextAction` never emits it and `resume.ts` returns nothing typed as `RouterDecision` (it dispatches). The 07-RESEARCH code example shows the union *without* the resume arm. Harmless, but it's a typing/doc inconsistency that could confuse the executor — pick one representation.

- **[LOW] `pensmith write --dry-run` flag-parse assumption.** The four flags are declared on the *root* `defineCommand.args`; under `runMain`, citty parses args against the *subcommand* spec, so the root declarations don't reach `write`. The real mechanism is the argv pre-parse (correct), but the test assertion "`write --dry-run` parses without an unknown-flag error" relies on citty's permissive unknown-arg handling. This is gated by the test, so it'll surface if wrong — just noting the implicit dependency.

---

`HIGH_COUNT: 1`
```

#### opencode

```
## Cycle-2 Cross-AI Plan Review — Phase 7

### H1 (`--yolo` cap scoping) — **RESOLVED**
The pre-flight is now in the pre-dispatch seam, runs WHENEVER `--yolo` is active (independent of `--estimate`), and calls `projectEstimate` → hard `exit(1)` when over 50% cap. The RED test in 07-01 flags.test.ts drives `compile --yolo` and bare `--yolo` WITHOUT `--estimate` and asserts non-zero exit. The scoping to gate-skipping verbs + bare invocation is correct.

[MEDIUM] `projectEstimate` calls `loadState` which throws `StateNotFoundError` on a fresh directory. Bare `pensmith --yolo` in a dir with no `.paper/` would crash before routing to `new`. The pre-flight needs a try/catch or presence check around `projectEstimate`.

### H2 (citty double-dispatch + late flags) — **RESOLVED**
The design correctly:
- Removes root `run()` entirely
- Adds an argv pre-parse BEFORE `runMain` that applies flags to the environment
- Gives bare routing its own path (no `runMain` call) when no verb is detected
- Keeps `runMain` for explicit verbs only (exactly once)

RED test asserts single stdout frame + no second dispatch + `--show-prompts` observable for explicit verbs. No concerns.

### H3 (`--dry-run` LLM leak) — **RESOLVED**
The guard at the runtime LLM seam (`PENSMITH_DRY_RUN` → canned stub) is the right approach, and the RED test drives a real verb path asserting zero network egress + no `COSTS.jsonl` append.

[MEDIUM] The plan acknowledges the seam "may not yet exist" and instructs to "introduce it here as the canonical call point so verbs route through ONE guarded function." This means the fix's effectiveness depends on whether ALL verb paths are refactored to route through this single chokepoint — but only `bin/lib/runtime.ts` is listed in `files_modified`. The verb files (`bin/cli/write.ts`, `bin/cli/research.ts`) are not listed. If the executor only modifies the seam and the two test-driven verbs, other verb paths could still leak LLM calls under `--dry-run`. This is a partial SC5 delivery risk.

### H4 (router/resume infinite loop) — **RESOLVED**
Triple pinning: `resolveNextAction` never reads HANDOFF, never returns `'resume'`; `resume.ts` computes the next WORK verb via `resolveNextAction` (not self-dispatch), then deletes HANDOFF. RED test asserts `verb !== 'resume'` with a non-done HANDOFF present. Clean.

### Additional findings

[LOW] **Stale HANDOFF after non-resume dispatch.** Bare routing or explicit verbs (compile/done/write) that advance state never consume HANDOFF.json. If a session is interrupted, SessionStart finds a stale HANDOFF and emits an outdated resume message. Not a correctness bug (routing ignores it) but a UX nuisance.

[LOW] **Gate-skipping verb list is implicit.** The plan says "gate-skipping verbs + bare invocation" but compiles the list procedurally (compile/done/outline) without defining a named export or configuration. If a verb is added later, the list drifts. Consider exporting `GATE_SKIPPING_VERBS` from `verbs.ts` for programmatic use.

### Summary

| Concern | Status |
|---------|--------|
| H1 (`--yolo` without `--estimate`) | RESOLVED (MEDIUM: fresh-dir crash edge case) |
| H2 (citty double-dispatch + late flags) | RESOLVED |
| H3 (`--dry-run` LLM leak) | RESOLVED (MEDIUM: single-chokepoint coverage scope) |
| H4 (router/resume infinite loop) | RESOLVED |

**HIGH_COUNT: 0**
```

---

## Cycle 3

Reviewers run (all 4 completed, exit 0): **codex** (4 HIGH claimed), **gemini** (0 HIGH), **claude** (1 HIGH), **opencode** (0 HIGH). Review prompt: `/tmp/gsd-review-prompt-7.md` (full text of all 4 revised plans + GOAL + 5 SCs + non-negotiables + the 4 prior-HIGH resolutions to confirm).

### Synthesized Findings (cycle 3)

**Prior-HIGH confirmation — UNANIMOUS across all 4 reviewers + verified against the codebase:**

| Prior HIGH | Verdict | Codebase evidence |
|---|---|---|
| H2 (citty double-dispatch) | **GENUINELY RESOLVED** | `bin/pensmith.ts` currently has `subCommands` only + NO root `run()`; 07-02 Task 3 replaces `void runMain(command)` with a pre-dispatch argv pre-parse that calls `runMain` exactly once for explicit verbs and bypasses it for bare. |
| H4 (router/resume loop) | **GENUINELY RESOLVED** | 07-02 Task 1: `resolveNextAction` does not read HANDOFF.json and never emits `resume`; resume.ts dispatches the next WORK verb then `rmSync(force)` the handoff. 07-01 H4 RED case asserts `verb !== 'resume'`. |
| H1/C2-H1 (yolo cap scope + paper-less) | **GENUINELY RESOLVED** | 07-02 Task 3c: pre-flight runs whenever `--yolo` present, ANY verb, independent of `--estimate`, hard `exit(1)`. Cap = `PENSMITH_COST_CAP_USD` else $5 (no `cost_cap_usd` config field exists — C2-M3 honored). 07-02 Task 2: `projectEstimate` catches `StateNotFoundError` -> empty projection. |
| H3/C2-H3 (dry-run LLM gate) | **GENUINELY RESOLVED — independently code-verified** | `runtime.ts` confirmed config/API-key load only (no model seam). pass2.ts:215 + pass4.ts:392 both gate on `PENSMITH_NO_LLM==='1' OR !ANTHROPIC_API_KEY`; `messages.create()` (pass2:255/pass4:444) AND `appendCost()` (pass2:263/pass4:452) are both inside the live branch AFTER the noLlm short-circuit. `--dry-run` sets `PENSMITH_NO_LLM='1'` (07-02 Task 3b). The 07-01 H3 test sets a FAKE `ANTHROPIC_API_KEY`, making the gate depend ENTIRELY on `PENSMITH_NO_LLM` -> non-vacuous. The fictional runtime.ts seam is removed from RESEARCH (L348/698/737) + PATTERNS (L295/919) + all 4 plans. |

**NEW HIGH (judge-confirmed against the codebase):**

- **[HIGH] Router decision table is not total — `failed`/`unverifiable` terminal sections yield an undefined `RouterDecision` (SC1 / SC5).** _Raised by claude; verified._ 07-02 Task 1 (line 167) walks sections treating `verified/failed/unverifiable -> continue`, and the post-walk compile branch (line 168) is guarded on **"All sections verified."** A reachable state `[verified, failed, verified]` with no DRAFT.md matches NO branch: the walk finds nothing actionable, "all verified" is false (one is `failed`), no DRAFT -> fall-through returns `undefined`, breaking the `Promise<RouterDecision>` contract and crashing the bare dispatcher's `decision.verb` access. `failed` and `unverifiable` are first-class `SectionStateSchema` states the verify verb legitimately sets (`state.ts:33-34`, `plan-frontmatter.ts:46`) — not a contrived edge. 07-01's RED suite (line 170) fixtures ONLY `planned`/`verified`/DRAFT/FINAL (no `failed`/`unverifiable`/`writing`/`written`/`verifying`), so the gap stays GREEN and SC5's "fix every contract first" misses it. Directly violates SC1's "bare /pensmith ALWAYS resolves a next action." **Fix:** add an exhaustive terminal `else` to resolveNextAction (route a `failed`/`unverifiable` section back to `verify`/`write`, or return `{verb:'status', reason}` for a stuck-needs-attention state), AND add 07-01 RED cases for `failed`/`unverifiable`/`writing`/`written`/`verifying`.

- **[HIGH] Global flags (esp. `--yolo`) are not specified to propagate into manually-dispatched verbs (bare / next / resume paths) — approval-gate-skip non-negotiable at risk (SC3 / non-negotiable).** _Raised by codex; verified._ For the explicit-verb path, citty parses `--yolo` into the subcommand's `args.yolo`, and `compile.ts:90` / `done.ts:436` both read `yolo: args.yolo === true` to decide whether to skip the approval gate. But on the bare path (07-02 Task 3e: "dispatch to the resolved verb via the shared loader table and run it") and the resume/next manual-dispatch paths, the plan does not specify constructing an `args` object carrying `yolo:true` into the verb's `run()`. So `pensmith --yolo` resolving to compile/done — or `pensmith resume --yolo` — would run the cost-cap pre-flight (financial gate holds) but the verb's OWN approval-gate-skip would NOT engage, contradicting the "approval gates default-on; --yolo skips them" non-negotiable. No test covers `--yolo` propagation through the manual-dispatch path (H2(b) only checks env-based `--show-prompts`/`--dry-run`). **Fix:** define an explicit dispatch contract — the shared loader-table dispatch must forward the parsed global flags (at minimum `yolo`) into the manually-invoked verb's `args`, and add a RED case asserting `--yolo` skips the approval gate via the bare/resume path.

**Downgraded / rejected from codex's claimed HIGHs:**

- _Codex [HIGH] "Stop hook flush is a no-op across the hook process boundary"_ -> **MEDIUM.** Real architectural caveat: hooks run as separate subprocesses; `closeSessionLog()` awaits a module-scope `activeChain` only populated by an in-process `openSessionLog()`, and `stop.ts` opens no logger — so the flush drains only records the Stop process itself enqueued, not the main agent process's buffer (`session-log.ts:251` chain is module-scope; writes are async via `atomicAppendFile`). BUT this is the design as approved in cycles 1-2; the M1/`Promise.allSettled` gate is still correct for in-process records and the flush is best-effort by requirement framing (HOOK-04). It does not produce wrong/unsafe output -> MEDIUM. (Also raised by claude as MEDIUM.)
- _Codex [HIGH] "lock-release target `.paper` is underspecified / likely wrong"_ -> **REJECTED (non-issue).** The plan EXPLICITLY documents that no `.paper`-keyed lock is held and that `release('.paper')` rejects — that rejection is the entire rationale for `Promise.allSettled`. By-design best-effort, not a defect. Codex misread the intent.
- _Codex [HIGH] "07-04 doc-only fallback would not deliver the colon namespace (SC2)"_ -> **MEDIUM.** Gated by `validate-plugin-manifest.cjs` + a blocking human-verify checkpoint, so it cannot ship a broken manifest. Tier-1 namespace delivery is genuinely contingent on the unresolved Anthropic plugin-schema question (Assumption A1) — settle it before execution — but it is not a guaranteed failure. (Also raised by claude as MEDIUM.)

**Consensus MEDIUMs worth carrying:**
- PreCompact `Promise.race` timeout `setTimeout` is never cleared/`unref`'d (codex, claude, opencode) — fast writes can delay hook exit up to 10s. Clear the timer on the race winner.
- PreCompact has no `section_pointers` size-fitting strategy (claude) — a ~25+ section paper can exceed `HANDOFF_MAX_BYTES=5120`; the `.refine` REJECTS (not truncates), so `writeHandoff` throws and NOTHING is written, silently losing resume state (SC4/HOOK-01). Add a deterministic trim/elide of pointers.
- plugin.json colon-namespace schema validity unresolved (codex, claude) — see above.

**Consensus LOWs:** keeping `{verb:'resume'}` in `RouterDecision` invites misuse (codex); `REAL_VERB_LOADERS` export creates an ES-module cycle that works only via lazy access (opencode); first-non-flag-token verb detection breaks if a value-taking flag is added (opencode); default $5 cap may make bare `--yolo` over-conservative for real papers (opencode); global flags declared root-only rely on citty's permissive unknown-flag handling (claude).

### Per-Reviewer Raw (cycle 3)

#### codex (HIGH_COUNT: 4 claimed -> judged 1 valid HIGH [flag propagation] + 1 reject + 2 downgrades)

```text
**Prior High Confirmation**
1. Citty double-dispatch (H2): genuinely resolved as written. 07-02 keeps root command subCommands-only, moves flags/bare routing into a manual pre-dispatch seam, and gates explicit verbs to `runMain()` exactly once.
2. Router/resume loop (H4): genuinely resolved as written. `resolveNextAction()` ignores `HANDOFF.json` and never emits `resume`; `resume.ts` dispatches to the next work verb and deletes HANDOFF afterward.
3. `--yolo` cap scope + paper-less guard (H1/C2-H1): mostly resolved for cost refusal. The plan runs the cap pre-flight for any `--yolo` invocation and catches missing state via `projectEstimate()`.
4. `--dry-run` real LLM guard (H3/C2-H3): genuinely resolved as written for current LLM call sites. The plan correctly sets `PENSMITH_NO_LLM='1'` and relies on the existing `pass2.ts` / `pass4.ts` guards, with a non-vacuous `verify --dry-run` test.

**Findings**
[HIGH] 07-02 does not specify propagating global flags when bare/`next`/`resume` manually dispatch into the resolved work verb. The pre-dispatch seam sets env flags, but for bare `pensmith --yolo` resolving to `compile`/`done`, or `pensmith resume --yolo`, the underlying command may not receive a parsed `yolo` arg. That threatens the non-negotiable “approval gates default-on (`--yolo` skips them)” even though the cost cap pre-flight runs. The plan needs an explicit dispatch contract that carries global flags into manually invoked verb runners, especially `yolo`.

[HIGH] 07-03’s Stop hook plan does not actually guarantee log flushing across the hook process boundary. `closeSessionLog()` is described as a module-level `activeChain`, but Stop runs as its own hook process, so it imports a fresh module with no active logger chain from prior CLI/plugin work. As written, the flush can be a no-op while tests still pass if they only exercise same-process state. This misses SC4’s “always flushes the session log.” The plan needs a process-independent flush strategy or a clear proof that the session logger lives in the Stop hook process.

[HIGH] 07-03’s lock-release target is underspecified and likely wrong. The plan repeatedly notes no code acquires a `.paper`-keyed lock and locks are per-file, then implements `release('.paper')`. That means Stop best-effort releases a lock that normally was never held and may not release the actual pensmith lock. This fails HOOK-04 unless `.paper` is proven to be the real shared lock resource.

[HIGH] 07-04 allows a documented fallback if the plugin schema rejects `skills` or colon-prefixed names. That fallback would not deliver the required colon-prefix plumbing namespace routing, violating SC2, UX-04, and two-tier parity. This should be a blocking plan failure, not an accepted success path: either validate and register the namespace or redesign to a schema-valid equivalent.

[MEDIUM] 07-03’s PreCompact timeout pattern uses `Promise.race()` with a raw `setTimeout()` that is never cleared on successful writes. In Node, that timer can keep the hook process alive until the 10s timeout fires, making fast PreCompact runs appear to hang near the timeout boundary. Use a cleared timer or abortable timeout helper.

[MEDIUM] 07-01’s H3 dry-run network assertion is weaker than the stated contract. “Run completes without a network error” plus no `COSTS.jsonl` append is useful, but it does not directly prove zero provider egress if a call is swallowed, mocked elsewhere, or fails silently. The implementation plan is sound via `PENSMITH_NO_LLM`, but the RED test should assert the provider client/mock was not invoked.

[LOW] 07-02 keeps `{ verb: 'resume' }` in `RouterDecision` while also stating `resolveNextAction()` never returns it. That is workable but invites misuse by future code. Prefer a separate `ResumeDecision` or a narrower return type for `resolveNextAction()`.

HIGH_COUNT: 4

```

#### gemini (HIGH_COUNT: 0)

```text
This review evaluates the four execution plans (07-01 through 07-04) for Phase 7 of "pensmith." The plans are assessed against the Goal, 5 Success Criteria, and Non-Negotiables.

### Prior-Cycle Resolution Confirmation
1. **citty double-dispatch (H2):** **Resolved.** Plan 07-02 (Task 3) implements a manual `argv` pre-parse seam in `bin/pensmith.ts` before `runMain`, ensuring flags apply globally and the root command (which has no `run()`) never falls through to a second dispatch. 07-01 (Task 1) provides a RED test specifically to assert single-dispatch behavior.
2. **router/resume loop (H4):** **Resolved.** Plan 07-02 (Task 1) implements a router that explicitly ignores `HANDOFF.json`, and Task 3 ensures `resume.ts` consumes (deletes) the handoff file after dispatching to a work verb, preventing circularity.
3. **--yolo cap scope (H1/C2-H1):** **Resolved.** Plan 07-02 (Task 3) places the yolo cap pre-flight in the pre-dispatch seam for *any* command line containing `--yolo`, covering non-gate verbs like `write` and `plan`. Task 2 includes the `StateNotFoundError` guard in the estimator to prevent crashes in fresh directories.
4. **--dry-run anchored to real PENSMITH_NO_LLM (H3/C2-H3):** **Resolved.** Plan 07-02 (Task 3) uses `--dry-run` to set `PENSMITH_NO_LLM='1'`, and Task 4 verifies that the existing Phase 5 LLM call sites in `pass2.ts` and `pass4.ts` already honor this variable to short-circuit to offline placeholders. 07-01 (Task 1) includes a non-vacuous RED test driving the `verify` path with a fake key to prove zero egress.

### Findings

- [LOW] **Circular Dependency Mitigation:** 07-02 Task 3 correctly identifies the risk of circular dependencies by exporting `REAL_VERB_LOADERS` from the entry point (`bin/pensmith.ts`) for use by the `next` and `resume` orchestrators. This maintains the single-command architecture while keeping the codebase modular.
- [LOW] **Handoff Deletion Strategy:** In 07-02 Task 3, `resume.ts` deletes `HANDOFF.json` immediately after resolving the next work verb. This is the correct "consuming" behavior to prevent infinite resume loops if the resumed action itself is interrupted (as a fresh handoff will be written by subsequent hooks).
- [MEDIUM] **Stop Hook Reliability:** 07-03 Task 2 correctly uses `Promise.allSettled` for the `Stop` hook. This is a critical safety feature: since no code currently acquires a `.paper` resource lock, `release('.paper')` is guaranteed to reject. `allSettled` ensures this rejection does not prevent the `session-log` flush, satisfying SC4/M1.
- [MEDIUM] **Pre-Dispatch Seam Robustness:** 07-02 Task 3's manual `argv` scan is correctly positioned outside of `runMain`. This ensures that global flags take effect even for explicit subcommands, fixing a known limitation of the `citty` framework where root `run()` logic is bypassed when a subcommand matches.
- [LOW] **NL Routing Descriptions:** 07-04 Task 1 adheres to the "No Vague Descriptions" rule by including the exact PRD §5.4 trigger phrases. This ensures the LLM has high-signal routing targets for phrases like "where am I?" and "redo section 3."
- [LOW] **Plumbing Namespace Fallback:** 07-04 Task 2 includes a defensive fallback plan in case the `Claude Code` plugin schema rejects colon-prefix skill names (e.g., `pensmith:plan-section`). This demonstrates proactive risk management for Tier-1 registration.

### Final Assessment
The plans are surgically precise and strictly adhere to the project's technical integrity standards. The use of a RED-by-skip test suite in Wave 0 ensures that all regression gates for the previously identified HIGH concerns are locked in before implementation. The architecture preserves the 16-verb bijection and delivers the requested single-command UX without introducing redundant logic or "just-in-case" alternatives.

**HIGH_COUNT: 0**

```

#### claude (HIGH_COUNT: 1 — the router-totality HIGH, judge-confirmed)

```text
# Adversarial Review — Pensmith GSD Phase 7 (cycle 3)

## Prior-cycle HIGH confirmations

**H2 (citty double-dispatch) — GENUINELY RESOLVED.** The root `defineCommand` keeps `subCommands` only and NO `run()` (07-02 Task 3, step 2 + closing note), so after citty dispatches the subcommand at the unconditional parent-run point there is no fall-through verb. Flag side-effects and bare routing live in the argv pre-parse before `runMain`, and bare invocation deliberately bypasses `runMain` (which would throw "No command specified"). Single-dispatch (H2a) and flags-for-explicit-verbs (H2b) are both correctly mechanized and test-gated in `flags.test.ts`.

**H4 (router/resume loop) — GENUINELY RESOLVED.** `resolveNextAction` is specified to ignore `HANDOFF.json` and the `{verb:'resume'}` arm is explicitly never emitted (07-02 Task 1 behavior). `resume.ts` computes the next WORK verb via `resolveNextAction`, dispatches, then `rmSync(force)` the handoff. The 07-01 H4 fixture (non-done HANDOFF + a `planned` section) asserting `decision.verb !== 'resume'` is a valid regression gate. No self-dispatch path remains.

**H1/C2-H1 (--yolo cap scope + paper-less crash) — GENUINELY RESOLVED.** The cap pre-flight runs whenever `--yolo` is present, for any verb (incl. non-gate `write`/`plan`) and bare, independent of `--estimate`, as a hard `exit(1)` in the pre-dispatch seam (07-02 Task 3, step 3c). Cap source is `PENSMITH_COST_CAP_USD` else `$5`, and `projectEstimate` catches `StateNotFoundError` → empty projection (Task 2), so a paper-less dir is under-cap. `flags.test.ts` drives both the non-gate over-cap and the paper-less no-crash cases.

**H3/C2-H3 (--dry-run anchored to PENSMITH_NO_LLM) — GENUINELY RESOLVED.** No `runtime.ts` seam is invented; `--dry-run` sets `PENSMITH_NO_LLM='1'` (07-02 Task 3b), honored by the only live `messages.create()` sites (pass2/pass4), with no Phase-5 edits (Task 4). The 07-01 H3 test drives `verify <N> --dry-run` **with a fake `ANTHROPIC_API_KEY` present**, so the assertion depends entirely on `PENSMITH_NO_LLM` (non-vacuous) and asserts zero egress + no `COSTS.jsonl` append. Note the standing caveat below (L-B-adjacent): the "zero external calls" guarantee holds only while pass2/pass4 remain the sole LLM sites — true this phase, but undefended against future call sites.

## New / remaining findings

- **[HIGH] The router decision table is not total — `failed`/`unverifiable` terminal sections produce no matching branch (SC1 / SC5).** As written (07-02 Task 1), the section walk treats `verified | failed | unverifiable → continue`, and the post-walk branches are guarded on **"all sections verified"** (compile), then DRAFT→done, then both→status. A reachable state — e.g. sections `[verified, failed, verified]` with no DRAFT — satisfies *none* of these: the walk finds nothing actionable, "all verified" is false (one is `failed`), and no DRAFT exists. `resolveNextAction` then falls through with no defined return, so the contract `Promise<RouterDecision>` yields `undefined` and the bare dispatcher's `decision.verb` access crashes. `failed`/`unverifiable` are first-class `SectionStateSchema` states that verify legitimately produces, so this is not an edge case. This directly violates SC1's guarantee that bare `/pensmith` *always* resolves a state-aware next action. Worse, 07-01's RED suite only fixtures the `planned`/`verified`/DRAFT/FINAL branches — there is no RED case for `failed`/`unverifiable` (nor for `writing`/`written`/`verifying`), so 07-02 can implement the gap and the suite stays green. The decision table needs an exhaustive terminal else (route the failed section back to `verify`/`write`, or return `status` with a reason), plus a RED case covering it.

- **[MEDIUM] Stop hook's "always flushes the session log" is likely vacuous in a subprocess, and `stop.test.ts` cannot observe a real flush (SC4 / M1).** Hooks run as separate short-lived processes (the tests `execFileSync` them). `closeSessionLog()` awaits a *module-scope* `activeChain` that is only assigned by an in-process `openSessionLog()` call — but `stop.ts` opens no logger, so `activeChain` is `null` and `closeSessionLog()` resolves immediately, draining nothing. The session log that needs flushing lives in the main agent process, which the Stop subprocess cannot reach. The whole `Promise.allSettled` framing (flush-survives-release-rejection) presumes `closeSessionLog()` does real work here; if it's a no-op, both SC4's "always flushes" half and the M1 test are theatrical. The stop.test.ts assertion ("session-log pending records were written / flush sentinel present") has no mechanism to be non-vacuous because the hook never queues records. Verify session-log's durability model against `session-log.ts`: if writes are synchronous-append the flush is moot (and the requirement should be reframed), if buffered the flush is unachievable from the hook (and SC4 is unmet). Either way the current test will pass without proving anything.

- **[MEDIUM] PreCompact has no size-fitting strategy; a large paper exceeds `HANDOFF_MAX_BYTES` and writes NOTHING (SC4 / HOOK-01).** `HandoffSchema` `.refine` *rejects* (does not truncate) at >5120 bytes. `section_pointers` is the one unbounded field (slug + 3 paths per section). A many-section paper (~25+ sections) blows past 5KB, the parse throws inside `writeHandoff`, the catch routes to stderr, and no HANDOFF is written — silently losing resume state. The plan relies on the refine as a guard but specifies no fitting/truncation of `section_pointers`. SC4's "writes a ≤5KB HANDOFF" is then unmet precisely for the long-running sessions PreCompact exists to protect. Add a deterministic trim (e.g., cap/elide pointers) so a handoff always fits.

- **[MEDIUM] plugin.json colon-namespace registration is unverified, and the doc-only fallback would leave the plumbing namespace non-functional in Tier 1 (SC2).** 07-04 Task 2 itself flags (Assumption A1 / Open Question 2) that the `skills` array + `pensmith:plan-section` colon names may not validate against the Anthropic plugin schema, with a fallback of "document in CONTRIBUTING.md." If that fallback triggers, the plumbing namespace is documented but not registered — so SC2's "the plumbing namespace route correctly" is not delivered in the plugin tier, and the tier-contract parity case (Task 2) would have nothing real to assert against on the Tier-1 side. This is gated by `validate-plugin-manifest.cjs` and a blocking human-verify checkpoint, so it won't ship a broken manifest — but the success criterion's delivery is genuinely contingent on an unresolved schema question that should be settled before, not during, execution.

- **[LOW] Global flags are declared on the root command only; explicit-verb support relies on citty's permissive unknown-flag handling.** `write --dry-run` / `compile --show-prompts` are parsed for side-effects by the pre-parse seam, but citty's subcommand parser receives `--dry-run`/`--yolo` as undeclared. citty is non-strict by default (unknown flags are tolerated), so `flags.test.ts`'s "no unknown-flag error" assertion should pass — but the verbs' own `--help` won't document the global flags, and the design is one citty-strictness-default change away from breaking. Consider redeclaring the four flags per-subcommand or documenting the reliance.

- **[LOW] `--estimate`/`--yolo` project the entire remaining workflow regardless of the invoked verb.** `projectEstimate({paperRoot, sessionCapUsd})` takes no target verb, so `write --yolo` is refused based on *total remaining paper cost*, not the write step's cost — a defensible "session cap" reading of SC3, but a possible surprising refusal on a cheap single-section write in a large paper. The semantics aren't pinned in the plan; worth an explicit decision/comment.

- **[LOW] PreCompact timeout timer is not `unref`'d and the estimator's stated `resolveNextAction` reuse is inconsistent with its action body.** The `setTimeout` in the `Promise.race` (07-03 Task 1) can keep the event loop alive up to 10s after a fast `writeHandoff` if the hook ever returns without an explicit `process.exit` (the race winner is handled, so no unhandled rejection — just a minor exit delay). Separately, 07-02 Task 2 `read_first` lists reusing `resolveNextAction` while the action says "only pricing.ts and state.ts" — harmless, but clarify whether the estimator walks state directly or via the router.

## Summary

The four prior HIGHs are all genuinely resolved as written, with correct, test-gated mechanisms. The one new HIGH is a totality gap in the router decision table for `failed`/`unverifiable` sections — a reachable state that yields an undefined `RouterDecision` and is uncovered by the RED suite, directly threatening SC1. The Stop-flush vacuity and PreCompact size-fitting are the strongest MEDIUMs and should be resolved against the actual `session-log.ts`/handoff sizing before execution.

HIGH_COUNT: 1

```

#### opencode (HIGH_COUNT: 0)

```text
# Pensmith Phase 7 Cross-AI Plan Review

## Prior HIGH Confirmations

1. **H2 (citty double-dispatch):** GENUINELY RESOLVED — the pre-parse argv seam before `runMain`, combined with no root `run()` and manual bare dispatch, prevents double routing. **Residual risk noted below.**

2. **H4 (router/resume loop):** GENUINELY RESOLVED — `resolveNextAction` never reads HANDOFF.json, never returns `'resume'`; `resume.ts` dispatches to the next WORK verb then deletes HANDOFF.json. The H4 RED case (`decision.verb !== 'resume'`) guards the regression.

3. **H1/C2-H1 (yolo cap scope + fresh-dir guard):** GENUINELY RESOLVED — cap pre-flight runs for ANY `--yolo` verb and bare invocation, independent of `--estimate`; `projectEstimate` catches `StateNotFoundError` → empty projection (no crash in a paper-less dir). Fresh-dir test case included.

4. **H3/C2-H3 (dry-run LLM gate via PENSMITH_NO_LLM):** GENUINELY RESOLVED — `--dry-run` sets `PENSMITH_NO_LLM='1'` which the existing `pass2.ts`/`pass4.ts` call sites already honor; no `runtime.ts` edits needed. The H3 test drives the LLM-calling `verify` path with a fake `ANTHROPIC_API_KEY` (non-vacuous).

---

## Findings

[MEDIUM] **Circular dependency via REAL_VERB_LOADERS export (07-02 Task 3).** The plan exports `REAL_VERB_LOADERS` from `bin/pensmith.ts` so that `next.ts`/`resume.ts` can use it, claiming this "avoids the circular-dep risk." In fact it creates a cycle: `pensmith.ts → next.ts` (to register) **and** `next.ts → pensmith.ts` (to get the loader table). This works with ES module lazy access (dispatch inside `run()` functions) but is fragile — a top-level access of the import would get `undefined`. **Fix:** extract the loader table to a separate module (e.g., `bin/lib/verb-loaders.ts`) that both `pensmith.ts` and the verb CLIs import without creating a cycle.

[MEDIUM] **citty `undefined run()` dependency for H2 (07-02 Task 3).** The plan relies on omitting root `run()` entirely, assuming citty checks for existence before calling `parent.run()`. If citty unconditionally calls it, explicit verbs crash. The RED test guards the symptom but the plan provides no fallback. **Fix:** provide an explicit no-op `run() {}` that returns void (guaranteed safe regardless of citty behavior) or confirm citty's internals handle `undefined`.

[MEDIUM] **PreCompact Promise.race timeout does not cancel writeHandoff (07-03 Task 1).** A hanging `writeHandoff` continues executing with a file lock after the 10s timeout rejects. The `stale:10_000` proper-lockfile setting mitigates crash-safety but a subsequent PreCompact call within 10s may fail to acquire the lock. **Fix:** note this limitation in a comment and/or use an AbortController pattern if the underlying I/O supports it.

[LOW] **Flag-value heuristic for verb detection (07-02 Task 3e).** The "first non-flag argv token" assumes all registered flags are boolean with no values. If a future non-boolean flag is added (e.g., `--config path`), `path` would be misidentified as a verb token. **Fix:** document this constraint or add a known-flag skip-list.

[LOW] **Default $5 session cap may make --yolo unusably conservative (07-02 Task 3c).** Most real academic paper sessions exceed $2.50 in projected cost, so bare `pensmith --yolo` would always exit non-zero unless the user knows to set `PENSMITH_COST_CAP_USD`. **Suggestion:** raise the default to $20–50 or make the refusal a warning (not hard exit) when using the default cap.

[LOW] **"make it sound less AI" → done/humanize depends on prior-phase correctness (07-04 Task 1).** The NL routing phrase maps to a done-verb sub-path assumed implemented in a prior phase. If it doesn't exist, the skill description routes correctly but the target verb path is missing. Outside Phase 7 scope; verify during human checkpoint.

---

## Summary

The four plans are well-structured and correctly address all five SUCCESS CRITERIA. The three MEDIUM findings (circular dep, citty run() assumption, timeout non-cancellation) should be addressed before or during implementation to avoid runtime failures. All four prior HIGH concerns are genuinely resolved as written.

HIGH_COUNT: 0

```

### Cycle 3 — Judge Verdict

**current_high = 2.** Prior H1/H2/H3/H4 unanimously + code-verified RESOLVED. Two NEW HIGHs survive judging: (A) router decision-table totality gap for failed/unverifiable sections (claude; verified against SectionStateSchema in state.ts:39-41), and (B) global-flag (yolo) propagation into manually-dispatched bare/resume verb paths (codex; verified against compile.ts:90 + done.ts:436). Gemini + opencode found 0 HIGH; codex claimed 4 but 1 was rejected (.paper lock rejection is by-design, the rationale for Promise.allSettled) and 2 downgraded to MEDIUM (Stop-flush cross-process vacuity; plugin-schema fallback). All other findings are MEDIUM/LOW and non-blocking.

---

## Cycle 4

**Reviewed:** 2026-06-18. Reviewers run: codex, gemini, claude, opencode (all four available and returned usable output). Prompt: `/tmp/gsd-review-prompt-7.md` (GOAL + 5 SCs + 8 non-negotiables + FULL TEXT of all 4 revised plans 07-01..07-04). Focus: confirm the two cycle-3 fixes — (1) resolveNextAction made TOTAL over SectionStateSchema, (2) global flags forwarded through bare/next/resume manual dispatch via dispatchVerb — are genuinely resolved, and surface any remaining/NEW HIGH.

Raw HIGH_COUNT per reviewer: codex 2, gemini 0, claude 0, opencode 1.

### Synthesized Findings (cycle 4)

**Both cycle-3 fixes UNANIMOUSLY + code-verified RESOLVED.** All four reviewers independently confirm:
- **C3-HIGH-1 (router totality):** the exhaustive `switch` over all 7 SectionStateSchema states (`planned/writing/written/verifying/verified/failed/unverifiable`) + `default:` arm + three post-walk returns is provably total. `failed`/`unverifiable` route to `verify`; `verified` is the only `continue`; compile is reached only when every section is verified. The mixed `[verified,failed,verified]`-no-DRAFT case returns `verify` at the failed section and can never fall through to `undefined`. Verified against the RESEARCH.md code example and 07-02 Task 1 behavior.
- **C3-HIGH-2 (flag propagation):** `dispatchVerb()` merges `yolo: globalFlags.yolo === true` into the dispatched verb's args and calls `cmd.run({args: mergedArgs})`; bare (3e), next, and resume all route through it. Re-verified against the live repo: `compile.ts:90` and `done.ts:436` read exactly `args.yolo === true`, so the forwarded value reaches the gate-skip read on the bare AND resume paths. Ordering is sound — the C3-HIGH-2 RED fixtures keep projected cost under the 50% cap so the step-3c pre-flight does not mask the gate-skip assertion. The explicit-verb path correctly relies on citty parsing `--yolo` directly (no manual forwarding needed) with a single dispatch (no root `run()`).

**Judge verdict: current_high = 1.** One genuine NEW HIGH survives, code-verified and not adjudicated in any prior cycle.

- **[HIGH] (07-02 Task 1, router.ts) — `resolveNextAction` crashes on a malformed-but-present STATE.json, violating SC1's "never crash" guarantee.** Raised by codex; sub-case (state.sections undefined → `.sort()`) raised by opencode (LOW). VERIFIED against the repo: `loadState` calls `StateSchema.parse` (state.ts:259 and migration path :303), which throws a Zod/SchemaValidationError on a corrupt or schema-invalid STATE.json (e.g. bad JSON, a `sections` entry missing `slug`, a non-numeric `n`, or `sections` absent). The router (07-02 Task 1) catches ONLY `StateNotFoundError instanceof` and re-throws everything else, so the exception bubbles out of `resolveNextAction` before any `RouterDecision` exists — the bare dispatcher fails before `decision.verb`. This is distinct from the cycle-3 totality HIGH (which was the well-typed SectionStateSchema state space, genuinely fixed); it is the OTHER half of "router is total over real inputs" — robustness against a corrupted/hand-edited STATE.json. SC1 says bare `/pensmith` must NEVER crash, and the review prompt explicitly asked about "any STATE.json shape." **Fix direction:** widen the router's catch (and the estimator's, which has the identical `StateNotFoundError`-only catch — 07-02 Task 2) to also handle malformed/schema-invalid state — return `{ verb:'status', reason:'attention' }` (router) / the empty projection (estimator) with a stderr diagnostic, and guard `state.sections` for null/undefined before `.sort()`. Add a RED case in `pensmith-router.test.ts` fixturing a corrupt STATE.json and asserting a valid non-undefined decision (no throw).

**Downgraded / rejected (with justification):**
- **[MEDIUM] (07-02 Task 3, bin/pensmith.ts) — pre-parse scans but does not STRIP the four global flags from `process.argv` before `runMain`, so `pensmith write --dry-run` may hit a citty "unknown flag" error** (the `write` subcommand does not declare those flags). Raised independently by codex (LOW), gemini (LOW), opencode (MEDIUM), claude (LOW) — strong cross-reviewer signal. Maps to SC3 / H2(b) (flags must take effect for explicit verbs) and the H2/H3 RED tests that drive explicit-verb paths. NOT a HIGH because citty ^0.2.2 is lenient with undeclared flags by default (collects them rather than erroring) and the pre-parse applies the flag EFFECTS regardless of stripping — so this is an untested robustness assumption, not a proven SC failure. **Recommend (non-blocking):** strip the four flags from argv before `runMain`, or declare them on every subcommand's args, and add an explicit `pensmith write --dry-run` RED case so the assumption is tested rather than relied upon.
- **[MEDIUM] (07-04 Task 2) — plugin.json CONTRIBUTING.md fallback does not deliver a working `/pensmith:plan-section` in Tier 1 if the schema rejects colon names.** Raised as HIGH by codex. This is a REPEAT of the cycle-3 already-adjudicated MEDIUM ("plugin-schema fallback" — see Cycle 3 Judge Verdict). The plan's PRIMARY path ships the real skills array; the fallback is a conditional contingency gated on Assumption A1 (verify the Anthropic plugin schema FIRST) with a SUMMARY deviation note. Keeping at MEDIUM. **Recommend:** the planner resolve A1 (confirm `skills` array + colon-name support) before execution so the fallback branch is provably unreachable; if the schema does reject it, that is a genuine UX-03 gap to escalate then — but as written the plan does not commit to the lossy branch.
- **[REJECTED → non-issue] (opencode HIGH) — circular ESM dependency / TDZ crash for `dispatchVerb` between `bin/pensmith.ts` and `bin/cli/{next,resume}.ts`.** The plan (07-02 Task 3, line 265) ALREADY specifies `async function dispatchVerb(...)` — a hoisted function declaration, which is exactly opencode's own recommended fix (a). ESM circular imports with hoisted function declarations do not hit TDZ at module-eval time, and `dispatchVerb` is only invoked at runtime (inside `run()`), after both modules finish loading. The plan also already names the circular-dep risk (M7) and chose to export REAL_VERB_LOADERS + dispatchVerb from pensmith.ts. The hazard is pre-empted by design; not a defect.
- **[REJECTED → non-issue] (claude MEDIUM) — `done`/humanize could issue an LLM call not gated on PENSMITH_NO_LLM, so `pensmith done --dry-run` would egress.** VERIFIED against the repo: the ONLY `messages.create()` / `new Anthropic()` sites in `bin/` and `hooks/` are `verify/pass2.ts` (255/230) and `verify/pass4.ts` (444/423) — both gated on `PENSMITH_NO_LLM`. The humanizer is the user's external Tier-1 skill, not a Tier-2 LLM call site; `done` in Tier 2 makes no `messages.create()`. The "two call sites" claim IS exhaustive for the current codebase, so `--dry-run` zero-egress (SC3) holds. (Claude's own suggestion of a one-line confirmation is reasonable but the claim is already true.)
- **[LOW, observational] (claude) — Stop hook's `closeSessionLog()` may be a no-op in a fresh hook subprocess** (the writes happened in the main CLI process, so module-scope `activeChain` is null). The `Promise.allSettled` fix genuinely resolves the M1 concern (release rejection cannot abandon the call); whether the flush moves real bytes depends on whether the logger is re-opened in the hook process. The "resolve immediately if no logger active" design avoids a crash. Observational, not a defect — same disposition as cycle-3's "Stop-flush cross-process vacuity" MEDIUM.

### Per-Reviewer Raw (cycle 4)

#### codex (HIGH_COUNT: 2 claimed -> judged 1 valid HIGH [malformed STATE.json] + 1 downgrade [plugin fallback, repeat MEDIUM])
```
[LOW] Router totality fix looks genuinely resolved for valid `SectionStateSchema` states. The revised decision table is exhaustive over `planned/writing/written/verifying/verified/failed/unverifiable`, routes `failed` and `unverifiable` back to `verify`, treats only `verified` as continue, and has defensive `status/attention` fallbacks. The mixed `[verified, failed, verified]` case is now explicitly covered.

[LOW] Flag propagation through manual dispatch also looks genuinely resolved. The shared `dispatchVerb()` contract forwards parsed global flags into the dispatched verb args, and the bare, `next`, and `resume` paths are all required to use it. The ordering also looks right: `--yolo` cap pre-flight runs first, then under-cap bare/resume dispatch forwards `yolo:true` so `compile.ts` / `done.ts` see `args.yolo === true`.

[HIGH] `resolveNextAction` is still allowed to crash on malformed-but-present `STATE.json`. The plan catches `StateNotFoundError` only and rethrows any other `loadState()` error. SC1 says bare `/pensmith` must never crash, and your review prompt explicitly asks about “any STATE.json shape.” A corrupt JSON file, schema-invalid sections array, missing `slug`, nonnumeric `n`, or other validation error can still bubble out before a `RouterDecision` exists, so the bare dispatcher can fail before `decision.verb`. Fix: make router total over state-load failures too, probably returning `status/attention` with a diagnostic reason for invalid state rather than throwing.

[HIGH] 07-04 permits a manifest fallback that does not deliver the plumbing namespace. Task 2 says if the plugin schema rejects `skills` or colon-prefix names, fall back to documenting the namespace in `CONTRIBUTING.md`. That is not equivalent to `/pensmith:plan-section` working in Tier 1, so it fails SC2 / cross-tier parity if the schema rejects the proposed shape. The fallback must be an actually supported registration mechanism or the plan must block until one is found.

HIGH_COUNT: 2
```

#### gemini (HIGH_COUNT: 0 — both fixes confirmed resolved; 1 LOW flag-stripping)
```
An exhaustive architectural review of the four revised execution plans (07-01 to 07-04) for GSD Phase 7 has been completed. Both recent high-priority concerns from Cycle 3 have been completely and robustly resolved, and the plans meet all success criteria and non-negotiables.

### Resolution Verification

*   **Router Totality (C3-HIGH-1): Genuinely Resolved.** The implementation of `resolveNextAction` in 07-02 Task 1 enforces a strict, exhaustive `switch` over the entire `SectionStateSchema`. By explicitly routing both `failed` and `unverifiable` states back to the `verify` verb (instead of continuing), and providing a guaranteed terminal fallback via `default`, the function achieves true mathematical totality. It is impossible for any reachable state combination—including the mixed `[verified, failed, verified]` case—to return `undefined` or cause a crash during property access on `decision.verb`.
*   **Flag Propagation & Ordering (C3-HIGH-2): Genuinely Resolved.** The introduction of the shared `dispatchVerb` orchestrator in 07-02 Task 3 perfectly bridges the gap between manual dispatch paths (bare invocation, `next`, and `resume`) and `citty`'s explicit verb handling. By cleanly injecting the parsed global flags directly into the constructed `args` object before calling `cmd.run()`, gate-bearing commands like `compile` and `done` correctly receive `args.yolo === true` and skip their internal approval gates. The execution ordering is sound: the pre-flight check executes first across all paths, followed by flag propagation during manual dispatch, aligning perfectly with `citty`'s native parsing behavior for explicit verbs.

### Findings

*   [LOW] **Citty Subcommand Argument Tolerance:** In 07-02 Task 3, global flags are declared on the root command, but the pre-dispatch seam pre-parses them from any position in `process.argv`. Since explicit verbs are handed off to `runMain()`, if a global flag appears *after* an explicit subcommand (e.g., `pensmith write --dry-run`), `citty` might pass an unparsed or unexpected flag warning depending on its strictness settings. To maximize robustness, consider having the pre-dispatch seam slice out the four global flags from `process.argv` before passing the remaining tokens to `runMain()`.

HIGH_COUNT: 0
```

#### claude (HIGH_COUNT: 0 — both fixes genuinely resolved; 2 MEDIUM [done-egress rejected, section-arg], 2 LOW)
```
I've reviewed all four plans against the success criteria and the two most recent fixes. I reasoned from the plan text and the cited code seams (the live repo isn't part of this working directory, and the review history states the seams were verified against it across prior cycles).

## Verdict on the two most recent fixes

**C3-HIGH-1 (router totality) — GENUINELY RESOLVED.**
`resolveNextAction` in 07-02 Task 1 is provably total:
- Pre-section gates (`new`/`research`/`outline`/zero-sections) each return concretely.
- The section walk uses an exhaustive `switch` over the full `SectionStateSchema` where **every** non-`verified` arm `return`s (`planned`/missing-PLAN → plan; `writing` → write; `written`/`verifying`/`failed`/`unverifiable` → verify), `verified` is the only `continue`, and `default:` returns `status/attention`.
- Because every non-`verified` branch returns, the post-walk `compile → done → status(done)` chain is reached only when all sections are verified, and it is exhaustive over that case.
- The mixed `[verified, failed, verified]`-no-DRAFT case correctly returns `verify` for the failed section (ascending walk hits it first) — it cannot fall through to `compile` or to `undefined`. `decision.verb` therefore cannot crash the bare dispatcher (SC1/SC5 held). The RED suite (07-01 cases g–l + mixed-stuck) fixtures every state and would catch a regression.

**C3-HIGH-2 (flag propagation through bare/resume) — GENUINELY RESOLVED.**
- `dispatchVerb` merges `yolo: globalFlags.yolo === true` into `mergedArgs` and invokes `cmd.run?.({ args: mergedArgs, ... })`. compile.ts:90 / done.ts:436 read exactly `args.yolo === true`, so the forwarded value reaches the gate-skip read site.
- Bare path (07-02 Task 3 step 3e) and resume path (resume.ts) both route through the single `dispatchVerb` helper, forwarding parsed flags. No manual path calls `cmd.run()` with a bare args object.
- **Ordering vs. cost-cap pre-flight is sound:** the C3-HIGH-2 RED fixtures deliberately keep projected cost *under* the 50% cap, so the step-3c pre-flight passes and does not mask the gate-skip assertion. For `pensmith resume --yolo`, resume is an explicit verb → seam pre-flight (3c) runs, then runMain → resume → `dispatchVerb('compile'|'done', {yolo:true})`. The forwarded `yolo` reaches the inner gate.
- **Explicit-verb path** correctly relies on citty parsing `--yolo` into the subcommand args directly (no manual forwarding needed), and compile/done already read it — consistent and single-dispatch (no root `run()`, verified at index.mjs).

Both fixes are coherent, internally consistent, and backed by RED regression gates that would fail against the prior broken designs.

## Remaining / new concerns (none rise to HIGH)

- **[MEDIUM]** `--dry-run` zero-egress is only *exercised* on the verify path (pass2/pass4). The plans assert pass2.ts:215 + pass4.ts:392 are the *only* `messages.create()` sites "verified against the live repo," but the `done` verb folds in the humanizer ("make it sound less AI"), which is exactly where an LLM call could live. If `done`/humanize (or any compile path) issues an LLM call **not** gated on `PENSMITH_NO_LLM`, `pensmith done --dry-run` would egress and violate SC3 (ERGO-01). No test drives a non-verify LLM verb under `--dry-run`. This is fully resolved *only if* the "two call sites" claim is exhaustive across `done`/humanize — worth a one-line confirmation before relying on it.

- **[MEDIUM]** Section-arg forwarding for manually-dispatched *work* verbs (plan/write/verify) is underspecified and untested. The C3-HIGH-2 tests only drive bare/resume → compile/done (which take no positional). For bare/resume → write/plan/verify, `dispatchVerb` must build `mergedArgs` in the exact shape the verb's `run()` reads its section identifier (positional `n` vs. `args.n`/`args.slug`). The plans say dispatchVerb "BUILDS the args object the verb's run() will read" but never pin the key mapping, and no RED case asserts a bare→write dispatch actually targets the right section. A mismatch would silently break SC1's "resolves a next WORK action" for the common plan/write/verify states.

- **[LOW]** Explicit-verb flag parsing for the 14 verbs that don't declare the four global flags (only next/resume are specified to declare them) depends on citty tolerating undeclared flags rather than erroring "unknown flag." citty's parser is lenient by default, so `pensmith compile --show-prompts` should parse — but the plans neither state this assumption nor add the declarations to compile/write/verify/etc. The flag *effects* are applied by the pre-dispatch argv scan regardless; the only risk is citty rejecting the token during `runMain`. Worth an explicit note.

- **[LOW]** Stop-hook `closeSessionLog()` runs in a fresh hook subprocess where the module-scope `activeChain` will be `null` (the writes happened in the main CLI process), so the flush may be a no-op. The `Promise.allSettled` fix correctly prevents the release rejection from *abandoning* the call (the M1 concern is genuinely resolved), but whether the flush moves real bytes depends on whether the session logger is (re)opened within the hook process. The "resolve immediately if no logger active" design avoids a crash, so this is observational, not a defect.

All four non-negotiables (section isolation, two-tier parity, single-command UX, verifier-blocks-compile, no exported trace, gates-default-on, 16-verb bijection) are preserved by the plans as written.

HIGH_COUNT: 0
```

#### opencode (HIGH_COUNT: 1 claimed -> judged 0 valid [ESM TDZ pre-empted by async-function decl]; MEDIUM flag-stripping carried)
```
## Review of Phase 7 Plans (07-01..07-04)

### C3-HIGH-1 (Router Totality) — RESOLVED ✓
Exhaustive switch over all 7 `SectionStateSchema` states (including `failed`/`unverifiable` → `verify`), a `default` arm, 3 post-walk returns, and `StateNotFoundError` catch. The RED suite fixtures every state plus the mixed `[verified,failed,verified]` stuck case. `resolveNextAction` can never return `undefined`.

### C3-HIGH-2 (Flag Propagation) — Partially Resolved ✓ in design, ⚠️ implementation risk

The `dispatchVerb()` helper design is correct: bare/next/resume all merge forwarded global flags into the dispatched verb's args. Explicit verbs use citty's direct parse. A dispatched `compile`/`done` receives `args.yolo === true` and skips its approval gate.

---

### [HIGH] Circular ESM dependency for `dispatchVerb` between `bin/pensmith.ts` and `bin/cli/{next,resume}.ts`

**Why**: `bin/pensmith.ts` imports `next.ts`/`resume.ts` for `REAL_VERB_LOADERS`, while `next.ts`/`resume.ts` import `dispatchVerb` from `pensmith.ts` — creating `pensmith.ts → next.ts → pensmith.ts`. If `dispatchVerb` is a `const` arrow function, ESM's TDZ semantics crash at runtime (`ReferenceError`), collapsing the entire C3-HIGH-2 fix.

**Fix**: Either (a) declare as `async function dispatchVerb(...)` (hoisted in ESM) or (b) extract to `bin/lib/dispatch.ts`.

### [MEDIUM] Citty unknown-flag errors on subcommand invocations with global flags

**Why**: The pre-parse scans `process.argv` for `--dry-run`/`--estimate`/`--yolo`/`--show-prompts` but does not strip them. When citty dispatches `pensmith write --dry-run` via `runMain`, the `write` subcommand's `defineCommand` may not declare `--dry-run`. Citty may reject it as unknown, failing the H2/H3 RED tests that drive explicit-verb paths.

**Fix**: Strip the four flags from `argv` before `runMain`, or add them to every subcommand's args.

### [LOW] `state.sections` undefined/null with OUTLINE.md present → `.sort()` crash or `compile`-with-no-sections

No RED test covers this hand-editing edge case.

---

**HIGH_COUNT: 1**
```

### Cycle 4 — Judge Verdict

**current_high = 1.** Both cycle-3 fixes (router totality over SectionStateSchema; flag forwarding through bare/next/resume dispatch) are UNANIMOUSLY confirmed resolved and re-verified against the live repo (compile.ts:90, done.ts:436, pass2.ts:255, pass4.ts:444). One NEW HIGH survives: `resolveNextAction` (and `projectEstimate`) catch only `StateNotFoundError` and re-throw on a malformed/schema-invalid STATE.json (loadState → StateSchema.parse throws), so the bare dispatcher can crash before `decision.verb` — violating SC1's "never crash" guarantee for "any STATE.json shape." codex flagged it; opencode's `.sort()` LOW is the same root cause. Fix: widen both catches to handle malformed state (router → status/attention, estimator → empty projection) and guard `state.sections` before `.sort()`, with a corrupt-STATE.json RED case. Remaining items are MEDIUM/LOW: the citty unknown-flag stripping robustness gap (4 reviewers, non-blocking — citty is lenient by default) and the already-adjudicated plugin-schema fallback (repeat MEDIUM). The ESM-TDZ and done-egress candidate HIGHs were rejected as pre-empted/false against the plan text and the repo.

## Cycle 5

**Reviewed:** 2026-06-18. Reviewers run: codex, gemini, claude, opencode (all four available; all returned usable output — gemini recovered after transient 429 backoff). Prompt: `/tmp/gsd-review-prompt-7.md` (GOAL + 5 SCs + 8 non-negotiables + FULL TEXT of all 4 revised plans 07-01..07-04 + the cycle-1..4 adjudication ledger). Focus: confirm the cycle-4 fix — `resolveNextAction` + `projectEstimate` made robust to absent / well-typed / malformed STATE.json (catch-all-then-reclassify; never crash) — is genuinely resolved, and surface any remaining/NEW HIGH.

Raw HIGH_COUNT per reviewer: codex 0, gemini 0, claude 1, opencode 0.

### Synthesized Findings (cycle 5)

**The cycle-4 STATE.json fix is UNANIMOUSLY + code-verified RESOLVED.** All four reviewers independently confirm: 07-02 Task 1 wraps `loadState` in a catch-all that reclassifies `StateNotFoundError → {verb:'new'}` and EVERY other error (`SyntaxError`/`SchemaValidationError`/`ForwardIncompatError`/`EACCES`) `→ {verb:'status', reason:'attention'}` + one stderr line, never re-throwing; `state.sections ?? []` guards the `.sort()`; 07-02 Task 2 mirrors it in `projectEstimate` (catch-all → empty projection); 07-01 fixtures both invalid-JSON and schema-invalid (sections-entry-missing-slug) STATE.json for router AND estimator, plus bare `pensmith --yolo` against corrupt STATE → exit 0. This matches the verified `loadState` contract (only ENOENT is translated) and closes the STATE.json crash vector as written. claude and gemini explicitly re-verified the seam against the live `state.ts`/`pass2.ts`/`pass4.ts`/`lock.ts` code.

**Judge verdict: current_high = 1.** One genuine NEW HIGH survives — code-verified against the repo and NOT adjudicated in any prior cycle (cycles 1-4 all concerned STATE.json; this is the sibling file).

- **[HIGH] (07-02 Task 1 / 07-RESEARCH router code example, bin/lib/router.ts) — the "never crash" property is INCOMPLETE: a present-but-corrupt per-section PLAN.md crashes `resolveNextAction` on the same `decision.verb` access SC1/SC5 were hardened to protect.** Raised by claude; code-verified by the judge. SC1 and the router contract both state routing is "based on STATE.json + per-section PLAN.md frontmatter." In the section walk, the canonical 07-RESEARCH code example (07-RESEARCH lines 505-508 — `parseFrontmatter(readFileSync(planPath,'utf8'))`) that 07-02 Task 1 implements against has NO try/catch; 07-02 Task 1's action says only "read status via parseFrontmatter." `readFileSync` can throw (EACCES/EISDIR/TOCTOU after the `existsSync` check) and `parseFrontmatter`→`yaml.parseDocument(...).toJSON()` can throw on malformed YAML (e.g. duplicate map keys). The repo's OWN precedent confirms this is real, not speculative: `hooks/pre-compact.ts:178-187` wraps the IDENTICAL `parseFrontmatter(readFileSync(planPath,'utf8'))` call in a `try/catch` precisely because it can throw — yet the router omits the guard. A hand-edited / partially-written / merge-conflicted PLAN.md (the same realistic on-disk corruption class C4 just fixed for STATE.json, one file over) therefore throws BEFORE the switch's `default` arm is ever reached, crashing bare `/pensmith`. There is NO RED test for this case — 07-01 cases g-n all use schema-valid `status:` frontmatter or corrupt STATE.json; none fixture an unparseable PLAN.md — so even an executor who happened to guard it would have no contract enforcing it. This is genuinely in the C4 "never-crash family" and was overlooked because C4 scoped the parenthetical to STATE.json specifically. **Fix direction:** in router.ts, wrap the per-section `readFileSync`+`parseFrontmatter` in try/catch (on throw, route to `{verb:'status', reason:'attention', section:{n,slug}}` — matching the unrecognized-status `default` arm — or default the status to `'planned'`), mirroring `hooks/pre-compact.ts:178-187`; update the 07-RESEARCH router code example + 07-02 Task 1 action to show the guard; and add a 07-01 RED fixture in `pensmith-router.test.ts` writing a PLAN.md with unparseable frontmatter (and a sub-case for an unreadable PLAN.md if practical) asserting a valid non-undefined decision with no throw. Estimator note: 07-02 Task 2's `projectEstimate` counts sections from STATE.json and does NOT read PLAN.md frontmatter, so the estimator is not affected — the fix is router-only.

**Downgraded / rejected (with justification):**

- **[MEDIUM] (07-02 Task 3, bin/pensmith.ts) — argv pre-parse "first non-flag token" wording does not explicitly say `process.argv.slice(2)`.** Raised by codex. If implemented literally the Node executable or script path could be mistaken for a verb and bare routing would not run. NOT a HIGH: the surrounding plan text strongly implies user args (the established dispatcher already operates on the user-arg slice), so this is a tightening note, not a proven SC failure. **Recommend (non-blocking):** the plan/executor pin `process.argv.slice(2)` for the verb-detection scan.
- **[MEDIUM] (07-02 Task 3) — circular ESM import `pensmith.ts → next.ts → pensmith.ts` for `dispatchVerb`/`REAL_VERB_LOADERS` is present (not the TDZ, the import cycle itself).** Raised by opencode. This is a RESTATEMENT of the cycle-4 already-adjudicated/REJECTED ESM-TDZ item; opencode itself confirms it works in Node ESM (no module-eval-time cross-call; `async function` hoisted; loaders are dynamic `import()`). Kept at MEDIUM/observational — the only residual is fragility against a future refactor that adds a top-level cross-call. **Recommend:** the 07-02 SUMMARY leave a "do not add top-level calls across this import cycle" note for wave 2.
- **[MEDIUM] (07-02 Task 3, dispatchVerb) — positional `n`/`slug` mapping into manually-dispatched plan/write/verify args underspecified/untested.** Raised by claude as the natural sibling of the HIGH. REPEAT of the cycle-4 already-adjudicated MEDIUM; not promoted (no NEW SC failure beyond the adjudicated one). The PLAN.md-guard fix above should also pin the happy-path `{verb:'plan',n,slug}` dispatch reaches the verb with the right section.
- **[MEDIUM] (07-04) — UX-04/UX-05 final success depends on the live model-routing human-verify checkpoint.** Raised by codex. By design: the deterministic contracts (skill-file content, plumbing registration, tier parity) are CI-tested; live NL routing is the blocking `checkpoint:human-verify` (07-04 Task 3) per 07-VALIDATION Manual-Only. Acceptable as written, not a plan defect.
- **[LOW] (07-03, pre-compact.ts) — the 10s `Promise.race` `setTimeout` is not `unref()`'d/cleared on the success path**, so the hook can keep the event loop alive up to ~10s after a sub-second write unless the caller `process.exit`s. Within the platform budget, harmless to correctness; worth an `unref()` for tidiness.
- **[LOW] (07-02 Task 3 step c vs d) — `pensmith --estimate --yolo` over-cap exits with the refusal (step c) BEFORE printing the projection table (step d).** Raised by opencode + gemini. Internally consistent with the spec (the `--yolo` refusal fires independently of `--estimate`); a minor UX wrinkle (user omits `--yolo` to see the number), not a defect.
- **[LOW] (07-01 flags.test.ts) — the dispatch-case skip-guard greps bin/pensmith.ts for a 'dry-run' token rather than using the `existsSync` idiom**; works but diverges from the established pattern — note it in the SUMMARY.
- **[LOW] (07-01, C2-H1 fresh-dir `pensmith --yolo` → exit 0) — the fresh-dir router resolves to `{verb:'new'}` then dispatches `new`; the test must ensure `new` does not block on non-tty stdin** in the `execFileSync` child. Test-fixture hardening note, not a plan defect.
- **[LOW] (codex) — resume clears HANDOFF.json AFTER dispatching the next work verb; if that verb throws/exits early a stale HANDOFF can linger** and SessionStart keeps emitting the old resume context. Because `resolveNextAction` ignores HANDOFF this does NOT recreate the prior resume loop (H4 holds); clearing in a `finally`/before dispatch would be more robust. Observational, not a defect.
- **[LOW] (Stop hook `closeSessionLog()` no-op in a fresh subprocess) — REAFFIRMED prior disposition.** `activeChain` is null in the hook subprocess, so the flush half of HOOK-04 is structurally a no-op; `Promise.allSettled` genuinely resolves the M1 abandon-on-rejection concern. Observational, already accepted as LOW in cycles 3-4.

### Per-Reviewer Raw (cycle 5)

#### codex (HIGH_COUNT: 0 — C4 fix confirmed resolved; 2 MEDIUM [argv.slice tightening, UX-04 human-verify] + 2 LOW)
```
[LOW] C4 router/estimator robustness looks genuinely resolved as written. 07-01 adds invalid-JSON and schema-invalid `STATE.json` RED cases for both `resolveNextAction()` and `projectEstimate()`, plus a CLI `pensmith --yolo` corrupt-state no-crash case. 07-02 then requires catch-all load handling: absent state maps to `new` or empty projection, while malformed/schema-invalid/forward-incompatible/permission errors map to `status/attention` or empty projection without rethrowing. It also guards `state.sections ?? []` before sorting. That satisfies SC1’s “never crash for absent, well-typed, or malformed STATE.json” requirement.

[MEDIUM] The argv pre-dispatch wording in 07-02 is slightly hazardous: it says to scan `process.argv` and find the first non-flag token, but does not explicitly say to use `process.argv.slice(2)`. If implemented literally, the Node executable or script path would be mistaken for an explicit verb and bare `/pensmith` routing would not run. The surrounding text strongly implies user args, so I would not call this a HIGH, but the plan should tighten that seam.

[MEDIUM] 07-04 still depends on live model skill routing for UX-04/UX-05, which is correctly marked as a blocking human verification step. That means the deterministic plan can ship the files and manifest, but final success for natural-language trigger routing is not fully proven until that checkpoint passes. This is acceptable as written, not a plan defect.

[LOW] Resume clearing happens after dispatching the next work verb. If that dispatched verb throws or exits early, stale `HANDOFF.json` may remain and SessionStart can keep emitting the old resume context. Because `resolveNextAction()` ignores HANDOFF, this should not recreate the prior resume loop, but clearing in a `finally` or before dispatch would make the lifecycle more robust.

HIGH_COUNT: 0

```

#### gemini (HIGH_COUNT: 0 — all fixes confirmed; 2 LOW)
```
The execution plans (07-01 to 07-04) for Phase 7 are exceptionally well-detailed and explicitly address every success criterion and non-negotiable requirement. The robustness strategy for **SC1 (bare `/pensmith` never crashes)** is particularly strong, utilizing the "Catch-all-then-reclassify" pattern to handle missing, well-typed, and malformed/corrupt `STATE.json` files without throwing exceptions.

### Key Observations & Confirmation of Fixes:
*   **[SC1] Robustness to Malformed State:** Plan 07-02 (Task 1 & 2) and Plan 07-01 (Task 1) correctly implement and test the widened catch-all logic for `loadState`. This ensures that even a corrupted or schema-invalid `STATE.json` results in a graceful `status/attention` disposition rather than a CLI crash.
*   **[SC1/SC5] Router Totality:** Plan 07-02 Task 1 explicitly closes the totality gap (C3-HIGH-1) by routing `failed` and `unverifiable` sections back to `verify` instead of `continue`. This guarantees that `resolveNextAction` never returns `undefined` for any reachable section state.
*   **[SC2/SC3] Global Flag Forwarding:** The introduction of the shared `dispatchVerb` helper in `bin/pensmith.ts` (Plan 07-02 Task 3) solves the C3-HIGH-2 issue where manually-dispatched verbs (bare, next, resume) would fail to skip their own approval gates despite the `--yolo` flag being present.
*   **[SC3] Hook Protocol & Reliability:** Plan 07-03 Task 2 correctly uses `Promise.allSettled` for the `Stop` hook, ensuring the session-log flush completes even if the best-effort lock release rejects (M1/C2-M2). The 10s `PreCompact` race and 5KB limit are likewise correctly wired.
*   **[SC5] Dry-Run Integrity:** Plan 07-02 Task 3 & 4 correctly wire `--dry-run` to both `PENSMITH_NETWORK_TESTS` (source adapters) and `PENSMITH_NO_LLM` (LLM call sites). The verification in `pass2/pass4` is non-vacuous, driving a real LLM-calling path to confirm zero egress.
*   **[SC5] Yolo Cost Cap:** The `--yolo` pre-flight check is correctly implemented in the dispatcher (Plan 07-02 Task 3) for ANY command line, independent of `--estimate`, and uses a fresh-dir guard to avoid crashing in new projects (H1/C2-H1).
*   **[UX-02/03/04] Plumbing & NL Routing:** The skill descriptions in Plan 07-04 are optimized for PRD §5.4 trigger phrases, and the 16-verb bijection is strictly preserved via tests.

### Adjudicated Items:
*   **Citty Unknown-Flag Stripping:** Retained as **MEDIUM** (non-blocking) per review history; the manual pre-parse seam in `pensmith.ts` ensures the *effects* (env vars, mirrors) are applied regardless of Citty's lenient parse behavior.
*   **Circular Dependencies:** The hoisted `async function dispatchVerb` and the use of dynamic imports within `REAL_VERB_LOADERS` safely pre-empt any ESM Temporal Dead Zone (TDZ) issues.

### Summary of Findings:
- [LOW] **Stop closeSessionLog() Subprocess No-op:** As noted in history, if the hook runs in a fresh subprocess, `activeChain` may be null. However, `allSettled` correctly handles the call lifecycle and the requirement for a clean flush on normal exit is satisfied.
- [LOW] **Estimate table vs Refusal order:** Running `pensmith --estimate --yolo` in an over-cap project will exit with a refusal before showing the table. This is technically compliant with ARCH-11 and users can simply omit `--yolo` to see the projection.

The plans are idiomatically complete, safe, and ready for execution.

HIGH_COUNT: 0

```

#### claude (HIGH_COUNT: 1 — NEW: unguarded PLAN.md read in the section walk; judge-confirmed)
```
I've reviewed all four plans against the phase goal, the five success criteria, the non-negotiables, and the actual codebase (`state.ts` error contract via `loadState`, `pass2.ts:215`/`pass4.ts:392` `PENSMITH_NO_LLM` gates, `lock.ts:135` `release`, `hooks/pre-compact.ts`, `hooks/session-start.ts`/`stop.ts` stubs, `bin/pensmith.ts` dispatcher, and `frontmatter.ts` usage). Findings below.

---

**Confirmation of the cycle-5 fix (router/estimator robust to malformed STATE.json):** GENUINELY RESOLVED for `STATE.json`. 07-02 Task 1 wraps the `loadState` call in a catch-all that reclassifies `StateNotFoundError → {verb:'new'}` and every other error (`SyntaxError`/`SchemaValidationError`/`ForwardIncompatError`/`EACCES`) `→ {verb:'status', reason:'attention'}` + one stderr line, never re-throwing; `state.sections ?? []` guards the `.sort()`. 07-02 Task 2 mirrors this in `projectEstimate` (catch-all → empty projection). 07-01 fixtures both invalid-JSON and schema-invalid (sections-entry-missing-slug) STATE.json for router AND estimator, plus bare `pensmith --yolo` against corrupt STATE → exit 0. This matches the actual `loadState` contract (only ENOENT is translated) and closes the STATE.json crash vector as written.

**Findings:**

- [HIGH] The "never crash" property is INCOMPLETE over the router's other documented input — a present-but-corrupt **PLAN.md** crashes `resolveNextAction`. SC1 and the router contract both state routing is "based on current `.paper/STATE.json` + per-section PLAN.md frontmatter." In the section walk, the canonical 07-RESEARCH code example (which 07-02 Task 1 implements against) calls `parseFrontmatter(readFileSync(planPath,'utf8'))` with **no try/catch** (07-RESEARCH lines 506-508; 07-02 Task 1 action says only "read status via parseFrontmatter"). `parseFrontmatter` can throw on malformed YAML frontmatter — `hooks/pre-compact.ts:178-187` wraps this exact call in `try/catch` precisely because it can throw; the router does not. A hand-edited / partially-written / merge-conflicted PLAN.md (the same realistic on-disk corruption class C4 fixed for STATE.json, one file over) therefore throws *before* the `switch`'s `default` arm is ever reached, crashing bare `/pensmith` on the very `decision.verb` access SC1/SC5 were hardened to protect. There is **no RED test** for a malformed-PLAN.md case (07-01 cases g-n all use schema-valid `status:` frontmatter or corrupt STATE.json — none fixture unparseable PLAN.md YAML), so even an executor who happened to guard it would have no contract enforcing it. Fix: wrap the per-section `readFileSync`+`parseFrontmatter` in try/catch (default to `'planned'` or route to `{verb:'status', reason:'attention', section:{n,slug}}`, matching the unrecognized-status arm), and add a 07-01 RED fixture writing a PLAN.md with unparseable frontmatter asserting no-throw. (Scoping note: the review's SC1 parenthetical names STATE.json specifically; I rate this HIGH because the phase non-negotiable is bare `/pensmith` never crashing over the inputs it reads to resolve, and PLAN.md frontmatter is explicitly one of them.)

- [MEDIUM] (Downgraded — already adjudicated cycle 4, restated only because it is the natural sibling of the HIGH above.) `dispatchVerb`'s mapping of the router's positional `n`/`slug` into the dispatched `plan`/`write`/`verify` verb's args object is still underspecified/untested. The fix for the HIGH above will exercise the corrupt-PLAN.md → status path; it should also pin that the happy-path `{verb:'plan',n,slug}` dispatch actually reaches `plan.ts` with the right section. Not promoting to HIGH (no new SC failure beyond the adjudicated one).

- [LOW] (Reaffirm prior LOW.) Stop hook `closeSessionLog()` runs in a fresh `node hooks/stop.ts` subprocess whose module-scope `activeChain` is `null`, so the "flush session log" half of HOOK-04 is structurally a no-op (the session-log chain lives in the CLI process, not the hook subprocess). `Promise.allSettled` correctly resolves the M1 abandon-on-rejection concern; the flush-emptiness is observational and was already accepted as LOW.

- [LOW] 07-03's `Promise.race` 10s timeout in `pre-compact.ts` uses a `setTimeout` that is not `unref()`'d/cleared on the fast (success) path, so the hook can keep the event loop alive up to ~10s after a successful sub-second write unless its caller calls `process.exit`. Within the platform budget and harmless to correctness; worth an `unref()` for tidiness.

The C4-HIGH STATE.json fix is sound; H1/H2/H3/H4/C3-HIGH-1/C3-HIGH-2 regression gates are correctly specified and match the verified code. The one genuine remaining defect is the unguarded PLAN.md read in the same never-crash family.

HIGH_COUNT: 1

```

#### opencode (HIGH_COUNT: 0 — C4 gates confirmed faithful; 1 MEDIUM [import cycle, repeat] + 3 LOW)
```
## Review of 07-01..07-04 for Phase 7

**C4-HIGH regression gates are genuine and correctly specified.** Both `resolveNextAction` and `projectEstimate` use a CATCH-ALL-then-reclassify pattern (07-01 fixtures the RED cases; 07-02 Task 1-2 implement the widened catch). `state.sections ?? []` is called out explicitly in both plans. The `[verified,failed,verified]` stuck case routes to `verify` with the failed section's n/slug, and the `decision !== undefined` assertion is structural. These plans deliver the cycle-4 fix faithfully.

**No HIGH concerns found.** My review of all four plans against the 5 SCs, 8 non-negotiables, and all previously adjudicated HIGH items shows the plans are internally consistent, complete, and would deliver the phase goal as stated.

**MEDIUM** — `dispatchVerb` in `bin/pensmith.ts` creates a circular ESM dependency (`pensmith.ts → next.ts → pensmith.ts`). The review history adjudicated this as "hoisted function = no TDZ," but the circular import itself (not TDZ) is still present: `pensmith.ts` statically imports `nextCommand` for `REAL_VERB_LOADERS`, and `next.ts` statically imports `dispatchVerb` from `pensmith.ts`. In Node ESM this works because neither module calls the other's export at module-evaluation time (only inside async handlers). It is fragile against future refactors that add top-level calls. The 07-02 plan acknowledges the concern exists and the pattern was REJECTED rather than removed — worth leaving a static-import break in the 07-02 SUMMARY so wave-2 knows not to strengthen the cycle.

**LOW** — 07-01 `flags.test.ts` skip-guard for the dispatch-driving cases uses a "flagsWired predicate that greps bin/pensmith.ts for a 'dry-run' token." This is a grep-on-import heuristic rather than the `existsSync` pattern used everywhere else. Works fine but diverges from the established idiom; the SUMMARY should note it so a future maintainer doesn't wonder why this file uses a different guard.

**LOW** — When `--yolo` and `--estimate` are both present and cost exceeds 50% cap, the yolo cap pre-flight (step c) exits non-zero before the estimate-print (step d) runs, so the user sees a refusal message but never sees the projection table they asked for. Internally consistent with the plan's spec (`--yolo` refusal fires independently of `--estimate`) but creates a poor UX loop (user must run `--estimate` alone to see the number, then increase cap or reduce scope, then retry with `--yolo`). Not a HIGH because the behavior matches the stated design — worth noting for a future UX polish pass.

**LOW** — 07-01 say that C2-H1 "`pensmith --yolo` in a paper-less dir does NOT crash (C2-H1 fresh-dir guard)" and the assertion is "exit 0." This is correct per the empty-projection guard. But `pensmith --yolo` in a paper-less dir resolves to `{verb:'new'}` (the router's StateNotFoundError path), then dispatches `new` verb. The test must ensure the `new` verb exits 0 (which is trivially true for a new-project flow that just prompts or creates). If `new` itself requires non-tty stdin (e.g. prompts), an `execFileSync` child would hang rather than fail. Worth noting in the test that the fixture may need to pre-configure enough context so `new` doesn't block on stdin.

HIGH_COUNT: 0

```

### Cycle 5 — Judge Verdict

**current_high = 1.** The cycle-4 STATE.json robustness fix is UNANIMOUSLY confirmed resolved and re-verified against the live `loadState` contract — absent → new/empty, well-typed → correct verb/projection, malformed/schema-invalid → status/attention/empty, neither throws; `state.sections ?? []` guarded. One NEW HIGH survives, code-verified and not adjudicated in any prior cycle: the router's per-section walk reads `parseFrontmatter(readFileSync(planPath))` with NO try/catch (07-RESEARCH lines 505-508; 07-02 Task 1), so a present-but-corrupt/unparseable PLAN.md throws before the switch's `default` arm and crashes bare `/pensmith` on `decision.verb` — the exact SC1 "never crash" guarantee the C4 fix hardened for STATE.json, one file over. The repo's own `hooks/pre-compact.ts:178-187` wraps the identical call in try/catch, confirming the throw is real; no 07-01 RED case fixtures a malformed PLAN.md. Fix: guard the per-section read in router.ts (route to status/attention or default to 'planned'), update the RESEARCH code example + 07-02 Task 1, and add a corrupt-PLAN.md RED case. The estimator is unaffected (it counts sections from STATE.json, never reads PLAN.md). All other findings are MEDIUM/LOW and non-blocking — argv.slice(2) tightening, the repeat import-cycle MEDIUM (works in ESM, fragility note only), the repeat section-arg-mapping MEDIUM, the by-design UX-04 human-verify checkpoint, and several LOW tidiness/test-fixture notes. The four cross-AI HIGH families resolved across cycles 1-4 (H1/H2/H3/H4, C3-HIGH-1/2, C4-HIGH) remain resolved.

---

## Cycle 6

**Reviewed:** 2026-06-18. Reviewers run: codex, gemini, claude, opencode (all four available; all returned usable output). Prompt: `/tmp/gsd-review-prompt-7.md` (GOAL + 5 SCs + 8 non-negotiables + the cycle-1..5 resolved-HIGH ledger + FULL TEXT of all 4 revised plans 07-01..07-04). Focus: confirm the cycle-5 fix — `resolveNextAction` given a NEVER-THROW invariant over its ENTIRE input surface (STATE.json catch-all + per-section PLAN.md try/catch + outer backstop + input-surface audit) — is genuinely resolved, and surface any remaining/NEW HIGH.

Raw HIGH_COUNT per reviewer: codex 1, gemini 0, claude 1, opencode 0.

### Synthesized Findings (cycle 6)

**The cycle-5 PLAN.md never-throw fix is UNANIMOUSLY + code-verified RESOLVED for `resolveNextAction`.** All four reviewers independently confirm 07-02 Task 1 + the 07-RESEARCH router code example now wrap each per-section `readFileSync`+`parseFrontmatter` in try/catch (absent→plan, present-but-corrupt→status/attention+section+stderr), add an OUTER backstop around the whole resolver body, and carry an input-surface audit (loadState catch-all, `state.sections ?? []`, per-section read guard, existsSync probes confirmed non-throwing, no stray JSON.parse). claude re-verified the load-bearing seams against the live repo: `pass2.ts:215`/`pass4.ts:392` (PENSMITH_NO_LLM gate), `bin/pensmith.ts` subCommands-only/no root run(), `compile.ts:88` (`args.yolo === true`), `hooks/pre-compact.ts:178-187` (the identical guarded parseFrontmatter call), `lock.ts:135` (release rejects on an unheld stub → Promise.allSettled). All eight prior HIGH families (H1/H2/H3/H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH) remain resolved.

**Judge verdict: current_high = 1.** One genuine NEW HIGH survives — code-verified against the plan text + repo, NOT adjudicated in any prior cycle. It is the SAME never-crash family as C4→C5, moved ONE VERB DOWNSTREAM (router→status dispatch), exactly as C4→C5 was the same family one FILE over.

- **[HIGH] (C6-HIGH; 07-02 Task 3 status.ts + step 3e dispatch, bin/cli/status.ts + bin/pensmith.ts) — SC1's "never crash on a present-but-corrupt per-section PLAN.md" is proven only for `resolveNextAction`, NOT for the bare-dispatch leg that follows it; the `status` verb the router routes corruption INTO re-walks the same corrupt PLAN.md unguarded, so bare `/pensmith` still crashes end-to-end.** Raised by claude; judge-confirmed against the plan text + repo. The C4→C5 arc made `resolveNextAction` never throw so `decision.verb` cannot crash the bare dispatcher. But for a corrupt PLAN.md the resolver returns `{verb:'status', reason:'attention', section}` (07-02 Task 1, lines 200/227), and the bare path (07-02 Task 3 step 3e, line 312) then `dispatchVerb('status', …)` → `statusCommand.run()`. Per 07-02 Task 3 (line 301), `status.ts` is specified to "walk section PLAN.md frontmatter (**reuse the router's read helpers or parseFrontmatter**)" to print its per-section table — re-reading the SAME corrupt PLAN.md the router just flagged. Two facts turn this into an unguarded throw: (1) **the suggested reuse target does not exist** — 07-02 Task 1 exports only `resolveNextAction` + `RouterDecision` (line 33), there is NO exported per-section `readSectionState()` helper, so the executor falls to the "or parseFrontmatter" alternative = a raw `parseFrontmatter(readFileSync(planPath))`, which `hooks/pre-compact.ts:178-187` proves throws on malformed YAML; (2) **`dispatchVerb` is not specified to wrap `cmd.run()` in try/catch**, so the throw propagates to the top level and crashes bare `/pensmith`. And **no test pins it**: the router RED suite exercises `resolveNextAction` in isolation (07-01 T-07-26 / line 342 asserts the RESOLVER's return, not the dispatch); `flags.test.ts`'s existing end-to-end (execFileSync child) bare-dispatch no-crash case (07-01 line 229) drives bare `pensmith --yolo` against a corrupt **STATE.json** — there is NO analogous case driving bare `pensmith` (or `pensmith status`) against a corrupt **PLAN.md** asserting the full router→status dispatch exits cleanly. `status.ts`'s acceptance criterion (07-02 line 320) hardens only "BOTH StateNotFoundError and a corrupt-STATE load error" — the per-section corrupt PLAN.md (C5) is absent from status's contract and coverage. This directly fails SC1, which explicitly enumerates "on a present-but-corrupt per-section PLAN.md AND it must NEVER crash" — a guarantee currently delivered only up to `resolveNextAction`'s return, not through the dispatch bare `/pensmith` actually performs. **Fix direction:** (a) have 07-02 Task 1 export a shared guarded `readSectionState(planPath)` helper (the per-section try/catch the router already uses) so "reuse the router's read helpers" is literally achievable, and require status.ts (and any verb that walks PLAN.md frontmatter) to use it; AND/OR (b) have `dispatchVerb` wrap the dispatched `cmd.run()` in a backstop try/catch (stderr diagnostic + clean exit); AND (c) add a `flags.test.ts` end-to-end RED case driving bare `pensmith` against a corrupt PLAN.md asserting the full invocation does not crash — the missing twin of the existing corrupt-STATE bare-dispatch case.

### Downgraded / rejected (with justification)

- **[codex HIGH → DOWNGRADED to scoping observation] "07-02/07-04 do not make `list`/`open`/`sketch`/`add` work in both tiers (SC2)."** Factually correct that the live dispatcher (`bin/pensmith.ts:37-56`) leaves `list/open/sketch/add` on `makeStub()` and the plans promote only `next`/`status`/`resume`. BUT the real implementations of these four verbs are EXPLICITLY scoped to **Phase 8**, not Phase 7: ROADMAP Phase 8 GOAL (line 294: "`/pensmith sketch` thinking-partner mode, `/pensmith add <doi|pdf|url>`, library mode polish") and Phase 8 Success Criteria (line 299 `/pensmith list` + `/pensmith open <name>`; line 301 `/pensmith sketch`; line 302 `/pensmith add`). 07-RESEARCH line 27 also states these "stay stubs per Phase 8 scope." Phase 7's SC2 contract is the 16-verb registration/dispatch bijection (every verb is reachable, dispatches, is visible in both tiers) — which the stubs satisfy — NOT the feature implementation of the four Phase-8 verbs. This is the established, approved phase decomposition, not a Phase 7 SC failure. Not a HIGH.
- **[codex MEDIUM] plugin.json colon-namespace doc-only fallback (UX-03/SC2).** REPEAT of the cycle-1 M2 / cycle-2..5 already-adjudicated MEDIUM. The plan's PRIMARY path ships the real skills array; the fallback is contingent on Assumption A1 (verify the Anthropic plugin schema FIRST) and gated by `validate-plugin-manifest.cjs` + a blocking human-verify checkpoint. Held at MEDIUM. Not re-raised as HIGH per the review instructions.
- **[opencode + (history) codex/gemini MEDIUM] citty unknown-flag stripping on the explicit-verb path.** REPEAT of the cycle-4 already-adjudicated MEDIUM. The pre-parse applies the flag EFFECTS before runMain regardless of stripping; citty ^0.2.2 is lenient with undeclared flags by default. Non-blocking robustness note (strip the four flags from argv before runMain, or declare per-subcommand, and add an explicit `pensmith write --dry-run` parse case). MEDIUM.
- **[claude MEDIUM-at-most note] `done` terminus keys on `FINAL.md` presence, but per STATE.md [06-05] `done.ts` writes exports to `.paper/export/` and may not write a `FINAL.md` sentinel — bare `/pensmith` after a completed export may keep resolving to `done`.** An idempotency/UX concern (the export gate re-confirms; only `--yolo` would silently re-export), not a crash. MEDIUM at most; flagged for awareness, non-blocking. Worth confirming the `FINAL.md` sentinel contract before execution.
- **[opencode LOW] SessionStart JSON.parse needs a surrounding try/catch (the hooks silent-try/catch pattern covers it); closeSessionLog tracks only the most-recent logger (sequential-session-safe).** LOW, observational, already covered.

### Per-Reviewer Raw (cycle 6)

#### codex (HIGH_COUNT: 1 claimed → judged 0 valid HIGH; the SC2 list/open/sketch/add claim downgraded to a Phase-8-scope observation)

```
[HIGH] 07-02/07-04 still do not make the full locked shortcut set “work” in both tiers. The live dispatcher currently leaves `list`, `open`, `sketch`, and `add` on `makeStub()` after prior phases, and the plans only promote `next`, `status`, and `resume`. 07-04’s tier-contract extension is likewise scoped to `next/status/resume + plumbing`, not all named shortcuts. That misses Success Criterion 2 for `list`, `open`, `sketch`, and `add`. Code seams: [bin/pensmith.ts](</mnt/c/Users/akhil/OneDrive - Roanoke College/Documents/Github/pensmith/bin/pensmith.ts:37>) loader map, [bin/cli/stubs.ts](</mnt/c/Users/akhil/OneDrive - Roanoke College/Documents/Github/pensmith/bin/cli/stubs.ts:9>), [tests/cli-stubs.test.ts](</mnt/c/Users/akhil/OneDrive - Roanoke College/Documents/Github/pensmith/tests/cli-stubs.test.ts:31>).

[MEDIUM] The plugin.json colon namespace fallback remains a real delivery risk, but not a new HIGH per the review instructions. 07-04 still allows a documented fallback if the schema rejects colon names or `skills`; that would not make `/pensmith:plan-section` available for scripting. Keep the schema validation gate, but do not accept documentation-only fallback as satisfying Phase 7.

[LOW] The previously resolved HIGHs look genuinely addressed in plan text: `--yolo` preflight is any-verb and independent of `--estimate`; pre-dispatch avoids citty double-dispatch; `--dry-run` sets `PENSMITH_NO_LLM`; router ignores HANDOFF; manual dispatch forwards global flags; router totality covers all section states, corrupt STATE.json, corrupt per-section PLAN.md, and has an outer backstop; estimator stays unaffected by PLAN.md.

[LOW] HOOK-03 is correctly treated as coverage-only. I did not flag it.

HIGH_COUNT: 1
```

#### gemini (HIGH_COUNT: 0 — all eight prior HIGH families confirmed resolved)

```
The four revised plans (**07-01..07-04**) for Phase 7 have been thoroughly reviewed against the Phase Goal, the 5 Success Criteria, the Project Non-Negotiables, and the 10+ resolved HIGH concerns from previous cycles.

The plans collectively deliver a robust, state-aware single-command UX while ensuring safety and totality over a corrupt input surface. 

### Key Resolution Confirmations:

*   **H1 (Yolo Cap Scope & Safety):** `07-02` Task 3 correctly implements the `>50%` cap refusal in a pre-dispatch seam that fires for **any** command line where `--yolo` is present (including non-gate verbs like `write`/`plan` and bare invocation), independent of `--estimate`. `07-02` Task 2 ensures the estimator returns an empty projection on `StateNotFoundError`, preventing a crash in paper-less directories (**C2-H1**).
*   **H2 (Single Dispatch & Pre-dispatch Flags):** `07-02` Task 3 implements a manual argv pre-parse BEFORE `runMain`. This ensures global flags (`--dry-run`, `--show-prompts`) are applied before subcommands execute and prevents double-execution by bypassing `runMain` on bare routing.
*   **H3 (Dry-run LLM Gate):** `07-02` Task 4 confirms that `--dry-run` achieves zero network egress by setting `PENSMITH_NO_LLM='1'`, which the existing Phase 5 verifier call sites already honor. `07-01` Task 1 adds a non-vacuous RED test driving the LLM-calling `verify` path with a fake key present.
*   **H4 (Resume Circularity & Hand-off Lifecycle):** `07-02` Task 1 pins the router to ignore `HANDOFF.json` and never return `resume`. `07-02` Task 3 ensures the `resume` verb hand-off clears the `HANDOFF.json` file, guaranteeing progress.
*   **C3-HIGH-1 (Router Totality):** `07-02` Task 1 ensures `resolveNextAction` is total over `SectionStateSchema`, specifically routing `failed`/`unverifiable` back to `verify` so the walk returns a concrete verb for the first non-verified section.
*   **C3-HIGH-2 (Flag Forwarding):** `07-02` Task 3 exports a `dispatchVerb` helper that merges parsed global flags into the `args` object for manually-dispatched verbs (bare, `next`, `resume`). This ensures `compile`/`done` correctly skip their own approval gates.
*   **C4-HIGH & C5-HIGH (Corrupt Input Safety):** `07-02` Task 1 implements a catch-all classification for `loadState` and a guarded read for per-section `PLAN.md` frontmatter, both resolving to `status/attention` without throwing. An outer try/catch backstop in the resolver body provides defense-in-depth, fulfilling the "never crash" non-negotiable across the full failure surface.

### Additional Validations:

*   **16-Verb Bijection:** Plans rigorously maintain the locked 16-verb set. Plumbing namespace skills route to existing verbs, and `07-01` Task 3 adds an invariant check for `UX02_VERBS.length === 16`.
*   **Hook Integrity:** `07-03` correctly upgrades the hooks, with `Stop` using `Promise.allSettled` to protect the session-log flush from a rejected lock release (**M1/C2-M2**), and `PreCompact` implementing the self-imposed 10s timeout.

The plans are idiomatically aligned with the project's engineering standards and the two-tier architecture.

HIGH_COUNT: 0
```

#### claude (HIGH_COUNT: 1 — NEW C6-HIGH: corrupt-PLAN.md never-crash not delivered through the router→status dispatch; judge-confirmed)

```
I've reviewed the four plans against the cited code seams. Let me confirm my reading of the key seams before finalizing.

The seams check out as the plans describe:
- `pass2.ts:215` and `pass4.ts:392` both gate on `PENSMITH_NO_LLM === '1' || !ANTHROPIC_API_KEY` → H3's dry-run gate is real, not fictional.
- `bin/pensmith.ts` has `subCommands` only, no root `run()` → H2's pre-dispatch seam premise holds.
- `compile.ts:88` reads `yolo: args.yolo === true` → C3-HIGH-2's forwarding target is real.
- `hooks/pre-compact.ts:178-187` wraps `parseFrontmatter(readFileSync(planPath))` in try/catch → C5's "the throw is real, and the repo already guards it" claim is accurate.
- `lock.ts:135` `release()` calls `lockfile.unlock` which rejects on an unheld stub → M1's `Promise.allSettled` requirement is correct.

# Cross-AI Plan Review — Phase 7, Cycle 6

## Confirmation of prior resolutions (all genuinely resolved)

- **H1 / C2-H1, H2, H3 / C2-H3, H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH** — all verified against plan text + seams. The C5 never-throw invariant over `resolveNextAction`'s input surface (loadState catch-all, `state.sections ?? []`, per-section `readFileSync`/`parseFrontmatter` try/catch, outer backstop, audited `existsSync` probes) is total and the RED gate in 07-01 (case (o) corrupt-frontmatter → status/attention; case (p) absent → plan) would catch the unguarded walk. The estimator-unaffected claim is correct (it counts sections from STATE.json, never reads PLAN.md).

## New HIGH

**[HIGH] SC1's "never crash on a present-but-corrupt per-section PLAN.md" is proven only for `resolveNextAction`, not for the bare-dispatch leg that follows it — the `status` verb the router routes corruption to is not guaranteed (nor tested) to guard its OWN per-section PLAN.md walk, so a corrupt PLAN.md still crashes bare `/pensmith` end-to-end.**

The whole C4→C5 arc made `resolveNextAction` never throw so that `decision.verb` can't crash the bare dispatcher. But for the C5 corrupt-PLAN.md case the resolver returns `{ verb:'status', reason:'attention', section }`, and the bare path (07-02 Task 3 step 3e) then calls `dispatchVerb('status', …)` → `statusCommand.run()`. Per 07-02 Task 3, `status.ts` is specified to "**walk section PLAN.md frontmatter (reuse the router's read helpers or parseFrontmatter)**" to print its per-section table. That walk re-reads the *same* corrupt PLAN.md the router just flagged. Two problems make this an unguarded throw:

1. **The suggested reuse target doesn't exist.** 07-02 Task 1 exports only `resolveNextAction` + `RouterDecision` — there is no exported per-section `readSectionState()` helper to "reuse." So the executor falls to the "or parseFrontmatter" alternative, i.e. a raw `parseFrontmatter(readFileSync(planPath))`, which `hooks/pre-compact.ts:178-187` proves throws on malformed YAML. `dispatchVerb` is not specified to wrap `cmd.run()` in try/catch, so the throw propagates to the top level and crashes bare `/pensmith` — the exact SC1 failure mode, just moved one layer downstream (the same "sibling, one file over" pattern as C4→C5, now "one verb over").

2. **No test pins it.** The router RED suite (`pensmith-router.test.ts`) exercises `resolveNextAction` in isolation. `flags.test.ts`'s C4-HIGH case drives bare `pensmith --yolo` against a corrupt **STATE.json** (where `status.ts`'s STATE-level guard is explicitly required) but there is **no** case driving bare `pensmith` (or `pensmith status`) against a corrupt **PLAN.md** asserting the full router→status dispatch exits cleanly. So the only place SC1's corrupt-PLAN.md guarantee is gated is the router unit test, which cannot observe the status verb's own walk. 07-02's status acceptance criterion mentions only "handles BOTH StateNotFoundError and a corrupt-STATE load error" — the per-section corrupt PLAN.md (C5) is absent from status's contract and coverage.

**Fix:** (a) require `status.ts` (and any verb that walks PLAN.md frontmatter) to use the same per-section try/catch guard the router uses — ideally by having 07-02 Task 1 export a shared guarded `readSectionState(planPath)` helper so "reuse the router's read helpers" is literally possible; and/or (b) have `dispatchVerb` wrap the dispatched `cmd.run()` in a backstop try/catch that prints to stderr and exits cleanly; and (c) add a `flags.test.ts` (or router-dispatch) RED case driving bare `pensmith` against a corrupt PLAN.md asserting the end-to-end invocation does not crash — the missing twin of the existing corrupt-STATE bare-dispatch case.

This is HIGH because SC1 explicitly enumerates "on a present-but-corrupt per-section PLAN.md AND it must NEVER crash," and that guarantee is currently delivered only up to `resolveNextAction`'s return — not through the dispatch that bare `/pensmith` actually performs.

## Notes (not HIGH)
- The router's "done" terminus keys on `FINAL.md` presence, but per STATE.md [06-05] `done.ts` writes exports to `.paper/export/` and "leaves exportDraft outputDir UNSET" — it's not established that any `FINAL.md` sentinel is ever written, so bare `/pensmith` after a completed export may keep resolving to `done`. This is an idempotency/UX concern, not a crash, and the export gate re-confirms (only `--yolo` would silently re-export). MEDIUM at most; flagging for awareness, not blocking.

HIGH_COUNT: 1
```

#### opencode (HIGH_COUNT: 0 — all eight prior HIGH families confirmed genuinely resolved)

```
## Cross-AI Plan Review — Cycle 6

### Previously resolved HIGH concerns (verified against plan text)

| ID | Plan source | Status |
|---|---|---|
| **H1** — yolo >50%-cap for ANY verb, paper-less no-crash | 07-02 Task 3.c + must_haves truths | ✓ Genuinely resolved. Pre-flight runs for ANY verb (incl. non-gate write/plan/verify) and bare, independent of --estimate, hard exit(1). projectEstimate returns empty projection on StateNotFoundError (C2-H1) AND on any other load error (C4-HIGH). |
| **H2** — no double-dispatch + flags on explicit verbs | 07-02 Task 3 + must_haves truths | ✓ Genuinely resolved. Root has subCommands only, NO run(). Pre-dispatch argv pre-parse applies flags BEFORE dispatch. Explicit verbs run via runMain exactly once. Bare routes separately. |
| **H3** — dry-run gates LLM on verify path (non-vacuous) | 07-02 Task 3.b + Task 4 | ✓ Genuinely resolved. --dry-run sets PENSMITH_NO_LLM='1' which pass2.ts:215 + pass4.ts:392 already honor (zero messages.create, zero COSTS.jsonl). No runtime.ts edit, no pass2/pass4 edit. H3 test drives `verify --dry-run` WITH fake ANTHROPIC_API_KEY. |
| **H4** — resolveNextAction ignores HANDOFF | 07-02 Task 1 behavior | ✓ Genuinely resolved. Router never reads HANDOFF.json. RouterDecision 'resume' arm exists only for resume.ts typing, never emitted by resolveNextAction. |
| **C3-HIGH-1** — router totality over SectionStateSchema | 07-02 Task 1 COMPLETE SECTION-STATE→VERB MAP | ✓ Genuinely resolved. Exhaustive switch over all SectionStateSchema values. failed/unverifiable → verify (NOT continue). Mixed [verified,failed,verified] → verify. default arm + guaranteed terminal returns. |
| **C3-HIGH-2** — --yolo forwarded into manual-dispatch verbs | 07-02 Task 3 (dispatchVerb helper) | ✓ Genuinely resolved. Shared dispatchVerb helper MERGES globalFlags (≥ yolo) into dispatched verb's args. Bare/next/resume ALL dispatch through dispatchVerb. Explicit verb path uses citty native parsing. |
| **C4-HIGH** — corrupt STATE.json never throws | 07-02 Task 1 (loadState catch-all) + Task 2 (estimator catch-all) | ✓ Genuinely resolved. loadState catch-all: StateNotFoundError → new; ANY OTHER error → status/attention + stderr (never re-throws). state.sections ?? [] before .sort(). Estimator catch-all returns empty projection on any load error. |
| **C5-HIGH** — corrupt per-section PLAN.md never throws | 07-02 Task 1 (per-section try/catch + outer backstop + input-surface audit) | ✓ Genuinely resolved. Per-section readFileSync+parseFrontmatter wrapped in try/catch: absent → plan, present-but-corrupt → status/attention+section+stderr. Outer backstop wraps whole resolver. Input-surface audit confirms all fs/parse ops guarded (loadState, .sort guard, per-section read, existsSync probes). |

### New/remaining concerns

**[MEDIUM] M1: citty flag compatibility on explicit-verb path.** The pre-parse scans argv for --dry-run/--estimate/--yolo/--show-prompts but does NOT strip them before calling runMain. If citty subcommands don't declare these flags in their own `args`, citty may reject "unknown flag" errors on paths like `pensmith write --dry-run` or `pensmith compile --yolo`. The --estimate path exits before citty runs (safe), but --yolo under-cap, --dry-run, and --show-prompts still have untripped argv entries when runMain processes them. The plan's tests assert these work, so the implementation must handle this (strip argv, declare flags per subcommand, or use ignoreUnknown). The plan doesn't specify which mechanism. Document in the 07-02-SUMMARY that this is an implementation detail the RED tests guard.

**[MEDIUM] M2: citty `--show-prompts` flag parsing on explicit subcommands.** Same structural issue as M1 — `pensmith write --show-prompts` must work without citty erroring. The pre-parse has already called `setMirrorPromptsToStderr(true)` by the time it reaches runMain, so the EFFECT is applied regardless of whether citty errors. But if citty throws on unknown flag, the process still crashes before the verb runs, and the user sees an error. Same mitigation as M1.

**[LOW] L1: SessionStart HANDOFF.json parsing.** The plan says "existsSync → JSON.parse → HandoffSchema.safeParse (never throw on malformed)" but JSON.parse itself throws on invalid JSON. The behavior description implies a surrounding try/catch but doesn't spell it. Minor clarity gap — the hooks pattern (silent try/catch, exit 0) inherently covers this.

**[LOW] L2: closeSessionLog only tracks the most recent logger.** The module-scope `activeChain` approach only captures the latest openSessionLog() chain. Acceptable for sequential sessions, but if a concurrent or overlapping openSessionLog occurs, the earlier chain is orphaned. Not a real concern in current architecture (sessions are sequential).

### Summary

All 8 previously resolved HIGHs (H1-H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH) are **genuinely resolved** in the plan text — each has explicit design decisions, code seams, guard patterns, and regression-gate tests that would catch the original failure. The plans correctly and completely deliver the Phase 7 goal across all 5 success criteria and all project non-negotiables.

Two MEDIUM concerns around citty flag interoperability on the explicit-verb path — these are implementation risks the RED tests guard, not design gaps.

HIGH_COUNT: 0
```

### Cycle 6 — Judge Verdict

**current_high = 1.** The cycle-5 never-throw invariant for `resolveNextAction` (STATE.json catch-all + per-section PLAN.md try/catch + outer backstop + input-surface audit) is UNANIMOUSLY confirmed resolved and re-verified against the live seams; all eight prior HIGH families (H1/H2/H3/H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH) remain resolved. One NEW HIGH survives (C6-HIGH), code-verified and not adjudicated before: the corrupt-PLAN.md "never crash" guarantee (SC1) is delivered only up to `resolveNextAction`'s RETURN — the bare path then dispatches `status`, whose own per-section PLAN.md walk ("reuse the router's read helpers or parseFrontmatter") re-reads the same corrupt file via a raw, unguarded `parseFrontmatter(readFileSync)` (no shared guarded read helper is exported; `dispatchVerb` has no backstop try/catch), so bare `/pensmith` still crashes end-to-end — the same never-crash family as C4→C5, one VERB downstream. No 07-01 end-to-end case drives bare `pensmith`/`status` against a corrupt PLAN.md (only against a corrupt STATE.json). Fix: export a shared guarded `readSectionState(planPath)` from router.ts and have status.ts use it, and/or give dispatchVerb a backstop try/catch, and add an end-to-end corrupt-PLAN.md RED case. The corruption-robustness family (the C4→C5→C6 never-crash arc) is therefore NOT yet fully closed end-to-end — it is closed for the resolver, open for the dispatch leg. All other findings are MEDIUM/LOW and non-blocking: codex's `list/open/sketch/add` SC2 claim is Phase-8-scoped (downgraded), the plugin-schema fallback and citty flag-stripping are repeat MEDIUMs, and the `FINAL.md`-sentinel `done` idempotency is a MEDIUM-at-most awareness note.

## Cycle 7

**Reviewed:** 2026-06-18. Reviewers run: codex, gemini, claude, opencode (all four available; all four returned usable output). Prompt: `/tmp/gsd-review-prompt-7.md` (GOAL + 5 SCs + 8 non-negotiables + the cycle-1..6 resolved-HIGH ledger incl. the cycle-6 C6-HIGH closure + FULL TEXT of all 4 revised plans 07-01..07-04). Focus: confirm the cycle-6 fix — the corruption never-crash family closed END-TO-END (guarded `readSectionState` used by router+status; `dispatchVerb` outer backstop; end-to-end execFileSync RED case) — is genuinely resolved, and surface any remaining/NEW in-scope HIGH.

Raw HIGH_COUNT per reviewer: codex 1, gemini 0, claude 0, opencode 0.

### Synthesized Findings (cycle 7)

**The cycle-6 C6-HIGH end-to-end corruption never-crash closure is UNANIMOUSLY confirmed resolved.** All four reviewers independently verify that the C4→C5→C6 arc is now closed through three independent mechanisms in the revised plan text: (1) 07-02 Task 1 exports a SINGLE guarded `readSectionState(planPath)` helper (+ `SectionStateRead` type) that both `resolveNextAction`'s section walk AND `status.ts` consume — no raw unguarded `parseFrontmatter(readFileSync(planPath))` survives in either component; (2) 07-02 Task 3's `dispatchVerb` wraps the dispatched `cmd.run()` in an OUTER try/catch backstop scoped to the bare/next/resume umbrella dispatch (explicit `runMain` errors still surface); (3) 07-01 Task 1 adds the END-TO-END execFileSync bare-`pensmith` corrupt-PLAN.md no-crash RED case (driven WITHOUT `--yolo` so the cost pre-flight cannot mask the dispatch leg; accepts "clean exit, not an uncaught-exception stack"). claude re-verified the load-bearing seams against the live repo: `loadState` ENOENT-only translation, `pass2.ts:215`/`pass4.ts:392` PENSMITH_NO_LLM gate, `bin/pensmith.ts` subCommands-only/no root run(), `compile.ts:90`/`done.ts:436` `args.yolo === true`, `hooks/pre-compact.ts:178-187` identical guarded parseFrontmatter, `lock.ts:135` release-rejects-on-unheld-stub. All prior HIGH families (H1/H2/H3/H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH, C6-HIGH) remain resolved.

**Judge verdict: current_high = 0.** No genuine NEW in-scope HIGH survives. The single HIGH raised (codex) is the already-adjudicated M1/A2 Stop-hook lock family re-surfaced, not a new defect (see downgrade below). The corruption never-crash family (C4→C5→C6) is now CLOSED END-TO-END across router, estimator, status, and the bare-dispatch leg — by two independent guards (shared `readSectionState` + `dispatchVerb` backstop) plus an end-to-end RED case.

### Downgraded / rejected (with justification)

- **[codex HIGH → DOWNGRADED to already-adjudicated MEDIUM] "Stop hook hardcodes `release('.paper')` but no code acquires a `.paper`-keyed lock, so it releases nothing — SC4 'release the lock' unmet."** Factually correct about the mechanics and code-verified: pensmith locks are PER-FILE via `withLock(resource, fn)` (state/library/checkpoint/runtime-config/compile writes — `lock.ts:31-33`, `checkpoint.ts:161`, `compile.ts:253`), each acquired+released inside its OWN try/finally critical section DURING the run. There is NO long-lived `.paper`-keyed session lock that outlives a critical section for Stop to release. BUT this is the EXACT design point already adjudicated in cycles 1-6: 07-RESEARCH Assumption A2 (RESOLVED, lines 831/841) and the cycle-6 M1/C2-M2 finding explicitly establish that `release('.paper')` is a BEST-EFFORT orphaned-lock cleanup that typically rejects precisely because no `.paper`-keyed lock is held — and the `Promise.allSettled` design (07-03 Task 2, lines 160/213) exists SPECIFICALLY so that expected rejection cannot abandon the flush. The plan is internally consistent and intentional: Stop does harmless best-effort cleanup of any stale `.paper` stub and GUARANTEES the flush; per-file locks are already released by their own `withLock` finally blocks, so there is no held lock leaking past Stop. This produces no Phase-7 crash, no stdout-protocol violation, and Stop still exits 0 — it does NOT map to an in-scope SC4 failure or non-negotiable violation. Per the review instructions (do NOT re-raise already-adjudicated MEDIUMs as HIGH), held at MEDIUM/non-blocking. Worth a one-line note in the 07-03 SUMMARY clarifying that "release the lock" means best-effort orphaned-stub cleanup, not releasing a held session lock (none exists).
- **[claude MEDIUM] Stop-hook `closeSessionLog()` flush is effectively vacuous in a fresh Stop subprocess.** `closeSessionLog()` awaits a module-scope `activeChain` that is `null` unless THIS process opened a logger; the Stop hook is a separate Claude Code subprocess that never opened the session logger, so it resolves immediately and flushes nothing real. This is the SAME M1/HOOK-04 family as the codex finding (the flush half rather than the release half) and is the previously-adjudicated design ("if no logger is active, resolve immediately," 07-03 Task 1 line 132). SC4's "always flushes the session log" is satisfied without crashing; the vacuity is an awareness note, not an SC failure. MEDIUM, non-blocking — flag in the 07-03 SUMMARY.
- **[opencode MEDIUM + (history) cycle-4/5/6 MEDIUM] citty flag interop on the explicit-verb path (`pensmith compile --yolo` approval-gate skip / unknown-flag tolerance).** REPEAT of the already-adjudicated cycle-4..6 MEDIUM. The pre-parse applies flag EFFECTS before runMain regardless of stripping; the explicit-verb approval-gate-skip relies on citty parsing `--yolo` into the subcommand args (citty ^0.2.2 is lenient with undeclared flags by default). opencode itself states "this does not constitute an SC failure or non-negotiable violation." Non-blocking robustness note (strip the four flags from argv before runMain, declare per-subcommand, or rely on citty leniency; the RED tests guard it). MEDIUM.
- **[claude LOW] plugin.json colon-namespace skills-array schema (A1).** REPEAT of the cycle-1..6 already-adjudicated MEDIUM, here at LOW. Primary path ships the real skills array; the CONTRIBUTING.md fallback is contingent on Assumption A1 and gated by `validate-plugin-manifest.cjs` + a blocking human-verify checkpoint. Risk contained. Not re-raised as HIGH.
- **[claude LOW] estimator STEP_HEURISTICS are coarse.** SC3 requires only a no-LLM projection table + a correct 50%-cap predicate, both met. The heuristics are explicitly labeled estimates (07-RESEARCH A4). LOW, non-blocking.

### Per-Reviewer Raw (cycle 7)

#### codex (HIGH_COUNT: 1 claimed → judged 0 valid in-scope HIGH; the Stop `.paper` lock-release claim is the already-adjudicated M1/A2 family, downgraded to MEDIUM)

```
The C4→C5→C6 corruption never-crash family looks genuinely closed in the revised plans. The coverage now spans corrupt/schema-invalid `STATE.json`, corrupt per-section `PLAN.md`, shared guarded `readSectionState()`, `status.ts` reuse, and an end-to-end bare `pensmith` dispatch backstop. I do not see a remaining HIGH there.

[HIGH] Stop hook does not clearly release the actual Pensmith lock  
07-03 Task 2 hardcodes `release('.paper')`, while the same plan states locks are “per-file” and that no code acquires a `.paper`-keyed lock, so this release will typically reject and may release nothing. SC4 requires Stop to release the lock and flush the session log; `Promise.allSettled` fixes the flush survivability, but not the lock-release requirement if the wrong resource is targeted. Fix direction: identify the actual lock resource(s) Pensmith acquires during sessions, release those explicitly, and keep the release-failure test plus a positive test proving a real held Pensmith lock is gone after Stop.

Everything else I’d raise is MEDIUM/LOW or already covered by the revised gates. `list/open/sketch/add` remain appropriately treated as Phase-8 stubs, HOOK-03 is only coverage, and the no-17th-verb invariant is covered.

HIGH_COUNT: 1
```

#### gemini (HIGH_COUNT: 0 — all prior HIGH families confirmed resolved; C4→C5→C6 end-to-end closure confirmed)

```
The four plans are exceptionally thorough and demonstrate high technical integrity. All previous **HIGH** concerns from Cycles 1–6 have been systematically addressed and pinned with regression tests.

### Confirming the Corruption Never-Crash Family (C4→C5→C6)
The end-to-end guarantee for system resilience against corruption is now genuinely closed:
*   **C4 (STATE.json):** Both `resolveNextAction` and `projectEstimate` now use a catch-all classification of `loadState` errors, routing malformed/invalid files to the `status/attention` disposition without throwing.
*   **C5 (PLAN.md):** The per-section read is now try/catch-guarded inside the shared `readSectionState` helper, distinguishing between absent files (→ `plan`) and corrupt files (→ `attention`) while ensuring no parse error escapes the walk.
*   **C6 (End-to-End):** The `status` verb consumes the same guarded helper (avoiding re-walking corruption unguarded), and `dispatchVerb` provides an outer try/catch backstop for the bare/next/umbrella dispatch. This ensures the CLI never crashes with an uncaught exception regardless of disk state.

### Confirming UX and Ergonomic Correctness
*   **H1 (Yolo Cap):** The cost-cap pre-flight is correctly placed in the dispatcher pre-dispatch seam, covering all verbs (including non-gate `write`/`plan`) and bare invocation.
*   **H2 (Double Dispatch):** The manual argv pre-parse effectively separates flag setup and bare routing from `runMain`, preventing double-execution and ensuring flags apply to explicit verbs.
*   **H3 (Dry-Run):** The use of `PENSMITH_NO_LLM` (honored by existing call sites) and `PENSMITH_NETWORK_TESTS` (honored by adapters) provides a zero-network guarantee without requiring risky edits to Phase 5 code.
*   **H4 (Resume):** Decoupling routing from `HANDOFF.json` and consuming/clearing the file upon resume effectively breaks the potential infinite loop.
*   **Totality & Forwarding:** `resolveNextAction` is now typed and implemented as total over `SectionStateSchema` (failed/unverifiable → `verify`), and `dispatchVerb` ensures global flags like `--yolo` reach manually-dispatched verbs to skip their internal approval gates.

The **07-01 RED suite** is robust, utilizing the RED-by-skip pattern to ensure CI stays green while fixing exact implementation contracts.

**HIGH_COUNT: 0**
```

#### claude (HIGH_COUNT: 0 — C4→C5→C6 confirmed structurally closed end-to-end against live seams; Stop flush + plugin schema + heuristics are MEDIUM/LOW non-blocking)

```
I've reviewed all four plans against the Phase 7 success criteria and non-negotiables, and traced the load-bearing claims against the actual codebase (`bin/pensmith.ts`, `hooks/*.ts`, `bin/lib/lock.ts`, `verify/pass2.ts:215`, `verify/pass4.ts:392`, `frontmatter.ts` usage in `pre-compact.ts:178-187`).

## Confirmation: corruption never-crash family (C4 → C5 → C6) is genuinely closed

The three-link chain holds end-to-end, and the closure is structural rather than prompt-dependent:

- **C4 (corrupt/schema-invalid STATE.json).** Verified against the real `loadState` contract: only ENOENT → `StateNotFoundError`; `SyntaxError`/`SchemaValidationError`/`ForwardIncompatError`/EACCES bubble. 07-02 Task 1 widens the catch to *catch-then-classify* (StateNotFoundError→new; else→status/attention) and guards `state.sections ?? []` before `.sort()`. 07-02 Task 2 mirrors it in `projectEstimate` (empty projection on any load error). RED cases exist in both `pensmith-router.test.ts` (m/n) and `estimator.test.ts`.
- **C5 (corrupt per-section PLAN.md).** The per-section read is factored into the exported guarded `readSectionState(planPath)` mirroring the repo's own `pre-compact.ts:178-187` try/catch around the identical `parseFrontmatter(readFileSync(...))` — which I confirmed genuinely throws on malformed YAML. Absent→plan, corrupt→status/attention+section, plus an outer resolver backstop. Router-unit cases (o/p) cover it.
- **C6 (dispatch leg).** This is the real closure: `status.ts` is required to consume the *same* `readSectionState` (no raw `parseFrontmatter(readFileSync(planPath))` survives in either router or status), AND `dispatchVerb` wraps `cmd.run()` in an outer try/catch scoped to the bare/next/resume umbrella only (explicit `runMain` errors still surface). Two independent guards. The end-to-end `flags.test.ts` case correctly drives bare `pensmith` *without* `--yolo` so the cost pre-flight can't mask the dispatch leg, and accepts "clean exit, not an uncaught-exception stack" — which the readSectionState path satisfies with exit 0.

The other SC-mapped HIGHs (H1 yolo-cap-for-any-verb incl. non-gate + paper-less guard; H2 pre-dispatch seam / no double-dispatch, consistent with citty `index.mjs:228`; H3 non-vacuous `verify --dry-run` via `PENSMITH_NO_LLM`, which I confirmed is the real gate at `pass2.ts:215`/`pass4.ts:392` with no fictional `runtime.ts` seam; H4 HANDOFF-blind resolver + HANDOFF consume; C3-HIGH-1 total switch routing failed/unverifiable→verify; C3-HIGH-2 `dispatchVerb` flag forwarding into `args.yolo` matching `compile.ts:90`/`done.ts:436`) each have a dedicated regression-gated RED assertion that would fail against the original broken design.

## Non-HIGH observations (do not block)

`[MEDIUM] Stop-hook session-log flush is effectively a no-op in a fresh subprocess.` 07-03 Task 1's `closeSessionLog()` awaits a module-scope `activeChain` that is `null` unless *this process* opened a logger. The Stop hook is a separate Claude Code subprocess that never opened the session logger, so `closeSessionLog()` resolves immediately and flushes nothing real; `stop.test.ts` can only assert the `allSettled` rejection-survival, not a meaningful flush. This is the previously-adjudicated HOOK-04/M1 design and the plan explicitly acknowledges "if no logger is active, resolve immediately," so it is not a new SC failure — but the "always flushes the session log" framing of SC4 is satisfied only vacuously. Worth a one-line note in the 07-03 summary rather than a code change.

`[LOW] plugin.json skills-array schema (A1).` 07-04 ships a `skills` array with colon-prefixed names but the Anthropic plugin schema for this field is unverified; the plan already specifies a CONTRIBUTING.md fallback gated on `validate-plugin-manifest.cjs`, so the risk is contained.

`[LOW] estimator STEP_HEURISTICS are coarse.` The `--estimate` projection may diverge materially from real cost, but SC3 only requires a no-LLM projection table and a correct 50%-cap predicate, both of which are met.

No remaining or new HIGH maps to an SC failure or non-negotiable violation in this phase's scope. The corruption never-crash family is closed end-to-end across router, estimator, status, and the bare-dispatch leg.

HIGH_COUNT: 0
```

#### opencode (HIGH_COUNT: 0 — all eleven+ prior HIGH genuinely resolved; only a citty-flag-interop MEDIUM remains)

```
After thorough review across all four plans (07-01 through 07-04), I find that the eleven+ HIGH concerns from earlier cycles are genuinely resolved. The C4→C5→C6 end-to-end corruption never-crash family is properly closed through three independent mechanisms:

1. **Shared `readSectionState(planPath)` helper** — exported from router.ts, used by both resolveNextAction's section walk AND status.ts, so no component does a raw unguarded `parseFrontmatter(readFileSync(planPath))`
2. **dispatchVerb outer try/catch backstop** — bare/next/resume umbrella dispatch wraps `cmd.run()` so even an unforeseen throw becomes a graceful diagnostic
3. **End-to-end test** (07-01 C6-HIGH case) — `execFileSync` bare `pensmith` against a corrupt PLAN.md asserts clean exit with no uncaught exception

All SC1-SC5 have dedicated regression gates. The one remaining concern is **MEDIUM**: whether citty will pass `--yolo` into explicit verb args (`pensmith compile --yolo`) for approval-gate skipping when flags are declared at the root level rather than on every subcommand. The pre-dispatch seam handles the cost-cap refusal correctly, but the approval-gate-skip may not engage for explicit verbs if citty doesn't propagate unknown root flags into subcommand args. This does not constitute an SC failure or non-negotiable violation.

**HIGH_COUNT: 0**
```

### Cycle 7 — Judge Verdict

**current_high = 0.** The cycle-6 C6-HIGH closure — the corruption never-crash family delivered END-TO-END through the bare-dispatch leg via a shared guarded `readSectionState` helper (consumed by BOTH router and status), a `dispatchVerb` outer try/catch backstop, and an end-to-end execFileSync corrupt-PLAN.md RED case — is UNANIMOUSLY confirmed resolved and re-verified against the live seams. All prior HIGH families (H1/H2/H3/H4, C3-HIGH-1, C3-HIGH-2, C4-HIGH, C5-HIGH, C6-HIGH) remain resolved. The full C4→C5→C6 never-crash arc is now closed end-to-end (resolver + estimator + status verb + dispatch leg) by two independent guards. The one HIGH raised this cycle (codex: Stop hardcodes `release('.paper')` which releases nothing because locks are per-file) is factually accurate about the mechanics but is the already-adjudicated M1/A2 design — `release('.paper')` is intentional best-effort orphaned-stub cleanup wrapped in `Promise.allSettled` so its expected rejection cannot abandon the flush; per-file locks self-release via their own `withLock` finally blocks during the run, so no held session lock leaks past Stop, and Stop exits 0 without a protocol violation. It maps to no in-scope SC4 failure or non-negotiable violation and is held at MEDIUM (worth a one-line 07-03 SUMMARY clarification that "release the lock" = orphaned-stub cleanup, not releasing a held session lock). All other findings are MEDIUM/LOW and non-blocking: the Stop-flush-vacuity (same M1/HOOK-04 family), the repeat citty-flag-interop MEDIUM, the plugin-schema fallback (A1), and the coarse estimator heuristics (A4). After seven cycles, no remaining or new in-scope HIGH survives — the four plans are ready to execute.
