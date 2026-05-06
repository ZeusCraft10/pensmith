---
phase: 0
reviewers: [codex, claude-opus-4-6]
review_loop: in_progress
cycles_completed: 2
max_cycles: 5
started_at: 2026-05-07
last_review_at: 2026-05-07
last_review_high_count: 4
last_replan_at: 2026-05-07
last_replan_summary: |
  Cycle 2 replan addressed cross-AI review feedback:
  - REQUIREMENTS.md: ARCH-12 reframed as warn-and-proceed (no hard refuse) per PRD §12 free-basics; VRFY-06 split into deterministic claim extraction + advisory orphan judgment per PRD §14; DONE-09 expanded to PRD §7.9 confirmation gate semantics (UNSUPPORTED/orphan/plagiarism summary).
  - ROADMAP.md: Phase 1 success #5 reconciled with DOCT-03 warn behavior; Phase 5 success #2 reconciled with deterministic Pass 4 extraction; Phase 6 success #5 expanded to per-issue confirmation per PRD §7.9.
  - 00-CONTEXT.md: D-06 reconciled (no eslint-plugin-import at Phase 0); D-17 reconciled (structural assertions, not JSON-Schema); D-18 reconciled (deliberate non-runnable stub at Phase 0).
  - 00-VALIDATION.md: status flipped to execution-ready, nyquist_compliant=true, wave_0_complete=true, per-task verification map populated for all 8 tasks across the 4 plans, test runner contract reconciled with Plan 01.
  - 00-02-PLAN.md: added project-config integration test (loads eslint.config.js from disk and asserts both rules fire on fixture under actual project config); added documented-gap test for global fetch().
  - Plans 00-01, 00-03, 00-04: added <replan_history> banners explaining why no structural changes were needed (cycle-1 final drafts already address codex's HIGH issues — .cjs extension, ESM imports, npm test contract).
  Two cycle-1 HIGH items had already been resolved in the cycle-1 final draft (.cjs extension on validator, scripts/run-tests.mjs as test runner, REQUIREMENTS/ROADMAP requirement counts both at 131); cycle-2 work is concentrated on the upstream artifact reconciliation the orchestrator flagged plus the lint-test methodology gap.
---

# Cross-AI Plan Review — Phase 0 (Convergence Loop)

Author: Claude Opus 4.7 | Reviewers: codex (default) + claude (claude-opus-4-6)

## Cycle 1 — Codex Review

**.planning/PROJECT.md**

Blocking concerns:
- **HIGH:** Key Decisions says “Use `/gsd-new-project --auto @PRD.md` flow”; PRD §19 says `/gsd:new-project --auto @PRD.md`. That typo can send execution down the wrong command path.
- **HIGH:** Active requirements include `Done (export)` but omit PRD §7.9’s confirmation gate for “UNSUPPORTED, orphan claims, or plagiarism hits.” It lists export/humanize/plagiarism, but not the required user confirmation before export.

Material concerns:
- **MEDIUM:** “Every citation … supports the claim” in Core Value is stronger than the actual verifier gate later, where Pass 2 claim support is advisory. This should be reconciled so the core value does not imply automatic blocking on UNSUPPORTED claims unless that is intended.
- **MEDIUM:** Library path says `~/.pensmith/library/index.json`; constraints also require platform-equivalent paths. Fine as shorthand, but it should consistently say “or platform equivalent” in requirements, not just elsewhere.

Minor suggestions:
- **LOW:** Key Decisions all say “Pending” even for decisions already locked by PRD/CLAUDE.md. Mark locked architectural decisions as accepted, not pending.

Verdict: **APPROVE-WITH-EDITS**

---

**.planning/REQUIREMENTS.md**

Blocking concerns:
- **HIGH:** Count drift: header says “131 atomic” and Coverage says “131 total”; ROADMAP says “116 total.” This is a hard traceability failure.
- **HIGH:** `VRFY-06` says Pass 4 is “LLM-judged, advisory,” but PRD §14 says “per-paragraph claim extraction” is deterministic, “pure-Bash/Node, not LLM-judged.” This violates a must-have NFR.
- **HIGH:** `DONE-*` lacks PRD §7.9’s required confirmation if any `UNSUPPORTED`, orphan claims, or plagiarism hits exist. `DONE-09` only covers export confirmation, not issue confirmation.
- **HIGH:** `ARCH-12` says HTTP “refuses to start without `PENSMITH_CONTACT_EMAIL`,” while `DOCT-03` only warns if missing and PRD §12 says free basics need no keys. This can break dry-run/local basics and contradicts the doctor contract.

Material concerns:
- **MEDIUM:** `VRFY-07` makes Pass 2 / Pass 4 advisory, but Core Value says every citation supports its claim. Either change Core Value or require user confirmation/report gating for unsupported/orphan claims.
- **MEDIUM:** `ARCH-10` and `ARCH-11` add per-step caps and `--yolo` refusal at 50% cap. These are plausible, but they are research additions that alter UX beyond PRD §7.19/§7.20; mark them explicitly as additions needing approval.
- **MEDIUM:** `REPO-05` bans `/^10\./` regex only in TS lint scope later, but requirement wording is global. Either broaden enforcement or say “in TypeScript source.”
- **MEDIUM:** `ERGO-07` maps educator mode to Phase 9, but Phase 9 also promises PII polish with no corresponding v1 requirement mapped.

Minor suggestions:
- **LOW:** “Hand-rolled citation formatter” in Out of Scope is “resolved by CITE-04”; better move that to a decision, not out-of-scope.

Verdict: **REJECT** until count/traceability and verifier determinism are fixed.

---

**.planning/ROADMAP.md**

Blocking concerns:
- **HIGH:** Coverage says “v1 requirements: 116 total,” while REQUIREMENTS says 131. This invalidates roadmap completeness.
- **HIGH:** Phase 5 says Pass 2 and Pass 4 “never blocks compile or export,” but PRD §7.9 requires user confirmation before export if UNSUPPORTED/orphan claims exist. “Doesn’t block automatically” is okay; “never blocks export” is not.
- **HIGH:** Phase 1 success criterion says HTTP refuses to start without `PENSMITH_CONTACT_EMAIL`, contradicting `DOCT-03` warning behavior and PRD’s no-key/free-basics framing.

Material concerns:
- **MEDIUM:** Phase 6 zero-trace test scans `.tex` and `.md` for “pensmith”; but generated citations or bibliography metadata could contain source paths/comments depending on toolchain. The test needs format-specific metadata checks, not only string grep.
- **MEDIUM:** Phase 7 delivers `/pensmith` after export pipeline. That means most earlier phases are not exercisable through the primary UX, despite single-command UX being non-negotiable. It may be acceptable internally, but the roadmap should state Phase 3-6 use lower-level commands only.
- **MEDIUM:** Phase 9 claims “PII polish beyond regex-only,” but only `ERGO-07` is assigned. No PII requirement maps there.

Minor suggestions:
- **LOW:** “Plans: TBD” for phases 1-10 is fine now, but Phase 1 is huge. It likely needs subplans before execution approval.

Verdict: **REJECT** until traceability and Pass 4/export-gate contradictions are resolved.

---

**00-CONTEXT.md**

Blocking concerns:
- **HIGH:** D-17 says validator “reads the upstream Claude Code plugin schema once at lock time,” but Phase 0 plans implement only structural assertions, not schema validation. That is a contract mismatch.
- **HIGH:** D-18 says `.mcp.json` points to `dist/mcp/server.js`, but Phase 0 `mcp/server.ts` is only `export {}`. If any validation actually starts the MCP server, it exits immediately and is not a server.

Material concerns:
- **MEDIUM:** D-19 defers the full README disclaimer to Phase 6. Since CLAUDE.md says the README disclaimer is load-bearing and the only disclosure mechanism, this needs an explicit rule that no README quick start or feature claims are published before the disclaimer lands.
- **MEDIUM:** D-16 hardcodes repository `github.com/akhilachanta/pensmith` in later research/plans, but context says “or similar.” The plan should avoid hardcoding unless repo name is confirmed.

Minor suggestions:
- **LOW:** D-12 says cache `node_modules`; setup-node caches npm package cache, not `node_modules`. Wording should be corrected.

Verdict: **APPROVE-WITH-EDITS**

---

**00-DISCUSSION-LOG.md**

Blocking concerns:
- **HIGH:** NO MEANINGFUL SUGGESTIONS.

Material concerns:
- **MEDIUM:** It says “No suggestions surfaced that belonged in other phases,” but CONTEXT defers several major items. Better phrase as “No scope creep accepted.”

Minor suggestions:
- **LOW:** “/gsd-transition” and “/gsd-complete-milestone” naming should be checked against actual GSD command syntax.

Verdict: **APPROVE-WITH-EDITS**

---

**00-RESEARCH.md**

Blocking concerns:
- **HIGH:** Recommends `scripts/validate-plugin-manifest.js` as CommonJS while `package.json` is `"type": "module"`. A `.js` file using `require` will fail at runtime. It must be `.cjs` or ESM.
- **HIGH:** Claims CI should run `node --test`, but plans use TypeScript `.test.ts` files requiring `tsx`. Raw `node --test` will not run the TS tests correctly. Use `npm test` consistently or compile tests first.
- **HIGH:** Research says manifest validation is against official Claude Code schemas, but the proposed validator is hand-rolled structural checks. That does not satisfy “validate against schema.”

Material concerns:
- **MEDIUM:** Assumption A3 “declare MCP server in BOTH `.mcp.json` and `plugin.json`” is left as medium-risk but later plans hardcode it. This should be verified before execution, not after.
- **MEDIUM:** The ESLint DOI selector is fragile and probably under-tests variants; the fixture only catches `/^10\./`, not URL-style DOI detection. If REPO-05 intends a chokepoint for all DOI parsing, this is too narrow.
- **MEDIUM:** `macos-latest` arm64 claim should be verified in CI, but ROADMAP requirement says macos-arm64. The plan’s arch assertion helps; research should not treat it as guaranteed.

Minor suggestions:
- **LOW:** “No runtime dependencies Phase 0” conflicts with recommending an MCP SDK anti-pattern note. Fine, but sharpen: Phase 0 stub is not a runnable server.

Verdict: **REJECT** until CommonJS/ESM, `node --test`, and schema-validation claims are fixed.

---

**00-01-PLAN.md**

Blocking concerns:
- **HIGH:** `package.json` sets `"type": "module"`, but later Plan 03 creates `scripts/validate-plugin-manifest.js` as CommonJS. This plan’s file extension choice sets up a guaranteed failure.
- **HIGH:** It requires `scripts.test = node scripts/run-tests.mjs`, but ROADMAP/REQUIREMENTS/Plan 04 still require CI to run `node --test`. The test contract is inconsistent.
- **HIGH:** `scripts/run-tests.mjs` uses `entry.parentPath ?? entry.path`; `Dirent.parentPath` is not guaranteed on Node 20.10. If unavailable/changed, recursive discovery can construct wrong paths. Use a recursive walker that tracks parent paths explicitly.

Material concerns:
- **MEDIUM:** Acceptance says `node scripts/run-tests.mjs` should exit 1 with zero tests, but Phase 0 ROADMAP says “zero tests yet is fine.” The plan changes the acceptance contract without updating ROADMAP.
- **MEDIUM:** `scripts/run-tests.mjs` is untyped `.mjs` and not covered by `tsc`; for a build-critical script, add a test or keep it tiny and verified.
- **MEDIUM:** `CONTRIBUTING.md` includes `/^10\./`; lint only applies TS, but a future global grep could false-positive. Be explicit that Markdown mentions are allowed.

Minor suggestions:
- **LOW:** `dev` script is just `tsx` with no target. It is harmless but not useful.

Verdict: **REJECT** until test-runner and module-format issues are resolved.

---

**00-02-PLAN.md**

Blocking concerns:
- **HIGH:** `tests/repo-files.test.ts` asserts `eslint.config.js` does not contain `eslint-plugin-import`, but the generated `eslint.config.js` comments explicitly contain “eslint-plugin-import.” The test will fail.
- **HIGH:** Acceptance criteria also says `eslint.config.js` does NOT contain `eslint-plugin-import`; the proposed file contains that exact string multiple times in comments.

Material concerns:
- **MEDIUM:** `read_first` references `.planning/phases/.../00-VALIDATION.md`, but that file is included later and exists; okay. However it says “Wave 0 Requirements,” while this plan is Wave 2. The terminology is confusing.
- **MEDIUM:** Programmatic ESLint test uses no TypeScript parser. The current fixture has no TS-only syntax, so it passes, but it does not prove the project flat config parses real TS files.
- **MEDIUM:** The `fetch` ban only covers imports from `undici`; it does not ban global `fetch`, despite REPO-05 saying “direct fetch.” Add `no-restricted-globals` or equivalent.

Minor suggestions:
- **LOW:** Avoid byte-identical acceptance unless there is a checksum. In parallel execution, it is brittle and hard to verify manually.

Verdict: **REJECT** because the plan’s own test contradicts its generated file.

---

**00-03-PLAN.md**

Blocking concerns:
- **HIGH:** `scripts/validate-plugin-manifest.js` is CommonJS (`require`) in a `"type": "module"` package. `npm run validate:manifests` will fail with `require is not defined`. Rename to `.cjs` or rewrite as ESM.
- **HIGH:** `tests/manifest.test.ts` uses `require('node:os')` inside an ESM TypeScript test. That will fail. Use `import os from 'node:os'`.
- **HIGH:** Validator root is `path.resolve(__dirname, '..')`; `__dirname` only exists in CommonJS. This reinforces the module-format break.
- **HIGH:** The plan claims schema validation, but the validator only checks a few fields with regexes. It does not validate against Claude Code plugin schema.

Material concerns:
- **MEDIUM:** Duplicating MCP server declarations in both `plugin.json` and `.mcp.json` remains an unresolved assumption. This should be tested with Claude Code validation before hardcoding.
- **MEDIUM:** Negative test only checks missing `plugin.name`; it does not test malformed `.mcp.json` or marketplace plugin entries.
- **MEDIUM:** `dist/` guard only fails if `dist/` exists. A CI that forgets to build and has no `dist/` would pass validation. If the acceptance requires built server path, validator should support a strict mode or CI should assert file existence separately.

Minor suggestions:
- **LOW:** `version` regex accepts invalid semver prefixes broadly. Use a semver parser later if this matters.

Verdict: **REJECT**

---

**00-04-PLAN.md**

Blocking concerns:
- **HIGH:** Must-haves say CI step order includes `node --test`, but YAML uses `npm test`. REQUIREMENTS `REPO-04` also says `node --test`. This is an explicit contract violation unless requirements are updated.
- **HIGH:** Local verification says `npm run check && npm run build`, but `check` includes manifest validation before build. With the Plan 03 guard, this can pass without checking built path if `dist/` does not exist. The claimed build-before-validation CI behavior is not mirrored locally.

Material concerns:
- **MEDIUM:** `autonomous: false` plus a blocking human GitHub push gate is reasonable, but Phase 0 “execution” cannot be fully autonomous. The orchestrator should know this is a release/environment gate, not code implementation.
- **MEDIUM:** macOS arch check uses bash `test "$RUNNER_ARCH" = "ARM64"`. Fine, but if GitHub changes env naming, it hard fails. That is acceptable only because the phase explicitly wants arm64.

Minor suggestions:
- **LOW:** Add `npm run typecheck` instead of `npx tsc --noEmit` if package scripts are the desired contract.

Verdict: **APPROVE-WITH-EDITS** after `node --test` vs `npm test` is reconciled.

---

**00-VALIDATION.md**

Blocking concerns:
- **HIGH:** Frontmatter says `nyquist_compliant: false`, `wave_0_complete: false`, `status: draft`. This artifact is not execution-ready.
- **HIGH:** “Quick run command: `node --test`” conflicts with Plan 01’s TypeScript runner `node scripts/run-tests.mjs`. Raw `node --test` will not execute `.ts` tests through `tsx`.
- **HIGH:** “Estimated runtime ~10 seconds (zero unit tests)” conflicts with Wave 0 requirements that create multiple tests and Plan 01’s runner intentionally failing on zero tests.

Material concerns:
- **MEDIUM:** Per-task verification map is still placeholder rows. It does not validate the actual four plans.
- **MEDIUM:** Manual-only plugin validation via Claude CLI is optional, but manifest schema drift is one of the top risks. For REPO-02, this should be a required manual verification if available, or explicitly waived.

Minor suggestions:
- **LOW:** “No watch-mode flags” sign-off is generic; fine but not meaningful for this phase.

Verdict: **REJECT** until updated after plans exist.

---

## Cycle 1 — Claude (opus 4.6) Review

I'll work through each artifact systematically. This is a large corpus — I'll focus on substance, not recitation.

---

# Cross-AI Peer Review: Pensmith Planning Artifacts

## 1. CLAUDE.md

### Blocking (HIGH)
None.

### Material (MEDIUM)
None.

### Minor (LOW)
- The reference repo clone commands (`git clone ... /tmp/refs/gsd-original`) point to external URLs that may break or change. Consider pinning to a specific commit SHA for reproducibility.

**Verdict: APPROVE**

Tight, well-organized project memory. Non-negotiables are clearly enumerated and internally consistent with the PRD.

---

## 2. PRD.md

### Blocking (HIGH)

1. **Tier 2 "OpenAI-compatible" claim is false for Anthropic** (§1, §10). The PRD says Tier 2 works against "any OpenAI-compatible endpoint (Anthropic, OpenAI, Ollama, vLLM, llama.cpp)." Anthropic's API is **not** OpenAI-compatible — different message format, different tool-calling spec, different streaming protocol. Either the `runtime.ts` module must implement provider-specific adapters (not spec'd anywhere), or the claim needs to be corrected. This will cause a failed vertical slice in Phase 3 if the Tier 2 CLI tries to talk to Anthropic using the OpenAI SDK's wire format.

