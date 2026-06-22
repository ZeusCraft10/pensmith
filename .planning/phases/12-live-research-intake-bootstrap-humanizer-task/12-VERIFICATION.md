---
phase: 12-live-research-intake-bootstrap-humanizer-task
verified: 2026-06-22T00:00:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run a live research command against real adapter APIs under PENSMITH_NETWORK_TESTS=1"
    expected: "pensmith research returns real candidates from at least one live adapter; LIBRARY.json written with non-empty entries array"
    why_human: "CI is cassette-only by design; live network calls and rate-limit behavior cannot be verified programmatically"
  - test: "In Claude Code (Tier 1 runtime), run pensmith done on a compiled draft"
    expected: "The humanizer skill is invoked via the Task transport; FINAL.md is written under .paper/; before/after honesty score is printed with honest framing (no 'undetectable')"
    why_human: "Requires the live Claude Code Task runtime and the user's installed humanizer skill at ~/.claude/skills/humanizer/ — neither available in CI"
---

# Phase 12: Live Research + Intake Bootstrap + Humanizer Task — Verification Report

**Phase Goal:** Make the research, intake, and humanizer pipeline real — replacing the zero-candidate placeholder library, seeding STATE.json at intake so global-library registration and style-match proceed, and wiring the Tier-1 humanizer Task invocation with an injectable seam for offline testing.
**Verified:** 2026-06-22
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GEN-03: `pensmith research` fans out to real adapters, DOI-deduplicates, fuzzy-title-deduplicates, evaluates/tiers via source-evaluator, runs crossCheckRetractions BEFORE writeBibtex (D-15), writes a real LIBRARY.json with no placeholder tokens | VERIFIED | All 6 research-discovery tests pass; source trace confirms ordering; grep confirms no PLACEHOLDER_LIBRARY/tier2-placeholder in bin/ |
| 2 | GEN-04: `pensmith intake` calls idempotent `initState(cwd)`, writes `<cwd>/STATE.json` with $schemaVersion=2 + non-null paperId; re-run does NOT regenerate paperId; registration/style-match WARN-skip guards flip to active | VERIFIED | All 4 intake-bootstrap tests pass; source confirms `initState(cwd)` at correct path aligned with `loadState(cwd)` read path |
| 3 | GEN-05: `runHumanizer` has `__setTaskRunnerForTest` seam; non-null runner writes FINAL.md under paperDir + returns path; null runner emits clean skip banner + returns null + never throws; no "undetectable" in exporter.ts | VERIFIED | All 4 humanizer-task tests pass; source grep confirms __setTaskRunnerForTest exported; `undetectable` absent from exporter.ts |

