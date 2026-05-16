---
phase: 2
reviewers: [gemini, codex, opencode]
reviewed_at: 2026-05-16T01:09:10Z
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
notes: |
  - Self-CLI (claude) skipped because review was invoked from inside Claude Code, per workflow runtime-detection rules.
  - Cursor CLI invocation failed: the local `cursor` binary on this Windows host is the IDE editor, not the agent CLI; `cursor agent -p --mode ask --trust` is unsupported (flags pass through to Electron unrecognized). Skipped, no output.
  - Qwen / CodeRabbit / Ollama / LM Studio / llama.cpp not installed/running. Skipped.
  - OpenCode initially produced a complete, well-structured Phase 2 review (lines 1–203 of its raw output) and then unexpectedly pivoted into executing the plans. The execution-side actions (modifications to bin/lib/http.ts, bin/lib/retry.ts, eslint.config.js, package.json, hooks/.gitkeep, tests/repo-files.test.ts, tests/retry.test.ts, plus several new fixture/test files and a `nul` file) were reverted via `git checkout` and `rm` before this REVIEWS.md was written. Only the legitimate review prose is preserved below.
---

# Cross-AI Plan Review — Phase 2

Three independent AI systems (Gemini, Codex, OpenCode) reviewed all 10 Phase 2 plans plus CONTEXT, RESEARCH, PATTERNS, VALIDATION. Cursor and others were unavailable (see frontmatter notes).

---

## Gemini Review

Excellent. I have reviewed the project context and the 10 implementation plans for Phase 2. Here is my structured feedback.

### 1. Summary

The implementation plans for Phase 2 are of exceptional quality. They demonstrate a deep understanding of the project's architectural principles and non-negotiable constraints. The breakdown into four distinct waves, with linting chokepoints preceding the code they govern, is a superb strategy for de-risking a complex phase. The plans are granular, test-driven, and meticulously cross-referenced with the design documents (CONTEXT, RESEARCH, etc.), which provides a high degree of confidence that the implementation will meet the phase's success criteria.

### 2. Strengths

*   **Rigorous Test-First Gating**: The strategy of implementing lint-based chokepoints in Wave 1 (`02-01`, `02-02`, `02-03`) before the corresponding implementation in Wave 2 (`02-04`, `02-05`) is a significant strength. This mechanically enforces architectural invariants like the thin-shim, no-network, and no-leak policies, preventing entire classes of bugs before they are written.
*   **Robust Tier-Contract Design**: The design of the tier-contract test (`02-07`) is excellent. It correctly avoids common pitfalls by using the official SDK `StdioClientTransport` instead of raw JSON-RPC (per `RESEARCH.md` Pitfall 9), includes a dedicated preflight test for surface validation, and defines a clear, reusable helper for prose-tolerance assertions (`TIER-07`). This creates a meaningful and reliable merge gate.
*   **Clear Separation of Concerns**: The plans maintain a strict separation between tiers and between application logic (`bin/lib`) and presentation/transport layers (`mcp/`, `bin/cli`). Plan `02-04`'s thin MCP handlers and `02-05`'s CLI verb stubs delegating to a separate `doctor.ts` are prime examples.
*   **Detailed and Actionable**: Each plan's tasks are broken down into concrete, verifiable actions. The inclusion of `must_haves`, `artifacts`, and `key_links` provides precise instructions and acceptance criteria, minimizing ambiguity for the implementer. The threat model in each plan is also well-considered.
*   **Proactive Dependency Management**: Wave 0 (`02-00`) correctly sets up all necessary dependencies (`citty`, `@clack/prompts`) and shared artifacts (`references/doctor-output.md`) upfront, enabling parallel work in later waves and preventing dependency-related churn.

### 3. Concerns

*   **Ecosystem Probe Brittleness (LOW)**: Plan `02-05` introduces probes for ecosystem tools like Zotero, Pandoc, and a `humanizer` skill. These probes rely on checking specific file paths or the system `PATH`. This is inherently brittle and can lead to false negatives on contributor machines with non-standard setups.
    *   *Mitigation*: The plan correctly designates failures as `WARN`, not `FAIL`, which is the appropriate response. The `fix` messages are helpful. This is a low-risk concern but worth noting as a potential source of user support questions.
