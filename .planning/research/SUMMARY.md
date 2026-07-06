# Project Research Summary

**Project:** pensmith v0.3.0 "Truly End-to-End"
**Domain:** Integration/hardening milestone on an existing AI-assisted academic paper writing tool (source-feed wiring, CI hardening, network/PDF security)
**Researched:** 2026-07-06
**Confidence:** HIGH

## Executive Summary

v0.3.0 is not greenfield work — it is closing three well-scoped, well-understood gaps in an already-shipped pipeline. **FEED** wires the already-designed source-isolation contract (documented in `templates/prompts/section-{planner,drafter}.md` since earlier milestones) into three placeholder call sites (`outline.ts:205`, `plan.ts:127-133`, `write.ts:216-222`) via one new pure module, `bin/lib/source-context.ts`. No schema changes are needed — `DrafterInputSchema` already declares the exact restricted `assignedSources` shape FEED needs to populate. **HARDEN** promotes the existing offline `scripts/e2e-smoke.mjs` harness to a strict, required CI gate, adds a secrets-gated live-provider lane modeled on the already-proven `cassette-refresh.yml` pattern, and adds a citation-integrity differential test. **SEC** closes two independent, file-scoped security residuals that were deliberately deferred and documented in `.planning/SECURITY.md`: DNS-rebind TOCTOU (WR-03, via undici's `connect` callback / socket pinning) and PDF-parse timeout that doesn't actually cancel CPU-bound work (WR-05, via `node:worker_threads`).

The recommended approach requires **zero new dependencies** — every workstream reuses packages already in `package.json` (`undici@^7`, `fast-check@^3`, `nock@^14`, Node's built-in `worker_threads`) differently, not new acquisitions. The primary engineering risk is not "will this work" but "will it be implemented in the *correct shape*": socket-pinning must be a real undici `connect` callback preserving the original hostname for TLS SNI (not a naive IP-substitution that breaks virtual-hosted HTTPS), and the strict e2e gate's FEED-specific assertions are meaningless until FEED's real data exists — sequencing matters even though the three workstreams are largely independent.

**Important correction to the pitfalls research's framing:** PITFALLS.md treats the 37-finding `AUDIT-FINDINGS.md` audit as open/live and repeatedly recommends sequencing HARDEN's strict e2e gate and citation-integrity test *behind* fixes to the router/state-transition bugs (#1, #8, #9, M1) and the citekey-regex gap (#2/#20). **This is stale.** All 37 findings were fixed and merged to `main` in the audit-hardening pass (PRs #3–#19) immediately preceding this milestone. The router/state-transition bugs are fixed, so promoting `e2e-smoke.mjs` to a strict required gate is safe now — it will not go red on day one from pre-existing findings. The citekey-regex gap is fixed (broad `extractCitedKeysForVerification` + widened verdict-row parsing), so FEED and the regex fix are not co-requisites — the regex work is already shipped, and HARDEN's citation-integrity differential test now guards a fix that already exists rather than blocking on one that doesn't. Pitfall 4 and Pitfall 3's "co-requisite" framing should be read as **already satisfied**, not as outstanding sequencing risk.

## Key Findings

### Recommended Stack

No new core technology is needed. The three workstreams are internal wiring on packages already validated in v0.1.0/v0.2.0.

**Core technologies:**
- `undici@^7` (installed `7.25.0`) — already the sole HTTP chokepoint (`bin/lib/http.ts`, D-06). For WR-03, its `connect` option (via `buildConnector()`) is the correct primitive to pin the already-`checkSsrf()`-validated address into the actual TCP/TLS connect step, closing the TOCTOU window. Confirmed stable across the entire 7.x line via Context7.
- `node:worker_threads` (Node core, >=20.10) — for WR-05, isolates the `pdf-parse` call so `worker.terminate()` can genuinely reclaim CPU on timeout; `Promise.race` alone never cancels the losing promise. No package needed.
- `fast-check@^3` (installed `3.23.2`) — already a devDependency, already used for this exact class of property test (`tests/doi.property.test.ts` and siblings); the citation-integrity differential/property test is new test code on an existing tool.
- GitHub Actions `environments` + `push`/`workflow_dispatch`-only triggers (never `pull_request_target`) — the standard, already-precedented (`cassette-refresh.yml`) mechanism for scoping secrets to a live-provider CI lane without exposing them to fork PRs.

No supporting libraries are needed for FEED — it's prompt-string assembly plus a PLAN.md frontmatter field, consuming `LIBRARY.json` through existing Zod-validated schemas.

### Expected Features (context: this is an integration milestone on an already-scoped product)

The original FEATURES.md (2026-05-06) validated pensmith's v0.1.0 feature set against the competitive landscape; v0.3.0 doesn't add product features so much as make an already-designed differentiator actually load-bearing.

**What v0.3.0 closes (addendum, 2026-07-06):**
- Citation-grounded drafting where the drafter cites *only* from its section's mapped sources — the core differentiator ("our drafter cannot fabricate a citation by construction") — is currently unenforced because the prompt call sites are placeholders. FEED makes this real.
- The prompt templates (`section-planner.md`, `section-drafter.md`) already fully specify the target contract, including "NEVER invent a citekey" and a restricted-view instruction — this is finishing already-designed work, not designing new feature surface.

**Should have / hardening differentiators this milestone reinforces:**
- Section-isolated state (load-bearing, per CLAUDE.md) — FEED must implement isolation as a *data-flow property* (the drafter's code path structurally cannot reach unfiltered `LIBRARY.json`), not just a prompt instruction.
- Trust signals (honest citation verification, no fabricated sources reaching compile) — HARDEN's citation-integrity differential test and strict e2e gate are direct proof-points for this positioning.

**Defer:** Nothing in FEED/HARDEN/SEC scope is deferrable — all three are closing already-committed technical debt (`.planning/PROJECT.md` carried-forward items) rather than optional feature work.

### Architecture Approach

The existing pipeline (`new -> research -> outline -> {plan -> write -> verify}* -> compile -> done`) is unchanged by v0.3.0; all three workstreams are internal wiring/hardening on top of it. FEED introduces exactly one new pure module and modifies three call sites; HARDEN modifies one script and one CI workflow plus adds two new test files; SEC modifies two existing chokepoint files and adds one new worker-entry file. No new architectural layer, no new state machine, no schema changes to `DrafterInputSchema` or `PlanFrontmatterSchema`.

**Major components:**
1. **`bin/lib/source-context.ts` (NEW, pure)** — transforms `SourceCandidate[]` (already loaded from `LIBRARY.json`) into the exact JSON shape each prompt's `{{candidateSources}}`/`{{assignedSources}}` placeholder expects, with two projections: full filtered pool (outline/plan) and citekey-restricted subset (write). Enforces section-isolation *by construction* — the drafter's prompt-building code path cannot reach unfiltered library data.
2. **Three-layer isolation enforcement (existing, now fed real data)** — (a) prompt-injection layer: `write.ts` filters before interpolation; (b) schema layer: `assertDrafterInput`'s existing `.strict()` chokepoint; (c) post-hoc verification layer: Pass-1's broad citekey extraction independently re-checks any citekey in DRAFT.md against the section's `assigned_sources`. FEED feeds layer (a); layers (b)/(c) are unchanged.
3. **`scripts/e2e-smoke.mjs` promoted to strict, required CI job** — generalizes its existing router-advance assertion pattern (already proven for research->outline) to plan->write->verify->compile->done, plus new FEED-specific assertions (assigned_sources population and citekey containment) that only become meaningful once FEED lands.
4. **`bin/lib/http.ts` connect-pin (SEC/WR-03)** — `checkSsrf()`'s return contract changes from `Promise<void>` to surfacing the validated address, threaded into a per-request undici `Agent` `connect` callback that dials the pre-validated IP while preserving the original hostname for TLS SNI.
5. **`bin/lib/pdf-worker.ts` (NEW, SEC/WR-05)** — moves the `pdfParse()` call into a `worker_threads` Worker so `worker.terminate()` can genuinely stop CPU-bound work on timeout; wraps the whole retry loop in one worker, terminates on the outer timeout only.

### Critical Pitfalls

1. **FEED — Section-isolation leak in prompt construction.** If `LIBRARY.json` is read once and reused across sections instead of re-filtered per section from *that section's own* PLAN.md frontmatter at call time, a section's drafter prompt silently sees sibling sections' sources. Invisible in a single-section paper; only surfaces with 2+ disjoint sections. **Avoid by:** hard-filtering via `buildAssignedSources(entries, thisSectionsAssignedSources)` re-derived per call, never a hoisted/shared variable; test with a 2-section disjoint-assigned_sources fixture.
2. **FEED — No prompt-injection fencing on plan/write prompts.** Pass 2/4 (`claim-support.md`, `orphan-label.md`) already fence untrusted text with `PENSMITH_UNTRUSTED_DATA` markers; `section-planner.md`/`section-drafter.md` have none today. Once FEED wires real Crossref/OpenAlex/arXiv abstracts (attacker-influenceable metadata) into these prompts, this is a live, higher-stakes injection surface than Pass 2/4 because it shapes actual manuscript prose and citation selection, not just an advisory verdict. **Avoid by:** reusing the exact Pass 2/4 fence-marker + breakout-stripping mechanism in the *same commit* that wires real data in — do not ship wiring first and fence later.
3. **SEC — Socket-pinning implemented as naive IP-substitution instead of a real undici `connect` callback.** Substituting the resolved IP into the URL string looks like a smaller diff but breaks TLS SNI and `Host`-header virtual hosting for the majority of real HTTPS scholarly infrastructure (CDN-fronted OA mirrors). **Avoid by:** a proper `connect` callback on a per-request `Agent`/`Pool` that dials the validated IP while still presenting the original hostname for SNI; test against a real virtual-hosted HTTPS source, and add a new assertion that the validated address is exactly what gets dialed (the old `resolveFn`-injection test can stay green while the fix is entirely absent otherwise).
4. **HARDEN — historically, promoting `e2e-smoke.mjs` to strict risked failing on pre-existing router-bug FINDINGs (AUDIT #1/#8/#9/M1).** **This risk is now resolved** — those findings were fixed in the pre-milestone audit-hardening pass (PRs #3-#19). The strict gate can be promoted directly; still worth a fresh enumeration of current `[FINDING]`s before flipping the flag, purely as hygiene, not because a known-red gate is expected.
5. **SEC — Worker-thread PDF abort races (zombie workers, discarded valid results, unhandled worker errors).** Coordinating worker `message`/`error`/timer with exactly-once settlement is harder than racing two promises. **Avoid by:** a one-shot `settled` guard, both `message` and `error` listeners attached synchronously, `await worker.terminate()` before considering cleanup done, and a race-condition test at the exact timeout boundary.

## Implications for Roadmap

Based on combined research, the three workstreams map cleanly onto phases with one real cross-dependency (HARDEN's FEED-specific assertions require FEED to exist) and two fully independent tracks (SEC, and HARDEN's non-FEED-specific sub-phases).

### Phase 1: FEED — Source-Context Wiring + Isolation Fencing
**Rationale:** This is the milestone's headline and the prerequisite for HARDEN's most meaningful new assertions. The design already exists in the prompt templates; this phase is pure wiring plus closing the one security gap (prompt-injection fencing) that the wiring makes live for the first time.
**Delivers:** `bin/lib/source-context.ts` (new, pure, unit-tested standalone); `outline.ts`/`plan.ts`/`write.ts` reading real `LIBRARY.json` data instead of placeholders; `assigned_sources` persisted in PLAN.md frontmatter (no schema change); `PENSMITH_UNTRUSTED_DATA` fencing extended to `section-planner.md`/`section-drafter.md`; worked-example citekeys replaced with sentinel values.
**Addresses:** The core differentiator from FEATURES.md — "re-fetch every cited DOI during drafting, not after" and "section-isolated state (load-bearing)" — becomes actually enforced rather than aspirational.
**Avoids:** Pitfall 1 (isolation leak — filter per-section at call time, not hoisted), Pitfall 2 (un-fenced injection surface — fence in the same commit as wiring, not after), Pitfall 7 (context bloat — project to a prompt-safe view excluding `raw`, truncating `abstract`), Pitfall 9 (Tier-1/Tier-2 drift — update `workflows/plan.md`/`workflows/write.md` prose in lockstep).
**Sequencing internally:** `source-context.ts` (standalone, testable first) -> `outline.ts` -> `plan.ts` -> `write.ts`, mirroring the pipeline's own data dependency.

### Phase 2: SEC — DNS-Rebind Pinning + PDF Worker-Abort
**Rationale:** Fully independent of FEED and HARDEN (different files, different failure modes, no shared data flow). Can be built and merged in parallel with Phase 1 by a separate track.
**Delivers:** `bin/lib/http.ts` modified so `checkSsrf()` returns the validated address and `callOnce()` threads it into a per-request undici `Agent` `connect` callback (preserving original hostname for SNI); `bin/lib/pdf-worker.ts` (new) wrapping the `pdf-parse` call in a `worker_threads` Worker with `worker.terminate()` on timeout.
**Uses:** `undici@^7`'s `connect`/`buildConnector()` API (Context7-confirmed stable across 7.x); Node core `worker_threads`.
**Implements:** The connect-pin and worker-abort architecture components documented in ARCHITECTURE.md's SEC data-flow sections.
**Avoids:** Pitfall 5 (IP-substitution shortcut breaking TLS SNI/virtual hosting), Pitfall 6 (fix that keeps old tests green without closing the gap — requires a new address-dialed assertion), Pitfall 14 (redirect hops bypassing per-hop pinning — `maxRedirections` must stay unset, guarded by a test), Pitfall 15 (worker-thread race conditions — settled-guard + both listeners + awaited terminate), Pitfall 16 (new undici import site outside the `http.ts` chokepoint — keep pinning logic inside the existing exempted file).

### Phase 3: HARDEN — Strict E2E Gate, Live-Provider Lane, Citation-Integrity Test
**Rationale:** Sequenced last because its most valuable new assertions (assigned_sources population, citekey containment) are only meaningful once FEED's real data exists — checking "assigned_sources is a subset of LIBRARY.json citekeys" against placeholder data is vacuously true. The non-FEED-specific sub-parts (CI job promotion, router-advance generalization for plan->write->verify->compile->done) do not strictly require FEED and could start in parallel if bandwidth allows, but land the phase after FEED for a clean single narrative.
**Delivers:** `scripts/e2e-smoke.mjs` promoted to a required, strict CI job with `--strict` exit semantics; STATE.json/PLAN.md transition asserts generalized across all verb transitions (mirroring `router.ts::resolveNextAction`); new FEED-specific asserts (assigned_sources count in [3,15], citekey containment, DRAFT.md citekeys subset of assigned_sources); a secrets-gated live-provider CI lane modeled on the proven `cassette-refresh.yml` pattern (`schedule`/`workflow_dispatch` only, never `pull_request`/`pull_request_target`, never required); `tests/citation-integrity-differential.test.ts` (exporter-rendered citekeys subset of Pass-1-seen citekeys).
**Addresses:** Trust/correctness signals from FEATURES.md (tier-contract test, known-bad-citation fixtures) extended to full-pipeline and live-provider coverage.
**Avoids:** Pitfall 10 (flaky live APIs breaking a required lane — never make it required, model on `cassette-refresh.yml`), Pitfall 11 (forked-PR secret exposure via `pull_request_target` or over-broad `secrets: inherit`), Pitfall 12 (differential test where both legs replay the same stale cassette, testing nothing — one leg must hit live endpoints), Pitfall 13 (mistaking the offline strict gate for proof of prompt-content safety — keep these claims separate in phase success criteria).

**Note on Pitfall 3 and Pitfall 4's original "co-requisite"/"sequence-after" framing:** per the critical reconciliation, the router-bug and citekey-regex fixes these pitfalls flagged as blocking preconditions are *already shipped* (merged in PRs #3-#19 before this milestone). Phase 3 does not need to be gated behind additional router or regex fixes — it is hardening on top of an already-solid base. The only genuinely-live residual from Pitfall 3 is the *prompt-level* mitigation (few-shot negative examples, sentinel citekeys) which belongs in Phase 1 (FEED), not a precondition for Phase 3.

### Phase Ordering Rationale

- FEED before HARDEN's FEED-specific assertions: a data dependency, not a stylistic preference — those specific checks are meaningless against placeholder data.
- SEC fully parallel to both: no shared files, no shared data flow, confirmed independent by direct code inspection in ARCHITECTURE.md.
- Within HARDEN, the CI-job-promotion and router-advance-generalization work is safe to do immediately (the historical blocker — pre-existing router FINDINGs — no longer exists), removing what would otherwise have been the riskiest sequencing dependency in this milestone.
- The live-provider lane and the citation-integrity differential test are logically independent of FEED (they test the verifier/exporter path) but make more sense landed after FEED so a live-pipeline smoke run exercises non-placeholder data end-to-end.

### Research Flags

Phases likely needing deeper research during planning/implementation:
- **SEC (Phase 2):** Confirm the exact undici `connect` callback signature against the precisely pinned `undici` version in `package.json` at implementation time — Context7 confirms the API is stable across 7.x but the exact callback shape should get a final doc-lookup pass before coding (flagged MEDIUM confidence in STACK.md and as an explicit open question in ARCHITECTURE.md).
- **FEED (Phase 1):** The "OUTLINE.md `assigned_sources` column: advisory or authoritative?" question (ARCHITECTURE.md Open Questions) should be explicitly decided during phase planning, not left implicit — research recommends advisory-only (plan.ts re-derives from LIBRARY.json independently) but this affects whether `outline-parse.ts` needs any change at all.

Phases with standard, well-documented patterns (research-phase can be skipped or kept light):
- **HARDEN (Phase 3):** The live-provider lane has a directly-precedented pattern already in the repo (`cassette-refresh.yml`) to model against; the citation-integrity differential test composes two already-in-use tools (`fast-check` + existing citekey-extraction functions).
- **FEED's core wiring:** The target shape is already fully specified in existing prompt templates and an existing Zod schema — this is closer to "fill in the blank" than open design.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version claims checked against Context7 `/nodejs/undici` docs and live `npm ls`/`npm view` against the actual installed tree; no new dependencies to evaluate. |
| Features | HIGH (structural) / MEDIUM (external competitor specifics, inherited from the original 2026-05-06 research, not re-verified for this milestone) | The v0.3.0 addendum is codebase-verified (direct reads of prompt templates, schemas, call sites); the original competitive-landscape research is dated and not the primary driver for this integration milestone. |
| Architecture | HIGH | All integration points read directly from the existing codebase (file/line references throughout), not inferred from general patterns. |
| Pitfalls | HIGH (grounded in direct repo reads: `http.ts`, `plan.ts`, `write.ts`, prompt templates, `e2e-smoke.mjs`, CI workflows, `SECURITY.md`) | The audit-findings framing needed correction (see reconciliation) — the underlying pitfall analysis and prevention guidance for FEED/SEC remain sound; only the HARDEN sequencing conclusion changes now that the router/regex fixes are confirmed already shipped. |

**Overall confidence:** HIGH

### Gaps to Address

- **Undici `connect` callback exact signature:** needs a final documentation-lookup pass at SEC implementation time against the precisely pinned version (not a research gap, a "verify right before coding" item).
- **OUTLINE.md `assigned_sources` column authority (advisory vs. authoritative):** needs an explicit roadmap-level decision during Phase 1 planning; research has a recommendation (advisory) but flags it should not be left implicit.
- **Live-provider lane cost/flakiness tolerance:** research recommends `schedule`/`workflow_dispatch`-only, never required — this is a firm recommendation, not a gap, but the specific schedule cadence and which subset of the pipeline it exercises should be pinned down during Phase 3 planning.
- **AUDIT-FINDINGS.md currency:** confirmed via this milestone's reconciliation that all 37 findings are fixed and merged (PRs #3-#19). Future research/planning passes referencing this file should treat it as a historical record of already-remediated findings, not a live backlog, to avoid re-introducing stale sequencing assumptions.

## Sources

### Primary (HIGH confidence)
- Context7 `/nodejs/undici` — `connect(opts, cb)` function-form, `buildConnector()`, `interceptors.dns()`; confirmed current/stable across undici 7.x (`docs/docs/api/Connector.md`, `docs/docs/api/Client.md`, `docs/docs/api/Interceptors.md`).
- Direct repo inspection: `bin/lib/http.ts`, `bin/cli/{outline,plan,write}.ts`, `bin/lib/drafter-input.ts`, `bin/lib/schemas/{plan-frontmatter,source-candidate}.ts`, `bin/lib/pdf-text.ts`, `bin/lib/pymupdf-shellout.ts`, `templates/prompts/{section-planner,section-drafter,claim-support,orphan-label,outline-author,source-evaluator}.md`, `scripts/e2e-smoke.mjs`, `.github/workflows/{ci,cassette-refresh}.yml`, `.planning/SECURITY.md`, `.planning/PROJECT.md`, `package.json`.
- `npm view undici versions` / `npm ls undici fast-check nock` — live registry and installed-tree confirmation this session.

### Secondary (MEDIUM confidence)
- GitHub Actions environments/secrets/forked-PR behavior — well-known, stable platform behavior; recommend a final check against GitHub's "Security hardening for GitHub Actions" docs at implementation time.
- Original FEATURES.md competitive-landscape claims (Elicit, SciSpace, Paperpal, Jenni, etc.) — verified via official product pages and 2025-2026 review articles, not hands-on; not the primary driver for this integration-focused milestone.

### Corrected/Superseded
- `AUDIT-FINDINGS.md`'s 37 findings — treated as OPEN/LIVE in the raw PITFALLS.md research; corrected here: all 37 were fixed and merged to `main` (PRs #3-#19) immediately preceding this milestone. The router/state-transition fixes (#1, #8, #9, M1) and the citekey-regex fix (#2/#20) are DONE, not preconditions for HARDEN's strict gate or FEED's drafter-prompt work.

---
*Research completed: 2026-07-06*
*Ready for roadmap: yes*
