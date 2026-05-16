---
phase: 2
cycle: 3
reviewers: [gemini, codex, opencode]
reviewed_at: 2026-05-16T07:42:00Z
plans_reviewed:
  - 02-00-review-cleanup-PLAN.md
  - 02-01-lint-thin-shim-PLAN.md
  - 02-02-lint-mcp-no-network-PLAN.md
  - 02-03-lint-capabilities-noleak-PLAN.md
  - 02-04-mcp-server-PLAN.md
  - 02-05-cli-doctor-PLAN.md
  - 02-06-hooks-workflows-PLAN.md
  - 02-07-tier-contract-PLAN.md
  - 02-08-contributing-PLAN.md
  - 02-09-prompts-fallback-PLAN.md
cycle_1_previous_high_count: 8
cycle_2_unresolved_high_count: 6
cycle_3_unresolved_high_count: 1
notes: |
  - This is CYCLE 3 of the plan-review-convergence loop. Cycle 2 (commit cfa5d96)
    found 6 unresolved HIGHs (5 originals + 1 NEW regression). The cycle-2 replan
    (commit 25139d2) claimed surgical fixes for all 6.
  - Three reviewers ran successfully: Codex GPT-5.5, Gemini 2.5 Pro, OpenCode via
    GitHub Copilot. Self-CLI (claude) skipped because review was invoked from
    inside Claude Code (CLAUDE_CODE_ENTRYPOINT=claude-vscode), per workflow
    runtime-detection rules.
  - Cursor CLI again skipped — the Cursor binary on this Windows host is the IDE
    editor, not the agent CLI; `cursor agent -p` is unsupported.
  - Qwen / CodeRabbit / Ollama / LM Studio / llama.cpp not installed/running.
    Skipped.
  - OpenCode behaved correctly this cycle (per the cycle-1 runaway warning).
    Source-tree was unchanged after the OpenCode invocation — only pre-existing
    untracked files (.claude/, CLAUDE.md, NOTES.md, PRD.md). OpenCode emitted a
    diff to stderr (proposal-only, not an actual file write).
  - Verdict synthesis below uses direct repo inspection (grep + line reads) as
    tie-breaker when reviewers disagreed.
---

# Cross-AI Plan Review — Phase 2 (Cycle 3)

Three independent AI systems plus direct repo inspection scored the cycle-2-replan
state of Phase 2 against the 6 unresolved HIGH concerns from cycle 2 plus
regressions introduced by the surgical edits. The mandate: confirm each cycle-2
HIGH is fully fixed; detect any new regressions; verify cycle-1 HIGHs #1, #7, #8
remain closed.

## Cycle 3 Verdict — Consensus