**Score:** 3/3 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/research-orchestrator.ts` | Fan-out adapter discovery orchestrator | VERIFIED | 429 lines; exports `runResearchOrchestrator` + `runResearchDiscovery` alias; injectable `__adapterRegistry` + `__forceCandidates` seams |
| `bin/lib/intake-parse.ts` | INTAKE.md heuristic parser | VERIFIED | 231 lines; `parseIntakeMd()` never throws; DISCIPLINE_MAP excludes 'machine learning'/'artificial intelligence' (lint-gate fix) |
| `bin/cli/research.ts` | Live research verb with approval gates | VERIFIED | Swap-seam replaced; imports `runResearchOrchestrator` + `parseIntakeMd`; D-15 LOCKED ordering preserved |
| `bin/cli/intake.ts` | Intake verb with initState bootstrap | VERIFIED | `initState(cwd)` called after `complete()` and before `atomicWriteFile` + `runSideEffects()`; StateAlreadyExistsError caught via `.code` |
| `bin/lib/exporter.ts` | Exporter with injectable TaskRunner | VERIFIED | `TaskRunner` type, `_taskRunner`, `__setTaskRunnerForTest` exported; `runHumanizer` body fully wired; never throws |
| `tests/research-discovery.test.ts` | GEN-03 behavioral tests | VERIFIED | 6 tests all PASS (0 skip, 0 fail) |
| `tests/intake-bootstrap.test.ts` | GEN-04 behavioral tests | VERIFIED | 4 tests all PASS (0 skip, 0 fail) |
| `tests/humanizer-task.test.ts` | GEN-05 behavioral tests | VERIFIED | 4 tests all PASS (0 skip, 0 fail) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bin/cli/research.ts` | `bin/lib/research-orchestrator.ts` | `runResearchOrchestrator(chosenScope.queries, { topic, discipline, assignment, scopeLabel })` | WIRED | Import confirmed at line 41; call at line 223 |
| `bin/cli/research.ts` | `crossCheckRetractions` | Before `writeBibtex` (D-15) | WIRED | `crossCheckRetractions` at char 7226, `writeBibtex` at char 7317 — ordering verified by test + source grep |
| `bin/cli/intake.ts` | `initState(cwd)` from `state.ts` | `try { await initState(cwd); } catch (e) { if (e.code !== 'STATE_ALREADY_EXISTS') throw e; }` | WIRED | Lines 461-465; placed AFTER `complete()`, BEFORE `atomicWriteFile` + `runSideEffects()` |
| `resolvePaperId(cwd)` | `STATE.json` | `loadState(cwd)` reads `<cwd>/STATE.json`; `initState(cwd)` writes `<cwd>/STATE.json` | WIRED | Read/write paths both use `stateFile(cwd)` = `path.join(path.resolve(cwd), 'STATE.json')` |
| `registerPaperNonFatal` WARN-skip guard | `paperId` from `resolvePaperId` | `if (!paperId) { WARN; return; }` now bypassed after STATE.json written | WIRED | Line 195 guard confirmed; test asserts "skipping global-library registration" WARN absent after init |
| `bin/lib/exporter.ts` | `__setTaskRunnerForTest` seam | Module-level `let _taskRunner: TaskRunner | null = null`; seam sets it | WIRED | Lines 63-72; `runHumanizer` checks `_taskRunner !== null` first at line 110 |
| `runResearchOrchestrator` | retraction-watch exclusion | `'search' in adapter` guard + `name !== 'unpaywall'` | WIRED | Lines 353-356; retraction-watch has no `.search` method by design (D-15) |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `research.ts` LIBRARY.json | `finalCandidates: SourceCandidate[]` | Adapter fan-out via `runResearchOrchestrator` → real adapter cassettes under PENSMITH_NO_LLM=1 | Yes — 9 candidates returned from cassettes in CI test | FLOWING |
| `intake.ts` STATE.json | `paperId` in `initState()` | `randomUUID()` from `node:crypto` — generated once, stable on re-run | Yes — test verifies non-empty UUID in STATE.json | FLOWING |
| `exporter.ts` FINAL.md | `output` from `_taskRunner('humanizer', { draft: draftMd })` | Injected `TaskRunner` in tests; live Task in Tier-1 production | Yes — test verifies content equals runner output | FLOWING (test seam confirmed; live path manual) |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 14 Phase 12 tests all pass, 0 skip | `node --import tsx --test tests/research-discovery.test.ts tests/intake-bootstrap.test.ts tests/humanizer-task.test.ts` | 14 pass, 0 fail, 0 skip | PASS |
| Full suite green | `npm test` | 889 pass, 0 fail, 0 skip | PASS |
| Lint clean | `npm run lint` | 0 errors | PASS |
| Tier-contract parity | `npm run test:tier-contract` | 48/48 pass | PASS |
| 16-verb bijection intact | `node --import tsx --test tests/cli-verbs.test.ts` | 2/2 pass — exactly 16 verbs confirmed | PASS |
| crossCheckRetractions before writeBibtex (D-15) | Source index: `crossCheckRetractions(` at char 7226, `writeBibtex(` at char 7317 | D-15 LOCKED ordering confirmed | PASS |
| No placeholder tokens in production bin/ | `grep -r 'PLACEHOLDER_LIBRARY\|tier2-placeholder' bin/` | No matches | PASS |
| No "undetectable" in exporter.ts | Source grep | Not found | PASS |
| Honest framing in honesty.ts | Source read | "it does not promise to make output undetectable" — disclaimer framing, not affirmative claim | PASS |
| retraction-watch excluded from search fan-out | `'search' in adapter` guard at line 353 of research-orchestrator.ts | retraction-watch has no `.search` method; guard confirmed by D-15 test | PASS |
| No TBD/FIXME/XXX debt markers in Phase 12 files | Grep across bin/ and tests/ | No matches in any Phase 12 deliverable | PASS |

