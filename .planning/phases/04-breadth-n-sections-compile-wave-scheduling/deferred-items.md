# Phase 04 — Deferred Items (out-of-scope discoveries during execution)

These were discovered during plan execution but are NOT caused by the current
plan's changes. Per the executor SCOPE BOUNDARY rule they are logged here, not
fixed in-plan.

| Discovered During | Item | Detail | Status |
|-------------------|------|--------|--------|
| 04-01 Task 3 | `tests/schemas.test.ts` has 3 pre-existing failures | `CURRENT_STATE_VERSION` is `2` (bumped in an earlier phase) but `tests/schemas.test.ts` still asserts all `CURRENT_*_VERSION === 1` and uses a v1 `state` fixture (`$schemaVersion: 1`). The state-schema migration (v1→v2) never updated this test. Confirmed present at commit `b1b2d48` (before Phase 04 execution). Unrelated to the wave scheduler / outline-parse / citation-token work in 04-01. | Open — needs a dedicated test-fix commit (update `CURRENT_STATE_VERSION` expectation to 2 and the `state` fixtures to `$schemaVersion: 2`). |
| 04-02 (full-suite run) | Same state-version breakage also surfaces in a loader/migrations test | `schema validation failure throws SchemaValidationError with rich issues` fails for the same root cause (state v1 fixture under a v2 schema). Same family as the 3 `schemas.test.ts` failures above — 4 manifestations of one root cause. Confirmed at baseline `b1b2d48`. Unrelated to 04-02 (freshness / compile-report / paths). | Open — resolved by the same state-version test-fix commit. |
| 04-02 (full-suite run) | `tests/tier-contract.test.ts` Case C pre-existing failure | `Case C: paper_advance_section is idempotent` fails with `section 1 state must be "writing" … actual: undefined`. Rooted in the same state.ts version-bump breakage (advance-section reads a v1-shaped state that no longer parses). 04-02 imports none of `state.ts` / `tier-contract.test.ts` / advance-section code (grep-confirmed). Pre-existing. | Open — gated behind the state-version migration fix; verify Case C once state fixtures are bumped. |
| 04-02 Task 1 | `tests/wave-scheduler.test.ts` lint warning | `eslint` reports one warning (`Unused eslint-disable directive` at line 111) in the Plan 04-01 wave-scheduler test. 0 errors. Not 04-02's file. | Open — trivial; drop the stale `eslint-disable` in a 04-01 follow-up. |
