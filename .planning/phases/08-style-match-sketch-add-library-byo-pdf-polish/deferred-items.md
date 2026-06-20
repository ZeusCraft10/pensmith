# Phase 08 — Deferred Items

Out-of-scope discoveries logged during execution (not fixed by the discovering plan).

## Pre-existing test failures: TIER-04 stub assertions in tests/cli-stubs.test.ts

**Discovered during:** 08-05 execution (`npm run check`).

**Issue:** `tests/cli-stubs.test.ts` asserts that the verbs `list`, `open`, `sketch`, and
`add` are unimplemented stubs that exit 0 printing "not implemented yet". Those verbs were
IMPLEMENTED in earlier Phase-8 plans (08-01 list/open, 08-03 add, 08-04 sketch), so the stub
assertions now fail:

- `TIER-04: stub verb 'list' exits 0 with 'not implemented yet'` — FAIL
- `TIER-04: stub verb 'open' exits 0 with 'not implemented yet'` — FAIL
- `TIER-04: stub verb 'sketch' exits 0 with 'not implemented yet'` — FAIL (now an interactive prompt)
- `TIER-04: stub verb 'add' exits 0 with 'not implemented yet'` — FAIL (now requires a SOURCE arg)

**Proven pre-existing:** Running `tests/cli-stubs.test.ts` at commit `2af3871` (the tip BEFORE
plan 08-05) reproduces all 4 failures. Plan 08-05 touches only `bin/lib/drafter-input.ts`,
`bin/cli/write.ts`, `bin/cli/intake.ts`, and `README.md` — none of which are exercised by these
TIER-04 stub assertions.

**Scope:** Out of scope for 08-05 (SCOPE BOUNDARY — only auto-fix issues directly caused by the
current task's changes). The cli-stubs TIER-04 cases should be retired/updated to reflect that
these four verbs are now real (likely a wrap-up task for plan 08-06 or a phase-cleanup plan).
The pensmith verifier for Phase 8 should reconcile cli-stubs.test.ts with the verbs that 08-01
through 08-04 graduated from stubs to real implementations.

**✅ RESOLVED (orchestrator test-maintenance commit):** `STUBS` in `tests/cli-stubs.test.ts`
emptied (`const STUBS: string[] = []`) with a graduation comment matching the compile/done/
next/status/resume precedent — after Phase 8 ALL 16 UX-02 verbs are real, zero stubs remain.
The TIER-04 stub-invariant loop is retained structurally for any future stub. Full suite
776/776 green, lint + tsc clean.
