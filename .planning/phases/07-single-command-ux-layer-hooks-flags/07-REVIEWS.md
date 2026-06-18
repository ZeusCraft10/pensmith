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