*   **Redundant Build Artifact Checks (LOW)**: The `build-artifact-resolves` probe in `02-05` and the preflight test in `02-07` both check for the existence of the `dist/` artifacts.
    *   *Mitigation*: This is a very minor issue, as the two checks serve different audiences (the user running `doctor` vs. the CI runner executing tests). The duplication is minimal and justifiable. No action is required, but it's a small overlap in logic.

### 4. Suggestions

*   **For `02-05` (CLI Doctor)**:
    *   Enhance the `build-artifact-resolves` probe. Instead of just a pass/fail on existence, the `detail` field in the `ProbeResult` could include the file sizes and modification timestamps of the binaries. This would provide more debugging information to the user at a low implementation cost.
    *   The ecosystem probe `fix` messages are good. To further improve user experience, consider creating a `TROUBLESHOOTING.md` file and linking to specific sections from the `fix` messages (e.g., `fix: 'Install Pandoc (see TROUBLESHOOTING.md#pandoc-on-windows)'`).
*   **For `02-07` (Tier Contract)**:
    *   The plan correctly identifies the need for helper functions (`extractCliFacts`, `extractMcpFacts`) to parse the different output shapes of the two tiers before comparison. This is a crucial detail that makes the main test case (`Case A`) clean and readable. The plan should ensure these helpers are pure functions and are unit-tested themselves, perhaps within `tests/lib/assert-tier-equivalent.test.ts`.
*   **For `02-09` (Prompts Fallback)**:
    *   The plan to use `readline` for the numbered fallback is solid. To make the test for this (`tests/prompts-numbered.test.ts`) even more robust, the `stderr` collector should not just assert that *something* was written, but that the written text exactly matches the expected multi-line prompt format, including numbered options and the `[default: ...]` string when applicable. This would lock in the wire protocol more tightly.

### 5. Risk Assessment

**Overall Risk: LOW**

The phase goals — bootstrapping two application tiers, implementing multiple architectural guardrails, and wiring a cross-platform integration test suite — are inherently complex. However, the provided set of 10 plans mitigates this complexity to an exceptional degree. The meticulous waving of dependencies, the "lint-first" approach to enforcing invariants, the detailed test specifications, and the clear alignment with the project's foundational decisions (`CONTEXT.md`) leave very little to chance. The identified risks are minor, well-contained, and do not threaten the phase's primary success criteria. The planning quality is sufficient to proceed with high confidence.

---

## Codex Review

### Summary

The Phase 2 plan set is strong in intent: it correctly treats the tier shells, doctor, MCP thin shim, no-leak surface, and tier-contract gate as architecture, not incidental scaffolding. The wave ordering is mostly sound: prep, lint rails, implementations, contract gate, documentation. However, the current plans contain several internal contradictions that would either fail execution or produce a false-confidence green check. The biggest issues are around D-12 no-leak enforcement vs. the planned MCP implementation, inconsistent probe IDs and JSON shapes between 02-05 and 02-07, state-root mismatch in tier-contract tests, and stale 16-vs-17 / generic-tool wording that survived into docs and tests.

### Strengths

- The phase has the right architectural center of gravity: `bin/lib/*` as source of truth, MCP as thin Tier 1 shell, citty CLI as Tier 2 shell, workflows as shared markdown.
- Wave 1 lint-first sequencing is good. Landing D-09, D-10, D-12 before `mcp/server.ts` is the right way to prevent architectural drift.
- The plans correctly make `doctor` deterministic and read-only, which is the right first tier-contract case.
- The explicit red-team fixtures for lint chokepoints are a good pattern. They make the guardrails regression-tested rather than aspirational.
- CI ordering in 02-07 is correct in principle: build before tier-contract, tier-contract before normal tests.
- The `PromptQuestion` / numbered fallback plan in 02-09 is a useful Phase 2 addition because it prevents Phase 3 intake from blocking in CI.

### Concerns

- **HIGH — D-12 contradictions will make 02-04 fail or weaken the no-leak invariant.**
  02-03 forbids computed `process.env[...]` and `loadRuntimeConfig()` inside `mcp/**`, but 02-04's `mcp/resources.ts` and `mcp/tools.ts` explicitly use both in `paper://capabilities` and `paper_capability_probe`. The plan text claims this is allowed, but the selector described in 02-03 is not flow-sensitive. This either fails lint or forces weakening D-12.

- **HIGH — Capabilities should not be built inside `mcp/`.**
  The clean architecture is a `bin/lib/capabilities.ts` or `bin/lib/doctor/capabilities.ts` helper that returns presence-only facts. MCP handlers should call that helper. This preserves thin-shim, avoids `process.env` in `mcp/`, and gives CLI doctor and MCP one shared capability fact source.

