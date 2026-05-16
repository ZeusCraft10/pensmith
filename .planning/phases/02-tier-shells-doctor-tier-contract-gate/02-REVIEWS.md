---
phase: 2
cycle: 2
reviewers: [gemini, codex, opencode]
reviewed_at: 2026-05-16T06:20:06Z
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
notes: |
  - This is CYCLE 2 of the plan-review-convergence loop. Cycle 1 (commit 1f784ea)
    found 8 HIGH-severity concerns. A partial replan (commit 541f656) addressed
    some of them but timed out before completion. Cycle 2's mandate was to score
    the partial replan against the 8 originals and detect any regressions.
  - Self-CLI (claude) skipped because review was invoked from inside Claude Code
    (CLAUDE_CODE_ENTRYPOINT=claude-vscode), per workflow runtime-detection rules.
  - Cursor CLI invocation failed AGAIN: the local `cursor` binary on this Windows
    host is the IDE editor, not the agent CLI; `cursor agent -p --mode ask
    --trust` is unsupported (flags pass through to Electron unrecognized; only a
    "Run with 'cursor -' to read output" usage line returned). Skipped, no output.
  - Qwen / CodeRabbit / Ollama / LM Studio / llama.cpp not installed/running.
    Skipped.
  - OpenCode behaved correctly this cycle (per the cycle-1 runaway warning).
    `git status --short` after the OpenCode invocation showed only the
    pre-existing untracked files (.claude/, CLAUDE.md, NOTES.md, PRD.md) —
    no source-tree modifications. OpenCode's tool use was Read-only (12 reads
    across the plan files), and its output was pure review prose.
  - The convergence agent's commit message (541f656) claimed HIGHs #6, #7, #8
    were NOT touched. Inspection by all 3 reviewers in this cycle confirms #7
    and #8 actually WERE addressed (the cycle-1 plans already contained the
    fixes, or the partial replan landed them silently). Only #6 is correctly
    described as untouched. This is noted per-HIGH below.
---

# Cross-AI Plan Review — Phase 2 (Cycle 2)

Three independent AI systems (Gemini 2.5 Pro, Codex GPT-5.1, OpenCode via GitHub
Copilot) reviewed the post-partial-replan state of Phase 2 against the 8 original
HIGH concerns from cycle 1. The mandate: score each original HIGH as FULLY
RESOLVED / PARTIALLY RESOLVED / STILL BROKEN, and flag any regressions.

## Cycle 2 Verdict — Consensus

