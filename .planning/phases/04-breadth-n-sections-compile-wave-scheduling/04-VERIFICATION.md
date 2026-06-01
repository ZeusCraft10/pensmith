---
phase: 04-breadth-n-sections-compile-wave-scheduling
verified: 2026-06-01T00:00:00Z
verdict: PASS-WITH-CAVEATS
goal_summary: >
  Scale from one section to N. The wave scheduler honors depends_on
  (Kahn topological sort) and respects --max-parallel (default 5) in Tier 1
  with serial Tier-2 fallback; the compile pipeline concatenates sections in
  outline order, runs cross-section smoothing read-only on section files,
  produces consistency flags + citation-density (never edits), regenerates
  CITATIONS.bib, and refuses on any FABRICATED / MIS-CITED / quote NOT_FOUND
  citing the offending section + citekey. Stable section numbering with
  letter suffixes is locked via the D-07 draft hash and parseSectionDirName,
  and verified_against_draft_hash flags compile-staleness. The revise verb
  swaps flagged citations behind a default-on approval gate and runs
  --research section-scoped without cross-section disturbance.
score: 5/5 success criteria PASS (with 1 surface-wording caveat on SC-5)
build_gates:
  lint: 0
  typecheck: 0
  build: 0
  tests: { total: 644, pass: 644, fail: 0, skip: 0 }
carry_forward:
  baseline_test_failures: 0
  surface_wording_caveats: 1
---

# Phase 4: Breadth — N sections + compile + wave scheduling — Verification Report

**Phase Goal (ROADMAP §Phase 4):** Scale from one section to N. Wave scheduler
honors `depends_on`; compile concatenates sections in outline order, runs
cross-section smoothing read-only on section files, produces consistency flags
(never edits), and refuses on any FABRICATED / MIS-CITED / quote NOT_FOUND.
Stable section numbering with letter suffixes is locked.

**Verified:** 2026-06-01
**Verdict:** PASS-WITH-CAVEATS
**Re-verification:** No — initial verification after Phase 4 closure
(Plans 04-01 through 04-05; commits f9a6b61, e60568f, 32a4da7, 02df1e4,
3473dfd and earlier task commits).

