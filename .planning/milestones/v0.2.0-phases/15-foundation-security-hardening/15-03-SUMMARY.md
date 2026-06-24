---
phase: 15-foundation-security-hardening
plan: "03"
subsystem: lock
tags: [hard-01, lock, canonicalize, compile]
dependency_graph:
  requires: ["15-01"]
  provides: ["canonical-lock-keys"]
  affects: ["bin/lib/lock.ts", "bin/lib/compile.ts", "tests/lock.test.ts", "tests/lock-conflict.cjs"]
tech_stack:
  added: []
  patterns: ["path.resolve + fs.realpathSync.native + win32 case-fold before sha256"]
key_files:
  created: []
  modified:
    - bin/lib/lock.ts
    - bin/lib/compile.ts
    - tests/lock.test.ts
    - tests/lock-conflict.cjs
decisions:
  - "Export stubFor as named export (not __stubForTest seam) — direct export is cleaner and the lock.test.ts scaffold already probes both names"
  - "Update lock-conflict.cjs child helper with identical HARD-01 canonicalization (Rule 1) — without this the cross-process test-5 fails because child and parent resolve different stubs"
  - "Fix fsp.writeFile → fsp.open('a') in test-7 scaffold (Rule 2) — pre-existing lint violation from Wave-0 scaffold, now in scope since we touch the file"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  files_modified: 4
---

# Phase 15 Plan 03: HARD-01 Lock-Key Canonicalization Summary

Closed HARD-01: canonicalize lock keys inside `stubFor` so two callers targeting the same underlying file via different path conventions always share one lock. Re-closes the BLOCKER-01/02 clobber races and the macOS /var→/private/var hazard.

## Tasks Completed

### Task 1: Canonicalize stubFor + export it (HARD-01)

**File:** `bin/lib/lock.ts`

Added `import * as fs from 'node:fs'`. In `stubFor`, before `createHash`:
1. `let canonical = path.resolve(resource)` — make absolute
2. `try { canonical = fs.realpathSync.native(canonical) } catch { /* ENOENT — use resolved path */ }` — resolve symlinks (macOS /var→/private/var)
3. `if (process.platform === 'win32') canonical = canonical.toLowerCase()` — case-fold

Hash `canonical` instead of raw `resource`. Changed `async function stubFor` to `export async function stubFor`.

**Result:** Test 7 (HARD-01 canonicalize scaffold) flipped from `skip` to `PASS`. Tests 1-6 (all lock tests) continue to pass.

### Task 2: Drop the 'compile:' prefix in compile.ts (HARD-01 call-site cleanup)

**File:** `bin/lib/compile.ts:234`

Changed:
```
const lockResource = `compile:${join(paperDir(opts.paperRoot), '.compile.lock')}`;
```
to:
```
const lockResource = join(paperDir(opts.paperRoot), '.compile.lock');
```

With canonicalization inside `stubFor`, the `compile:` prefix was producing a different hash than the bare path (it's not a real file path, so `path.resolve('compile:/path/...')` gives a different canonical). The compile lock now keys off the canonical resolved path of `.compile.lock`. All 9 compile-refuse tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated tests/lock-conflict.cjs to apply HARD-01 canonicalization**
- **Found during:** Task 1, running test suite
- **Issue:** `lock-conflict.cjs` is the cross-process child helper for test 5. It duplicates `stubFor` logic with the OLD raw-hash computation. After our change, the parent's `withLock(r)` hashes `path.resolve(r)` but the child still hashes raw `r` — different stubs, no serialization, test 5 fails.
- **Fix:** Applied identical HARD-01 canonicalization block (resolve → realpathSync.native try/catch → win32 toLowerCase) to the `stubFor()` function in `lock-conflict.cjs`.
- **Files modified:** `tests/lock-conflict.cjs`
- **Commit:** 0823c2e (included in atomic commit)

**2. [Rule 1 - Bug] Fixed test-6 hash computation in tests/lock.test.ts**
- **Found during:** Task 1, analyzing test-6 regression
- **Issue:** Test 6 independently computed `createHash('sha256').update(r).digest('hex').slice(0,12)` using the raw resource string, then looked for the stub at that path. After canonicalization, the stub lives at the canonical-hash path. Both paths differ for non-real-file resource strings.
- **Fix:** Added `canonicalHash(resource)` helper (mirrors `stubFor`'s canonicalization) and updated test-6 to use it.
- **Files modified:** `tests/lock.test.ts`
- **Commit:** 0823c2e

**3. [Rule 2 - Missing correctness] Fixed pre-existing fsp.writeFile lint violation in test-7 scaffold**
- **Found during:** Post-implementation lint run
- **Issue:** The Wave-0 HARD-01 scaffold used `fsp.writeFile(filePath, '')` to create the temp file. ESLint rule `no-restricted-syntax` (ARCH-05 / D-07) forbids `fsp.writeFile` — use `bin/lib/atomic-write.ts` instead. In test context, the appropriate alternative is `fsp.open(filePath, 'a')` + `fh.close()` (same pattern `stubFor` uses internally).
- **Fix:** Replaced `await fsp.writeFile(filePath, '')` with `const fhTmp = await fsp.open(filePath, 'a'); await fhTmp.close();`.
- **Files modified:** `tests/lock.test.ts`
- **Commit:** 0823c2e

## Test Results

| Test | Status |
|------|--------|
| 1. withLock returns inner value | PASS |
| 2. withLock releases on inner throw | PASS |
| 3. tryAcquire / release / isLocked roundtrip | PASS |
| 4. serialized within same process (regression gate) | PASS |
| 5. cross-process: child holds, parent waits (TEST-07) | PASS |
| 6. lock file lives in pensmithLockDir() NOT .paper/ | PASS |
| 7. lock canonicalize: two path conventions → identical stub (HARD-01) | **PASS (was skip)** |
| compile-refuse.test.ts (9 tests) | ALL PASS |
| Full suite (952 tests) | 949 pass, 3 skip, 0 fail |

## Verification

- Two path conventions (path.resolve form vs raw absolute path) → same stub: CONFIRMED
- Win32 case variant → same stub (toLowerCase branch): CONFIRMED
- Not-yet-created file (ENOENT from realpathSync.native) → no crash, falls back to path.resolve: CONFIRMED
- `compile:` prefix removed from compile.ts:234: CONFIRMED
- Compile lock still functions (locks real .compile.lock path): CONFIRMED (9 compile-refuse tests pass)
- `npm run lint`: CLEAN
- `npx tsc --noEmit`: CLEAN
- `npm test`: 949 pass / 0 fail

## Self-Check: PASSED

- `bin/lib/lock.ts` modified: CONFIRMED
- `bin/lib/compile.ts` modified: CONFIRMED
- `tests/lock.test.ts` modified: CONFIRMED
- `tests/lock-conflict.cjs` modified: CONFIRMED
- Commit 0823c2e exists: CONFIRMED
- Test 7 HARD-01 passes: CONFIRMED
- No TypeScript errors in modified files: CONFIRMED
