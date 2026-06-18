---
phase: 06-done-export-pipeline-zero-trace-gate
plan: 03
subsystem: export-pipeline
tags: [honesty, gptzero, detection-aware, pluggable-backend, locked-copy, verbatim-render, http-chokepoint, advisory, no-key-leak]

# Dependency graph
requires:
  - phase: 06-done-export-pipeline-zero-trace-gate
    provides: "06-01 RED honesty test + GPTZero cassette (ai=0.82/AI_ONLY) + LOCKED hash-pinned references/honesty-framing.md + pinned symbol names (scoreHonesty/renderHonestyReport/selectBackend)"
  - phase: 01-foundation
    provides: "http.ts findPkgRoot + loadWarnString locked-copy read pattern + fetch chokepoint; http-mock.ts isOfflineMode + loadCassetteFile; budget.ts assertBudget/appendCost; runtime.ts getProviderApiKey no-leak precedent"
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "verify/pass2.ts key-absence guard + defensive parse + assertBudget-pre-call + advisory-never-throws shape"
provides:
  - "bin/lib/honesty.ts — scoreHonesty + renderHonestyReport + HonestyScore/HonestyBackend interfaces + GPTZero backend + selectBackend (DONE-04/05)"
  - "before/after detection-aware honesty score (two scoreHonesty calls per paper) consumed by 06-04 done.ts"
  - "verbatim-rendered honest-framing note (loadFramingNote reads the locked copy — drift = CI failure)"
