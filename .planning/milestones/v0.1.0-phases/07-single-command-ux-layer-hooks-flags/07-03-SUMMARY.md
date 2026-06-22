---
phase: 07-single-command-ux-layer-hooks-flags
plan: 03
subsystem: infra
tags: [hooks, session-start, stop, pre-compact, post-tool-use, handoff, lock, session-log, promise-allsettled, stdout-protocol]

# Dependency graph
requires:
  - phase: 07-single-command-ux-layer-hooks-flags
    provides: "07-01 Wave-0 RED hook tests (session-start/stop/pre-compact RED-by-skip; tsx-loader pinned via import.meta.resolve for hook subprocesses)"
  - phase: 01-foundation
    provides: "HandoffSchema (5120-byte cap) + writeHandoff, lock.ts release/isLocked/tryAcquire (proper-lockfile CJS shim), session-log.ts module-scope write chain"
  - phase: 03-vertical-slice-one-section
    provides: "hooks/pre-compact.ts (onPreCompact + assembleHandoff), hooks/post-tool-use.ts (HOOK-03 throttle, already complete)"
provides:
  - "SessionStart hook (HOOK-02): reads .paper/HANDOFF.json via HandoffSchema.safeParse and emits ONE { systemMessage } JSON frame to auto-invoke resume"
  - "Stop hook (HOOK-04 / M1): Promise.allSettled lock-release + log-flush so the flush ALWAYS completes even when release rejects on an unheld lock"
  - "PreCompact 10s Promise.race timeout (HOOK-01) bounding the HANDOFF write with a cleared deadline timer"
  - "closeSessionLog() module-level flush export on bin/lib/session-log.ts"
  - "forceRelease(resource) cross-process orphan-lock cleanup on bin/lib/lock.ts"
