---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: 05
subsystem: compile-pipeline
tags: [compile, refuse-gate, citation-token-protection, smoother, consistency-scan, citation-density, draft-hash, bibtex-regen, compile-report, tier-contract, hash-pinned-prompt]

# Dependency graph
requires:
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-01)
    provides: "parseOutline (outline-order section list), CITATION_TOKEN_RE / extractCitekeys / replaceCitekeys (citation-token helpers consumed by the smoother substitution)"
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-02)
    provides: "renderCompileReport + CompileReportSchema (D-14 5-section v1 report), letter-suffix path tolerance"
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-03)
    provides: "tests/tier-contract.test.ts write-wave registry stub (extended here to the 3-section deps parity)"
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-04)
    provides: "revise-swap real prompt hash + repo-files pin; tier-contract revise registry entry (revise parity extended here with the hash-reset assertion)"
  - phase: 03-vertical-slice-one-section
    provides: "verify/pass1.ts runPass1 + pass3.ts runPass3 (deterministic re-verify), bibtex-write.ts (D-19 base-26 collision suffix), atomic-write.ts (D-07 sole writer), lock.ts withLock, frontmatter.ts, citations.ts parseBib, prompt-loader EXPECTED_PROMPT_HASHES + WN-3 sentinel pattern, citty verb pattern"
provides:
  - "runCompile — the keystone compile pipeline under .paper/.compile.lock: refuse-gate / outline-order concat / N-1 token-safe smoothing / consistency scan / citation density / bib regen / DRAFT.md + COMPILE-REPORT.md emission. All writes via atomicWriteFile; section files read-only."
  - "computeDraftHash(bytes, sources) — D-07 SHA-256 per-section hash input (no byte normalization)"
  - "runConsistencyScan + ConsistencyWarning — cross-section claim-consistency, flags-only (COMP-04)"
  - "computeCitationDensity + CitationDensityReport — per-section density + paper-wide mean/stdev vs discipline preset target, warn-only (COMP-05)"
  - "templates/prompts/smoother.md — hash-pinned boundary smoother prompt with the placeholder-token invariant (D-12/D-13)"
  - "bin/cli/compile.ts — the real compile verb (promoted from the Phase-2 stub; locked-16 preserved)"
  - "workflows/compile.md — the full compile Body (8-step pipeline) + capability_check + Tier-2 degrade"
affects: [05-advisory-passes (populates the reserved Advisory Findings slot), 06-export (reads .paper/DRAFT.md + COMPILE-REPORT.md + CITATIONS.bib), compile, done]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Keystone pipeline composition: runCompile holds a single whole-run .paper/.compile.lock and composes Phase 1-3 chokepoints (parseOutline, computeDraftHash, runPass1/3, writeBibtex, renderCompileReport, atomicWriteFile) — no new primitive added"
    - "Injectable transport seams (smoothBoundary, reVerify) keep the pipeline pure/CI-safe: tests feed deterministic seams; the CLI wires the production Pass 1+3 re-verify and (later phase) the real smoother model call — mirrors 04-03 writeSection and 04-04 proposeSwap"
    - "Citation-token protection by construction (D-13): pre-call [@key]->{{cite_K_M}} mask + post-call placeholder-set equality; ANY drift rejects the boundary and keeps original prose (raw-concat fallback) — citations are the invariant, smoothing is best-effort"
    - "Refuse-gate collects ALL blocking verdicts across ALL sections before any write, so a bad citation in any section blocks the whole compile (no partial DRAFT.md)"
    - "Read-only-on-sections compile: every write targets .paper/ project-level files via atomicWriteFile; sections/<N>/DRAFT.md is never written (ARCH-20), proven by the compile-order mtime+hash test"

