---
phase: 14-fail-closed-verifier-gate
verified: 2026-06-24T06:37:04Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run `pensmith verify <N>` with PENSMITH_NETWORK_TESTS=1 against a real DOI that is confirmed retracted on live Retraction Watch"
    expected: "Pass-1 produces verdict MIS-CITED with a reason containing 'Retraction Watch (live re-query at verify time)'; the section's VERIFICATION.md written to disk has the MIS-CITED blocking row; `pensmith compile` subsequently refuses naming that citekey"
    why_human: "The gate-retraction test uses offline cassettes — only the live network path exercises the true GATE-03 end-to-end flow against real Retraction Watch data. CI cassette coverage is the only acceptable substitute for automated CI, but the live smoke test is the single remaining manual item per VALIDATION.md."
---

# Phase 14: Fail-Closed Verifier Gate Verification Report

**Phase Goal:** Close four fail-open holes so the verifier gate is genuinely fail-closed end-to-end — GATE-01 (compile refuses on missing/empty/no-Status VERIFICATION.md), GATE-02 (shared verdict render+parse pair in verdict-rows.ts), GATE-03 (live retraction re-query at verify time escalates to MIS-CITED), GATE-04 (reCheckFinalMd hard-blocks export on citekey-set mismatch or NOT_FOUND in humanized FINAL.md).
**Verified:** 2026-06-24T06:37:04Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pensmith compile` REFUSES when a section's VERIFICATION.md is absent / empty / has no parseable `Status:` line | VERIFIED | `hasStatus = /^Status:\s*\S/m.test(verificationMd)` guard at compile.ts:263; `!hasStatus` pushes `"section N (slug): no verifiable VERIFICATION.md (section never verified or verifier output unreadable)"` to refuseReasons and `continue`s, skipping bib write. GATE-01 tests 1/2/3 confirm absent/empty/no-Status all REFUSE with that exact phrase; Test 4 (valid `Status: verified`) passes cleanly; Pitfall-3 regression test (`Status: unverifiable`) passes cleanly. |
| 2 | A shared `bin/lib/verify/verdict-rows.ts` render+parse pair is used by BOTH verify.ts (writer) AND compile.ts (parser); round-trip test proves render→parse yields identical blocking set; old inline parser/`failingCitekeys` is gone | VERIFIED | `verdict-rows.ts` is a pure module exporting `renderPass1VerdictRow`, `renderPass3VerdictRow`, `parseVerdictRows`. `verify.ts:33` imports and calls `renderPass1VerdictRow`/`renderPass3VerdictRow` for every Pass-1/Pass-3 row. `compile.ts:60` imports and calls `parseVerdictRows`. `REFUSING_VERDICTS` constant and `failingCitekeys` function are both absent from compile.ts (grep confirms zero matches). Round-trip test (verdict-rows.test.ts test 1) PASSES: renders FABRICATED+MIS-CITED+OK+NOT_FOUND rows, parses back, asserts `Set(['smith2020','jones2019'])` exactly. Format-drift mutation test PASSES. Freshness-table immunity test PASSES. |
| 3 | Pass-1 re-queries Retraction Watch live on the resolved DOI and escalates a CONFIRMED hit to MIS-CITED (blocking); a transport error / no-hit (fetchById null) NEVER produces a false MIS-CITED; the stored `claimed.retracted` fast-path is preserved; cassette-deterministic | VERIFIED | `pass1.ts:31` imports `fetchById as retractionWatchFetchById` from retraction-watch.ts. GATE-03 block at pass1.ts:143-152 executes AFTER the Crossref null-guard (Pitfall 1 honored): `liveRetraction = await retractionWatchFetchById(claimed.DOI)` — non-null → MIS-CITED; null → silent fall-through to JW path (no try/catch needed; fetchById already catches all transport errors and returns null at retraction-watch.ts:120-122). Gate-retraction test 1 PASSES: `10.0000/gate03-retracted` cassette hit → MIS-CITED, reason matches `/Retraction Watch|live re-query|retraction/i`. Gate-retraction test 2 PASSES: no-cassette DOI → fetchById null → reason does NOT mention live retraction. Stored `claimed.retracted` fast-path (pass1.ts:114-119) unchanged; known-bad-citations test 4/4 PASSES. retraction-watch.ts now uses `loadCassetteDir` (not single-file load), ensuring per-DOI cassettes are found with no false-positive fallback. |
| 4 | `done.ts reCheckFinalMd` runs AFTER humanize, BEFORE runDoneGate, as a HARD block (`return { ok: false }`) on a FINAL.md citekey-set mismatch (add/drop/swap) OR a Pass-3 NOT_FOUND; skips cleanly when no FINAL.md or `--yolo` | VERIFIED | `reCheckFinalMd` exported at done.ts:357. Call site at done.ts:515-527 executes `if (finalPath !== null && args.yolo !== true)` after humanize (line 498) and BEFORE `readSectionUnsupported` / `runDoneGate` (line 532) — hard ordering confirmed. Failure returns `{ ok: false }` immediately (done.ts:525). done-recheck tests 1-5 all PASS: matching sets + absent bib → passed; added key → failed naming key; dropped key → failed; swapped key → failed; absent bib → skip-clean. GATE-04 comment in code says "HARD block, BEFORE runDoneGate". |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/verify/verdict-rows.ts` | GATE-02 shared render+parse pair | VERIFIED | 76 lines, pure module; exports `renderPass1VerdictRow`, `renderPass3VerdictRow`, `parseVerdictRows`; `BLOCKING_VERDICTS = new Set(['FABRICATED','MIS-CITED','NOT_FOUND'])` local constant |
| `bin/lib/compile.ts` | GATE-01 hasStatus guard + GATE-02 parseVerdictRows consumer | VERIFIED | `import { parseVerdictRows } from './verify/verdict-rows.js'` at line 60; `hasStatus` guard at lines 263-269; `for (const ck of parseVerdictRows(verificationMd))` at line 272; no `REFUSING_VERDICTS` or `failingCitekeys` |
| `bin/cli/verify.ts` | GATE-02 render functions writer | VERIFIED | `import { renderPass1VerdictRow, renderPass3VerdictRow } from '../lib/verify/verdict-rows.js'` at line 33; both called in `lines[]` array at lines 156/160 |
| `bin/lib/verify/pass1.ts` | GATE-03 live retraction re-query inside verdictForCitekey | VERIFIED | `import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js'` at line 31; GATE-03 block at lines 135-152 after Crossref null-guard |
| `bin/lib/sources/retraction-watch.ts` | loadCassetteDir (not single-file); transport-error returns null | VERIFIED | Uses `loadCassetteDir('retraction-watch')` at line 101; no fallback-to-any-retractions; `catch { return null }` at lines 120-122 for transport errors |
| `bin/cli/done.ts` | GATE-04 `reCheckFinalMd` export + call site before runDoneGate | VERIFIED | Exported at line 357; call site at lines 515-527; hard block before runDoneGate at line 532 |
| `tests/verdict-rows.test.ts` | GATE-02 round-trip + mutation + freshness-table immunity | VERIFIED | 3 tests, all PASS; no skips |
| `tests/compile-refuse.test.ts` | GATE-01 absent/empty/no-Status refuse cases (extended) | VERIFIED | 9 tests total (4 original COMP-01 + 5 GATE-01); all PASS |
| `tests/gate-retraction.test.ts` | GATE-03 live-retraction-blocks + transport-skip | VERIFIED | 2 tests, both PASS (source-grep predicate confirmed wiring, no skips) |
| `tests/done-recheck.test.ts` | GATE-04 citekey-diff + Pass-3 re-check | VERIFIED | 5 tests, all PASS |
| `tests/fixtures/cassettes/retraction-watch/gate03-blocking-doi.json` | Offline cassette for GATE-03 live-retracted DOI | VERIFIED | Contains `10.0000/gate03-retracted` in both path and `items[0].doi`; valid JSON array |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bin/cli/verify.ts` | `bin/lib/verify/verdict-rows.ts` | `import { renderPass1VerdictRow, renderPass3VerdictRow }` | WIRED | verify.ts:33 imports; lines 156/160 call both render functions |
| `bin/lib/compile.ts` | `bin/lib/verify/verdict-rows.ts` | `import { parseVerdictRows }` | WIRED | compile.ts:60 imports; line 272 calls `parseVerdictRows(verificationMd)` |
| `bin/lib/verify/pass1.ts` | `bin/lib/sources/retraction-watch.ts` | `import { fetchById as retractionWatchFetchById }` | WIRED | pass1.ts:31 imports; line 143 calls `await retractionWatchFetchById(claimed.DOI)` |
| `bin/cli/done.ts` | `bin/lib/verify/pass3.ts` | `import { runPass3 }` via `reCheckFinalMd` | WIRED | done.ts:29 imports runPass3; called at done.ts:404 inside reCheckFinalMd |
| GATE-04 call site | runDoneGate | positioned before | WIRED | GATE-04 block at lines 515-527; runDoneGate call at line 532 — ordering confirmed by line numbers |
| GATE-01 guard | compile refuse path | `continue` skips both verdict parse AND staleness | WIRED | compile.ts:268 `continue` statement skips the `parseVerdictRows` loop and staleness check for that section |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `compile.ts` GATE-01 | `verificationMd` | `readFileSync(verifPath)` or `''` | Reads actual file bytes from disk | FLOWING |
| `compile.ts` GATE-02 | `parseVerdictRows(verificationMd)` | verdict-rows.ts pure string parser | Returns blocking citekeys from real VERIFICATION.md content | FLOWING |
| `pass1.ts` GATE-03 | `liveRetraction` | `retractionWatchFetchById(claimed.DOI)` | Cassette in offline mode; live HTTP in production | FLOWING |
| `done.ts` GATE-04 | `gate4` | `reCheckFinalMd(finalMd, draftMd, bibPath)` | Reads real FINAL.md + DRAFT.md + CITATIONS.bib from disk | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GATE-01: absent VERIFICATION.md → compile refuses | `node --import tsx --test tests/compile-refuse.test.ts` (GATE-01 test 1) | PASS — refuseReasons contains "no verifiable VERIFICATION.md" | PASS |
| GATE-01: `Status: unverifiable` → NOT refused (Pitfall 3) | Same (GATE-01 test 5) | PASS — no "no verifiable" phrase in reasons | PASS |
| GATE-02: round-trip render→parse yields `Set(['smith2020','jones2019'])` | `node --import tsx --test tests/verdict-rows.test.ts` (test 1) | PASS — exact set match | PASS |
| GATE-02: format-drift mutation drops row | Same (test 2) | PASS — corrupted bold marker yields `[]` | PASS |
| GATE-02: freshness-table pipe-rows excluded (Pitfall 2) | Same (test 3) | PASS — table rows yield `[]` | PASS |
| GATE-03: cassette-retracted DOI → MIS-CITED | `node --import tsx --test tests/gate-retraction.test.ts` (test 1) | PASS — verdict MIS-CITED, reason contains "Retraction Watch" | PASS |
| GATE-03: no-cassette DOI → NOT false MIS-CITED | Same (test 2) | PASS — reason does not mention "live re-query" | PASS |
| GATE-03: stored `claimed.retracted` still blocks | `node --import tsx --test tests/known-bad-citations.test.ts` | PASS — 10/10 fixtures flag MIS-CITED | PASS |
| GATE-04: added citekey → `{ passed: false }` | `node --import tsx --test tests/done-recheck.test.ts` (test 2) | PASS — names `fabricated2099` | PASS |
| GATE-04: absent bib → skip-clean | Same (test 5) | PASS — `{ passed: true }` | PASS |
| Full suite: 0 failures | `npm test` | 917 pass, 0 fail, 0 skip | PASS |
| Lint: clean | `npm run lint` | 0 errors, 0 warnings | PASS |

---

## Probe Execution

No probe scripts declared for Phase 14. Step 7c: SKIPPED (no `scripts/*/tests/probe-*.sh` for this phase; behavioral spot-checks above exercise equivalent coverage via the node:test runner).

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| GATE-01 | compile refuses on absent/empty/no-Status VERIFICATION.md | SATISFIED | compile.ts `hasStatus` guard + 5 GATE-01 tests all pass |
| GATE-02 | shared verdict-rows render+parse pair; round-trip test; old inline parser gone | SATISFIED | verdict-rows.ts created; verify.ts + compile.ts both import it; 3 round-trip tests pass; `failingCitekeys`/`REFUSING_VERDICTS` grep returns zero matches |
| GATE-03 | live retraction re-query at verify time; transport error silent; stored fast-path preserved; cassette-deterministic | SATISFIED | pass1.ts GATE-03 block after Crossref null-guard; fetchById catches and returns null on transport error; known-bad-citations 4/4 pass; gate-retraction 2/2 pass |
| GATE-04 | `reCheckFinalMd` AFTER humanize BEFORE runDoneGate; hard block on citekey-set mismatch or NOT_FOUND; skip when no FINAL.md or --yolo | SATISFIED | done.ts line ordering confirmed (515-527 before 532); 5 done-recheck tests pass; `return { ok: false }` on failure confirmed |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none found) | — | — | — |

Scan of all Phase-14 modified files (`bin/lib/verify/verdict-rows.ts`, `bin/lib/compile.ts`, `bin/cli/verify.ts`, `bin/lib/verify/pass1.ts`, `bin/lib/sources/retraction-watch.ts`, `bin/cli/done.ts`) found no `TBD`, `FIXME`, `XXX`, `PLACEHOLDER`, `coming soon`, or `not yet implemented` markers. No empty implementations. No hardcoded empty returns in load-bearing paths. No `return null` stubs in gate-critical functions.

---

## Human Verification Required

### 1. Live Retraction Watch Smoke Test (GATE-03)

**Test:** Run `pensmith verify <N>` with `PENSMITH_NETWORK_TESTS=1` set in the environment, against a section whose CITATIONS.bib contains a DOI that is confirmed retracted on the live Retraction Watch API (e.g., a known retracted DOI from the literature). The section must have passed Crossref resolution (so the GATE-03 check is reached).

**Expected:** Pass-1 returns verdict `MIS-CITED` with a reason containing `"cited work appears in Retraction Watch (live re-query at verify time)"`. The written VERIFICATION.md has a `- citekey: **MIS-CITED** ...` blocking row. A subsequent `pensmith compile` refuses with `"section N (slug): citation [@citekey] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)"`.

**Why human:** The cassette-backed gate-retraction tests use synthetic DOIs (`10.0000/gate03-retracted`) and offline cassette data. Only a live network test against real Retraction Watch data confirms the production HTTP path works end-to-end. Per VALIDATION.md, this is the one explicitly designated manual-only verification item for Phase 14. CI cassette coverage is sufficient for regression guard; the live smoke test is the sole remaining human check.

---

## Gaps Summary

No gaps. All four gates are genuinely fail-closed with test evidence. The single human verification item (live Retraction Watch smoke test) is a network-dependent smoke test explicitly planned as manual-only in VALIDATION.md — it does not represent a code gap.

---

## Invariants Confirmed

| Invariant | Status | Evidence |
|-----------|--------|---------|
| Deterministic Pass-1/Pass-3 are the blocking gate; advisory Pass-2/Pass-4 stay advisory | VERIFIED | GATE-03 places the retraction check inside the deterministic Pass-1 `verdictForCitekey` path; verify-advisory-isolation test passes (917 total) |
| 16-verb bijection intact | VERIFIED | `cli-verbs.test.ts` and `workflows-keyequal.test.ts` pass in full suite (917 pass, 0 fail) |
| All network via http.ts | VERIFIED | retraction-watch.ts imports `{ fetch as httpFetch } from '../http.js'` (line 19); no new raw fetch calls |
| No key/PII leak via retraction re-query (DOI only) | VERIFIED | retraction-watch.ts:112 URL construction is `filter=record:${encodeURIComponent(doi)}` — only the DOI is sent; the cassette-no-leak test passes (917 suite) |
| Transport error → silent skip (never a false MIS-CITED block) | VERIFIED | `catch { return null }` at retraction-watch.ts:120-122; gate-retraction test 2 confirms no false MIS-CITED from null return |
| `Status: unverifiable` still compiles (Pitfall 3 regression) | VERIFIED | GATE-01 test 5 (Pitfall 3 regression) passes — `Status: unverifiable` satisfies `hasStatus` regex |

---

_Verified: 2026-06-24T06:37:04Z_
_Verifier: Claude (gsd-verifier)_