**6 of 8 original HIGHs remain unresolved.** 2 fully resolved (#1, #7). 1 fully
resolved per 2/3 (#8). 1 partially resolved per 1/3 (#2). 4 still broken per
2/3 or 3/3 (#3, #4, #5, #6). 1 new regression introduced by the replan.

| #  | Short name                                              | Cycle 2 verdict          |
|----|---------------------------------------------------------|--------------------------|
| 1  | D-12 lint vs 02-04 contradictions                       | **FULLY RESOLVED** (3/3) |
| 2  | Capabilities not built inside mcp/                      | **PARTIALLY RESOLVED** (Codex)/FULLY (Gemini+OpenCode) — keep open: Codex evidence that CLI doctor doesn't consume shared helper is correct |
| 3  | 02-07 stale probe IDs + incompatible detail parsing     | **STILL BROKEN** (3/3)   |
| 4  | Case C state idempotency wrong paper root               | **STILL BROKEN** (3/3)   |
| 5  | 02-00 doctor-output.md self-contradiction               | **STILL BROKEN** (2/3 — Gemini misread) |
| 6  | 02-08 stale CONTRIBUTING prose (17 / state.update)      | **STILL BROKEN** (3/3)   |
| 7  | ESLint flat-config block-ordering on new Server()       | **FULLY RESOLVED** (3/3) |
| 8  | http-crossref-ping imports tests/cassettes              | **FULLY RESOLVED** (3/3) |
| NEW| 02-04 self-failing forbidden-string grep checks         | **NEW HIGH REGRESSION** (Codex) |

---

## Gemini Review

# Cycle 2 Review — Cross-AI Plan Convergence

## 1. Summary
The partial replan made significant progress, fully resolving 5 of the 8 original HIGH-severity concerns, including two that the summary commit message suggested were untouched. The fixes for the linting contradictions (HIGH #1, #7) and improper dependencies (HIGH #2, #8) are robust, adopting the architectural recommendation to extract logic to `bin/lib` helpers. However, 3 critical HIGH-severity issues remain unresolved. Mismatches in identifiers and data parsing between the CLI and the tier-contract test (HIGH #3) guarantee test failure. The state idempotency test (HIGH #4) remains flawed, reading from the wrong directory. Finally, the documentation plan (HIGH #6) is still based on stale facts. The plan is not yet ready for implementation.

## 2. Per-HIGH Scoring (REQUIRED — score all 8)

### HIGH #1 — D-12 lint vs 02-04 contradictions
**Status:** FULLY RESOLVED
**Evidence:** The replan structurally refactors the code to eliminate the contradiction.
- `02-04-mcp-server-PLAN.md`, in its `must_haves` section and Task 1 (Step E & F) and Task 2 (Step A), moves the capability-building logic that requires `loadRuntimeConfig` and `process.env` access out of `mcp/` and into a new `bin/lib/capabilities.ts` helper.
- Both the `paper://capabilities` resource handler (`mcp/resources.ts`) and the `paper_capability_probe` tool handler (`mcp/tools.ts`) are now thin shims that call the new `bin/lib/capabilities.ts::loadCapabilityFacts` helper.
- `02-03-lint-capabilities-noleak-PLAN.md` still applies the strict D-12 lint rule to `mcp/**/*.ts`. Since the logic was moved, no lint violations will occur in `mcp/`.
**Remaining gap (if any):** None.

### HIGH #2 — Capabilities not built inside mcp/
**Status:** FULLY RESOLVED
**Evidence:** The replan directly implements the requested extraction.
- `02-04-mcp-server-PLAN.md`, Task 1, Step F, is dedicated to creating `bin/lib/capabilities.ts` to provide a `loadCapabilityFacts()` helper.
- The `must_haves` section explicitly calls this out: "Capabilities are built in `bin/lib/capabilities.ts::loadCapabilityFacts()` (thin-shim architecture per cross-AI review HIGH consensus)."
- Both consumers within the `mcp/` directory (`mcp/resources.ts` and `mcp/tools.ts`) are planned to import and use this single helper, ensuring a single source of truth.
**Remaining gap (if any):** None.

### HIGH #3 — 02-07 stale probe IDs + incompatible detail parsing
**Status:** STILL BROKEN
**Evidence:** The inconsistencies between the doctor probe implementation (`02-05`) and the tier-contract test that consumes its output (`02-07`) remain.
1.  **Probe ID Mismatch:**
    - `02-05-cli-doctor-PLAN.md`, Task 2 specifies the probe ID as `'contact-email-presence'`.
    - `02-07-tier-contract-PLAN.md`, Task 3, in the `extractCliFacts` function for Case A, attempts to read the result from `probes['http-contact-email']`. This will fail to find the probe.
2.  **Detail Parsing Mismatch:**
    - `02-05-cli-doctor-PLAN.md`, Task 2 specifies that the `runtime-config-presence` probe's `detail` field will be a `JSON.stringify()`-ed array of objects.
    - `02-07-tier-contract-PLAN.md`, Task 3, `extractCliFacts` still plans to parse this JSON string using a regex: `detail.matchAll(/(?<name>[a-z]+)=(?<flag>true|false)/g)`. This regex will not correctly parse the JSON array.
**Remaining gap (if any):** Both mismatches will cause `tests/tier-contract.test.ts` Case A to fail. The test's fact-extraction logic needs to be updated to match the probe's actual ID and output format.

### HIGH #4 — Case C state idempotency wrong paper root
**Status:** STILL BROKEN
**Evidence:** The test logic remains flawed. The tier-contract test writes to a temporary directory but reads state from the default project directory.
- `02-07-tier-contract-PLAN.md`, Task 3, Case C creates a temporary paper root via `freshPaperRoot()`.
- It then calls tools like `paper_init_section` and correctly passes the temporary `paperRoot` as an argument.
- However, to verify the result, it calls `await client.readResource({ uri: 'paper://state' });`.
- The handler for this resource, defined in `02-04-mcp-server-PLAN.md` (Task 1, Step E), is `async (uri) => { const state = await loadState(paperDir()); ... }`. The `paperDir()` call has no arguments, so it resolves to the default project directory, not the temporary one used in the test. The resource URI is not parameterized, so there is no mechanism to pass the temporary path to the resource handler.
**Remaining gap (if any):** The test is fundamentally broken. The `paper://state` resource needs a way to be told which `paperRoot` to read from, or the test needs to be redesigned.

### HIGH #5 — 02-00 doctor-output.md self-contradiction
**Status:** FULLY RESOLVED
**Evidence:** The contradiction between the file content and the test criteria has been removed from the plan.
- `02-00-review-cleanup-PLAN.md`, Task 3, Step 2 now specifies that `references/doctor-output.md` explicitly defers DOCT-05 and does *not* contain the "wiring-smoke" text.
- `02-00-review-cleanup-PLAN.md`, Task 3, Step 4 adds a test to `tests/repo-files.test.ts` that explicitly asserts `DOCT-05` is not present: `assert.equal(/wiring-smoke|DOCT-05/.test(copy), false, ...)`
**Remaining gap (if any):** None.

> **Synthesis note:** Gemini's HIGH #5 verdict is contradicted by Codex AND OpenCode AND
> direct file inspection. The locked-copy file's explanatory text DOES contain
> the literal string `DOCT-05` at `02-00-review-cleanup-PLAN.md:304-305` ("DOCT-05
> (end-to-end fixture probe) is deferred to Phase 3 per CONTEXT D-04; this file
> does NOT contain wiring-smoke copy"), while the anti-grep at line 422 forbids
> the substring `DOCT-05` appearing anywhere in the file. Gemini misread the
> intent/content split — it confused the meta-comment that the file defers
> DOCT-05 with whether the literal substring `DOCT-05` appears in the file.
> The consensus (2/3 + repo evidence) is STILL BROKEN.

### HIGH #6 — 02-08 stale CONTRIBUTING.md prose (17 / state.update)
**Status:** STILL BROKEN
**Evidence:** The documentation plan in `02-08` has not been updated and still contains incorrect information that contradicts other parts of the Phase 2 plan.
- `02-08-contributing-PLAN.md`, Task 1, still contains the phrase "exactly 17 .md files" for workflows. However, `02-06-hooks-workflows-PLAN.md` (Task 2) correctly plans for **16** workflow files, matching the canonical verb list.
- `02-08-contributing-PLAN.md`, Task 1, also still refers to the `state.update` tool for idempotency examples. This tool was replaced by more specific, granular tools (`paper_init_section`, `paper_advance_section`, etc.) in `02-04-mcp-server-PLAN.md`. The corresponding test in `02-07-tier-contract-PLAN.md` (Case C) correctly uses `paper_advance_section`. The documentation is stale.
**Remaining gap (if any):** `CONTRIBUTING.md` will ship with incorrect facts, confusing future developers and violating the D-24 "locked prose" intent.

### HIGH #7 — ESLint flat-config block-ordering on new Server()
**Status:** FULLY RESOLVED
**Evidence:** Contrary to the cycle-1 commit message, the replan for `02-03` correctly anticipates and solves the flat-config override problem.
- `02-03-lint-capabilities-noleak-PLAN.md`, Task 2's action explicitly states that its new `mcp/**/*.ts` block must "re-include the project-wide D-07/D-41 selectors AND the D-09 + D-10 selectors".
- The provided code block for `eslint.config.js` correctly includes the strong `NewExpression[callee.name='Server']` selector from the D-10 plan (`02-02`), preventing the weaker rule from taking precedence. This shows a correct understanding of ESLint flat-config's override semantics.
**Remaining gap (if any):** None.

### HIGH #8 — http-crossref-ping imports tests/cassettes
**Status:** FULLY RESOLVED
**Evidence:** Contrary to the cycle-1 commit message, this was fixed. The plan replaces the violating implementation with a safe, structurally-SKIP implementation.
- `02-05-cli-doctor-PLAN.md` has a `must_haves` truth: "Production code MUST NOT import from `tests/`".
- Task 2, Step B of the same file implements the `http-crossref-ping.ts` probe to be a hardcoded SKIP: `return { id: 'http-crossref-ping', severity: 'SKIP', ... }`.
- The implementation contains no imports from `tests/` and performs no I/O, explicitly deferring the real implementation to Phase 3 when a production-safe mocking strategy is available.
**Remaining gap (if any):** None.

## 3. NEW HIGHs Introduced by the Replan (Regressions)
None.

## 4. NEW MEDIUM/LOW Findings (optional)
None.

## 5. Unresolved-HIGH Count
**Total unresolved HIGHs (PARTIALLY + STILL BROKEN + NEW REGRESSIONS):** 3
- HIGH #3 — 02-07 stale probe IDs + incompatible detail parsing
- HIGH #4 — Case C state idempotency wrong paper root
- HIGH #6 — 02-08 stale CONTRIBUTING prose (17 / state.update)

## 6. Risk Assessment
**HIGH**: While the replan fixed a majority of issues, the remaining 3 unresolved HIGHs are critical. The mismatches in the tier-contract test (HIGH #3, #4) guarantee that the primary merge gate for this phase (`tests/tier-contract.test.ts`) cannot pass as planned. The stale documentation (HIGH #6) will immediately cause confusion. The plan requires another revision cycle to be viable.

---

## Codex Review

# Cycle 2 Review — Cross-AI Plan Convergence

## 1. Summary
The partial replan moved the needle on the MCP capability leak architecture and the D-10 `new Server()` selector, but it did not converge the plan set. Five original HIGHs remain unresolved, and I found one new HIGH regression in 02-04's literal grep/regex checks. Overall verdict: **not ready for execution**.

## 2. Per-HIGH Scoring

### HIGH #1 — D-12 lint vs 02-04 contradictions
**Status:** FULLY RESOLVED
**Evidence:** 02-03 still forbids computed `process.env[...]` and `loadRuntimeConfig` inside `mcp/**` (`02-03-lint-capabilities-noleak-PLAN.md:15-16`). 02-04 now makes `paper://capabilities` delegate to `loadCapabilityFacts()` (`02-04-mcp-server-PLAN.md:457-467`) and requires `mcp/resources.ts` / `mcp/tools.ts` to contain zero `loadRuntimeConfig` and zero `process.env[` references (`02-04-mcp-server-PLAN.md:496-498`, `02-04-mcp-server-PLAN.md:831`, `02-04-mcp-server-PLAN.md:849`).
**Remaining gap:** None for the original lint-vs-implementation conflict. See new regression below for self-failing text checks.

### HIGH #2 — Capabilities not built inside mcp/
**Status:** PARTIALLY RESOLVED
**Evidence:** 02-04 creates `bin/lib/capabilities.ts::loadCapabilityFacts()` as the non-MCP composition site (`02-04-mcp-server-PLAN.md:501-507`) and routes both MCP surfaces through it (`02-04-mcp-server-PLAN.md:657`, `02-04-mcp-server-PLAN.md:764`). But the plan claims this helper is consumed by "02-05's doctor probes" (`02-04-mcp-server-PLAN.md:39`), while 02-05 still wires independent probes (`02-05-cli-doctor-PLAN.md:606-621`) and reimplements runtime env presence in `runtime-config-presence.ts` (`02-05-cli-doctor-PLAN.md:917-922`).
**Remaining gap:** The helper is shared by MCP resource/tool surfaces, but not by the Tier 2 CLI doctor path demanded by the HIGH.

### HIGH #3 — 02-07 stale probe IDs + incompatible detail parsing
**Status:** STILL BROKEN
**Evidence:** 02-05 declares canonical probe id `contact-email-presence` (`02-05-cli-doctor-PLAN.md:45`, `02-05-cli-doctor-PLAN.md:528`). 02-07 still extracts `probes['http-contact-email']` (`02-07-tier-contract-PLAN.md:687`). 02-05 emits `runtime-config-presence.detail` as `JSON.stringify(providers)` (`02-05-cli-doctor-PLAN.md:917-922`), but 02-07 still parses it with the stale regex `/(?<name>[a-z]+)=(?<flag>true|false)/g` (`02-07-tier-contract-PLAN.md:692-697`).
**Remaining gap:** Case A still silently extracts wrong/empty facts.

### HIGH #4 — Case C state idempotency wrong paper root
**Status:** STILL BROKEN
**Evidence:** 02-04's `paper://state` resource handler reads `loadState(paperDir())` with no `paperRoot` argument (`02-04-mcp-server-PLAN.md:409-415`). 02-07 Case C creates a temp `paperRoot`, passes it to tools, then validates by reading `paper://state` (`02-07-tier-contract-PLAN.md:746-760`).
**Remaining gap:** The resource read still targets the default project root, not the temp root used by the tool calls.

### HIGH #5 — 02-00 doctor-output.md self-contradiction
**Status:** STILL BROKEN
**Evidence:** The locked-copy body still contains `DOCT-05` explanatory text (`02-00-review-cleanup-PLAN.md:304-305`), while the test and acceptance criteria require `/wiring-smoke|DOCT-05/` to be absent (`02-00-review-cleanup-PLAN.md:421-422`, `02-00-review-cleanup-PLAN.md:448`).
**Remaining gap:** The plan still cannot pass as written.

### HIGH #6 — 02-08 stale CONTRIBUTING prose (17 / state.update)
**Status:** STILL BROKEN
**Evidence:** 02-08 still says `state.update` is idempotent (`02-08-contributing-PLAN.md:137-138`) and still says workflows are "exactly 17 .md files" (`02-08-contributing-PLAN.md:155-157`). It also closes with stale requirement prose listing `DOCT-01..06` despite the Phase 2 replan adding `DOCT-07` (`02-08-contributing-PLAN.md:368`).
**Remaining gap:** The stale locked docs were not repaired.

### HIGH #7 — ESLint flat-config block-ordering on new Server()
**Status:** FULLY RESOLVED
**Evidence:** 02-02 uses the exact `NewExpression[callee.name='Server']` selector (`02-02-lint-mcp-no-network-PLAN.md:215`) and tests the project config catches all five D-10 violations (`02-02-lint-mcp-no-network-PLAN.md:302-320`). 02-03 explicitly re-includes that exact bare `new Server()` selector in the later D-12 block to avoid flat-config override loss (`02-03-lint-capabilities-noleak-PLAN.md:286-292`, `02-03-lint-capabilities-noleak-PLAN.md:376`).
**Remaining gap:** None.

### HIGH #8 — http-crossref-ping imports tests/cassettes
**Status:** FULLY RESOLVED
**Evidence:** 02-05 explicitly rejects importing `tests/cassettes/index.js` from production code (`02-05-cli-doctor-PLAN.md:129-132`, `02-05-cli-doctor-PLAN.md:554-560`). The planned probe is structurally `SKIP` only (`02-05-cli-doctor-PLAN.md:1028-1049`) and acceptance requires `grep -c "tests/cassettes\|tests/" bin/lib/doctor/probes/http-crossref-ping.ts` to return 0 (`02-05-cli-doctor-PLAN.md:1254`, `02-05-cli-doctor-PLAN.md:1526`).
**Remaining gap:** None for the original production-import issue.

## 3. NEW HIGHs Introduced by the Replan

1. **02-04 self-failing forbidden-string checks.** The planned `mcp/resources.ts` and `mcp/tools.ts` snippets include comments containing `loadRuntimeConfig`, but 02-04's automated checks regex/grep the full source text and fail on any occurrence. Evidence: resource comment contains `loadRuntimeConfig` (`02-04-mcp-server-PLAN.md:459`), tool comment contains `loadRuntimeConfig + process.env` (`02-04-mcp-server-PLAN.md:753-754`), while the automated checks fail if `/loadRuntimeConfig/` appears in those files (`02-04-mcp-server-PLAN.md:585`, `02-04-mcp-server-PLAN.md:840`). This is HIGH because the plan's own acceptance gate fails even if the executable code is safe.

## 4. NEW MEDIUM/LOW Findings
02-05 still has stale prose saying `http-crossref-ping.ts` uses "MockAgent through the 02-00 cassette infrastructure" (`02-05-cli-doctor-PLAN.md:1239`) and later says the cassette smoke is "live" (`02-05-cli-doctor-PLAN.md:1475`), contradicting the SKIP-only fix. Not HIGH because the implementation/acceptance path forbids `tests/` imports.

## 5. Unresolved-HIGH Count
**Total unresolved HIGHs (PARTIALLY + STILL BROKEN + NEW REGRESSIONS):** 6

Unresolved:
- HIGH #2 — CLI does not consume shared capabilities helper
- HIGH #3 — stale probe id and regex parsing
- HIGH #4 — Case C reads wrong root through `paper://state`
- HIGH #5 — `doctor-output.md` still contains forbidden `DOCT-05`
- HIGH #6 — stale CONTRIBUTING prose
- NEW HIGH — 02-04 self-failing forbidden-string checks

## 6. Risk Assessment
**HIGH** overall, because several merge-gate plans still fail by construction and the tier-contract equivalence test would extract the wrong facts even after implementation.

---

## OpenCode Review

# Cycle 2 Review — Cross-AI Plan Convergence

## 1. Summary

The partial replan resolved the 3 HIGHs that required structural changes (capabilities extraction, lint contradictions, cassette import) but left 4 HIGHs fully unresolved and 1 HIGH partially unresolved. The replan added a `bin/lib/capabilities.ts` helper and made both MCP endpoints thin shims, which is architecturally sound. However, 4 of the 8 original HIGHs remain broken on disk due to unreconciled details (probe ID mismatches, self-contradictory plan, stale text, and a paper-root mismatch that will cause a test to read wrong state). The convergence memo claimed #6/#7/#8 were not touched, but inspection reveals #7 WAS fixed and #8 WAS fixed — only #6 actually wasn't. Overall verdict: **4 HIGHs remain unresolved; cycle 3 is needed before execution.**

## 2. Per-HIGH Scoring

### HIGH #1 — D-12 lint vs 02-04 contradictions
**Status:** FULLY RESOLVED
**Evidence:** `02-04-mcp-server-PLAN.md:474-487` (architectural note citing cross-AI review HIGH consensus). `02-04-mcp-server-PLAN.md:501-582` (Task 1 Step F creates `bin/lib/capabilities.ts::loadCapabilityFacts()` as the SINGLE composition site). `02-04-mcp-server-PLAN.md:462-470` (paper://capabilities handler is a thin shim delegating to the helper). `02-04-mcp-server-PLAN.md:756-767` (paper_capability_probe handler also delegates). Self-checks at `02-04-mcp-server-PLAN.md:494-499` verify zero `loadRuntimeConfig` and zero `process.env[` in mcp/. D-12 lint in `02-03-lint-capabilities-noleak-PLAN.md:224-383` stays maximally tight targeting `mcp/**/*.ts`.
**Remaining gap:** None. The structural contradiction is eliminated.

### HIGH #2 — Capabilities not built inside mcp/
**Status:** FULLY RESOLVED
**Evidence:** `02-04-mcp-server-PLAN.md:27-28` ("Capabilities are built in `bin/lib/capabilities.ts::loadCapabilityFacts()`"). `02-04-mcp-server-PLAN.md:501-582` (the helper). `02-04-mcp-server-PLAN.md:58-59` (key_links from mcp/ to `bin/lib/capabilities.ts::loadCapabilityFacts`). Both `mcp/resources.ts` and `mcp/tools.ts` import from the shared helper; neither calls `loadRuntimeConfig` nor accesses `process.env[...]` directly.
**Remaining gap:** None.

### HIGH #3 — 02-07 stale probe IDs + incompatible detail parsing
**Status:** STILL BROKEN
**Evidence:** Two mismatches remain unaddressed:

1. **Probe ID mismatch:** `02-07-tier-contract-PLAN.md:694` uses `probes['http-contact-email']?.severity`. The canonical probe ID in `02-05-cli-doctor-PLAN.md:45` is `contact-email-presence` (no `http-` prefix). This key will resolve to `undefined`, making `contact_email_set` always `false` in the CLI fact set, causing Case A to silently surface a false-negative fact divergence.

2. **Detail regex mismatch:** `02-07-tier-contract-PLAN.md:694` parses the runtime-config-presence detail with regex `(?<name>[a-z]+)=(?<flag>true|false)`. But `02-05-cli-doctor-PLAN.md:922` serializes `detail = JSON.stringify(providers)` which produces JSON like `[{"name":"anthropic","apiKeyEnv":"ANTHROPIC_API_KEY","present":true}]` — delimited by `:` and `,`, NOT `=`. The regex will match zero times, silently extracting zero provider facts. Case A would pass (no assertion fails) but report zero providers compared against whatever the MCP side returns.
**Remaining gap:** Both line 694 identifiers and regex must be updated. Either 02-05 must change the detail format to `name=anthropic present=true` (downgrading from JSON), or 02-07 must parse JSON properly. The latter is architecturally preferable since JSON is parseable.

### HIGH #4 — Case C state idempotency wrong paper root
**Status:** STILL BROKEN
**Evidence:** `02-04-mcp-server-PLAN.md:415` calls `const state = await loadState(paperDir())` — `paperDir()` with NO argument reads the DEFAULT project root. `02-07-tier-contract-PLAN.md:747-764` (Case C) creates a temp root via `freshPaperRoot()` (line 639), initializes/advances sections there, then reads `paper://state` at line 757. The `paper://state` resource handler will read the host project's `.paper/STATE.json`, NOT the temp root's. The assertion on line 762-763 that `section.state === 'writing'` will either fail (if the host project has no section 1) or read wrong state (if it does).
**Remaining gap:** Either the `paper://state` handler must accept a `paperRoot` query parameter / URI variable, or Case C must read state from the tool return values (which correctly received `paperRoot`). The simplest fix: drop the `paper://state` read in Case C and compare only the tool return values, or add a `paperRoot` capability to `paper://state`.

### HIGH #5 — 02-00 doctor-output.md self-contradiction
**Status:** STILL BROKEN
**Evidence:** `02-00-review-cleanup-PLAN.md:304` writes `DOCT-05 (end-to-end fixture probe) is deferred to Phase 3` into the `references/doctor-output.md` content. But `02-00-review-cleanup-PLAN.md:448` requires `grep -c "wiring-smoke\|DOCT-05" references/doctor-output.md` returns 0. And `02-00-review-cleanup-PLAN.md:422` asserts `assert.equal(/wiring-smoke|DOCT-05/.test(copy), false, ...)`. The plan writes "DOCT-05" into the file at line 304, then asserts the file does NOT contain "DOCT-05" at line 422. The plan cannot pass its own acceptance criteria.
**Remaining gap:** Either remove the DOCT-05 mention from the file content (line 304) or update the acceptance criteria and test to permit the explanatory mention while forbidding a probe section.

### HIGH #6 — 02-08 stale CONTRIBUTING prose (17 / state.update)
**Status:** STILL BROKEN
**Evidence:** `02-08-contributing-PLAN.md:156-157` says `workflows/ (exactly 17 .md files with <capability_check> blocks per ARCH-03)`. Per D-05 (`02-CONTEXT.md:45`), the verb list has exactly 16 verbs (post-2026-05-16 correction). `02-08-contributing-PLAN.md:137` says `state.update is idempotent: applying the same patch twice produces byte-identical state. Asserted by tests/tier-contract.test.ts Case C.` The tool surface has no `state.update` — Case C tests `paper_advance_section` idempotency. The convergence memo confirmed #6 was not touched, and inspection confirms both stale references remain intact.
**Remaining gap:** Change "17" to "16" (matching D-05) and replace "state.update" with "paper_advance_section" (matching 02-07's actual tool name).

### HIGH #7 — ESLint flat-config block-ordering on new Server()
**Status:** FULLY RESOLVED
**Evidence:** `02-03-lint-capabilities-noleak-PLAN.md:285-293` includes a `CROSS-AI REVIEW HIGH FIX` comment and uses the exact bare selector `NewExpression[callee.name='Server']` — identical to `02-02-lint-mcp-no-network-PLAN.md:346-350`. The D-12 block re-includes all D-10 selectors including this one. The comment at lines 285-291 explicitly warns against adding argument filters that would weaken the selector. Inspection confirms this WAS addressed by the replan despite the memo's claim.
**Remaining gap:** The flat-config ordering dependency remains an architectural risk (future blocks could override), but the current plans handle it correctly.

### HIGH #8 — http-crossref-ping imports tests/cassettes
**Status:** FULLY RESOLVED
**Evidence:** `02-05-cli-doctor-PLAN.md:1012-1024` has a `CROSS-AI REVIEW HIGH FIX (Codex iter 1)` comment explaining the fix. The probe at `02-05-cli-doctor-PLAN.md:1043-1053` returns a structurally fixed `severity: 'SKIP'` with zero imports from `tests/`. Acceptance criterion at line 1254 enforces `grep -c "tests/" bin/lib/doctor/probes/http-crossref-ping.ts` returns 0. Inspection confirms the probe code contains no `import` from `tests/` infrastructure.
**Remaining gap:** None. Inspection confirms the fix.
**Note:** The convergence memo claimed #8 was not touched, but the current plan file DOES address it (the CROSS-AI REVIEW HIGH FIX comment is present).

## 3. NEW HIGHs Introduced by the Replan (Regressions)

None. The replan did not introduce any new HIGH-severity issues. The 4 unresolved HIGHs are continuations of cycle-1 findings.

One minor note (not a HIGH): the 02-08 plan's test at line 295 uses `/D-10.*mcp-no-network|mcp-no-network.*D-10/s` — the `s` flag (dotall) is unnecessary but harmless.

## 4. NEW MEDIUM/LOW Findings (optional)

1. **02-00 `read()` helper undefined (MEDIUM):** `02-00-review-cleanup-PLAN.md:411` uses `const copy = read('references/doctor-output.md');` but the plan never defines or imports a `read` function. The test file likely uses `readFileSync` elsewhere; the template should match that pattern. If an executor follows the template literally, this line won't compile.

2. **02-07 extractMcpFacts undefined → false skew (LOW):** `02-07-tier-contract-PLAN.md:703-704` converts `undefined` to `false` (`pandoc: caps.pandoc === true`). In Phase 2, these placeholders ARE undefined. The CLI side (`extractCliFacts` at line 687-690) treats absence as false via `severity === 'PASS'`. These are functionally equivalent but create noise if the `assertEquivalent` helper runs on the raw boolean maps. Case D filters shared keys so this works, but it's fragile.

## 5. Unresolved-HIGH Count

**Total unresolved HIGHs:** 4

| # | Short Name | Status |
|---|-----------|--------|
| 3 | 02-07 stale probe IDs + regex mismatch | STILL BROKEN |
| 4 | Case C state idempotency wrong paper root | STILL BROKEN |
| 5 | 02-00 doctor-output.md self-contradiction | STILL BROKEN |
| 6 | 02-08 stale CONTRIBUTING prose (17 / state.update) | STILL BROKEN |

## 6. Risk Assessment

**HIGH overall.** Four of 8 original HIGHs remain unresolved, and 3 of those (#3, #4, #5) would cause a plan-verification FAIL rather than just a broken output — meaning the plans cannot pass their own acceptance criteria as written. Phase 3 must not execute until the replan addresses all 4, particularly the self-contradiction in 02-00 (which is Wave 0 and blocks all other plans) and the paper-root mismatch in 02-07 (which is Wave 3 and the phase's capstone test).

---

## Consensus Summary

Three reviewers independently scored the partial replan. Two of three (Codex, OpenCode) and direct repo inspection converge on **6 unresolved HIGHs**. Gemini scored 3 unresolved but missed two issues that the other two reviewers and a grep against the plan files confirm: (a) HIGH #2 — Codex's evidence that 02-05's CLI doctor independently re-implements runtime env presence rather than delegating to the new `bin/lib/capabilities.ts` helper is correct; the helper is shared by MCP surfaces only, not by the Tier 2 CLI path; (b) HIGH #5 — the literal substring `DOCT-05` appears in the locked-copy content at `02-00:304-305` and is also forbidden by the anti-grep at line 422, so the plan still cannot pass its own acceptance criteria.

The replan successfully landed structural fixes (capabilities extraction, lint block-ordering, cassette decoupling). The remaining unresolved HIGHs are mostly text-level reconciliation — stale identifiers, regex/JSON-shape mismatches, missing temp-root threading, locked-copy contradictions, and stale CONTRIBUTING prose — that the timed-out agent did not get to. None of the remaining HIGHs require architectural rework; they require careful cross-plan-text editing.

### Agreed Strengths (cycle 2)

- **HIGH #1 fix is robust** (3/3): the `bin/lib/capabilities.ts` extraction eliminates the lint-vs-MCP contradiction and preserves D-12's maximal lint signal in mcp/.
- **HIGH #7 fix is robust** (3/3): 02-03's D-12 block re-includes the exact bare `NewExpression[callee.name='Server']` selector, defeating flat-config override.
- **HIGH #8 fix is robust** (3/3): `http-crossref-ping` is now a structural SKIP probe with zero imports from tests/.

### Agreed Concerns (cycle 2, raised by 2+ reviewers — highest priority)

**HIGH #3** (3/3): 02-07's `extractCliFacts` uses stale probe ID `http-contact-email` (canonical is `contact-email-presence`) AND regex-parses what 02-05 emits as a JSON-serialized array. Both fix sides are simple text edits; pick the canonical JSON parse path.

**HIGH #4** (3/3): 02-04's `paper://state` resource handler reads `loadState(paperDir())` with no arg, but 02-07 Case C creates a temp root and passes it to tools. The state read targets the host project, not the temp root. Fix: parameterize `paper://state` with a `paperRoot` URI variable, OR change Case C to assert idempotency from tool return values only.

**HIGH #5** (2/3 + repo evidence): `02-00:304-305` writes "DOCT-05" into the locked copy as explanatory text; `02-00:422` (test) and `02-00:448` (acceptance) forbid the substring `DOCT-05` appearing in the file. Plan cannot pass as written. Fix: rephrase the explanatory text to avoid the literal `DOCT-05` substring (e.g., "the end-to-end fixture probe deferred to Phase 3"), OR scope the anti-grep to forbid probe-anchor patterns only.

**HIGH #6** (3/3): `02-08:137` still says `state.update is idempotent`; `02-08:155-157` still says workflows are "exactly 17 .md files". Both are stale on day one of the locked-copy contract. Fix: replace `state.update` with `paper_advance_section`; replace `17` with `16` (per D-05).

**HIGH #2** (1/3 PARTIAL — Codex): 02-04 routes both MCP surfaces through `loadCapabilityFacts()` but 02-05's `runtime-config-presence.ts` still re-implements env presence directly. The shared helper is consumed by MCP only, not by the Tier 2 doctor path. Fix: have 02-05 import and consume `bin/lib/capabilities.ts::loadCapabilityFacts()` for the providers section of the runtime-config-presence probe.

**NEW HIGH** (Codex): 02-04's automated acceptance checks regex-search the full file text for forbidden strings (`loadRuntimeConfig`, `process.env[`), but the planned mcp/resources.ts and mcp/tools.ts snippets contain those strings in EXPLANATORY COMMENTS (mcp/resources.ts line 459, mcp/tools.ts lines 753-754). The plan's own acceptance gate fails even when the code is structurally correct. Fix: either remove the substrings from the comments OR refine the grep to skip comment lines (e.g., `grep -E '^[^//]*loadRuntimeConfig\('` rather than plain `grep loadRuntimeConfig`).

### Divergent Views

- **HIGH #2 severity.** Gemini and OpenCode call it FULLY RESOLVED based on the MCP-side delegation being clean. Codex calls it PARTIALLY RESOLVED because the original HIGH demanded a SINGLE shared capability source for BOTH tiers, and 02-05's CLI path still has its own env-presence code. Codex's reading is more faithful to the cycle-1 HIGH text ("gives CLI doctor and MCP one shared capability fact source"). Listed as unresolved per Codex.
- **HIGH #5 severity.** Gemini says FULLY RESOLVED based on the test being well-formed. Codex + OpenCode + direct repo inspection say STILL BROKEN because the file content (line 304) contains the literal forbidden substring. The 2/3 + evidence consensus is STILL BROKEN.

### Recommended Next Steps (cycle 3 / for /gsd-plan-phase --reviews)

Cycle 3 should:

1. **Reconcile 02-07 with 02-05** (HIGH #3): change `probes['http-contact-email']` → `probes['contact-email-presence']` AND replace the regex `for (const m of detail.matchAll(...))` block with `for (const p of JSON.parse(detail))`. Cite line 687, 692-697 in 02-07.
2. **Parameterize `paper://state`** (HIGH #4): add a `paperRoot` URI variable to `paper://state` (e.g., `paper://state?paperRoot=...`) and update 02-04's resource handler to honor it. OR drop the `paper://state` read in 02-07 Case C and rely on tool return values.
3. **Fix 02-00 self-contradiction** (HIGH #5): rephrase the line-304 explanatory paragraph to not contain the literal `DOCT-05` substring, OR change the test+acceptance to forbid only probe-anchor patterns (e.g., `### DOCT-05` or `## DOCT-05 — `).
4. **Repair 02-08 locked prose** (HIGH #6): `17` → `16`; `state.update` → `paper_advance_section`; `DOCT-01..06` → `DOCT-01..07`. Three text replacements.
5. **Share capabilities helper with CLI doctor** (HIGH #2): have 02-05's `runtime-config-presence.ts` import `loadCapabilityFacts()` (or its providers subset) from `bin/lib/capabilities.ts`. This gives both tiers ONE source of truth.
6. **Fix 02-04 self-failing forbidden-string checks** (NEW HIGH): scope the grep checks to non-comment lines, OR remove `loadRuntimeConfig` / `process.env[` from the explanatory comments in the planned snippets.
7. **Clean up 02-05 stale prose** about MockAgent/cassette (Codex MEDIUM): remove or rewrite `02-05:1239` and `02-05:1475` so they don't contradict the SKIP-only fix.
8. **Fix 02-00 undefined `read()` helper** (OpenCode MEDIUM): use `readFileSync` directly or define `read` locally.

To incorporate this feedback into planning:

```
/gsd-plan-phase 2 --reviews
```