key-files:
  created:
    - bin/lib/compile.ts
    - bin/lib/draft-hash.ts
    - bin/lib/consistency-scan.ts
    - bin/lib/citation-density.ts
    - bin/cli/compile.ts
    - templates/prompts/smoother.md
    - tests/compile-refuse.test.ts
    - tests/compile-staleness.test.ts
    - tests/compile-order.test.ts
    - tests/draft-hash.test.ts
    - tests/compile-smoother.test.ts
    - tests/smoother-token-protect.test.ts
    - tests/compile-bib-regen.test.ts
    - tests/consistency-scan.test.ts
    - tests/citation-density.test.ts
    - tests/fixtures/cassettes/smoother/smoother-clean.json
    - tests/fixtures/cassettes/smoother/smoother-token-drift.json
    - tests/fixtures/cassettes/smoother/smoother-multi-paragraph.json
  modified:
    - bin/pensmith.ts
    - bin/lib/prompt-loader.ts
    - workflows/compile.md
    - tests/repo-files.test.ts
    - tests/tier-contract.test.ts
    - tests/cli-stubs.test.ts

key-decisions:
  - "refuse-gate collects ALL blocking verdicts across ALL sections (and any staleness re-verify failure) BEFORE any write, then refuses without writing DRAFT.md — a bad citation in any single section blocks the whole compile (COMP-01 / verifier-blocks-compile)"
  - "smoother + re-verify are injectable seams (smoothBoundary, reVerify); the production CLI wires deterministic Pass 1+3 re-verify (never Pass 2/4) and OMITS the boundary smoother in Tier 2 (raw concat) since no model transport exists yet — smoothing is best-effort prose and never blocks"
  - "no pensmith_compile MCP tool exists; the compile Tier-1 surface is the workflow body delegating to the SAME runCompile as the CLI. The compile tier-contract parity case is therefore CLI-only (mcpTool: null), documented architectural asymmetry consistent with the write-wave precedent. compile remains one of the locked UX-02 16 verbs (no new verb)"
  - "smoother cassettes placed under tests/fixtures/cassettes/smoother/ (NOT the flat tests/cassettes/ the PLAN files list named) so loadCassetteFile + the cassette-size/no-leak gates resolve and scan them — same Rule-3 path correction established in 04-02 and 04-04"
  - "citation-density discipline target ships as an in-module discipline->target lookup with a documented `default` fallback (the discipline preset is not yet persisted in a machine-readable config; Phase 6 export formalizes it); the comparison is WARN-only with a ±50% band"
  - "WN-3 lockstep: smoother prompt byte-pin landed in repo-files.test.ts at Task 1a (real hash, byte-stable on creation); prompt-loader sentinel re-pinned to the SAME real SHA-256 at Task 4 — both surfaces agree, loadPrompt('smoother') succeeds without PENSMITH_ALLOW_PENDING_PROMPT_HASHES"

patterns-established:
  - "Whole-pipeline lock for a multi-step output writer: runCompile wraps the entire pipeline in withLock('compile:<.paper/.compile.lock>') so two concurrent compiles never race on the output files (§P-6)"
  - "Per-boundary smoothing with disjoint placeholder namespaces: section K uses {{cite_K_M}}, section K+1 uses {{cite_(K+1)_M}}, so the merged restore map is collision-free and the boundary stays independent"
  - "Verifier-blocks-compile is unbypassable on the compile path: the refuse-gate runs before Step 2 (concat) and returns early on any blocking verdict — the DRAFT.md write is structurally unreachable when a refuse reason exists"

requirements-completed: [COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-07, ARCH-20]

# Metrics
duration: 21min
completed: 2026-06-17
---

# Phase 4 Plan 05: Compile Pipeline Summary