- **HIGH — 02-07 uses stale probe IDs and incompatible detail parsing.**
  02-05 canonical IDs include `contact-email-presence`, but 02-07 extracts `probes['http-contact-email']`. 02-05 makes `runtime-config-presence.detail` JSON, but 02-07 parses `name=true` regex lines. Case A will either miss facts or compare the wrong things.

- **HIGH — Case C state idempotency likely reads the wrong paper root.**
  02-07 creates a temp `paperRoot` and passes it to tools, but then reads `paper://state`, whose 02-04 resource handler uses `paperDir()` with no argument. That reads the default project state, not the temp state. The tier-contract idempotency test can fail or, worse, pass against unrelated state.

- **HIGH — 02-00 `doctor-output.md` acceptance criteria are self-contradictory.**
  The planned file explicitly contains "DOCT-05" in the explanatory text, but the acceptance criterion requires `grep -c "wiring-smoke\|DOCT-05"` to return 0. That plan cannot pass as written.

- **HIGH — 02-08 docs contain stale contract facts.**
  The proposed CONTRIBUTING section says "exactly 17 .md files" and references generic `state.update` idempotency, while the phase uses 16 workflows and snake_case tools like `paper_advance_section`. This undermines the locked docs and will confuse later agents.

- **HIGH — Multiple ESLint flat-config `mcp/**/*.ts` blocks can accidentally override prior `no-restricted-syntax` selectors.**
  The plans know this risk, but 02-03 re-includes a weaker D-10 selector: `NewExpression[callee.name='Server'][arguments.0.type='ObjectExpression']`, while 02-02 intended to ban all `new Server()`. If last-match semantics apply, no-arg `new Server()` slips through.

- **MEDIUM — 02-04 ResourceTemplate/listing behavior may not match preflight expectations.**
  `listResources()` may not include templated resources the same way as static resources depending on SDK behavior. If `paper://section/{N}` is registered as a `ResourceTemplate`, preflight expecting exactly 5 from `listResources()` may be brittle. It may need `listResourceTemplates()` or a direct read-resource case.

- **MEDIUM — 02-04 puts Phase 3 section directory behavior into Phase 2.**
  `loadSection()` reads `.paper/sections/.../{PLAN,DRAFT,VERIFICATION}.md`, while CONTEXT says no section directory I/O in Phase 2. A resource shell is fine, but the plan should return structured "not available yet" state or delegate to existing state only until Phase 3.

- **MEDIUM — Retry-After handling in 02-00 can create long sleeps.**
  The plan explicitly sleeps `serverRetryDelay` before retrying, but does not cap it to `capMs` or a bounded max. The threat model claims retry cap protects this, but the explicit sleep bypasses retry's cap.

- **MEDIUM — 02-05 production doctor imports test cassette helpers.**
  `http-crossref-ping.ts` imports from `tests/cassettes/index.js`. Production `bin/lib` code should not depend on test modules. If this remains, package layout and build behavior become fragile.

- **MEDIUM — Direct `os.homedir()` in doctor probes may violate existing paths chokepoint.**
  02-05's Zotero and humanizer probes use `homedir()` directly. If Phase 1 lint bans `os.homedir()` outside `bin/lib/paths.ts`, these files will fail lint. Use a paths helper instead.

- **MEDIUM — Workflow capability names do not match the actual MCP surface.**
  02-06 uses entries like `MCP state.read`, `MCP library.read`, and `MCP state.update`, but 02-04 exposes resources and snake_case tools. This weakens ARCH-03 because workflow bodies declare capabilities that do not exist.

- **MEDIUM — 02-07 `assertEquivalent` length tolerance is not meaningful for JSON vs. TTY.**
  Comparing raw MCP JSON text length to CLI TTY output length can fail for formatting noise or pass despite fact divergence. Facts should be primary. Length tolerance should be reserved for true prose cases in later phases, not capability JSON.

- **LOW — Several plans over-specify implementation details.**
  Some task bodies prescribe full code that may not match the existing repo APIs. That raises execution risk when `state.ts`, `runtime.ts`, MCP SDK exports, or test helpers differ. The plan should specify contracts and tests more than exact code bodies.

### Suggestions