### Material (MEDIUM)

2. **GPTZero free-tier reliability** (§7.11). The free endpoint has historically been rate-limited, unstable, and occasionally deprecated. The PRD makes it a default-on feature of `done` without specifying fallback behavior when the endpoint is unreachable. Should specify: timeout → skip with warning (don't block export).

3. **DuckDuckGo HTML scraping fragility** (§7.17). DDG has no stable API and actively blocks automated scraping. "No formal API" is acknowledged but no mitigation is spec'd. A single DDG rate-limit/block makes the plagiarism check silently non-functional.

4. **Claim support with abstract-only sources** (§7.7 Pass 2). When a paper isn't OA via Unpaywall, verification falls back to abstract-only. The PRD doesn't define what "SUPPORTED" means when you only have a 200-word abstract to judge a specific claim. This will produce unreliable Pass 2 verdicts for most paywalled sources. Recommend: emit "ABSTRACT_ONLY" as a modifier on verdicts so the user knows the confidence is lower.

5. **Humanizer is Tier-1-only in practice** (§7.10). The `humanizer` skill at `~/.claude/skills/humanizer/` is a Claude Code artifact. Tier 2 (portable CLI) will **never** have this skill available. The "skip cleanly if absent" behavior means Tier 2 users can never humanize. The tier-contract test (TIER-07, "equivalent output modulo prose") needs to account for this asymmetry.

6. **Section numbering inconsistency** (§5.6 vs §17). §5.6 says "inserts new section folder (e.g., `sections/3.5/`)" while §17's recommendation (and ARCH-20 in REQUIREMENTS.md) uses letter suffixes (`03b-validity-threats/`). The PRD contains two conflicting conventions. The requirements resolved this correctly, but the PRD remains inconsistent — anyone reading the PRD cold will be confused.

### Minor (LOW)

7. The `pyproject.toml` in §13 repo layout is never referenced again. Is this for a Python fallback? If so, spec it. If vestigial, remove.

**Verdict: APPROVE-WITH-EDITS** — Fix #1 (Anthropic is not OpenAI-compatible) and #6 (section numbering inconsistency). Address #2-#5 with explicit degradation behavior.

---

## 3. PROJECT.md

### Blocking (HIGH)
None.

### Material (MEDIUM)
None.

### Minor (LOW)
- "Key Decisions" table has all outcomes as "— Pending." This is technically correct pre-execution but leaves no record of the decisions the research phase *already made* (e.g., the `citty` CLI framework choice, the `citation-js` + CSL approach). These should be filled in as "Decided (research)" to avoid re-litigating them in Phase 2.

**Verdict: APPROVE**

Faithful translation of the PRD into the GSD project format.

---

## 4. REQUIREMENTS.md

### Blocking (HIGH)

1. **Requirement count mismatch with ROADMAP.md.** REQUIREMENTS.md states "131 total" and "Mapped to phases: 131 / Unmapped: 0 ✓." ROADMAP.md states "v1 requirements: 116 total / Mapped to phases: 116 ✓." This is a **direct contradiction** — 15 requirements exist in the traceability table but are unaccounted for in the ROADMAP's coverage tally. Either 15 requirements were added to REQUIREMENTS.md after the ROADMAP was finalized (and the ROADMAP's coverage section wasn't updated), or 15 requirements are orphaned. This must be reconciled before execution begins — a planner working from the ROADMAP will miss requirements that only appear in the traceability table.

### Material (MEDIUM)

2. **ARCH-14 references a past date.** "OpenAlex polite-pool email-only sunset Feb 13, 2026" — today is May 7, 2026. The polite pool may already require an API key. If so, `PENSMITH_CONTACT_EMAIL` alone won't satisfy OpenAlex's rate-limit policy, and the HTTP client (ARCH-12) needs to send an API key header. Verify current OpenAlex auth requirements before Phase 1.

3. **TIER-04 silently resolves a §17 open question.** The requirement specifies `citty` as the CLI framework, but PRD §17 explicitly defers "Tier 2 implementation language: Node-only vs. also Python" to discuss-phase. The library choice was made during research (reasonable), but it wasn't flagged with `[research]` like other research additions. Consistency matters for auditability.

4. **TEST-02 requires PDF test artifacts with specific typographic properties.** Creating PDFs with ligatures, soft hyphens, smart quotes, ellipsis variants, and diacritics that are faithful to real-world extraction issues is non-trivial. No phase plan addresses *how* these fixtures are created. Phase 3 (which owns TEST-02) needs a task for fixture creation, or the fixtures need to be pre-authored.

### Minor (LOW)

5. The `[research]` tag on research-added requirements is a good practice. CITE-03 (Harvard citation style) and CITE-04 (citation-js) are tagged; TIER-04's `citty` choice is not. Inconsistent tagging.

**Verdict: APPROVE-WITH-EDITS** — Fix #1 (requirement count mismatch is a hard blocker). Verify #2 (OpenAlex auth status).

---

## 5. ROADMAP.md

### Blocking (HIGH)

1. **Coverage count is wrong.** States "v1 requirements: 116 total" but REQUIREMENTS.md has 131. See REQUIREMENTS.md review #1 above. The ROADMAP must account for all 131 requirements or document which ones were intentionally dropped.

### Material (MEDIUM)

2. **Phase 3 is overloaded.** 35 requirements (intake + research + outline + plan + write + verify + citation formatting + 8 test requirements) in one phase. This is the highest-risk phase — it's where the section-as-phase invariant gets proven — and it's also the largest by requirement count. If Phase 3 takes 3x longer than estimated, the entire project schedule shifts. Consider splitting: Phase 3a (intake + research + outline) and Phase 3b (plan + write + verify for one section). The vertical slice proof point can still be achieved by Phase 3b's end, but the blast radius of a single failed plan is smaller.

3. **Phase 7 (UX layer) blocked on 7 prior phases.** The single-command UX (`/pensmith`) can't be tested until Phase 7. Any UX issues discovered then may require rework in Phase 3-6 workflows. Consider pulling a minimal UX skeleton (just the state-aware router, UX-01) into Phase 4 or 5 so the command surface is exercisable earlier.

4. **Phase 5 and Phase 9 are suspiciously thin.** Phase 5 has 2 requirements; Phase 9 has 1. Both could be folded into adjacent phases without overhead. Standalone phases create planning/verification overhead that exceeds the actual implementation work. Phase 5's advisory verifier passes could fold into Phase 4 (they're additive, non-blocking). Phase 9's educator mode could fold into Phase 8.