## Goal-backward checks

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pensmith compile` refuses on any section with FABRICATED / MIS-CITED / quote NOT_FOUND, naming the offending section + citekey | PASS | `bin/lib/compile.ts:293-352` ALWAYS-ON refuse gate runs Step 0 for EVERY outline section before any concat/write; `checkVerificationForBlockingVerdict` (`:76-104`) returns citekey+verdict; refuse messages name `Section ${sec.n} (${sec.slug})` + citekey + verdict (`:336,349,378`). Tests PASS: `compile-refuse: FABRICATED → refuse, name section + citekey`, `MIS-CITED → refuse`, `quote-NOT_FOUND → refuse`, `REVIEW H-01: hash-match + FABRICATED → always-on gate still refuses, no DRAFT.md`, `multi-section, one bad section → refuse naming the bad section`. (COMP-01) |
| 2 | Cross-section smoothing writes only to `.paper/DRAFT.md`, never `sections/<N>/DRAFT.md` (read-only invariant by mtime + content-hash) | PASS | `compile.ts` Step 3 smooths an in-memory `assembled` string; the only writes are `atomicWriteFile(draftPath…)`, `bibPath`, `reportPath` in `.paper/` (`:730-734`); section files are read with `readFileSync` only. Tests PASS: `compile-order: section DRAFT.md files are read-only (mtime + hash unchanged) (ARCH-20)` (`tests/compile-order.test.ts:114-150`), `compile-smoother: smoothing writes only to .paper/DRAFT.md (never sections/<N>/DRAFT.md) (COMP-03)`. (COMP-03 / ARCH-20) |
| 3 | Wave scheduler topologically sorts by `depends_on` + respects `--max-parallel` (default 5) Tier 1; Tier 2 same order serial | PASS | `bin/lib/scheduler.ts:16-116` `buildWaveGraph` = Kahn topo-sort + cycle detect (`:96-99`) + override honoring (`:79-84`); `runWave:122-145` runs nodes under `Semaphore` cap. `bin/lib/write-orchestrator.ts:150-274` drains waves serially, `new Semaphore(opts.maxParallel)` per wave; Tier-2 (`maxParallel===1`) emits ONE stderr WARN (`:159-166`). `bin/cli/write.ts:110` default `--max-parallel 5`. Tests PASS: `buildWaveGraph: assigns computed_wave by topological depth (COMP-06)`, `runWave: honors bounded concurrency`, `write-orchestrator: wave structure`, `…Tier-2 serial WARN emitted exactly once (REVIEW M-04)`, `…maxParallel 1 produces deterministic serial order`. (ARCH-19 / COMP-06) |
| 4 | Stable letter-suffix numbering enforced (inserts never renumber); `verified_against_draft_hash` flags compile-staleness | PASS | `bin/lib/draft-hash.ts:42-55` D-07 LOCKED `computeDraftHash(draftBytes, sources)` (no CRLF/BOM normalization; sorted array not Set). `compile.ts:360-384` Step 1 recomputes hash and on mismatch auto re-verifies Pass 1+3 ONLY (never Pass 2/4). `parseSectionDirName` (Plan 02) + `findSectionDirs` regex `^(\d{2})[a-z]?-…` (`compile.ts:236`) accept letter suffixes. Tests PASS: `draft-hash: CRLF NOT normalized / BOM preserved / sorted array NOT Set (D-07)`, `lexicographic order: "03" < "03b" < "04" (letter-suffix insertion invariant)`, `compile-staleness: stale hash → WARN + auto re-verify (Pass 1+3)`, `…Pass 2/4 are NEVER invoked (D-08)`. (ARCH-20 / COMP-02) |
| 5 | `--revise` modifies only the target section's PLAN.md; `--research <query>` modifies only target section's RESEARCH additions (no cross-section disturbance) | PASS (with caveat) | Capability is delivered by the dedicated `revise` verb (not `plan --revise`): `bin/lib/revise.ts` `runResearch` (`:266-286`) writes ONLY `.paper/RESEARCH.md` + `sections/<N>/RESEARCH-LOG.md` (D-09 / T-04-17); accept path resets `verified_against_draft_hash → null` under `withLock` on the target PLAN.md only (`:467-472`); approval gate default-on. Test PASS: `revise: --research only writes to project RESEARCH.md and section RESEARCH-LOG.md; sibling section untouched`, `section-isolation-n: re-running section 3 leaves other N=4 sections DRAFT.md unchanged (mtime + hash)`. **Caveat:** SC-5 wording is `pensmith plan <N> --revise` / `plan <N> --research`; the actual surface is the standalone `revise` verb with a `--research` flag. `bin/cli/plan.ts:48` declares a `--revise` boolean but its `run()` ignores it (always writes the Tier-2 placeholder). The isolation guarantee is met; the command surface differs from the SC phrasing. (WRTE-02 / PLAN-02 / PLAN-03) |

**Score:** 5/5 success criteria PASS (SC-5 carries a non-blocking surface-wording caveat).

## Requirements coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ARCH-19 (bounded-parallel waves) | SATISFIED | `Semaphore` per-wave in `write-orchestrator.ts:233`; `runWave: honors bounded concurrency` test PASS. |
| ARCH-20 (no on-disk scheduler state; section files read-only) | SATISFIED | Orchestrator persists nothing (in-memory wave map); compile writes only `.paper/`; `scheduler-stateless` + `compile-order …read-only (ARCH-20)` tests PASS. |
| PLAN-02 (valid wave override honored) | SATISFIED | `scheduler.ts:79-84`; `buildWaveGraph: honors valid wave override (PLAN-02)` PASS. |
| PLAN-03 (invalid wave override rejected) | SATISFIED | `scheduler.ts:80-82` throws; `buildWaveGraph: reject invalid wave override (PLAN-03)` PASS. |
| WRTE-02 (single revise chokepoint) | SATISFIED | `bin/lib/revise.ts::runRevise` sole chokepoint for both tiers; 8 revise tests PASS. |
| RSCH-10 (source-freshness WARN-only) | SATISFIED | `bin/lib/verify/freshness.ts::probeFreshness`; 5 `probeFreshness` tests PASS (DOI 200/404, retraction hit, null/invalid DOI). |
| COMP-01 (refuse gate) | SATISFIED | See check #1. |
| COMP-02 (outline-order concat) | SATISFIED | `compile.ts:299,360,391` iterate `outlineSections` sorted by `n`; `compile-order: …in outline order (COMP-02)` PASS. |
| COMP-03 (N-1 boundary smoothing) | SATISFIED | `compile.ts:436` loops `length-1` boundaries; `compile-smoother: 3 sections → invoked exactly 2 times (N-1)` / `2→1` / `1→0` PASS; ORDERED token-sequence equality (`:541-553`) — `smoother-token-protect …reordered → REJECTED (REVIEW M-01)` PASS. |
| COMP-04 (consistency flags, never edits) | SATISFIED | `bin/lib/consistency-scan.ts::runConsistencyScan` returns `ConsistencyWarning[]` (flags only, never throws); 7 consistency-scan tests PASS incl. `pure function — no I/O`. |
| COMP-05 (citation density warn-only) | SATISFIED | `bin/lib/citation-density.ts::computeCitationDensity` warn-only; 7 citation-density tests PASS incl. `never signals a block`. |
| COMP-06 (topological wave order) | SATISFIED | Kahn sort in `scheduler.ts`; COMP-06 test PASS. |
| COMP-07 (COMPILE-REPORT emission, D-14) | SATISFIED | `compile.ts:728-734` `renderCompileReport` → `atomicWriteFile(reportPath)`; `compile-report-schema` + `compile-bib-regen` tests PASS. |

## Build/test gates

| Gate | Exit | Notes |
|------|------|-------|
| `npm run lint` (eslint .) | 0 | clean |
| `npx tsc --noEmit` | 0 | clean |
| `npm test` (scripts/run-tests.mjs) | 0 | tests 644 / pass 644 / fail 0 / skip 0 / todo 0 — duration ~133s (the long tail is the `compile-staleness: stale lockfile older than 30s is auto-cleared` real-time wait, ~131s). |

## Architecture invariants spot-checked

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Verifier-blocks-compile (CLAUDE.md non-negotiable) | PASS | Always-on Step 0 gate refuses even on hash-match (`REVIEW H-01` test); `known-bad-citations` Pass-1 10/10 MIS-CITED, `known-bad-quotes` Pass-3 10/10 NOT_FOUND. |
| Smoothing never mutates `[@citekey]` tokens | PASS | Nonce-prefixed placeholder family + ORDERED sequence equality (`compile.ts:537-559`); `smoother-token-protect: no [@citekey] tokens mutated in final DRAFT.md (COMP-03)` PASS. |
| D-07 atomic-write chokepoint | PASS | All compile/revise persistent writes route through `atomicWriteFile` / `atomicAppendFile`; `compile-bib-regen: bib write is atomic` PASS. |
| D-08 Pass 2/4 never invoked on re-verify | PASS | `compile-staleness: Pass 2/4 are NEVER invoked (D-08)` PASS. |
| D-40 locks live in pensmithLockDir, not project tree | PASS | `runCompile` uses `withLock('pensmith:compile:<paperRoot>')` (`compile.ts:269-274`); D-40 lock.test assertions pass in suite. |
| Approval gate default-on (revise) | PASS | `revise: user rejects → DRAFT.md unchanged` PASS; default-on gate per PRD §19. |

## Caveats / carry-forward

1. **SC-5 command-surface wording mismatch (non-blocking).** The success
   criterion phrases the revision/research entrypoint as
   `pensmith plan <N> --revise` and `pensmith plan <N> --research <query>`.
   The shipped implementation is a standalone `revise` verb
   (`pensmith revise --section <N>` with a `--research` flag), registered in
   `UX02_VERBS` (17 verbs). `bin/cli/plan.ts:48` declares a `--revise`
   boolean arg, but its `run()` handler never reads it — it always writes the
   Tier-2 placeholder PLAN.md. The underlying isolation guarantee that SC-5
   exists to protect (revise/research touch only the target section; siblings
   untouched) is fully implemented and tested, so the goal is achieved; only
   the verb name differs from the SC phrasing. Recommend either updating the
   ROADMAP SC-5 wording to reference the `revise` verb or wiring
   `plan --revise` to delegate to `runRevise` in a future phase. This was an
   intentional design choice noted in 04-04-SUMMARY (`revise` added as its own
   verb); flagged here for traceability, not as a blocker.

2. **No baseline test failures remain.** Phase 3 carried 5 baseline failures
   (schemas/migration/tier-contract idempotency). The full suite now reports
   644/644 PASS with 0 fail / 0 skip — the prior baseline failures are no
   longer present. No regressions detected.

## Verdict rationale

All 5 success criteria are observably true in the codebase, backed by
load-bearing source (compile.ts refuse gate + read-only smoothing,
scheduler.ts Kahn sort + Semaphore, draft-hash.ts D-07, revise.ts isolation +
hash-reset) and by passing safety-critical tests (compile-refuse,
compile-order read-only, compile-staleness Pass-1+3-only, wave override
honor/reject, revise --research isolation). All 13 declared requirements
(ARCH-19/20, PLAN-02/03, WRTE-02, RSCH-10, COMP-01..07) are SATISFIED with
direct evidence. All three build gates exit 0 and the test suite is fully
green (644/644). The verdict is PASS-WITH-CAVEATS solely because the SC-5
command surface (`plan --revise` vs. the `revise` verb) diverges from the
ROADMAP phrasing — a wording/traceability caveat, not a functional gap.

---

_Verified: 2026-06-01_
_Verifier: Claude (gsd-verifier)_