**`runCompile` — the keystone compile pipeline: a whole-run `.paper/.compile.lock`-guarded sequence that refuses on any FABRICATED/MIS-CITED/quote-NOT_FOUND verdict (fresh or staleness re-verify, Pass 1+3 only), concatenates sections in OUTLINE order, runs N-1 token-safe boundary smoothings (placeholder mask + post-call token-set equality → raw-concat fallback on drift), runs the flags-only cross-section consistency scan and the warn-only citation-density check, regenerates `.paper/CITATIONS.bib` from the compiled citekey union, and atomically emits `.paper/DRAFT.md` + `.paper/COMPILE-REPORT.md` (schema v1) — all writes through the D-07 chokepoint, section files read-only throughout.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-06-17T11:02Z
- **Completed:** 2026-06-17T11:23Z
- **Tasks:** 4 (Task 1 split into the safety-first 1a/1b)
- **Files modified:** 24 (18 created, 6 modified)

## Accomplishments
- Shipped `runCompile` (`bin/lib/compile.ts`) — the COMP-01 refuse-gate (collect-all-then-refuse, naming section + citekey, no DRAFT.md write), outline-order concatenation (COMP-02 / D-11), N-1 per-boundary smoothing with citation-token protection (COMP-03 / D-12 / D-13), staleness auto-re-verify (Pass 1+3 only, never Pass 2/4 — D-08), bib regen (D-19), and DRAFT.md + COMPILE-REPORT.md emission (COMP-07 / D-14). The whole pipeline holds `.paper/.compile.lock`; section files are read-only the entire run (ARCH-20).
- Shipped three pure helpers: `computeDraftHash` (D-07, no byte normalization), `runConsistencyScan` (COMP-04 — proper-noun divergence + abbreviation collision + opt-in heading-tense, flags-only, never throws/blocks), and `computeCitationDensity` (COMP-05 — per-section density + paper-wide mean/stdev + discipline-target comparison, warn-only, never throws).
- Authored the hash-pinned `smoother` prompt (5 hard constraints incl. the `{{cite_K_M}}` placeholder invariant) and re-pinned it real across prompt-loader + repo-files (WN-3 lockstep).
- Promoted `compile` from the Phase-2 dispatcher stub to a real verb (`bin/cli/compile.ts` → `runCompile`, registered in REAL_VERB_LOADERS) without adding a 17th verb, and wrote the full `workflows/compile.md` Body (95 lines, under the verify.md 135 high-water mark, no Pass 2/4 prompt references).
- Extended the shared tier-contract gate with the compile parity case (D-24 for the new compile.md), the full 3-section write-wave deps parity (`b→a`, `c→a`, Tier-2 serial WARN), and the revise parity `verified_against_draft_hash: null` reset assertion.
- Landed the COMP-01 guard test FIRST (`tests/compile-refuse.test.ts` was the first artifact created), so a partial completion still left the safety-critical refuse test on disk.

## Task Commits

Each task was committed atomically:

1. **Task 1a: safety-critical refuse/staleness/order RED tests + smoother prompt + cassettes** — `f3413bc` (test)
2. **Task 1b: remaining RED tests (hash, smoother behavior, bib-regen, COMP-04, COMP-05)** — `775f4e7` (test)
3. **Task 2: draft-hash + consistency-scan + citation-density pure helpers** — `2b94f92` (feat, GREEN)
4. **Task 3: compile.ts pipeline — refuse / outline-concat / smooth / density / emit** — `5a31c20` (feat, GREEN)
5. **Task 4: compile verb + workflow + re-pin smoother hash + tier-contract parity** — `b6414dd` (feat, GREEN)

**Plan metadata:** (this commit) `docs(04-05): complete compile-pipeline plan`

_Note: Tasks 2 & 3 are `tdd="true"` — their RED commits are Tasks 1a/1b; the GREEN production code lands in 2 & 3. No standalone REFACTOR commit was needed._