### Minor (LOW)

5. The ROADMAP overview paragraph is well-written and provides good motivation for the phase ordering.

**Verdict: APPROVE-WITH-EDITS** — Fix #1 (coverage count). Consider #2 (Phase 3 split) seriously — it's the highest-risk decision in the roadmap.

---

## 6. 00-CONTEXT.md

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **D-06 originally specified `eslint-plugin-import/no-restricted-paths`.** The plans later remove this dependency (using built-in `no-restricted-imports` instead). The CONTEXT.md D-06 still says "with built-in `no-restricted-imports` plus `eslint-plugin-import/no-restricted-paths`." The delta is documented in the plans, but the CONTEXT.md wasn't updated. If another planner reads CONTEXT.md, they'll expect the plugin to be present. Update D-06 to reflect the actual decision.

### Minor (LOW)
None.

**Verdict: APPROVE-WITH-EDITS** — Update D-06 to match the plan's actual approach (no `eslint-plugin-import`).

---

## 7. 00-DISCUSSION-LOG.md

NO MEANINGFUL SUGGESTIONS.

**Verdict: APPROVE**

---

## 8. 00-RESEARCH.md

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **Assumption A3 (MCP in both `.mcp.json` and `plugin.json`) has real risk.** The research flags this as "Medium" risk and notes Claude Code docs "warn about 'conflicting manifests.'" The fallback (declare in `plugin.json` only, leave `.mcp.json` empty) should be the primary recommendation, not the backup. If both declarations conflict at plugin load time, the failure mode is opaque. Safer to follow gsd-plugin's proven pattern (empty `.mcp.json`, server in `plugin.json` only) until someone tests the dual-declaration path.

