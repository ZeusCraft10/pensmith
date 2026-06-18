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