## Files Created/Modified
- `bin/lib/compile.ts` - `runCompile` keystone pipeline (lock → refuse-gate + staleness re-verify → outline-order concat → N-1 token-safe smoothing → consistency scan + citation density → bib regen → DRAFT.md + COMPILE-REPORT.md). Injectable smoothBoundary + reVerify seams; sole writer is atomicWriteFile.
- `bin/lib/draft-hash.ts` - `computeDraftHash(bytes, sources)` = SHA-256(bytes + '\n' + JSON.stringify(sources.slice().sort())); pure, no normalization (D-07).
- `bin/lib/consistency-scan.ts` - `runConsistencyScan` flags-only cross-section claim-consistency (COMP-04); never throws/blocks; heading-tense gated by lintHeadings.
- `bin/lib/citation-density.ts` - `computeCitationDensity` per-section + paper-wide mean/stdev + discipline-target band comparison (COMP-05); warn-only; never throws.
- `bin/cli/compile.ts` - thin compile verb delegating to runCompile; production Pass 1+3 re-verify seam (never Pass 2/4); stdout-only.
- `templates/prompts/smoother.md` - hash-pinned boundary smoother prompt with the placeholder-token invariant (D-12/D-13).
- `bin/pensmith.ts` - registered compile in REAL_VERB_LOADERS (locked 16 preserved).
- `bin/lib/prompt-loader.ts` - added smoother to EXPECTED_PROMPT_HASHES (sentinel at Task 1a → real SHA-256 at Task 4).
- `workflows/compile.md` - full compile Body (8-step pipeline) + capability_check + Tier-2 degrade rule.
- `tests/repo-files.test.ts` - smoother byte-pin (WN-3).
- `tests/tier-contract.test.ts` - compile parity (D-24) + 3-section write-wave deps parity + revise hash-reset assertion.
- `tests/cli-stubs.test.ts` - compile removed from STUBS (graduated to real).
- 9 test files + 3 smoother cassettes (see frontmatter `key-files.created`).

## Decisions Made
See frontmatter `key-decisions`. Highlights:
- Refuse-gate is collect-all-then-refuse across all sections — verifier-blocks-compile is structurally unbypassable on the compile path.
- compile parity is CLI-only (no pensmith_compile MCP tool; the Tier-1 surface is the workflow body delegating to the same runCompile) — documented asymmetry, consistent with the write-wave precedent; locked-16 preserved.
- Citation-density discipline target is an in-module lookup with a documented default, since the discipline preset is not yet persisted in machine-readable config (Phase 6 formalizes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Smoother cassettes relocated to the loader-resolvable path**
- **Found during:** Task 1a
- **Issue:** The PLAN `files_modified` listed cassettes at flat `tests/cassettes/smoother-*.json`. The cassette-size + cassette-no-leak gates (and `loadCassetteFile`) only resolve `tests/fixtures/cassettes/<adapter>/<basename>.json`; flat-path cassettes would be unscanned by the leak gate.
- **Fix:** Placed the three smoother cassettes under `tests/fixtures/cassettes/smoother/`. Identical Rule-3 path correction already established by 04-02 and 04-04.
- **Files modified:** the 3 smoother cassette files
- **Verification:** cassette-size + cassette-no-leak gates GREEN over the new cassettes.
- **Committed in:** `f3413bc` (Task 1a commit)

**2. [Rule 1 - Bug] citation-density.test.ts cast for exactOptionalPropertyTypes**
- **Found during:** Task 2 (typecheck gate)
- **Issue:** `(r as Record<string, unknown>)` in the COMP-05 RED test failed `tsc --noEmit` (TS2352 — insufficient type overlap) under the project's strict tsconfig.
- **Fix:** Cast via `unknown` first (`r as unknown as Record<string, unknown>`).
- **Files modified:** tests/citation-density.test.ts
- **Verification:** `tsc --noEmit` clean.
- **Committed in:** `2b94f92` (Task 2 commit)

**3. [Rule 1 - Bug] consistency-scan proper-noun divergence missed lowercase variants**
- **Found during:** Task 2 (GREEN)
- **Issue:** The naive `\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b` regex only matched all-TitleCase phrases, so "Bayesian network" (lowercase second word) was never grouped with "Bayesian Network" and the divergence went undetected (test expected 1 flag, got 0).
- **Fix:** Collect candidate phrases from the strict TitleCase regex, then re-search the whole document case-insensitively for each candidate's exact word-sequence to capture any-casing variants; group by lowercased key.
- **Files modified:** bin/lib/consistency-scan.ts
- **Verification:** consistency-scan suite GREEN (proper-noun divergence detected, matching-form case produces no flag).
- **Committed in:** `2b94f92` (Task 2 commit)

**4. [Rule 1 - Bug] cli-stubs.test.ts asserted compile is a stub**
- **Found during:** Task 4 (full `npm test` regression after promoting compile to a real verb)
- **Issue:** `tests/cli-stubs.test.ts` listed `compile` among the stub verbs that must print "not implemented yet"; promoting compile to a real verb correctly invalidated that assertion (same graduation the 6 Phase-3 verbs underwent).
- **Fix:** Removed `compile` from the STUBS list (now 8 stubs) and documented the graduation; compile is exercised by tier-contract.test.ts.
- **Files modified:** tests/cli-stubs.test.ts
- **Verification:** cli-stubs GREEN; full suite 632/632.
- **Committed in:** `b6414dd` (Task 4 commit)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking)
**Impact on plan:** All four were necessary for correctness/CI-resolvability and stayed within the plan's surface. No scope creep; every `must_haves.truths` bullet and `<success_criteria>` line is satisfied; the locked-16-verb + 16-workflow-bijection + tier-contract invariants are all preserved.