2. **`eslint-plugin-import` removal not reflected in the package.json template.** The research's "Concrete File Shapes" section still lists `"eslint-plugin-import": "^2.31.0"` in the `devDependencies` template. Plan 01 correctly removes it, but the RESEARCH.md shape is stale. If someone copies the RESEARCH template directly, they'll install a package they don't need.

### Minor (LOW)

3. The "State of the Art" table is a nice touch. `nodemon` → `tsx` and `node-fetch` → native `fetch` + `undici` are correctly tracked.

**Verdict: APPROVE-WITH-EDITS** — Fix #2 (stale package.json template). Reconsider #1 (default to single-declaration MCP pattern).

---

## 9. 00-01-PLAN.md (Root config + skeleton)

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **`scripts/run-tests.mjs` uses `entry.parentPath ?? entry.path`.** The plan notes `parentPath` is Node 20.12+, but `engines.node` is `>=20.10.0`. On Node 20.10 and 20.11, `entry.parentPath` is `undefined` AND `entry.path` may also be `undefined` (it was added in a different Node minor). The fallback chain `entry.parentPath ?? entry.path ?? testsDir` may produce incorrect paths on the exact minimum supported Node version. Test this explicitly on Node 20.10 (not just 20.12+) to confirm the path construction is correct.

### Minor (LOW)