---

## Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found; no probe paths declared in PLAN files.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GEN-03 | Plans 02, 01 | Live adapter fan-out + DOI/title dedup + source-evaluator + D-15 ordering + real LIBRARY.json (no placeholder) | SATISFIED | research-discovery.test.ts 6/6 pass; source verified |
| GEN-04 | Plans 03, 01 | `initState(cwd)` idempotent bootstrap; STATE.json at `<cwd>/STATE.json`; WARN-skip guards flip active | SATISFIED | intake-bootstrap.test.ts 4/4 pass; initState(cwd) path alignment confirmed |
| GEN-05 | Plans 04, 01 | `__setTaskRunnerForTest` seam; call-through writes FINAL.md; null-runner clean skip; honest framing | SATISFIED | humanizer-task.test.ts 4/4 pass; source grep confirms |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | — | — | — | No TBD/FIXME/XXX/PLACEHOLDER markers found in any Phase 12 deliverable |

---

## Human Verification Required

### 1. Live adapter network round-trip (GEN-03)

**Test:** Set `PENSMITH_CONTACT_EMAIL` and `PENSMITH_NETWORK_TESTS=1`, then run `pensmith research` on a fixture topic (e.g., "attention mechanisms in transformer neural networks").
**Expected:** At least one real adapter (preferably OpenAlex as the primary) returns candidates; LIBRARY.json is written with a non-empty `entries` array containing valid SourceCandidate objects.
**Why human:** All CI runs use cassette-backed offline mode. Rate limits, live API schema changes, and real network behavior cannot be verified by code inspection or offline tests. The cassette infrastructure proves the adapter plumbing is correct; the live round-trip proves adapters are still reachable.

### 2. Live Tier-1 Task invocation of humanizer skill (GEN-05)

**Test:** In Claude Code (Tier 1), run `pensmith done` on a compiled draft from a real paper. Ensure the humanizer skill is installed at `~/.claude/skills/humanizer/`.
**Expected:** The humanizer skill is invoked via the Task transport; `.paper/FINAL.md` is created with humanized prose; the before/after honesty score is printed with the honest framing ("improves readability; does not promise to make output undetectable"); the export proceeds without error.
**Why human:** The `__setTaskRunnerForTest` seam proves the offline path is correct. The live Task runtime requires Claude Code's Task API, which is not available in CI and cannot be mocked at the integration level. Per the Phase 12 VALIDATION.md and CONTEXT.md, this is the explicitly documented manual-only verification item — the seam delivery is what Phase 12 ships; the live Task call is the human acceptance test.

---

## Gaps Summary

No automated gaps. All three GEN requirements are fully verified by code inspection and passing tests. The two human verification items represent:

1. A live network smoke test that is intentionally out of scope for CI (cassette infrastructure is the automated proxy).
2. The Tier-1 live Task runtime verification that is structurally impossible to automate in CI — explicitly documented in the VALIDATION.md as a manual-only check.

These items do not block any downstream phase. Phase 13 (citation rendering at export) and Phase 14 (re-verify humanized FINAL.md / GATE-04) can proceed.

---

_Verified: 2026-06-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
