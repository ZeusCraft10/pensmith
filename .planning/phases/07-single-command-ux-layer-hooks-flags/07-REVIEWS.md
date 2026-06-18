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