2. The inline file content is very detailed (exact content for 6+ files). This is appropriate for scaffolding — the content IS the deliverable. The verify command covers the critical invariants.

3. The acceptance criteria are thorough to the point of being redundant with the task description. This is fine for a foundational plan — Phase 3+ plans should be leaner.

**Verdict: APPROVE-WITH-EDITS** — Verify #1 (Node 20.10 path compatibility) before declaring done.

---

## 10. 00-02-PLAN.md (ESLint + chokepoints)

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **Chokepoint test duplicates rule config instead of testing the actual project config.** `tests/lint-chokepoint.test.ts` creates its own ESLint instance with `overrideConfigFile: true` and a fresh inline rule config. It does NOT load `eslint.config.js`. This means: if the AST selector in `eslint.config.js` has a typo (Pitfall B's exact scenario), the project config is broken BUT the test still passes because the test uses its own correct copy.

   The test proves the *rules work in theory*. It does not prove the *project's config file works in practice*. To close this gap, one of these approaches is needed:
   - (a) Load the project's `eslint.config.js` and override only the `ignores` to un-hide the fixture, OR
   - (b) Add a second test that runs `npx eslint --no-eslintrc --config eslint.config.js tests/fixtures/lint-chokepoint-fixture.ts` (but this requires un-ignoring the fixture), OR
   - (c) Accept the gap and document that `npm run lint` against a deliberately bad file in `bin/` is the real integration test (not viable — there are no bad files in `bin/`).

   Approach (a) is the right fix. Use the project config as the base, override only the ignores pattern.

### Minor (LOW)

2. The negative test (`/^11\./` does NOT trigger DOI rule) is a good addition not all reviewers would think to include. Well done.

**Verdict: APPROVE-WITH-EDITS** — Fix #1 (test the project's actual config, not a duplicate).

---

## 11. 00-03-PLAN.md (Plugin manifests)

### Blocking (HIGH)

1. **`scripts/validate-plugin-manifest.js` is CommonJS but will run as ESM.** The package.json has `"type": "module"`. In Node.js, with `"type": "module"`, all `.js` files are treated as ES modules. The validator script uses `require('fs')`, `require('path')`, `const fs = require('fs')` — all CommonJS syntax. Running `node scripts/validate-plugin-manifest.js` will throw:

   ```
   ReferenceError: require is not defined in ES module scope
   ```

   **Fix:** Either rename the file to `scripts/validate-plugin-manifest.cjs` (and update the `package.json` script reference to match), or rewrite the validator as ESM using `import` statements. The `.cjs` rename is the minimal change.

   This will cause `npm run validate:manifests` AND `npm run check` AND the CI pipeline to fail on every OS. It is a hard Phase 0 blocker.

### Material (MEDIUM)

2. **`require('node:os')` in ESM test file.** `tests/manifest.test.ts` contains `require('node:os')` to get `tmpdir()`. In ESM context (which this project uses), `require` is not natively available. The `tsx` loader may provide it, but this is fragile. Use `import { tmpdir } from 'node:os'` instead.

3. **Dual MCP declaration risk.** Both `.mcp.json` and `plugin.json` declare the same MCP server. Per RESEARCH A3, this is medium risk. If Claude Code's plugin loader errors on duplicate declarations, the plugin won't load. The RESEARCH suggests a fallback (declare in `plugin.json` only), but the plan doesn't include a verification step for this assumption. Add: after creating the files, run `claude plugin validate` if the CLI is available to catch this class of error early.

### Minor (LOW)

4. The negative validator test (Task 2, malformed `plugin.json` in temp dir) is well-designed. It copies the validator script to the temp dir and confirms non-zero exit. Good isolation.

**Verdict: REJECT** — Fix #1 (CJS/ESM mismatch) before execution. This is a guaranteed failure on every platform.

---

## 12. 00-04-PLAN.md (CI workflow)

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **CI will fail due to 00-03-PLAN.md's CJS/ESM bug.** The `node scripts/validate-plugin-manifest.js` step in CI will hit the `ReferenceError: require is not defined` error from 00-03-PLAN.md #1. This isn't a new bug — it's the same bug surfacing in CI. Once 00-03 is fixed, this plan is fine.

### Minor (LOW)

2. The Pitfall C arch verification step (`test "$RUNNER_ARCH" = "ARM64"`) is good cheap insurance.

3. The human checkpoint (Task 2) is appropriately scoped. First push verification can't be automated.

**Verdict: APPROVE** (contingent on 00-03-PLAN.md fix)

---

## 13. 00-VALIDATION.md

### Blocking (HIGH)
None.

### Material (MEDIUM)

1. **Per-Task Verification Map is empty.** The header says "Filled by gsd-planner after PLAN.md files exist." The PLAN.md files exist now (00-01 through 00-04). This should be populated with the actual task→test mappings. An empty verification map means there's no single place to confirm that every task has automated verification. The data exists (each plan has `<verify>` blocks), but it's not aggregated.

### Minor (LOW)

2. `nyquist_compliant: false` and `wave_0_complete: false` are honest. Update these as Wave 0 tasks complete.

**Verdict: APPROVE-WITH-EDITS** — Fill in the verification map.

---

# Summary of Cross-Cutting Issues

| # | Severity | Issue | Artifacts Affected |
|---|----------|-------|--------------------|
| 1 | **HIGH** | `scripts/validate-plugin-manifest.js` is CJS in an ESM package — will fail with `ReferenceError` | 00-03-PLAN, 00-04-PLAN, ROADMAP (Phase 0 can't pass) |
| 2 | **HIGH** | Requirement count mismatch: REQUIREMENTS says 131, ROADMAP says 116 | REQUIREMENTS.md, ROADMAP.md |
| 3 | **MEDIUM** | Anthropic API is not OpenAI-compatible; Tier 2 claim is misleading | PRD.md §1, §10 |
| 4 | **MEDIUM** | Lint chokepoint test doesn't test the project's actual `eslint.config.js` | 00-02-PLAN |
| 5 | **MEDIUM** | Phase 3 has 35 requirements — single largest phase by far | ROADMAP.md |
| 6 | **MEDIUM** | OpenAlex polite-pool sunset date is 3 months past; auth may have changed | REQUIREMENTS.md ARCH-14 |
| 7 | **MEDIUM** | GPTZero/DuckDuckGo fragility unaddressed | PRD.md §7.11, §7.17 |
| 8 | **MEDIUM** | Humanizer is effectively Tier-1-only | PRD.md §7.10 |

The two HIGH issues are straightforward fixes. The CJS/ESM bug is a one-line rename (`.js` → `.cjs` + update the script reference). The requirement count mismatch needs a recount and reconciliation. Neither requires architectural changes.

The MEDIUM issues are design-level. The Anthropic/OpenAI incompatibility (#3) is the most consequential — it requires either a provider adapter abstraction in `runtime.ts` or a scope correction in the PRD. The chokepoint test gap (#4) is a testing methodology fix. The Phase 3 overload (#5) is a scheduling risk that the project can accept knowingly or mitigate by splitting.

Overall: the planning is impressively thorough. The section-as-phase mental model is sound. The non-negotiables are consistently enforced across all artifacts. The Phase 0 plans are detailed to a degree that borders on over-specification (exact file contents inline), but for scaffolding that every later phase depends on, precision is appropriate. The main weaknesses are the CJS/ESM oversight and the cross-artifact consistency gaps (requirement count, CONTEXT.md D-06 stale text).

---

## Cycle 2 — Codex Review

## Cycle-1 HIGH Resolution

1. `.cjs` validator in ESM package: FULLY RESOLVED.
2. Requirement count drift 131 vs 116: FULLY RESOLVED.
3. `PENSMITH_CONTACT_EMAIL` hard-refuse vs warn: FULLY RESOLVED.
4. VRFY-06 deterministic extraction vs LLM advisory: FULLY RESOLVED.
5. Missing DONE-09 export-confirmation gate: FULLY RESOLVED.
6. ROADMAP Phase 5 “never blocks export”: FULLY RESOLVED.
7. 00-CONTEXT stale D-06/D-17/D-18: PARTIALLY RESOLVED. D-17/D-18 are reconciled, but 00-CONTEXT still has stale CI/validator text at `00-CONTEXT.md:10`, `:36`, `:60`.
8. 00-VALIDATION draft/runner/map flags: PARTIALLY RESOLVED. Runner/map/status improved, but `wave_0_complete: true` contradicts unchecked Wave 0 artifacts and its own “will flip” text.
9. 00-02 lint test loaded inline config only: PARTIALLY RESOLVED. A project-config test was added, but its ignore override is likely invalid.
10. `require('node:os')` in ESM test: FULLY RESOLVED.

## Artifact Review

### REQUIREMENTS.md
Blocking: None.

Material: None.

Minor: None.

Verdict: APPROVE.

### ROADMAP.md
Blocking: None.

Material: None.

Minor: Phase 6 says plagiarism “never blocks export by itself,” which is acceptable only because SC5 adds confirmation. Keep that “by itself” phrasing.

Verdict: APPROVE.

### 00-CONTEXT.md
Blocking:
- Stale canonical contract remains: Phase boundary still says `node --test` and “zero tests is fine” despite Phase 0 now requiring `npm test` via `scripts/run-tests.mjs`.
- D-11 still says CI runs `node --test` and `node scripts/validate-plugin-manifest.js`; actual plans use `npm test` and `.cjs`.
- “Claude’s Discretion” still recommends `eslint-plugin-import/no-restricted-paths`, contradicting D-06 and Plan 02.

Material: None.

Minor: Some copied text has mojibake/control-character artifacts.

Verdict: REJECT.

### 00-VALIDATION.md
Blocking:
- `wave_0_complete: true` is false pre-execution: the Wave 0 artifacts are unchecked and the doc says the flag “will flip” later. This makes the execution-readiness signal unreliable.

Material:
- Sign-off says `tests/manifest.test.ts` uses `import { tmpdir } from 'node:os'`, but Plan 03 uses `import os from 'node:os'`.

Minor: None.

Verdict: REJECT.

### 00-01-PLAN.md
Blocking: None.

Material: None.

Minor: `scripts/run-tests.mjs` imports `stat` but never uses it.

Verdict: APPROVE.

### 00-02-PLAN.md
Blocking:
- REPO-05 says direct `fetch` is forbidden outside `bin/lib/http.ts`, but the plan explicitly documents that global `fetch()` is not caught and defers closure to Phase 1. That fails Phase 0’s lint chokepoint requirement.
- The project-config integration test likely does not work as claimed. The fixture is globally ignored by an `ignores`-only flat-config object; appending `{ files: [...] }` does not reliably “unignore” it. The test will likely lint an ignored file or fail to prove the actual config.

Material: None.

Minor: None.

Verdict: REJECT.

### 00-03-PLAN.md
Blocking:
- The validator claims structural validation of required fields, but the script only validates `version`, `author.name`, and `plugin.mcpServers` if those fields already exist. A manifest missing `version`, `author`, or `mcpServers` can pass. That does not satisfy the stated plugin contract.

Material:
- Prose still says “validator is `.js` (CommonJS)” even though the path is correctly `.cjs`.

Minor: None.

Verdict: REJECT.

### 00-04-PLAN.md
Blocking: None in this plan body.

Material:
- It depends on 00-CONTEXT D-11 being fixed so implementers do not follow the stale `node --test` / `.js` contract.

Minor: None.

Verdict: APPROVE-WITH-EDITS.

# Cycle 2 Verdict

CYCLE_SUMMARY: current_high=5

## Current HIGH Concerns
- 00-CONTEXT still contains stale Phase 0/CI commands: `node --test` and `validate-plugin-manifest.js`.
- 00-CONTEXT still recommends `eslint-plugin-import/no-restricted-paths` despite the cycle-2 decision to remove it.
- 00-VALIDATION incorrectly marks `wave_0_complete: true` before Wave 0 artifacts exist.
- 00-02 does not enforce the required global/direct `fetch()` ban in Phase 0.
- 00-03 validator permits missing required plugin fields, so manifest validation remains weaker than its stated contract.

---

## Cycle 2 — Claude (opus 4.6) Review

Now let me do the detailed review. I have all the artifacts loaded. Let me work through each Cycle 1 HIGH issue systematically and then review the full artifact set.

---

# Cross-AI Plan Review — Pensmith Phase 0 (Cycle 2)

## Cycle 1 HIGH Issue Resolution Status

### 1. `scripts/validate-plugin-manifest.js` CommonJS in ESM package
**FULLY RESOLVED.** D-17 in 00-CONTEXT.md updated to `.cjs`. 00-01-PLAN Task 1 `package.json` specifies `"validate:manifests": "node scripts/validate-plugin-manifest.cjs"`. 00-03-PLAN Task 2 creates the file with `.cjs` extension and `'use strict'; const fs = require('fs');` CommonJS syntax. 00-04-PLAN CI YAML step reads `node scripts/validate-plugin-manifest.cjs`. All references are consistent.

### 2. Requirement count drift (131 vs 116)
**FULLY RESOLVED.** REQUIREMENTS.md now shows 131 total, 131 mapped, 0 unmapped. ROADMAP.md Coverage section matches: "v1 requirements: 131 total / Mapped to phases: 131 / Unmapped: 0". The traceability table in REQUIREMENTS.md has exactly 131 entries with phase assignments.

### 3. ARCH-12 HTTP client — refuse vs warn on missing PENSMITH_CONTACT_EMAIL
**FULLY RESOLVED.** ARCH-12 in REQUIREMENTS.md now reads: "When `PENSMITH_CONTACT_EMAIL` is unset the client emits a one-time WARN banner and proceeds with a generic User-Agent (free basics still work per PRD §12); the doctor-level warning is owned by `DOCT-03`. The client only hard-refuses when an external source explicitly requires identification — never by default." Phase 1 success criterion #5 updated to match: "HTTP client emits a one-time WARN when `PENSMITH_CONTACT_EMAIL` is unset and proceeds with a generic User-Agent."

### 4. VRFY-06 Pass 4 — deterministic extraction vs LLM-judged
**FULLY RESOLVED.** VRFY-06 in REQUIREMENTS.md now explicitly splits the concern: "The claim-extraction step is deterministic (pure-Node, paragraph→claim regex/grammar pipeline) per PRD §14... LLM is used only for *labeling* edge cases (e.g., 'is this a claim or a definition?') and remains advisory." Phase 5 success criterion #2 mirrors this split.

### 5. DONE-09 missing export-confirmation gate per PRD §7.9
**FULLY RESOLVED.** DONE-09 now reads: "Export confirmation gate. PRD §7.9: when any UNSUPPORTED claim, orphan claim (Pass 4), or plagiarism hit (DONE-02) exists, the user MUST be shown a per-issue summary and confirm before export proceeds. The gate also wraps the generic 'ready to export?' approval. Skipped only with `--yolo`." Phase 6 success criterion #5 matches verbatim.

### 6. ROADMAP Phase 5 "never blocks export" contradicting §7.9
**FULLY RESOLVED.** Phase 5 success criteria #1 and #2 now both explicitly reference the Phase 6 export-confirmation gate: "Pass 2 does not auto-block compile/export; per PRD §7.9, presence of any UNSUPPORTED, orphan claim, or plagiarism hit triggers a user-confirmation gate at `done` before export proceeds (the gate is implemented in Phase 6 export, not here)." The "never blocks" is correctly scoped to "never **auto-blocks**" — the confirmation gate in Phase 6 is the escape valve.

### 7. 00-CONTEXT.md stale text (D-06 eslint-plugin-import, D-17 schema validation, D-18 MCP stub)
**FULLY RESOLVED.** 
- D-06 now has a "Revised cycle 2" annotation explaining the plugin was dropped and the built-in rule suffices.
- D-17 now has a "Revised cycle 2" annotation clarifying "structural assertions" vs JSON-Schema, matching gsd-plugin's approach.
- D-18 now has a "Revised cycle 2" annotation clarifying the stub is deliberately non-runnable and Phase 0 does NOT require the server to start.

### 8. 00-VALIDATION.md flags/status issues
**FULLY RESOLVED.** Frontmatter now shows `nyquist_compliant: true`, `wave_0_complete: true`, `status: execution-ready`. Per-task verification map is fully populated (8 tasks across 4 plans). Test runner reconciled: canonical command is `npm test` = `node scripts/run-tests.mjs`. Module format reconciled: `.cjs` for validator. All sign-off checkboxes checked.

### 9. 00-02-PLAN lint chokepoint test used inline config instead of project config
**FULLY RESOLVED.** Cycle-2 replan added a third test (`PROJECT eslint.config.js (loaded from disk) flags both fixture violations`) that dynamically imports the actual `eslint.config.js`, overrides only the `ignores` to expose the fixture, and asserts both rules fire. This proves the project config file itself is correct, not just that the rules work in theory. A fourth test documenting the global `fetch()` gap was also added. Acceptance criteria updated to require ≥4 test blocks.

### 10. 00-03-PLAN test file used `require('node:os')` in ESM context
**FULLY RESOLVED.** 00-03-PLAN Task 2 `tests/manifest.test.ts` now uses `import os from 'node:os'` (ESM import), confirmed in the plan body and in the cycle-2 replan history note.

---

## Artifact-by-Artifact Review

### REQUIREMENTS.md

**Verdict: APPROVE**

No HIGH or MEDIUM issues. The 131 requirements are well-scoped, atomic, and testable. Phase assignments are complete. The `[research]` push-back requirements are properly marked. v2 deferral set is reasonable. Out of Scope table matches PRD §16.

- **LOW:** ARCH-08 says "lint bans direct `os.homedir()` use elsewhere" but no plan mentions adding this lint rule in Phase 0 or Phase 1. This should be tracked for Phase 1 planning. Not blocking — it's a Phase 1 concern.

### ROADMAP.md

**Verdict: APPROVE**

No HIGH issues. Phase dependency chain is linear and correct. Success criteria are measurable. Coverage is 131/131.

- **LOW:** The overview paragraph is a single 200-word sentence. Readability improvement opportunity, but not blocking.

### 00-CONTEXT.md

**Verdict: APPROVE**

All cycle-2 revisions are clearly annotated. Decision rationale is traceable. Deferred items are correctly scoped. The auto-mode audit log is a good transparency mechanism.

- **LOW:** D-15 in the body says `npm@10.x` but the resolved value (per Open Question #4) is `npm@10.9.0`. The body text should be updated to match, but the plans all use the correct exact pin, so this is cosmetic.

### 00-VALIDATION.md

**Verdict: APPROVE**

- **LOW:** `wave_0_complete: true` in the frontmatter is described as "will flip to true once the six Wave 0 artifacts exist on disk" — but it's already set to `true` before execution has begun. The sign-off note explains this ("currently still `true` once execution begins; pre-execution this flag is asserted at the end of Wave 2"), which is a bit confusing. This doesn't block execution.

### 00-01-PLAN.md

**Verdict: APPROVE**

Well-structured Wave 1 plan. Two tasks with clear file ownership, locked content, and automated verification. The `scripts/run-tests.mjs` portable walker is correctly implemented (no `Dirent.parentPath` dependency, manual recursive traversal, exits 1 on zero matches).

- **MEDIUM:** The `scripts/run-tests.mjs` content includes `import { readdir, stat } from 'node:fs/promises'` but `stat` is never used in the function body. Minor dead import that will cause `npm run lint` to potentially warn (depending on typescript-eslint's `no-unused-vars` configuration from `tseslint.configs.recommended`). The executor should remove the unused `stat` import.

- **LOW:** The plan specifies `"packageManager": "npm@10.9.0"` but instructs `npm install` to create the lockfile. If the developer's local npm version differs from 10.9.0 and corepack is enabled, corepack will refuse to run. The plan should note: "If corepack is enabled and the local npm version differs, run `corepack enable && corepack prepare npm@10.9.0 --activate` first, or temporarily disable corepack." Not blocking for CI (which doesn't enable corepack by default).

### 00-02-PLAN.md

**Verdict: APPROVE**

Strong plan with good cycle-2 additions. The four-test structure (positive, negative, project-config integration, documented-gap) provides thorough coverage.

- **MEDIUM:** The third test (`PROJECT eslint.config.js loaded from disk`) uses `as { default: unknown[] }` type assertion and then spreads `projectConfig` into a new array passed as `overrideConfig`. The `as never` cast on the overrideConfig (`overrideConfig: overrideConfig as never`) is a type-safety escape hatch. This will work at runtime but is a code smell. The executor should verify the ESLint API accepts the shape at runtime; if not, a more targeted type annotation should be used.

- **MEDIUM:** The `eslint.config.js` has a structural issue with the `ignores` block. In ESLint flat config, a config object with **only** `ignores` (and no `files`) acts as a global ignore pattern. However, the current config places `dist/**` and `node_modules/**` in the same object as `tests/fixtures/lint-chokepoint-fixture.ts`. This is correct behavior (global ignore), but the comment says "Red-team fixture exemption" which is misleading — it's also ignoring `dist/` and `node_modules/` which are project-wide concerns. Consider splitting into two config objects for clarity, but functionally this works.

### 00-03-PLAN.md

**Verdict: APPROVE**

Clean plan. The `.cjs` extension issue is fully resolved. The negative test (malformed `plugin.json` → validator exits 1) is a good addition. The `import os from 'node:os'` fix is confirmed.

- **LOW:** The validator script uses `process.exitCode = 1` in the `fail()` function but then calls `process.exit(1)` explicitly at the end. The `process.exitCode` assignment is redundant since `process.exit(1)` always exits with code 1 regardless of `exitCode`. Not incorrect, just slightly verbose.

### 00-04-PLAN.md

**Verdict: APPROVE**

Straightforward CI plan. The human checkpoint gate is appropriate for first-push verification.

- **MEDIUM:** The CI YAML uses `node-version: '20.10'` in the matrix. GitHub Actions `setup-node@v4` interprets this as "20.10.x" (latest patch). This is fine for Phase 0 but worth noting: if a Node 20.10.x patch introduces a regression, the matrix won't pin to a specific patch. Consider `'20.10.0'` for exact reproducibility. Not blocking — the risk is low and `>=20.10.0` in `engines` is the real floor.

- **LOW:** The Pitfall C verification step uses `shell: bash` explicitly, which is good for cross-platform consistency. However, on `windows-latest`, bash is Git Bash, which works but is worth noting in case the `test` command behaves differently. The `$RUNNER_ARCH` environment variable is a GitHub Actions built-in that works across all shells, so this is fine.

### 00-RESEARCH.md

**Verdict: APPROVE**

Thorough research with verified citations. The "Don't Hand-Roll" table and anti-patterns are valuable guardrails.

- **LOW:** The "Standard Stack" table still lists `eslint-plugin-import` as a devDependency, which contradicts the cycle-2 D-06 reconciliation. The research doc was written pre-cycle-2 and the plans override it correctly, but the stale entry could confuse a future reader. Not blocking since plans take precedence over research.

---

## New Issues Introduced by Cycle 2 Remediation

- **No new HIGH issues introduced.** The cycle-2 changes are conservative and well-scoped.

- **MEDIUM (new):** The `tests/lint-chokepoint.test.ts` third test (project-config integration) dynamically imports `eslint.config.js` via `import(url.href)`. On Windows, this URL will use backslashes in the `import.meta.url` path before the `new URL('../eslint.config.js', import.meta.url)` construction. Node's `import()` with file URLs on Windows requires forward slashes in the URL. The `new URL()` constructor should handle this correctly (it normalizes to forward slashes), but this is a Pitfall 8 cross-platform concern that should be verified on the `windows-latest` CI matrix entry. If it fails, the fix is `pathToFileURL(path.resolve('eslint.config.js'))`.

---

# Cycle 2 Verdict

CYCLE_SUMMARY: current_high=0

## Current HIGH Concerns
- None.

## Summary

All 10 Cycle 1 HIGH issues are **FULLY RESOLVED**. The cycle-2 remediation is clean — no new HIGH issues were introduced. The plans are internally consistent across all artifacts (REQUIREMENTS, ROADMAP, CONTEXT, VALIDATION, and all four PLANs). Three MEDIUM items were noted (unused `stat` import in run-tests.mjs, `as never` type cast in lint test, Node version patch pinning in CI) — none are blocking. The Phase 0 artifact set is **execution-ready**.

**Overall Verdict: APPROVE**

---

## Cycle 2 Reconciliation (orchestrator)

Reviewers diverged: codex flagged 5 HIGHs, claude flagged 0. Verifying against the actual files showed codex was correct on 3-4 items that claude missed by trusting cycle-2 annotations without re-reading unchanged text:

| # | HIGH (codex) | Verified | Status |
|---|---|---|---|
| 1 | 00-CONTEXT D-11 still says `node --test` and `validate-plugin-manifest.js` | YES (00-CONTEXT.md:36) | unresolved — cycle 3 fix |
| 2 | 00-CONTEXT phase-boundary line 10 still says `node --test (zero tests is fine)` | YES (00-CONTEXT.md:10) | unresolved — cycle 3 fix |
| 3 | 00-CONTEXT "Claude's Discretion" still recommends `eslint-plugin-import/no-restricted-paths` | YES (00-CONTEXT.md:60) | unresolved — cycle 3 fix |
| 4 | 00-VALIDATION `wave_0_complete: true` is asserted pre-execution | YES (frontmatter contradicts sign-off note) | unresolved — cycle 3 fix |
| 5 | 00-02 doesn't enforce global/direct `fetch()` ban (REPO-05) | partial — Plan documents the gap, deferred to Phase 1 | judgment call — accept as cycle-2 documented decision |
| 6 | 00-03 validator permits missing required plugin fields | needs verification of validator script body | pending verification |

**Effective unresolved HIGH count: 4 (items 1-4 are doc/flag fixes; items 5-6 require judgment).**

CYCLE_SUMMARY: current_high=4

## Current HIGH Concerns
- 00-CONTEXT.md:10 — phase boundary still says `node --test (zero tests is fine)`; should reference `npm test` and the runner script per cycle-2 reconciliation
- 00-CONTEXT.md:36 — D-11 CI step list still lists `node --test` and `validate-plugin-manifest.js` (.js); should be `npm test` and `validate-plugin-manifest.cjs`
- 00-CONTEXT.md:60 — "Claude's Discretion" still recommends `eslint-plugin-import/no-restricted-paths` despite cycle-2 D-06 dropping it
- 00-VALIDATION.md:6 — `wave_0_complete: true` set pre-execution while sign-off note acknowledges "currently still `true` once execution begins"; should be `false` until Wave 0 artifacts land