affects: [07-04-skills-plugin-namespace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook stdout protocol: stdout carries ONLY the protocol frame (empty for 3 hooks; one JSON object for SessionStart); diagnostics → stderr; exit 0 always"
    - "Promise.allSettled (NOT Promise.all) for best-effort shutdown cleanup so a rejecting cleanup step can never abandon a sibling (M1/C2-M2)"
    - "Promise.race + cleared setTimeout deadline to self-impose a 10s bound on a lock-owning write (HOOK-01); timeout applies OUTSIDE lock ownership (Pitfall 2)"

key-files:
  created: []
  modified:
    - hooks/session-start.ts
    - hooks/stop.ts
    - hooks/pre-compact.ts
    - bin/lib/session-log.ts
    - bin/lib/lock.ts
    - tests/hooks-noop.test.ts

key-decisions:
  - "closeSessionLog() awaits the EXISTING module-scope `chain` directly (not a new activeChain ref) — `chain` is already module-scoped and shared by every logger handle (each handle's close() awaits the same chain), and enqueue() installs work as both fulfil+reject handlers so awaiting chain never rejects. The plan's suggested activeChain indirection was unnecessary."
  - "Stop resolves `.paper` to an ABSOLUTE cwd path before release — resource locks are keyed by absolute path (lock.ts hashes the resource string), so release('.paper') literal would target a different stub than callers who lock join(cwd,'.paper'). Resolving against process.cwd() makes the resource key match (Rule 1)."
  - "Added forceRelease(resource) to lock.ts — proper-lockfile.unlock() checks an in-memory per-process registry and CANNOT release a lock held by another process (it throws ENOTACQUIRED and leaves the on-disk .lock dir). The Stop hook fires when the session is halting (any pensmith lock is orphaned), and the release test runs the hook in a CHILD subprocess against a parent-held lock — so cross-process cleanup (remove the .lock dir) is required. forceRelease tries unlock first, then rm -rf the lock dir; never rejects (Rule 2)."
  - "Stop runs Promise.allSettled([release, forceRelease, closeSessionLog]) — release() (the rejecting unlock) keeps the M1 rejection path REAL while forceRelease() guarantees actual cross-process cleanup; both alongside the flush so neither rejection abandons it."
  - "hooks-noop.test.ts split into SILENT_HOOKS (pre-compact/post-tool-use/stop must always emit empty stdout) + a dedicated session-start no-HANDOFF-path empty-stdout case with a precondition guard; JSON-frame case stays in tests/hooks/session-start.test.ts (not duplicated)."

patterns-established:
  - "Cross-process orphan-lock cleanup via forceRelease (unlock-then-rm) for halting-session hooks where proper-lockfile.unlock cannot reach another process's lock"
  - "stdout-protocol split test: silent-hooks list + per-hook protocol-frame assertion keeps the empty-stdout regression gate while allowing one hook a documented JSON frame"

requirements-completed: [HOOK-01, HOOK-02, HOOK-03, HOOK-04]

# Metrics
duration: 10min
completed: 2026-06-19
---

# Phase 7 Plan 03: Hooks (SessionStart / Stop / PreCompact + closeSessionLog) Summary

**SessionStart now emits a `{ systemMessage }` resume frame from a valid HANDOFF.json, Stop best-effort releases the `.paper` lock (cross-process) AND always flushes the session log via Promise.allSettled, and PreCompact bounds its HANDOFF write with a 10s Promise.race — every hook obeying the empty/one-JSON-frame stdout protocol, all 07-01 hook RED tests turned GREEN.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-19T05:01Z (approx)
- **Completed:** 2026-06-19T05:11Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- **HOOK-01 (PreCompact 10s timeout):** wrapped `writeHandoff` in `Promise.race([writeHandoff, deadline(PRECOMPACT_TIMEOUT_MS=10_000)])` with the deadline timer cleared in `finally` (no dangling timer); the rejection is routed to the existing stderr catch (never stdout); HANDOFF stays ≤5120 bytes well under 10s.
- **HOOK-02 (SessionStart resume emitter):** reads `.paper/HANDOFF.json` via `HandoffSchema.safeParse` (never throws on malformed → returns null), and for a valid non-`done` handoff emits exactly one `{ systemMessage }` JSON frame naming the phase, current section, next_action, and section states; empty stdout for no/`done` handoff; always exit 0.
- **HOOK-04 (Stop release + flush):** `Promise.allSettled([release(paperAbs), forceRelease(paperAbs), closeSessionLog()])` — a rejected `release()` on an unheld lock can NEVER abandon the session-log flush (M1/C2-M2); cross-process orphan-lock cleanup via the new `forceRelease`.
- **closeSessionLog() export:** module-level flush that drains the shared `chain`; resolves immediately when no logger is active; never rejects (the Stop hook's flush half).
- **HOOK-03 (PostToolUse):** confirmed coverage GREEN (throttle ≤1/min) with `hooks/post-tool-use.ts` byte-unchanged — no reimplementation.
- **Full suite GREEN:** `npm run check` → 747 tests, 741 pass, 0 fail, 6 skip (the 6 skips are the 07-04 UX-03/04/05 skill tests, RED-by-skip until 07-04 lands); lint + typecheck + build + tier-contract + manifests all pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: PreCompact 10s timeout + closeSessionLog() export** - `671c6d2` (feat)
2. **Task 2: SessionStart resume emitter + Stop release/flush via allSettled** - `ea41d44` (feat)
3. **Task 3: relax hooks-noop stdout gate for session-start + confirm HOOK-03** - `a8c7f67` (test)

**Plan metadata:** (this commit) — `docs(07-03): complete hooks plan`

## Files Created/Modified
- `hooks/pre-compact.ts` - Added `PRECOMPACT_TIMEOUT_MS=10_000` + `Promise.race` around `writeHandoff` with a cleared deadline timer (HOOK-01)
- `hooks/session-start.ts` - Reads HANDOFF.json via safeParse and emits one `{ systemMessage }` resume frame for a valid non-done handoff (HOOK-02)
- `hooks/stop.ts` - `Promise.allSettled([release, forceRelease, closeSessionLog])` shutdown cleanup; silent on stderr; exit 0 (HOOK-04)
- `bin/lib/session-log.ts` - New `closeSessionLog()` module-level flush export draining the shared write chain
- `bin/lib/lock.ts` - New `forceRelease(resource)` cross-process orphan-lock cleanup (unlock-then-rm); existing `release()` contract untouched
- `tests/hooks-noop.test.ts` - Split into SILENT_HOOKS empty-stdout asserts + a session-start no-HANDOFF-path empty-stdout case; hooks.json 4-hook assertion intact

## Decisions Made
- **closeSessionLog() awaits the existing module-scope `chain` directly** rather than the plan's suggested `activeChain` indirection — `chain` is already module-scoped and shared by every logger handle, so the simpler form is correct and the suggested new ref was unnecessary (the plan noted "Confirm by reading bin/lib/session-log.ts before editing"; confirmed).
- See `key-decisions` frontmatter for the Stop absolute-path resolution, the `forceRelease` cross-process cleanup rationale, and the release+forceRelease+flush allSettled composition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stop's `release('.paper')` literal targets the wrong lock stub**
- **Found during:** Task 2 (Stop hook)
- **Issue:** Resource locks are keyed by an absolute-path hash (lock.ts `stubFor` hashes the resource string). The plan/RESEARCH design `release('.paper')` (literal string) computes a different stub than any caller who locks `join(cwd, '.paper')` — so it would release a phantom resource and the actual `.paper` lock would remain held. The 07-01 release test acquires `join(cwd, '.paper')` and asserts the hook releases it.
- **Fix:** Resolve `.paper` to an absolute path via `resolve(process.cwd(), '.paper')` so the resource key matches the lock callers actually take.
- **Files modified:** hooks/stop.ts
- **Verification:** `HOOK-04: stop releases the .paper lock` test GREEN.
- **Committed in:** `ea41d44` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Cross-process orphan-lock release (`forceRelease`)**
- **Found during:** Task 2 (Stop hook — release test failing with `isLocked === true`)
- **Issue:** `proper-lockfile.unlock()` resolves ownership against an IN-MEMORY per-process registry (`locks[file]`); cross-process it throws `ENOTACQUIRED` and leaves the on-disk `${stub}.lock` directory intact, so `isLocked` stays true. The release test runs the Stop hook in a CHILD subprocess against a parent-held lock — `release()` alone (delegating to `unlock`) can never clear it. The Stop hook fires when the session is halting, so any pensmith lock is by definition orphaned and safe to break.
- **Fix:** Added `forceRelease(resource)` to lock.ts: try `lockfile.unlock(stub)` first (clean in-process path), and on failure `fsp.rm(`${stub}.lock`, { recursive: true, force: true })`. Never rejects (best-effort). The existing `release()` contract is left byte-equivalent. Stop runs `Promise.allSettled([release, forceRelease, closeSessionLog])` so the M1 rejection path (via `release`) stays real while `forceRelease` guarantees actual cleanup.
- **Files modified:** bin/lib/lock.ts, hooks/stop.ts
- **Verification:** `HOOK-04: stop releases the .paper lock` and `HOOK-04 / M1: flush survives release rejection` both GREEN; full suite (lock.test.ts included via `npm run check`) GREEN.
- **Committed in:** `ea41d44` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes are correctness-essential — without them the locked 07-01 release test cannot pass because proper-lockfile fundamentally cannot release a cross-process lock. No scope creep: `release()`'s public contract is unchanged and `forceRelease` is additive. The plan's `release('.paper')` literal + Promise.allSettled intent is preserved; `release` is still present in the allSettled array (keeping the M1 rejection real) with `forceRelease` added for actual cleanup.

## Issues Encountered
- None beyond the two deviations above. The cross-process unlock limitation was diagnosed by inspecting `node_modules/proper-lockfile/lib/lockfile.js` (`unlock` reads the in-memory `locks` registry → `ENOTACQUIRED` cross-process).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **07-04 (skills + plugin namespace):** the four hooks are fully wired; the only remaining RED-by-skip tests are `tests/skill-descriptions.test.ts` (UX-03/04) and `tests/nl-triggers.test.ts` (UX-05) — the four plumbing skill files + `plugin.json` skills array land in 07-04.
- **No blockers.** All hook + session-log behaviors are GREEN; `hooks/post-tool-use.ts` byte-unchanged (HOOK-03 not reimplemented).

---
*Phase: 07-single-command-ux-layer-hooks-flags*
*Completed: 2026-06-19*

## Self-Check: PASSED

- All 6 modified source/test files + SUMMARY.md verified on disk (FOUND).
- All 3 task commits verified in git log: 671c6d2, ea41d44, a8c7f67.
- Load-bearing tokens present: session-start `systemMessage`, stop `allSettled`, pre-compact `PRECOMPACT_TIMEOUT_MS`, session-log `closeSessionLog`.
- Hook + session-log suite: 27 tests, 0 fail, 0 skip.
- `npm run check`: 747 tests, 741 pass, 0 fail, 6 skip (07-04 UX-03/04/05 skill tests, RED-by-skip); lint + typecheck + build + tier-contract + manifests GREEN.
- `hooks/post-tool-use.ts` byte-unchanged (HOOK-03 not reimplemented).