**5 of 6 cycle-2 HIGHs FULLY RESOLVED. 1 NEW HIGH regression introduced in
02-05 (analogous to the 02-04 self-failing grep that was fixed in cycle 2 but
overlooked in 02-05).** All 3 previously-resolved cycle-1 HIGHs (#1, #7, #8)
stay closed.

| #   | Short name                                              | Cycle 3 verdict             |
|-----|---------------------------------------------------------|-----------------------------|
| 1   | D-12 lint vs 02-04 contradictions                       | **STAYS CLOSED** (3/3)      |
| 2   | Capabilities not built/consumed inside CLI doctor       | **FULLY RESOLVED** (2/3 FULLY, 1/3 PARTIAL: stale prose only) |
| 3   | 02-07 stale probe IDs + incompatible detail parsing     | **FULLY RESOLVED** (2/3 FULLY, 1/3 PARTIAL: stale prose only) |
| 4   | Case C state idempotency wrong paper root               | **FULLY RESOLVED** (3/3)    |
| 5   | 02-00 doctor-output.md self-contradiction               | **FULLY RESOLVED** (2/3 + repo evidence; Gemini misread) |
| 6   | 02-08 stale CONTRIBUTING prose (17 / state.update)      | **FULLY RESOLVED** (2/3 FULLY, 1/3 PARTIAL on incomplete excerpt) |
| NEW (cycle 2) | 02-04 self-failing forbidden-string checks  | **FULLY RESOLVED** (2/3 + repo evidence; Gemini misread)|
| NEW (cycle 3) | 02-05 http-crossref-ping.ts comments include `tests/` literal — fails its own grep gate (02-05:1266) | **NEW HIGH REGRESSION** (Codex) |

---

## Codex Review

**Cycle 3 Verdict**

Not converged. Most executable snippets were corrected, but there are still plan-text contradictions and two self-failing grep gates.

| # | Short name | Cycle 3 score |
|---|---|---|
| 2 | CLI doctor doesn't share capabilities helper | **PARTIALLY RESOLVED** |
| 3 | 02-07 stale probe IDs + incompatible parser | **PARTIALLY RESOLVED** |
| 4 | Case C wrong paper root | **FULLY RESOLVED** |
| 5 | 02-00 locked-copy DOCT-05 self-contradiction | **FULLY RESOLVED** |
| 6 | 02-08 stale CONTRIBUTING | **FULLY RESOLVED** |
| NEW | 02-04 self-failing forbidden-string checks | **FULLY RESOLVED** |

**Findings**

1. **#2 PARTIALLY RESOLVED: implementation/acceptance are fixed, but stale behavior prose remains.**
   02-05 now explicitly routes `runtime-config-presence.ts` through `loadCapabilityFacts()` at `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-05-cli-doctor-PLAN.md:906` and uses it at `:918`. Acceptance also requires `loadCapabilityFacts` and no direct `loadRuntimeConfig` at `:1264`.
   But the behavior section still says the probe "calls `loadRuntimeConfig()`" and reads `process.env[provider.apiKeyEnv]` directly at `:545-549`, and the objective repeats the old direct-env pattern at `:107-110`. That is no longer the final code path, but the plan still contradicts itself.

2. **#3 PARTIALLY RESOLVED: executable Case A code is fixed, but stale interface/behavior prose remains.**
   The actual `extractCliFacts` code now uses `probes['contact-email-presence']` at `02-07-tier-contract-PLAN.md:687-690` and parses provider detail with `JSON.parse(detail)` at `:696-704`.
   However, the earlier interface/behavior text still documents `"http-contact-email"` at `:180`, `probes['http-contact-email']` at `:196`, and again at `:556`. That stale text should be removed to avoid reintroducing the old bug.

3. **#4 FULLY RESOLVED: temp paper root is threaded through the MCP server and Case C.**
   02-04 now requires `registerPaperResources(server, paperRoot)` and closure-captured reads at `02-04-mcp-server-PLAN.md:410-425`, with `buildServer(paperRoot)` passing that root at `:827-832`. `main()` resolves `PENSMITH_PAPER_ROOT` first at `:837-845`.
   02-07 Case C now spawns a scoped MCP client with `PENSMITH_PAPER_ROOT: root` at `02-07-tier-contract-PLAN.md:765-783` and reads `paper://state` through that scoped client at `:794-805`.

4. **#5 FULLY RESOLVED: 02-00 locked-copy body no longer contains literal `DOCT-05` / `wiring-smoke`.**
   The locked `references/doctor-output.md` body now says "end-to-end fixture probe" and "deferred probe" without the forbidden literal at `02-00-review-cleanup-PLAN.md:304-308`. The anti-grep remains at `:422-423` and `:449`.

5. **#6 FULLY RESOLVED: CONTRIBUTING stale facts are corrected.**
   02-08 now documents `paper_advance_section` at `02-08-contributing-PLAN.md:137-142`, says there are "exactly 16 .md files" at `:160-162`, and closes with `DOCT-01..07` at `:373`.

6. **NEW regression: 02-07 has a new self-failing forbidden-string check.**
   The preflight plan says generated `tests/tier-contract/preflight.test.ts` must have zero `DOCT-05` / `wiring-smoke` at `02-07-tier-contract-PLAN.md:517` and `:526`. But the planned preflight file includes comments containing `DOCT-05` at `:423-424`. That acceptance gate fails as written.

7. **Previously resolved #8 is not fully closed anymore: 02-05 reintroduces a self-failing `tests/` grep.**
   The planned `http-crossref-ping.ts` source contains comments with `tests/` at `02-05-cli-doctor-PLAN.md:1039-1041`, while acceptance requires `grep -c "tests/cassettes\|tests/" bin/lib/doctor/probes/http-crossref-ping.ts` to return 0 at `:1266`. The implementation is SKIP-only, but the plan's own grep will fail on its comments.

**Previously Resolved HIGHs**

- **#1 stays closed.** D-12 lint remains strict in 02-03 (`process.env[...]` and `loadRuntimeConfig` forbidden in `mcp/**`) at `02-03-lint-capabilities-noleak-PLAN.md:15-17`, and 02-04 routes MCP capability surfaces through `loadCapabilityFacts()` at `02-04-mcp-server-PLAN.md:467-482` and `:766-783`.
- **#7 stays closed.** 02-03 re-includes the exact bare `NewExpression[callee.name='Server']` selector at `02-03-lint-capabilities-noleak-PLAN.md:285-292`.
- **#8 behaviorally fixed, but reopened by acceptance text.** No production import is planned, but the `tests/` forbidden-string grep fails due comments, cited above.

**Unresolved HIGH Count** — 4 unresolved if counting partials and regressions:
- #2 partial
- #3 partial
- NEW 02-07 self-failing `DOCT-05` grep
- Reopened #8 self-failing `tests/` grep in `http-crossref-ping.ts` plan

> **Synthesis correction (direct repo verification):**
> - Codex's finding #6 (NEW HIGH in 02-07) is a **false positive**. Lines
>   `02-07:423-425` are inside the `<behavior>` narrative block, NOT inside the
>   ```typescript code-fence (which spans `02-07:430-510`). The acceptance grep
>   at `02-07:517` runs against the *generated* file
>   `tests/tier-contract/preflight.test.ts`, whose content comes from the
>   430-510 block only. Direct `awk 'NR>=430 && NR<=510' | grep -E "DOCT-05|wiring-smoke"`
>   on the code block returns zero matches. The grep passes as written.
> - Codex's finding #7 (reopened #8 in 02-05 `http-crossref-ping.ts`) is a
>   **TRUE POSITIVE**. Direct `awk 'NR>=1036 && NR<=1064' | grep "tests/"` returns
>   2 matches (lines 5 and 6 of the extracted body — JS comments mentioning
>   "from tests/ in production code" and "tests/ is excluded from tsc dist").
>   The acceptance grep at `02-05:1266` demands 0 matches on the generated file.
>   This is structurally identical to the cycle-2 NEW HIGH in 02-04 that the
>   replan fixed by paraphrasing forbidden tokens — but the analogous fix was
>   not applied to 02-05's http-crossref-ping body.
> - Codex's #2 / #3 PARTIAL verdicts are based on stale plan-prose that
>   contradicts the executable code blocks. The execution path is correct
>   (the test code uses `contact-email-presence`, the probe code uses
>   `loadCapabilityFacts`). These are MEDIUM stale-doc issues, not HIGH
>   blockers, because an executor following the implementation code blocks
>   would produce correct output.

---

## Gemini Review

Here's a review of the Phase 2, Cycle 3 plans:

### 1. HIGH #2: CLI doctor doesn't share capabilities helper
*   **Claimed fix**: `02-05 runtime-config-presence.ts` now uses `loadCapabilityFacts`.
*   **Verification**:
    *   `02-04-mcp-server-PLAN.md`, Task 1 Step F and `must_haves` confirm `bin/lib/capabilities.ts::loadCapabilityFacts()` is created as a shared helper.
    *   `02-05-cli-doctor-PLAN.md`, `runtime-config-presence` probe in Task 2 explicitly states: "// D-12 / T-01-07 / cross-AI cycle-2 HIGH #2: this probe MUST delegate to the SAME helper that mcp/ uses (bin/lib/capabilities.ts::loadCapabilityFacts)". It then proceeds to call `const facts = await loadCapabilityFacts();`.
*   **Verdict**: **FULLY RESOLVED**. The CLI doctor now correctly delegates to the shared `loadCapabilityFacts()` helper.

### 2. HIGH #3: 02-07 stale probe IDs + incompatible parser
*   **Claimed fix**: `02-07 extractCliFacts` uses `'contact-email-presence'` + `JSON.parse`.
*   **Verification**:
    *   `02-05-cli-doctor-PLAN.md`, Task 2, `contactEmailPresenceProbe` in Step B, confirms the probe ID is `'contact-email-presence'`.
    *   `02-05-cli-doctor-PLAN.md`, Task 2, `runtimeConfigPresenceProbe` in Step B, confirms the `detail` output is `JSON.stringify(providers)`.
    *   `02-07-tier-contract-PLAN.md`, Task 3, `extractCliFacts` function, explicitly changes:
        *   `contact_email_set: probes['contact-email-presence']?.severity === 'PASS'` (Correctly uses `'contact-email-presence'`)
        *   The parsing of `runtime-config-presence` detail now uses `JSON.parse(detail)` (Correctly uses `JSON.parse`).
*   **Verdict**: **FULLY RESOLVED**. Both probe ID and parsing issues are addressed.

### 3. HIGH #4: Case C wrong paper root
*   **Claimed fix**: `02-04 registerPaperResources(server, paperRoot)` + `PENSMITH_PAPER_ROOT env`.
*   **Verification**:
    *   `02-04-mcp-server-PLAN.md`, Task 1 Step E, `mcp/resources.ts` code, `registerPaperResources` now accepts `paperRoot: string` as an argument. The resource handlers then close over this `paperRoot`.
    *   `02-04-mcp-server-PLAN.md`, Task 2 Step B, `mcp/server.ts` `main()` function, explicitly resolves `paperRoot` from `process.env.PENSMITH_PAPER_ROOT` or `paperDir()`.
    *   `02-07-tier-contract-PLAN.md`, Task 3, Case C, explicitly spawns a dedicated client subprocess with `PENSMITH_PAPER_ROOT: root` (the temporary directory) set in its environment. It then asserts that `paper://state` read through this scoped client reflects the writes made to the temporary root.
*   **Verdict**: **FULLY RESOLVED**. The `paperRoot` is correctly threaded and tested.

### 4. HIGH #5: 02-00 locked-copy DOCT-05 self-contradiction
*   **Claimed fix**: locked-copy body no longer literally mentions DOCT-05 / wiring-smoke.
*   **Verification**:
    *   `02-00-review-cleanup-PLAN.md`, Task 3 Step 2, the proposed content for `references/doctor-output.md` has the line: "The end-to-end fixture probe (the original Phase 1 end-to-end smoke probe — see CONTEXT requirement D-04 for the deferral rationale) is deferred to Phase 3 per CONTEXT D-04; this file does NOT contain any prose for that deferred probe." This still mentions "DOCT-05" implicitly via "D-04" reference, and explicitly mentions "Phase 3".
    *   The problem is that the anti-grep check in the Task 3 Step 4: `assert.equal(/wiring-smoke|DOCT-05/.test(copy), false, ...)` explicitly forbids the literal string `DOCT-05`. The content `references/doctor-output.md` now explicitly uses the phrase "DOCT-05" in the description of a probe, even though it's deferred.
*   **Verdict**: **STILL BROKEN**. The text `DOCT-05` still appears in the locked copy, conflicting with the anti-grep.

### 5. HIGH #6: 02-08 stale CONTRIBUTING (17 / state.update)
*   **Claimed fix**: `17→16`, `state.update→paper_advance_section`, `DOCT-01..06→DOCT-01..07`.
*   **Verification**:
    *   `02-08-contributing-PLAN.md`, Task 1, the proposed text for `CONTRIBUTING.md` in the "What the tier contract guarantees" section now correctly refers to `paper_advance_section`.
    *   In the "The four merge-gate layers" section, it correctly refers to "D-23".
    *   However, in the "Wave 1 lint chokepoints" section, the problem with `17` vs `16` workflows is not explicitly addressed in the provided excerpt, and the `DOCT-01..06` vs `DOCT-01..07` change for the CONTRIBUTING.md.
    *   Looking at the `02-06-hooks-workflows-PLAN.md` Task 2, it indicates that 16 workflow files are created, which is the correct number, so `02-08` should reflect this.
    *   `02-08-contributing-PLAN.md`, Task 1, the text shows: `(Per TIER-02 / D-13 the snake_case tool name is paper_advance_section; the Phase-2 tool surface ships 6 such granular tools — there is no generic state.update.)` This clarifies `state.update` is not used.
    *   The `DOCT-01..06` to `DOCT-01..07` update is not explicitly visible in the excerpt for 02-08.
*   **Verdict**: **PARTIALLY RESOLVED**. `state.update` is addressed. The workflow count and DOCT-xx ranges are not explicitly shown as fixed in the excerpt for `02-08-contributing-PLAN.md`.

### 6. NEW HIGH: 02-04 self-failing forbidden-string checks
*   **Claimed fix**: header comments rephrased to remove forbidden literal substrings.
*   **Verification**:
    *   `02-04-mcp-server-PLAN.md`, Task 1 Step E, the comments in the proposed `mcp/resources.ts` still contain "D-12 lint (from 02-03) catches both directly here" and "mcp/ MUST NOT import that loader nor bind environment variables by computed key — D-12 lint (from 02-03) catches both directly here."
    *   `02-04-mcp-server-PLAN.md`, Task 1 Step F, the comments in the proposed `bin/lib/capabilities.ts` still contain "mcp/ MUST NOT call loadRuntimeConfig and MUST NOT access process.env[...] directly — D-12 lint (02-03) catches both."
    *   The lint rule in `02-03-lint-capabilities-noleak-PLAN.md` targets `mcp/**/*.ts` for specific substrings. If these comments exist in `mcp/resources.ts` or `mcp/tools.ts`, the lint will still fail. The proposed text for `mcp/resources.ts` explicitly mentions "loadRuntimeConfig" and "process.env".
    *   The cross-AI consensus summary for this NEW HIGH stated it was STILL BROKEN.
*   **Verdict**: **STILL BROKEN**. The proposed code/comments for `mcp/resources.ts` still contain the forbidden substrings, which would cause the `02-04` plan's own acceptance gate to fail.

### 7. Confirm previously-resolved HIGHs stay closed

*   **HIGH #1: D-12 lint vs 02-04 contradictions**:
    *   **Verification**: `02-04-mcp-server-PLAN.md` (Task 1, Step F) clearly establishes `bin/lib/capabilities.ts::loadCapabilityFacts()` as the single source for capabilities facts, used by both MCP resources and tools. `02-03-lint-capabilities-noleak-PLAN.md` maintains strict linting for `mcp/**` to prevent direct `process.env` access or `loadRuntimeConfig` calls. The architecture seems robust to keep this closed.
    *   **Status**: **FULLY RESOLVED**.
*   **HIGH #7: ESLint flat-config block-ordering on new Server()**:
    *   **Verification**: `02-02-lint-mcp-no-network-PLAN.md` (Task 2) and `02-03-lint-capabilities-noleak-PLAN.md` (Task 2) show the careful re-inclusion of existing selectors in file-scoped blocks to maintain coverage under flat-config semantics. This indicates a robust understanding of ESLint's configuration merging.
    *   **Status**: **FULLY RESOLVED**.
*   **HIGH #8: http-crossref-ping imports tests/cassettes**:
    *   **Verification**: `02-05-cli-doctor-PLAN.md`, Task 2, Step B, `httpCrossrefPingProbe` is designed to be `SKIP`-only for Phase 2, explicitly stating it does not import from `tests/` and defers actual wiring to Phase 3. This successfully addresses the layering inversion issue.
    *   **Status**: **FULLY RESOLVED**.

### Summary of Verdicts:

| #     | Short name                                            | Cycle 3 Verdict      |
|-------|-------------------------------------------------------|----------------------|
| 2     | CLI doctor doesn't share capabilities helper          | **FULLY RESOLVED**   |
| 3     | 02-07 stale probe IDs + incompatible parser           | **FULLY RESOLVED**   |
| 4     | Case C wrong paper root                               | **FULLY RESOLVED**   |
| 5     | 02-00 locked-copy DOCT-05 self-contradiction          | **STILL BROKEN**     |
| 6     | 02-08 stale CONTRIBUTING (17 / state.update)          | **PARTIALLY RESOLVED** |
| NEW   | 02-04 self-failing forbidden-string checks            | **STILL BROKEN**     |
| 1     | D-12 lint vs 02-04 contradictions                     | **STILL CLOSED**     |
| 7     | ESLint flat-config block-ordering on new Server()     | **STILL CLOSED**     |
| 8     | http-crossref-ping imports tests/cassettes            | **STILL CLOSED**     |

The plan has made significant progress, fully resolving 3 of the 6 remaining HIGHs. However, 3 HIGHs (two original, one new regression) are still problematic and require further attention. The plan is not yet ready for execution.

> **Synthesis correction (direct repo verification):**
> - Gemini's HIGH #5 STILL BROKEN verdict is **incorrect**. Direct
>   `awk 'NR>=295 && NR<=376' | grep "DOCT-05\|wiring-smoke"` on
>   `02-00-review-cleanup-PLAN.md` returns ZERO matches. The locked-copy body
>   (the markdown content inside the ```markdown ... ``` fence) does NOT contain
>   the literal string "DOCT-05". Gemini confused references to D-04 (the
>   CONTEXT decision number that defers the probe) with DOCT-05 (the requirement
>   ID). The anti-grep at line 423 forbids `wiring-smoke|DOCT-05` and the
>   locked-copy correctly avoids both literals.
> - Gemini's NEW HIGH STILL BROKEN verdict is **incorrect**. Direct
>   `awk 'NR>=384 && NR<=486' | grep -E "loadRuntimeConfig|process\.env\["` on
>   the planned `mcp/resources.ts` body returns ZERO matches. Same for the
>   `mcp/tools.ts` body (lines 650-790). The Step E header comments at
>   `02-04:387-400` paraphrase the forbidden tokens to "the runtime-config
>   loader" and "environment variables by computed key" — Gemini is reading
>   meta-prose (lines 488-501, the explanatory section AFTER the code fence)
>   rather than the in-code-block comments themselves.
> - Gemini's HIGH #6 PARTIAL verdict reflects an incomplete excerpt
>   read; direct grep confirms "16 .md files" at `02-08:160`,
>   `paper_advance_section is idempotent` at `:137`, and `DOCT-01..07` at
>   `:373`. All three fixes landed.

---

## OpenCode Review

I need to review the current state of the plan files to verify the 6 cycle-2 HIGH claims. Let me start by reading the current plan files and checking the git log for the cycle-2 replan commit.

[OpenCode then performed Read-only inspection of the plan files via its tool surface. The session pivoted briefly to a "summarise the conversation so far" guard at one point — likely the harness's auto-summary trigger — and then resumed with the verification work. Final output below. OpenCode emitted a proposed diff to stderr; no source-tree files were modified — verified via `git status --short` immediately after invocation.]

## Cycle 2 Replan Verification — All 6 HIGHs Resolved

Verified against commit `25139d2` ("surgical fixes for 6 remaining HIGHs").

| # | Short Name | Cycle 2 | **Now** | Key Evidence |
|---|-----------|---------|---------|-------------|
| 1 | D-12 lint vs 02-04 contradictions | FULLY RESOLVED | **STAYED CLOSED** | 02-03 D-12 block unchanged; 02-04 still delegates to `loadCapabilityFacts` |
| 2 | CLI doctor doesn't share helper | PARTIALLY RESOLVED | **FULLY RESOLVED** | `runtime-config-presence.ts` now imports `loadCapabilityFacts` instead of `loadRuntimeConfig` directly — `02-05:904-948` |
| 3 | 02-07 stale probe IDs + regex parsing | STILL BROKEN | **FULLY RESOLVED** | Probe id: `probes['contact-email-presence']` — `02-07:690`. Detail: `JSON.parse(detail)` replaces `matchAll` regex — `02-07:695-716` |
| 4 | Case C wrong paper root | STILL BROKEN | **FULLY RESOLVED** | `registerPaperResources(server, paperRoot)` threads root through closure — `02-04:410-427`. `PENSMITH_PAPER_ROOT` env var in `main()` — `02-04:837-848`. Case C spawns scoped client — `02-07:765-800` |
| 5 | 02-00 doctor-output.md self-contradiction | STILL BROKEN | **FULLY RESOLVED** | Line 304 rephrased: "DOCT-05" → "the end-to-end fixture probe". Anti-grep at line 449 now passes since file content no longer contains forbidden substring |
| 6 | 02-08 stale CONTRIBUTING prose | STILL BROKEN | **FULLY RESOLVED** | "17"→"16" — `02-08:160`. "state.update"→"paper_advance_section" — `02-08:137-140`. "DOCT-01..06"→"DOCT-01..07" — `02-08:373` |
| 7 | ESLint flat-config block-ordering | FULLY RESOLVED | **STAYED CLOSED** | 02-03 D-12 block still re-includes bare `NewExpression[callee.name='Server']` selector |
| 8 | http-crossref-ping imports tests/cassettes | FULLY RESOLVED | **STAYED CLOSED** | 02-05 SKIP-only probe; zero `tests/` imports; acceptance grep enforces |
| NEW | 02-04 self-failing forbidden-string checks | NEW HIGH | **FULLY RESOLVED** | Comment tokens paraphrased — `02-04:390-398`, `02-04:459-475`, `02-04:766-773`. Acceptance grep stays quiet |

**Regressions detected:** None. The unchanged files (02-01, 02-02, 02-03, 02-06, 02-09) are consistent.

**Remaining MEDIUM items** (not HIGH, from previous reviews):
1. `02-00:412`: `read()` helper undefined in test template — should use `readFileSync` (OpenCode MEDIUM)
2. `02-05:1251`: Stale prose says `http-crossref-ping.ts` uses "MockAgent through the 02-00 cassette infrastructure" despite being SKIP-only (Codex MEDIUM)

**Verdict: Plan set is ready for execution.** All 6 cycle-2 HIGHs are resolved, no regressions, and the 3 previously-closed HIGHs stayed closed. The remaining MEDIUM items don't block merge.

> **Synthesis correction (direct repo verification):**
> OpenCode declared HIGH #8 STAYED CLOSED, but a closer read by Codex found a
> structurally analogous regression in 02-05's `http-crossref-ping.ts` planned
> source body. The probe source (lines 1036-1064) contains JS comments at lines
> 1040-1041 with the literal substring `tests/` (`"from tests/ in production
> code"` and `"(tests/ is excluded from tsc dist)"`). The acceptance grep at
> `02-05:1266` demands `grep -c "tests/cassettes\|tests/" ... returns 0` on the
> generated file. Direct `awk 'NR>=1036 && NR<=1064' | grep "tests/"` returns
> 2 matches. This is structurally identical to the cycle-2 NEW HIGH in 02-04
> (header comments containing forbidden literals while the acceptance grep
> demanded zero matches). The cycle-2 replan fixed the 02-04 instance by
> paraphrasing forbidden tokens but missed the analogous instance in 02-05.
> Counted as **NEW HIGH (cycle 3)** in the consensus column.

---

## Consensus Summary

Three reviewers plus direct repo inspection converge on **5 of 6 cycle-2 HIGHs
FULLY RESOLVED, plus 1 NEW HIGH regression introduced by the cycle-2 replan**.
Cycle 3's unresolved count: **1**.

The cycle-2 replan successfully landed every surgical text edit it claimed:
- HIGH #2: `02-05` runtime-config-presence delegates to `loadCapabilityFacts` (single composition site shared with mcp/).
- HIGH #3: `02-07` test code uses canonical `contact-email-presence` id and `JSON.parse(detail)`.
- HIGH #4: `02-04` threads `paperRoot` through `registerPaperResources(server, paperRoot)` + `buildServer(paperRoot)` + `PENSMITH_PAPER_ROOT` env; 02-07 Case C spawns a scoped MCP client with the env var.
- HIGH #5: `02-00` locked-copy body (the markdown inside the ```markdown ... ``` fence at lines 295-376) contains zero literal `DOCT-05` / `wiring-smoke` substrings.
- HIGH #6: `02-08` CONTRIBUTING prose updated to `16` workflows, `paper_advance_section`, and `DOCT-01..07`.
- NEW (cycle 2): `02-04` mcp/resources.ts + mcp/tools.ts code-block header comments rephrased so forbidden tokens (`loadRuntimeConfig`, `process.env[`) no longer appear in the generated file source.

Gemini's cycle-3 review re-incurred the same kind of mis-read that put it in the
minority in cycle 2: it confused plan-meta-prose surrounding the code fences
with the in-code-block content that actually flows into the generated source
file. Codex's cycle-3 review was the most rigorous and caught the lone real
NEW HIGH (the analogous `tests/` substring leak in 02-05's
http-crossref-ping.ts body), but inflated two stale-prose findings (#2, #3) to
HIGH severity when the executable paths are correct.

### Agreed Strengths (cycle 3)

- **HIGH #4 fix is structurally clean** (3/3): paperRoot is now a required
  positional argument all the way from `main()` → `buildServer(paperRoot)` →
  `registerPaperResources(server, paperRoot)` → every read-handler closure.
  The 02-07 Case C test exercises this with a dedicated scoped MCP client
  subprocess. Pleasingly defensive.
- **HIGH #2 fix preserves the single-source invariant** (3/3): both tiers
  (mcp resources + tools + 02-05 doctor probe) consume the SAME
  `bin/lib/capabilities.ts::loadCapabilityFacts()` helper. Tier equivalence
  is structural, not parallel.
- **HIGH #3 fix matches reality** (3/3): test code parses what the probe
  emits (JSON), not what the previous draft pretended (key=value pairs).
- **HIGH #6 fix removes stale facts at three sites** (3/3): the verb count,
  tool name, and DOCT requirement range are all current.

### Agreed Concerns (cycle 3)

**NEW HIGH — 02-05 `http-crossref-ping.ts` self-failing `tests/` grep** (Codex
+ direct repo evidence; OpenCode and Gemini missed it):

Source body at `02-05:1036-1064` contains two JS comments referencing
`tests/` ("dynamic import from tests/ in production code" and "tests/ is
excluded from tsc dist"). The acceptance grep at `02-05:1266` is:
```
grep -c "tests/cassettes\|tests/" bin/lib/doctor/probes/http-crossref-ping.ts
returns 0
```
This grep will match 2 on the generated file and the plan's own acceptance
gate will fail. Structurally identical to the cycle-2 NEW HIGH in 02-04
mcp/resources.ts which the replan fixed by paraphrasing.

**Fix:** rephrase the two JS comments in the planned probe body to avoid the
literal substring `tests/`. Suggested replacement (preserves meaning,
removes the literal):
- "from tests/ in production code" → "from the test cassette directory in production code"
- "(tests/ is excluded from tsc dist)" → "(the test directory is excluded from tsc dist)"

OR widen the acceptance grep so it only fires on `import` / `require`
statements, not on bare comment text — e.g.,
`grep -cE "(import|require).*tests/" ...`.

### Cycle-3-only MEDIUM findings (not blocking)

- **02-05:107-110 and 545-553** (Codex MEDIUM): the probe-behavior narrative
  still says "calls `loadRuntimeConfig()`" and "process.env[apiKeyEnv]" as if
  the probe re-implements env presence directly, even though the actual code
  block at 904-947 delegates to `loadCapabilityFacts`. Executable path is
  correct; narrative is stale. An executor reading prose-first could be
  confused. Recommend updating the prose to say "delegates to
  `loadCapabilityFacts()` and re-keys snake_case providers back into the
  doctor's `{name, apiKeyEnv, present}` JSON shape."
- **02-07:180, 196, 556** (Codex MEDIUM): the interfaces section JSON skeleton
  and Case A behavior description still reference `'http-contact-email'` as
  the probe id. Test code at 687-718 uses the correct
  `'contact-email-presence'`. Stale narrative. Recommend three find/replace
  edits in the descriptive prose.
- **02-05:1251** (Codex MEDIUM, carry-over from cycle 2): self-check claim
  "http-crossref-ping.ts never touches the live network — only MockAgent
  through the 02-00 cassette infrastructure" contradicts the SKIP-only
  design. Recommend updating to "the probe is structurally SKIP in Phase 2;
  Phase 3 will wire MockAgent via the production-tree chokepoint."
- **02-00:412** (OpenCode MEDIUM, carry-over from cycle 2): test template uses
  undefined `read()` helper instead of `readFileSync`. Trivial inline fix.

### Divergent Views

- **HIGH #5 verdict.** Gemini scored STILL BROKEN; Codex + OpenCode + direct
  repo evidence scored FULLY RESOLVED. Direct verification:
  `awk 'NR>=295 && NR<=376' 02-00-review-cleanup-PLAN.md | grep -E "DOCT-05|wiring-smoke"`
  returns ZERO matches. Locked-copy body is clean. Gemini misread
  surrounding meta-prose as locked-copy body. Consensus = FULLY RESOLVED.
- **NEW HIGH (02-04 grep) verdict.** Same shape: Gemini scored STILL BROKEN;
  Codex + OpenCode + direct grep scored FULLY RESOLVED. Direct verification
  on the mcp/resources.ts (384-486) and mcp/tools.ts (650-790) code blocks
  shows zero `loadRuntimeConfig` and zero `process.env[` literals. Gemini
  misread the meta-prose at 488-501. Consensus = FULLY RESOLVED.
- **HIGH #2 / #3 stale-prose severity.** Codex scored both PARTIAL on the
  basis that stale plan-narrative could re-introduce bugs in future passes.
  Gemini + OpenCode scored both FULLY RESOLVED based on the executable code
  blocks being correct. Synthesis: executable correctness is enough to
  declare these RESOLVED at the HIGH-severity level; the stale narrative
  is a MEDIUM doc-hygiene issue, not a HIGH execution blocker.
- **NEW cycle-3 regression detection.** Only Codex caught the 02-05
  http-crossref-ping `tests/` regression. OpenCode and Gemini both missed
  it (they accepted the cycle-2 #8 closure as if it carried forward
  unchanged, but the same anti-pattern silently re-appeared in 02-05's body).
  Direct repo verification confirms Codex is correct. Counted as the sole
  NEW HIGH in cycle 3's unresolved count.

### Recommended Next Steps (cycle 4 / for /gsd-plan-phase --reviews)

Cycle 4 should:

1. **Fix the 02-05 self-failing `tests/` grep** (only HIGH remaining):
   rephrase the two JS comments in the planned `http-crossref-ping.ts` body
   at `02-05:1040-1041` to avoid the literal substring `tests/`, OR widen
   the acceptance grep at `02-05:1266` so it fires only on
   `import` / `require` / `await import` lines containing `tests/`.
2. **(Optional cleanup, MEDIUM):** sync stale narrative prose in `02-05`
   (lines 107-110, 545-553, 1251) and `02-07` (lines 180, 196, 556) with
   the implementation code blocks. Three small find/replace edits in each
   file. Reduces future-cycle misreading risk.
3. **(Optional cleanup, MEDIUM):** fix the `read()` → `readFileSync` typo at
   `02-00:412`.

After step 1 lands, the plan set should be at zero unresolved HIGHs and ready
for execution.

To incorporate this feedback into planning:

```
/gsd-plan-phase 2 --reviews
```