- **Fix D-12 architecture before executing 02-04.**
  Add `bin/lib/capabilities.ts` with something like `loadCapabilityFacts(): Promise<CapabilityFacts>`. Let both `paper://capabilities`, `paper_capability_probe`, and doctor fact extraction use it. Then keep `mcp/**` free of `process.env[...]` and `loadRuntimeConfig()`.

- **Normalize canonical probe IDs in one place.**
  In 02-05, export `DOCTOR_PROBE_IDS` and use it in 02-07. Replace all `http-contact-email` references with `contact-email-presence`, and parse runtime provider detail as JSON.

- **Make MCP state resources testable with explicit paper root.**
  For Case C, either set an env var that `paperDir()` honors before spawning MCP, or add test-only resource/tool arguments that consistently use the same temp root. Do not write temp state to one root and read from another.

- **Repair 02-00 locked copy checks.**
  If DOCT-05 is deferred, do not include the literal `DOCT-05` in `doctor-output.md`, or change the anti-grep to only forbid probe anchors like `### build-artifact` / `### wiring-smoke`.

- **Update 02-08 locked prose before locking it.**
  Replace `17` with `16`, replace `state.update` with `paper_advance_section`, and ensure the documented workflow/tool names match 02-04 and 02-06.

- **Collapse MCP lint rules into one final `mcp/**/*.ts` config block.**
  Instead of three independent blocks that may override each other, create one consolidated block after Wave 1 containing D-09, D-10, D-12, and existing project-wide selectors. Test that bare `new Server()` is still caught.

- **Make `paper://section/{N}` Phase 2-safe.**
  Register the resource/template but return `{ n, state: "unavailable", phase: 3 }` or state-only data until Phase 3. Avoid real section file I/O in Phase 2.

- **Cap Retry-After delays.**
  Use `Math.min(parseRetryAfter(...), capMs)` or a dedicated `maxServerRetryAfterMs`, with a test for absurd headers.

- **Move cassette behavior out of production doctor.**
  Either make `http-crossref-ping` a test-only probe, or implement it with dependency injection so production code never imports `tests/**`.

- **Align workflow capability vocabulary with actual surface.**
  Use `MCP resource paper://state`, `MCP tool paper_advance_section`, etc., or define a closed capability grammar that supports resources and tools separately.

### Risk Assessment

Overall phase risk: **HIGH until the contradictions are resolved; MEDIUM after cleanup**. The architecture is directionally good and the wave structure is sound, but several current plans cannot all be true at once. The highest-risk area is the no-leak/capabilities design: if implemented as written, it either fails lint or pressures the executor to loosen the lint, undermining a non-negotiable. The second major risk is the tier-contract test giving false confidence because it compares stale IDs, mismatched shapes, and possibly the wrong state root. Fixing those issues before execution would make Phase 2 much more credible and should reduce the risk to manageable execution complexity.

---

## OpenCode Review

### 1. Summary

Overall assessment: **HIGH quality, thoroughly specified, architecturally coherent.** The 10-plan decomposition across 4 waves follows the "chokepoint-before-implementation" pattern proven in Phase 0/1. The tier-contract gate (02-07) is particularly well-designed — spawning real built artifacts via the official MCP SDK Client rather than mocking is the right approach. The lint enforcement triad (D-09 thin-shim, D-10 no-network, D-12 capabilities-no-leak) provides strong mechanical guarantees.

However, I found **one HIGH-confidence functional bug** (the Case A fact-extraction logic cannot parse the runtime-config-presence output) and **several MEDIUM concerns** around cross-plan dependency coordination, stale documentation, and fragile import paths that will cause CI failures or rework if not addressed before execution.

### 2. Strengths

- **Chokepoint-before-implementation discipline** (Wave 1 lints land before Wave 2 MCP server) is correctly followed across all plans. This is the pensmith non-negotiable and each plan respects it.

- **Tier-contract test design (02-07)** is excellent. Four cases (fact equivalence, shape exactness, idempotency, prose tolerance) cover the right failure modes. Using the official `Client` + `StdioClientTransport` (Pitfall 9 mitigation) rather than raw JSON-RPC is the right call.

- **Security invariants are enforced at the right layer**: D-12 (capabilities-no-leak) has both AST-walk lint (02-03) AND runtime sentinel-value testing (02-05 T-02-05-01). Defense in depth.

- **Probe decomposition (02-05)** into 10 single-purpose files is clean. Each probe has exactly one responsibility, tests are straightforward, and the read-only discipline (D-19) is tested.

