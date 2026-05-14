---
phase: 01-foundation-nfrs
fixed_at: 2026-05-14T00:00:00Z
review_path: .planning/phases/01-foundation-nfrs/REVIEW.md
authorized_scope: BLOCKER-01, BLOCKER-02, FLAG-01, FLAG-03
findings_in_scope: 4
fixed: 4
deferred: 13
status: scope_complete
tests_before: 222
tests_after: 226
typecheck: clean
---

# Phase 1: Code Review Fix Report

User authorized the targeted fix subset {BLOCKER-01, BLOCKER-02, FLAG-01, FLAG-03}. All four landed as atomic commits with regression tests; all 226 tests pass; `npx tsc --noEmit` is clean. T-01-07 no-leak property is preserved (verified by the existing `CRITICAL: persisted runtime.json never contains the resolved api-key VALUE` test).

## Fixed

### BLOCKER-01 — TOCTOU race in initState / initLibrary
**Commit:** `dc3e944`
**Files:** `bin/lib/state.ts`, `bin/lib/library.ts`, `tests/state.test.ts`, `tests/library.test.ts`
**Fix:** Moved `fs.promises.access(file)` INSIDE `withLock`; throws `*AlreadyExistsError` on success, swallows ENOENT, then proceeds to `atomicWriteFile`. Two new regression tests fire 8 concurrent inits and assert exactly one fulfilled + the on-disk file matches the winner's seed.

### BLOCKER-02 — Unlocked writeBack in loadAndMigrate callers
**Commit:** `91d2f5a`
**Files:** `bin/lib/state.ts`, `bin/lib/library.ts`, `bin/lib/runtime.ts`, `tests/migrations.test.ts`
**Fix:** Wrapped every `loadAndMigrate(..., {writeBack: true})` call site in `withLock(file, ...)` (`loadState`, `loadLibrary`, `readOne`). Auto-mode in `runtime.ts` reads global then paper — locks are sequential (distinct file paths), not nested. Concurrency-contract doc comments updated. New regression test fires 5 concurrent locked v1→v2 migrations against the existing `migrations/state/v1_to_v2.ts` fixture and asserts the on-disk file ends in a single consistent v2 envelope.

### FLAG-01 — Cache envelope not structurally validated
**Commit:** `e333e40`
**Files:** `bin/lib/http.ts`, `tests/http-cache.test.ts`
**Fix:** Added `isValidCacheEnvelope` type guard (savedAt:string, response.status:number, response.body:string, response.headers:object). `readCache` returns null on shape mismatch — corrupt cache is transparent to callers (cache MISS, never an exception). New regression test plants a malformed envelope and asserts the next fetch reads as `cached:false`.

### FLAG-03 — Pricing leaf objects not deep-frozen
**Commit:** `09d06fb`
**Files:** `bin/lib/pricing.ts`, `tests/pricing.test.ts`
**Fix:** Added a third nested `Object.freeze` over each leaf ModelPrice value object before freezing its provider record and the outer table. Existing freeze test extended to check `Object.isFrozen` on every leaf and behaviorally assert that mutation throws TypeError under strict mode.

## Deferred (remain as Phase 1.1 follow-up debt in REVIEW.md)

FLAG-02 (session-log module-global chain), FLAG-04 (spilled_to path separator), FLAG-05 (module-singleton logger captures env), FLAG-06 (http cache writes auth-protected bodies), FLAG-07 (runtime auto-mode dual writeBack — partially addressed by BLOCKER-02 lock wrap but caching/invalidate is deferred), FLAG-08 (paths.ts diacritic regex literal codepoints), FLAG-09 (arxiv ARXIV_NEW 4-digit loose match), NIT-01 through NIT-06.

---
_Fixed: 2026-05-14_
_Fixer: Claude (gsd-code-fixer)_
