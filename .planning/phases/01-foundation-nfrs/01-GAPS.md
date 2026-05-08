---
phase: 01-foundation-nfrs
generated: 2026-05-08
status: post-planning gap analysis (informational, non-blocking)
---

# Phase 1 — Post-Planning Gap Analysis

Plan-phase verified PASSED after 4 revision iterations. All 18 REQ-IDs covered. All 9 iteration-1+2 issues resolved (B1-B6 + W1-W5). All 4 iteration-3 blockers resolved (B7-B10 Plan 09 rewrite + cascade). What follows are soft findings that did not block plan-checker but are worth tracking for the executor and future audit.

## Gap 1 — D-XX citation tags absent from PLAN.md text (substance present)

**Status:** Soft. 17 LOCKED decisions are implemented in substance but not cited by `D-XX` tag in plan text.

| Decision | Implemented in | Note |
|----------|----------------|------|
| D-09 | Plan 03 (lock) | project-hash semantics in lock path |
| D-10 | Plan 03 | lock payload JSON shape |
| D-11 | Plan 03 + VALIDATION.md | conflict semantics (heartbeat freshness) |
| D-14 | Plan 04 + Plan 00 | doi.ts chokepoint enforced via lint |
| D-16 | Plan 04 | doi_canonical + doi_as_cited dual-store |
| D-21 | Plan 05 + Plan 00 | http.ts chokepoint enforced via lint |
| D-34 | Plan 06 | Semaphore primitive |
| D-35 | Plan 06 | wouldYoloRefuse predicate |
| D-36 | Plan 07 | schema_version: 1 + migrations contract |
| D-54 | Plan 10 | state.ts Phase 1 scope (project-level only) |
| D-56 | Plan 12 | checkpoint envelope shape |
| D-57 | Plan 11 | library JSON v0.1 format |
| D-62 | Plan 13 | structural-only runtime tests |
| D-63 | Plan 13 | runtime config slot in `.paper/config.toml` |
| D-66 | Plan 05 (cited as `PENSMITH_NETWORK_TESTS` literal × 6, no D-66 tag) | network test gate |
| D-68 | All 14 plans (meta-rule, satisfied implicitly) | tests-by-name in success criteria |

**Why not blocked:** plan-checker iteration 2 classified this as W7 (warning, not blocker). The iteration-3 audit and iteration-4 verification both surveyed this and confirmed substance is correct.

**Action for executor:** when implementing each task, add inline `// per D-XX` comments where the decision text constrains a specific line of code. This restores the audit trail without re-opening planning.

## Gap 2 — Plan 11/12 use invented D-XX numbering

**Status:** Soft. Pre-existing.

Plan 11 cites "D-59" for library foundation slice; Plan 12 cites "D-60" for checkpoint foundation slice. CONTEXT.md numbers these D-55 and D-56 respectively. The plans' substance is correct; only the citation numbers are wrong.

**Why not blocked:** plan-checker iteration 2 raised this and explicitly deferred — "aligning it would be a Phase-1-wide audit, not a revision-only fix."

**Action for executor:** if implementing the audit trail (Gap 1), correct the citation numbers as part of that pass.

## Gap 3 — Plan 07 stale `key_links` (cosmetic)

**Status:** Soft. Pre-existing.

Plan 07 lists session-log W9 as a `loadAndMigrate` consumer, but session-log writes append-only JSONL and does not use the migrations loader on read paths.

**Why not blocked:** plan-checker iteration 4 flagged this as out-of-scope for the revision pass (it was outside the B7-B10 brief).

**Action for executor:** if executing Plan 07 surfaces a chokepoint-lint pattern that grep-matches the wrong consumer, drop the W9 entry from `key_links` at execute-time (one-line edit, not a deviation).

## Gap 4 — `run_id` is UUIDv4, not ULID

**Status:** Conscious deviation from D-49 wording, accepted by RESEARCH.md §V3.

D-49 says "`run_id` is a ULID." Plan 09 implements `run_id` via `crypto.randomUUID()` (UUIDv4) to avoid adding a new dependency. RESEARCH.md §V3 line 972 explicitly accepts both. Plan 09 documents the divergence inline.

**Property lost:** lexicographic time-ordering. UUIDs are unsorted; ULIDs sort by time. If Phase 7 replay (D-53) needs lexicographic ordering, swapping to inline Crockford-base32 ULID is a 10-line change.

**Action for executor:** none in Phase 1. Flag for Phase 7 if replay tooling depends on time-sort.

## Gap 5 — Wave numbers non-contiguous (0,1,2,3,4,9,10,11)

**Status:** Cosmetic only. Executor reads `depends_on`, not wave numbers.

**Action for executor:** none.

## Pre-execute punch list

When `/gsd-execute-phase 1` runs, the executor should be aware of:

1. **Wave 0 is blocking.** CI Node version bump (20.10 → 20.18), 11 runtime deps + 4 dev deps, D-07/D-41 chokepoint lint rules, red-team fixtures, locked WARN copy text, DOI corpus all land in 01-00 before any other plan can execute.
2. **OneDrive landmine.** Repo lives inside `OneDrive/`. Lock file and any local-only data MUST go to `%LOCALAPPDATA%`/`~/Library/Application Support`/`$XDG_DATA_HOME` — never inside `.paper/` (which OneDrive will sync and break).
3. **p-retry full-jitter shim required.** p-retry@^6 ships with equal-jitter by default; D-31 requires full-jitter. Plan 05 includes the shim implementation.
4. **Windows fsync(dirfd) guard.** Plan 02's atomic-write must catch `EPERM` from `fsync(dirfd)` on Windows and fall through (Windows has no per-directory fsync semantics).
5. **proper-lockfile is CJS-only.** Plan 03 uses `createRequire` shim for ESM consumption.
6. **Session-log records have NO `$schemaVersion` field.** Plan 07's session-log schema is a passthrough validator only; W9 writes JSONL directly without the migrations loader. Don't try to migrate session-log files at load-time.