## Issues Encountered
- `interpolate()` (prompt-loader) matches `{{\w+}}` and would have choked on a literal `{{cite_K_M}}` example in the smoother prompt body. Resolved by writing the placeholder shape as `{{cite_<K>_<M>}}` in the prompt prose (the `<` breaks the `\w+` match), keeping the prompt interpolate-safe while still communicating the locked D-13 token shape; the real per-window placeholders are generated by the compile pipeline, not interpolated from the prompt body.

## Known Stubs
- **Tier-2 boundary smoother is intentionally omitted** (raw concat) in `bin/cli/compile.ts` because no model-transport client exists in `bin/lib` yet (the same Tier-2 placeholder stance as plan/write/revise). This is NOT a goal-blocking stub: the smoother is best-effort prose that never blocks compile, the seam (`smoothBoundary`) and the hash-pinned `smoother` prompt are complete and ready, and the deterministic compile path (refuse-gate, staleness re-verify, concat, consistency scan, citation density, bib regen, report emission) is fully wired and exercised by passing tests. A later phase swaps the omitted seam for `loadPrompt('smoother') + interpolate + model call`.

## User Setup Required
None — no external service configuration; no new dependency added.

## Next Phase Readiness
- Phase 5 (advisory passes) populates the COMPILE-REPORT `## Advisory Findings` reserved slot — the renderer and the D-14 schema already reserve it; runCompile passes the empty marker through.
- Phase 6 (export) consumes `.paper/DRAFT.md` + `.paper/COMPILE-REPORT.md` + the regenerated `.paper/CITATIONS.bib`; the Pandoc-reserved frontmatter keys (title/author/abstract) are already present (empty) in the report.
- When a model-transport client lands, wire the Tier-2 smoother seam (`loadPrompt('smoother')` + interpolate + model call) — the prompt is hash-pinned and the post-call token-set equality guard is already in place.
- No blockers. Full `npm run check` GREEN (lint + typecheck + build + 632 tests + manifests).

## Self-Check: PASSED

All 18 created files and 6 modified files verified present on disk. All 5 task commits (`f3413bc`, `775f4e7`, `2b94f92`, `5a31c20`, `b6414dd`) verified in git history. Target suites GREEN (32/32 plan tests); full suite 632/632; `npm run check` (lint + typecheck + build + tier-contract + tests + manifests) clean.

---
*Phase: 04-breadth-n-sections-compile-wave-scheduling*
*Completed: 2026-06-17*