affects: [06-04 (done.ts wires before/after scoreHonesty + renderHonestyReport into the export flow), 06-05 (DONE-09 export-confirmation gate)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Locked-copy verbatim render: findPkgRoot walk-up + readFileSync + section/blockquote scan (http.ts loadWarnString shape) so framing prose is read from references/honesty-framing.md, never inlined — works under tsx AND dist/"
    - "Advisory-never-throws detection score: key-absence/offline/non-200/transport/parse error all collapse to a clean null skip (never a crash, never a fabricated score)"
    - "API-key-never-logged at the call boundary: resolved key reaches ONLY the x-api-key header; presence-check only for the skip banner (T-01-07 precedent)"
    - "Pluggable backend strategy: GPTZero shipped as default; originality/sapling not-implemented stubs that skip-clean rather than fabricate or throw (DONE-05)"

key-files:
  created:
    - bin/lib/honesty.ts
  modified: []

key-decisions:
  - "Exported symbol is selectBackend (matches the LOCKED 06-01 RED test contract + 06-01 SUMMARY pin), NOT the plan body's selectHonestyBackend — the test is the contract"
  - "assertBudget gate is PAPER-scoped (scope:'paper', scopeId:'honesty-gptzero', cap $1.00, est $0.02/call) because the score runs at most twice per paper (before/after humanize), unlike pass2's per-section cap; appendCost recorded as provider:'other' (GPTZero is not a token-metered LLM)"
  - "not-implemented backends return null with a one-line stdout banner (advisory-never-crash) rather than throwing a typed error — the RED test accepts either, null was chosen for consistency with the absent-key skip"
  - "references/honesty-framing.md was NOT edited — the 06-01 SHA-256 pin stands; no re-pin needed (the verbatim-render contract was satisfiable against the existing copy)"
  - "loadFramingNote scans for '## Note' then the first '> ' blockquote line (http.ts loadWarnString shape); the single-line note matches the test's multi-line-join-then-trim extraction exactly"

requirements-completed: [DONE-04, DONE-05]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 6 Plan 03: Detection-Aware Honesty Score + Pluggable Backend Summary

**Landed `bin/lib/honesty.ts` — the transparency-only detection-aware honesty score (DONE-04) with a pluggable backend (DONE-05): GPTZero ships as default through the http.ts chokepoint, the before/after report renders its framing note VERBATIM from the locked hash-pinned `references/honesty-framing.md` (never inlined), the GPTZERO_API_KEY never leaves the x-api-key header, and absent-key / offline / bad-response all collapse to a clean null skip — turning the 06-01 RED honesty suite fully GREEN with the full project suite still 670 pass / 0 fail.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-18T08:52:24Z
- **Completed:** 2026-06-18T08:55:54Z
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments

- Implemented the **GPTZero backend** (`name: 'gptzero'`) with the canonical guard order: key-absence check FIRST (presence-only, clean null skip + banner — the key value is never printed), then the offline cassette branch (no network), then the live branch.
- **assertBudget BEFORE the scored API call** (ARCH-10 financial boundary): paper-scoped cap, `appendCost` recorded as `provider:'other'` after a successful 200 — the GPTZero score runs at most twice per paper so a paper cap (not pass2's per-section cap) is the right scope.
- **All HTTP through `bin/lib/http.ts`** (`source:'generic'`, `noCache:true`); the resolved key reaches ONLY the `x-api-key` header, where http.ts's cache-header allowlist drops it from any persisted envelope (T-06-03-01).
- **Defensive `parseGptzeroResponse`**: untrusted remote JSON — missing `documents`, non-numeric `class_probabilities.ai`, or any access error → `null` (skip), never a fabricated score (T-06-03-03); unknown `document_classification` defaults to `MIXED`.
- **`renderHonestyReport(before, after, backend)`** emits the before/after percent lines (`after === null` → `N/A (humanizer not installed)`), then the honest-framing note read **VERBATIM** from the locked copy via `loadFramingNote` (findPkgRoot walk-up + `## Note` blockquote scan — the http.ts `loadWarnString` shape, working under tsx and dist).
- **`selectBackend(config)`** (DONE-05): GPTZero default; `originality`/`sapling` → not-implemented stubs that skip-clean (`null` + banner); unknown/undefined → GPTZero. `scoreHonesty` resolves the backend through it.

## Task Commits

Each task was committed atomically:

1. **Task 1: GPTZero backend + scoreHonesty (key-absence/offline skip-clean, defensive parse, assertBudget pre-call, key never logged)** — `f76fea9` (feat)
2. **Task 2: renderHonestyReport (verbatim framing) + pluggable backend selection** — `6a66990` (feat)

**Plan metadata:** final docs commit (this SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

- `bin/lib/honesty.ts` (created, 334 lines) — `HonestyScore` / `HonestyClassification` / `HonestyBackend` types; `parseGptzeroResponse` (defensive); `scoreWithGptzero` (key guard → offline cassette → live http.ts POST with assertBudget/appendCost); `gptzeroBackend`; `findPkgRoot` + `loadFramingNote` (verbatim locked-copy read); `notImplementedBackend`; `selectBackend`; `scoreHonesty`; `renderHonestyReport`.

## Decisions Made

- **Exported `selectBackend`, not the plan body's `selectHonestyBackend`.** The LOCKED 06-01 RED test (`tests/honesty.test.ts`) imports `selectBackend`, and the 06-01 SUMMARY pins that symbol name. The test is the contract; the plan-body name was a drafting inconsistency. (`scoreHonesty` and `renderHonestyReport` matched the test directly.)
- **Paper-scoped budget gate.** GPTZero is called at most twice per paper (before/after humanize), so the gate uses `scope:'paper'` / `scopeId:'honesty-gptzero'` / cap `$1.00` / est `$0.02`/call — distinct from pass2's per-section cap. GPTZero is not a token-metered LLM, so `appendCost` uses `provider:'other'` (a valid `CostRecord` enum value) with a fixed estimate.
- **Not-implemented backends return `null` (not a thrown error).** The RED test accepts either a `null` resolution or a non-throwing stub; `null` + a one-line banner keeps the absent-key and unimplemented-backend skip paths uniform (advisory-never-crash).
- **`references/honesty-framing.md` was NOT edited** — the verbatim-render contract was satisfiable against the existing locked copy, so the 06-01 SHA-256 pin in `tests/repo-files.test.ts` stands unchanged (no re-pin).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Exported `selectBackend` instead of the plan body's `selectHonestyBackend`**
- **Found during:** Task 2 (running the RED suite).
- **Issue:** The plan `<action>` text named the selector `selectHonestyBackend`, but the locked 06-01 RED test imports `selectBackend` and the 06-01 SUMMARY pins `selectBackend`. Shipping `selectHonestyBackend` would leave the DONE-05 test RED (`mod.selectBackend is not a function`).
- **Fix:** Exported `selectBackend(config?: { honestyBackend?: string }): HonestyBackend` matching the test contract. `scoreHonesty` resolves through it.
- **Files modified:** `bin/lib/honesty.ts`
- **Commit:** `6a66990`

No other deviations — the plan's behavior, threat mitigations, and acceptance criteria were implemented as written.

## Threat Mitigations Applied (06-03 threat_model)

- **T-06-03-01 (API-key disclosure):** presence-check guard only; resolved key passed solely into the `x-api-key` header; no `${apiKey}` interpolation into any stdout/log/return payload (source-scanned); http.ts cache-header allowlist drops `x-api-key`.
- **T-06-03-02 (framing drift / inlining):** note read VERBATIM from the hash-pinned `references/honesty-framing.md`; the verbatim-render assertion in `tests/honesty.test.ts` proves the copy is not inlined; rendered prose carries no `evade/beat/defeat/undetectable`-as-a-claim wording (transparency-only — the only `undetectable` token is in the framing's "does not promise to make output undetectable" disclaimer).
- **T-06-03-03 (fabricated/garbage response):** `parseGptzeroResponse` is fully defensive — non-200 / unexpected shape / parse error → `null`, never a fabricated score.
- **T-06-03-04 (429 / rate limit):** any non-200 or transport error in the live branch → `null` skip (advisory); http.ts retry + generic bucket front the call.
- **T-06-03-SC (supply-chain):** no package installs in this plan — nothing to slopcheck.

## Verification Results

- `node --import tsx --test tests/honesty.test.ts` — **6 pass / 0 fail / 0 skip** (was RED-by-skip in 06-01): absent-key→null, offline cassette→{0.82, AI_ONLY, gptzero}, renderHonestyReport 82%+41%+VERBATIM note, selectBackend pluggable.
- `node --import tsx --test tests/repo-files.test.ts` — **44 pass / 0 fail** (honesty-framing.md SHA-256 pin still GREEN; not edited → no re-pin).
- `npm test` (full suite) — **681 tests, 670 pass, 0 fail, 11 skipped** (the 11 skips are the 06-04 exporter/done RED-by-skip tests; honesty + 06-02 plagiarism are now GREEN, down from 19 skips at 06-01).
- `npm run lint` — clean. `npm run typecheck` — clean.

## Next Phase Readiness

- 06-04 `bin/cli/done.ts` can now call `scoreHonesty(draft)` before humanize and `scoreHonesty(humanizedDraft)` after, then `renderHonestyReport(before, after, 'gptzero')` for the export report — all offline-safe (null skip when no key / no cassette).
- 06-05 DONE-09 export-confirmation gate has the honesty score available as advisory transparency input.
- No blockers.

---
*Phase: 06-done-export-pipeline-zero-trace-gate*
*Completed: 2026-06-18*

## Self-Check: PASSED

- `bin/lib/honesty.ts` verified present on disk (334 lines).
- Task commits `f76fea9` + `6a66990` verified in git log.
- `tests/honesty.test.ts` 6/6 GREEN; `tests/repo-files.test.ts` 44/44 GREEN; full suite 670 pass / 0 fail; lint + typecheck clean.