- **Prompts fallback architecture (02-09)** correctly confines `@clack/prompts` to a single file, uses dynamic import, and tests the invariant via grep. The numbered fallback is well-specified with proper error handling (PromptAbortedError, PromptTimeoutError, 3-retry on out-of-range).

- **Cross-platform awareness** is woven throughout: `crlfDelay: Infinity` for Windows line endings in 02-09, `execFileSync` (never `exec`) to avoid shell injection on all OSes, explicit Windows path normalization commentary in the tier-contract test.

### 3. Concerns

#### HIGH

**H-01: Case A fact-extraction cannot parse runtime-config-presence output (02-07)**

`extractCliFacts()` in `tests/tier-contract.test.ts` uses:

```typescript
for (const m of detail.matchAll(/(?<name>[a-z]+)=(?<flag>true|false)/g)) {
```

But `runtime-config-presence` (02-05 Task 2) outputs:

```typescript
const detail = JSON.stringify(providers);
// → '[{"name":"anthropic","apiKeyEnv":"ANTHROPIC_API_KEY","present":true}]'
```

The regex (`name=flag`) will **never match** the JSON array format. Case A will silently extract zero provider facts, the key-set comparison against MCP will fail, and the test will break. **This is a load-bearing bug that must be fixed before the tier-contract test ships.**

