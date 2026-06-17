# Phase 04 — Deferred Items (out-of-scope discoveries during execution)

These were discovered during plan execution but are NOT caused by the current
plan's changes. Per the executor SCOPE BOUNDARY rule they are logged here, not
fixed in-plan.

| Discovered During | Item | Detail | Status |
|-------------------|------|--------|--------|
| 04-01 Task 3 | `tests/schemas.test.ts` has 3 pre-existing failures | `CURRENT_STATE_VERSION` is `2` (bumped in an earlier phase) but `tests/schemas.test.ts` still asserts all `CURRENT_*_VERSION === 1` and uses a v1 `state` fixture (`$schemaVersion: 1`). The state-schema migration (v1→v2) never updated this test. Confirmed present at commit `b1b2d48` (before Phase 04 execution). Unrelated to the wave scheduler / outline-parse / citation-token work in 04-01. | Open — needs a dedicated test-fix commit (update `CURRENT_STATE_VERSION` expectation to 2 and the `state` fixtures to `$schemaVersion: 2`). |