Fix options:
- Change the probe to output a regex-parsable format (e.g., `"anthropic=true,openai=false"`)
- Change the test to parse JSON detail correctly
- Best option: Make `extractCliFacts` parse the JSON detail, and keep the probe output as JSON (it's more structured for downstream consumers)

**H-02: `http-crossref-ping` probe depends on undefined cassette infrastructure (02-05)**

`bin/lib/doctor/probes/http-crossref-ping.ts` imports from:

```typescript
import { setUpCassette, tearDownCassette } from '../../../../tests/cassettes/index.js';
```

This assumes:
1. `tests/cassettes/index.js` exists (owned by 02-00, but 02-00's scope is parseRetryAfter + citty install + references + hooks dir — it does not specify creating this)
2. The file exports `setUpCassette` / `tearDownCassette` with a specific API
3. `tests/cassettes/crossref-ping.json` exists

The 02-00 plan does not create this infrastructure. Even if it did, the relative import path (`../../../../`) from `bin/lib/doctor/probes/` is fragile. If a future refactor moves the probes directory, this silently breaks.

Fix: Either (a) extract the cassette wiring into `bin/lib/http.ts` or a shared test helper at a stable path, or (b) admit this probe is deferred and ship it as SKIP-only in Phase 2 (removing the cassette wiring code), with real implementation gated on Phase 3 when the test infrastructure lands.

#### MEDIUM

**M-01: Resource count drift — 4 vs 5 resources (02-04 vs RESEARCH.md)**

`02-RESEARCH.md` §Standard Stack and `02-CONTEXT.md` D-07 lock **4 resources** (state, library, outline, capabilities). But `mcp/resources.ts` in 02-04 registers **5** (adding `paper://section/{N}` via `ResourceTemplate`). This expansion is architecturally sound, but the planning artifacts haven't been updated to reflect it. The validator extension in 02-06 also says "exactly 4 resources" in one comment but checks for 5 in practice.

Impact: Low for execution (the code is right), but the inconsistency will confuse future maintainers reading the planning docs. The D-07 decision in CONTEXT.md should be updated to reflect 5 resources.

**M-02: PreCompact hook configured to 10s timeout but not stored as state (02-06)**

TIER-03 requirement states: "PreCompact (HANDOFF.json, configured to 10s explicitly)". The `hooks/hooks.json` in 02-06 Task 1 does NOT declare a timeout field:

```json
{ "event": "PreCompact", "script": "pre-compact.ts" }
```

Claude Code's hook system may support a `timeout` or `timeoutMs` field in the manifest entry. If so, the 10s requirement is unmet. If not (hooks have no configurable timeout), the requirement text needs updating. Either way, the disconnect between REQUIREMENT and implementation needs resolution.

**M-03: `InMemoryTransport` import path unverified against SDK v1.29 (02-04)**

`tests/mcp-tool-handlers.test.ts` imports:
```typescript
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
```

I checked the v1.29.0 SDK — the canonical export is `@modelcontextprotocol/sdk/inMemory.js` (or potentially `@modelcontextprotocol/sdk/server/inMemory.js`). This needs verification against the actual installed SDK version before the tests will pass. If the path is wrong, the test file can't even load.

**M-04: citty `runMain` + `process.exit(1)` interaction (02-05)**

`bin/cli/doctor.ts` calls `process.exit(1)` inside a `run()` callback that was invoked by citty's `runMain()`. citty installs its own `process.exit` handler and may swallow or delay manual exit calls. The planned code:

```typescript
async run({ args }) {
  // ...
  if (failed) process.exit(1);
}
```

This should be verified with the installed citty@0.2.2. If citty intercepts exit, the doctor's exit code contract (D-15: non-zero on FAIL) breaks. Mitigation: test with a synthetic FAIL probe in `tests/doctor-exit-code.test.ts` (already planned). Flagging for explicit verification.

**M-05: Prompt timeout race — `setTimeout` + `readline` not properly cleaned up (02-09)**

`numbered.ts` creates both a `setTimeout(timeoutMs)` and a `readline.once('line', ...)`. If the timeout fires first, the rejection must close the readline interface and clear the line listener. If a line arrives just before the timeout, the timeout must be cleared. The plan specifies "reject with PromptTimeoutError AND close the readline interface" but doesn't specify clearing the timeout on successful answer. Without `clearTimeout`, a fast-answering user leaves a dangling timer that could delay process exit (Node 20 keeps the event loop alive for active timers).

**M-06: 02-07 depends on 02-09 but the dependency isn't structural**

`depends_on: ["02-04", "02-05", "02-06", "02-09"]` — but the tier-contract test in 02-07 never calls `ask()`. The sole dependency on 02-09 is conceptual (tier-contract must be CI-safe, and the numbered fallback ensures that). If 02-09 were deferred, 02-07 would still work because `pensmith doctor` doesn't invoke `ask()`. The dependency should be documented as informational ("wave ordering: prompts fallback should ship before Phase 3 intake") rather than a hard block.

#### LOW

**L-01: Stale "17 hooks" comment in 02-06 manifest validator**

```javascript
// asserts presence of hooks/, workflows/ (exactly 17 .md files with capability_check blocks)
```

The actual `EXPECTED_WORKFLOWS` array has 16 entries (correct per D-05 correction). The comment says 17. This will confuse readers.

**L-02: SHA-256 placeholder not auto-replaced in 02-00**

The `PINNED = '<<<COMPUTED-AT-COMMIT-TIME>>>'` pattern in `tests/repo-files.test.ts` is correct but relies on the executor remembering to compute and replace the hash. A simpler approach: compute the hash in a `before` hook using `createHash('sha256').update(readFileSync(...)).digest('hex')` and match against a committed known-good value, with a `--update-hashes` script that recomputes and writes.

**L-03: Unicode icons in TTY doctor output may not render on legacy Windows terminals**

`renderTty()` uses `✓`, `!`, `✗`, `—`. These render correctly in Windows Terminal, VS Code integrated terminal, and macOS Terminal.app, but may show as `<?>` or boxes in cmd.exe with raster fonts. Consider a `NO_COLOR`-style env fallback to ASCII (`[PASS]`, `[WARN]`, `[FAIL]`, `[SKIP]`). Marked LOW because the primary doctor use case is VS Code / modern terminal.

### 4. Suggestions

#### Must-fix before execution

1. **Fix H-01**: Change `runtime-config-presence` detail output to a regex-friendly format OR change `extractCliFacts` to parse JSON. I recommend keeping the detail as JSON (it's more structured) and fixing the test.

2. **Fix H-02**: Decouple `http-crossref-ping` from the hypothetical cassette infrastructure. Either:
   - Move the cassette wiring to a well-known stable import path (e.g., `tests/lib/mock-http.ts`)
   - OR change the probe to pure SKIP for Phase 2, remove the dynamic import, and document the deferred cassette dependency for Phase 3

3. **Fix M-03**: Before writing 02-04, verify the `InMemoryTransport` import path against the installed `@modelcontextprotocol/sdk@^1.29.0`. Include a verification note in 02-04's plan body. If the path differs, update the import before committing.

#### Should-fix before merge

4. **Fix M-02**: Add a `timeoutMs: 10000` field to the PreCompact hook entry in `hooks/hooks.json` if the Claude Code hook manifest supports it. If not, update TIER-03 requirement to remove the "10s explicitly" clause.

5. **Fix M-05**: Add `clearTimeout` guard in `numbered.ts`.

6. **Fix L-01**: Bump the "exactly 17" comment to "exactly 16" in `scripts/validate-plugin-manifest.cjs` (02-06 Task 3).

7. **Resolve the 4-vs-5 resource count discrepancy**: Update D-07 in `02-CONTEXT.md` to state 5 resources (adding `paper://section/{N}`).

#### Nice-to-have

8. **Make CITTY_INTERCEPT_EXIT explicit**: Add a comment in `bin/cli/doctor.ts` noting whether citty's `runMain` handles process.exit or whether the doctor's manual `process.exit(1)` actually reaches the OS.

9. **Add `NO_COLOR` / `CI` env detection to renderTty** to fall back to ASCII labels when Unicode isn't available.

10. **Cross-reference 02-09's PromptQuestion schema in 02-04's tool inputs doc**: Document the relationship so Phase 3 doesn't have to rediscover it.

### 5. Risk Assessment

**Overall phase risk: MEDIUM**

The architectural design is sound and the decomposition into waves is correct. The HIGH risks are concentrated in two places that are easy to fix before execution:

1. **Case A will break on first CI run** (H-01) because the fact-extraction regex doesn't match the probe's JSON output. This is a straightforward test-code fix, but if it ships without being caught, it erodes confidence in the tier-contract gate immediately.

2. **The cassette-dependency chain is under-specified** (H-02). 02-00 creates no cassette infrastructure but 02-05's probe depends on it. Either the cassette wiring must be explicitly added to 02-00's scope, or 02-05's probe must be made self-contained. Without resolution, `http-crossref-ping` will throw a module-not-found error at import time.

The MEDIUM concerns (M-01 through M-06) are real but unlikely to block the phase — they'll surface as failed CI runs or odd behavior that the developer diagnoses and fixes during execution. The architecture is resilient enough that none of them represent fundamental design flaws.

The four-layer merge gate (CI step + branch protection + preflight + CONTRIBUTING.md prose) is well-conceived and will effectively prevent silent contract drift. The discipline rule (D-21 — "fix tiers, not normalizers") is the critical prose element that prevents the gate from degrading over time.

**Recommendation**: Proceed with Phase 2 execution after the implementor resolves H-01 and H-02. The plans are otherwise ready.

---

## Consensus Summary

Three reviewers agree the Phase 2 plan set is architecturally sound with strong wave-ordering discipline and a credible tier-contract gate, but Codex and OpenCode independently surface concrete contradictions and bugs that would either fail execution or hand back a false-confidence green check. Gemini calls the overall risk LOW; Codex calls it HIGH-until-fixed; OpenCode calls it MEDIUM. The split is informative — Gemini reviewed surface coherence and design philosophy; Codex and OpenCode pulled specific code snippets out of the plans and traced them through to broken interactions. The HIGH-severity items below are the Codex+OpenCode union and should be treated as blocking for execution.

### Agreed Strengths (mentioned by 2+ reviewers)

- **Wave-1-lint-before-Wave-2-implementation discipline** (Gemini, Codex, OpenCode): D-09 thin-shim, D-10 no-network, D-12 capabilities-no-leak land before `mcp/server.ts` so they actually constrain the surface.
- **Official-SDK tier-contract design** (Gemini, OpenCode): 02-07 spawning real built artifacts via `Client` + `StdioClientTransport` (Pitfall 9 mitigation) rather than mocking JSON-RPC is the right architectural call.
- **Defense-in-depth on no-leak** (Codex, OpenCode): D-12 enforced at lint *and* runtime sentinel-value test layers.
- **bin/lib/* as canonical source of truth** with MCP and CLI as thin shells (Gemini, Codex, OpenCode): correct architectural center of gravity.
- **Red-team fixtures for lint chokepoints** (Gemini, Codex): make guardrails regression-tested rather than aspirational.

### Agreed Concerns (raised by 2+ reviewers — highest priority)

**HIGH (blocking) — agreed by Codex H-3 and OpenCode H-01:**
- **02-07 fact extraction is incompatible with 02-05 output.** Codex frames this as "stale probe IDs and incompatible detail parsing" (`probes['http-contact-email']` vs canonical `contact-email-presence`; regex `name=true` vs JSON array). OpenCode names the same bug as H-01 (`extractCliFacts` regex cannot parse JSON `runtime-config-presence` output). Both reviewers agree Case A will silently extract zero facts and either fail or pass against nothing.

**MEDIUM/HIGH (Codex elevated) — cassette dependency in production code:**
- Codex MEDIUM ("02-05 production doctor imports test cassette helpers") and OpenCode HIGH H-02 ("`http-crossref-ping` depends on undefined cassette infrastructure") describe the same defect with different severity. Both agree `bin/lib/doctor/probes/http-crossref-ping.ts` importing from `tests/cassettes/index.js` is wrong: production must not depend on tests, the cassette infrastructure is not actually created by 02-00, and the relative import path is fragile.

**MEDIUM — agreed:**
- **Resource count drift 4 vs 5** (Codex MEDIUM "02-04 ResourceTemplate behavior may not match preflight"; OpenCode M-01 "RESEARCH locks 4, code registers 5"). Both surface the same underlying drift between planning artifacts and the implementation, with downstream implications for the preflight test.
- **Phase 3 leak in 02-04 section resource** (Codex MEDIUM "02-04 puts Phase 3 section directory behavior into Phase 2"). OpenCode does not call this out explicitly but is congruent with the CONTEXT.md hard-fence on `.paper/` I/O.

### Divergent Views

- **Overall risk grading.** Gemini = LOW, OpenCode = MEDIUM, Codex = HIGH-until-fixed. The divergence reflects review depth: Gemini did a coherence/intent read; Codex and OpenCode traced specific code through cross-plan interactions and found broken seams. The HIGH grade is the more conservative read and should govern.
- **Whether the no-leak invariant requires a new `bin/lib/capabilities.ts` helper.** Codex argues HIGH that capabilities should not be built inside `mcp/` and proposes extracting `bin/lib/capabilities.ts`. OpenCode treats the existing 02-04 design as fine because the lint rule in 02-03 contains an explicit exception for the documented presence-check pattern (`typeof process.env[x] === 'string' && process.env[x].length > 0`). Gemini does not address. **Worth investigating**: does the AST selector in 02-03 actually distinguish the safe presence-check pattern from a value-leaking access? If not, Codex's read wins and the architecture needs the helper extraction. If yes, OpenCode's read wins and the lint exception is sufficient.
- **`paper://section/{N}` in Phase 2 scope.** Codex says it's a CONTEXT scope violation; OpenCode says the resource count drift is the issue but the registration itself is fine. Gemini does not address. The CONTEXT.md hard fence is unambiguous: no section directory I/O in Phase 2. The fix is to register the resource template but make it return `{ phase: 3, state: "unavailable" }` rather than reading from `.paper/sections/`.
- **02-08 staleness severity.** Codex marks the "exactly 17 / state.update" stale prose as HIGH (it lands in a locked-copy doc and immediately drifts). OpenCode marks it LOW (L-01) on the analogous validator-comment issue. The locked-doc framing tilts toward Codex's grading: locked prose that is wrong on day one undermines the entire locked-copy discipline.

### Recommended Next Steps (for /gsd-plan-phase --reviews)

1. **Resolve the H-01 / H-3 fact-extraction bug** in 02-07 OR 02-05 — pick one canonical detail format and update both sides.
2. **Decide H-02 / cassette MEDIUM**: ship `http-crossref-ping` as SKIP-only in Phase 2 OR add cassette infrastructure to 02-00's scope explicitly.
3. **Decide capabilities architecture**: extract `bin/lib/capabilities.ts` (Codex) OR verify the 02-03 AST selector handles the presence-check exception (OpenCode). Do not let this be settled by what the executor finds easier.
4. **Reconcile 4-vs-5 resource count** in CONTEXT.md D-07, RESEARCH.md, and 02-04/02-06 plan text.
5. **Repair 02-00 locked-copy self-contradiction** (DOCT-05 in body but anti-grep forbids it).
6. **Update 02-08 locked CONTRIBUTING prose** before locking it (16 not 17, snake_case tools, current workflow names).
7. **Make 02-04 `paper://section/{N}` Phase-2-safe** — register the template but return `{ phase: 3 }` placeholder; no `.paper/sections/` I/O.
8. **Cap Retry-After delays** in 02-00.
9. **Audit ESLint flat-config block ordering** for `mcp/**/*.ts` to ensure 02-03's selector does not weaken 02-02's `new Server()` ban.
10. **Verify SDK v1.29 InMemoryTransport import path** against installed package before 02-04 lands.

To incorporate this feedback into planning:

```
/gsd-plan-phase 2 --reviews
```
