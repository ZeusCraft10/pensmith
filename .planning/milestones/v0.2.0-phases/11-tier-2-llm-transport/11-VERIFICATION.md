---
phase: 11-tier-2-llm-transport
verified: 2026-06-22T00:00:00Z
status: passed
score: 3/3 requirements verified (19/19 transport tests pass; 875/875 full suite pass; 48/48 tier-contract pass)
overrides_applied: 0
re_verification: false
---

# Phase 11: Tier-2 LLM Transport Verification Report

**Phase Goal:** A single `bin/lib/anthropic.ts` LLM transport chokepoint, wired into the six generative verbs (intake, research, outline, plan, write, revise) so Tier 2 produces real artifacts when a key is configured, and fails loud when no key is configured.

**Verified:** 2026-06-22
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `bin/lib/anthropic.ts` exists, exports `complete()` and `isNoLlmMode()`, and is the sole LLM network call site | VERIFIED | File exists at 437 lines; exports confirmed by grep and T-11-01..T-11-04,T-11-07,T-11-08 all PASS |
| 2 | All LLM network routes through `bin/lib/http.ts::fetch()` — no undici/http/https/SDK-network import in `anthropic.ts` | VERIFIED | `npm run lint` exits 0 (ESLint D-06 chokepoint enforced); `anthropic.ts` has zero banned imports; SDK imports are `import type` only |
| 3 | `assertBudget` fires before every `fetch()` call (line 330 before line 373); `appendCost` records actual usage after | VERIFIED | Direct code read: `assertBudget` line 330, `fetch` line 373; T-11-02 PASS proves budget gate fires before network |
| 4 | The resolved API key value never reaches session log / stdout / exports (T-01-07 no-leak) | VERIFIED | T-11-03 PASS: disk sweep + stdout/stderr capture confirms sentinel never appears; `noCache:true` on every POST; key passed only to `headers` arg |
| 5 | `isNoLlmMode()` short-circuits before `getProviderApiKey()` — offline mode never triggers MissingApiKeyError | VERIFIED | Code confirms: step 1 in `complete()` is `if (isNoLlmMode()) return ...` before any provider/key resolution; T-11-01 PASS |
| 6 | Each of the 6 verbs calls `complete()` and produces a non-placeholder artifact under `PENSMITH_NO_LLM=1` | VERIFIED | Zero `tier2-placeholder`/`TIER2_*` strings in bin/cli/{intake,research,outline,plan,write,revise}.ts; T-11-06 per-verb PASS for all 6 verbs |
| 7 | With no key configured, each verb fails loud (stderr banner + non-zero exit), never `ok:true` with empty/placeholder output | VERIFIED | T-11-05 per-verb PASS for all 6 verbs; grep confirms each verb returns `{ ok: false, mode: 'no-key-configured' }` on `MissingApiKeyError` |
| 8 | `assertDrafterInput` precedes `complete()` in `write.ts` (WRTE-04 ordering) | VERIFIED | `assertDrafterInput` at line 199, `complete(` at line 221 in write.ts |
| 9 | One shared `proposeSwap` in `bin/lib/revise-swap.ts` — `tier2ProposeSwap` stubs removed from plan.ts and revise.ts | VERIFIED | Both files import `from '../lib/revise-swap.js'`; no local stubs remain; `revise-swap.ts` exists and calls `complete()` |
| 10 | `research.ts` has Phase-12/GEN-03 swap seam comment; no PLACEHOLDER_LIBRARY; crossCheckRetractions before writeBibtex | VERIFIED | Phase-12 seam comments at lines 136-193; crossCheckRetractions line 197 before writeBibtex line 200 (D-15 preserved) |
| 11 | 16-verb/16-body bijection intact (no 17th verb added) | VERIFIED | tier-contract test `ARCH-01: workflow filenames are bijective with dispatcher verbs` PASS at 48/48 |
| 12 | Tier-1 generation (Claude Code Task/subagents) untouched — no workflow bodies modified in Phase 11 | VERIFIED | `git log --since=2026-06-21 -- "workflows/*.md"` shows only pre-Phase-11 workflow commit (10-04); Phase-11 commits touch only `bin/` and `tests/` |

**Score:** 12/12 truths verified

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| GEN-01 | `bin/lib/anthropic.ts` is single LLM chokepoint; all LLM network via `http.ts`; `assertBudget` before every call; key value never logged | VERIFIED | `anthropic.ts` exists and is sole call site; `npm run lint` 0 errors (D-06 chokepoint); T-11-01/02/03/04/07/08 all PASS |
| GEN-02 | Six generative verbs call transport; produce real (non-placeholder) artifacts when key configured or under `PENSMITH_NO_LLM=1` | VERIFIED | All 6 verbs contain `complete(`; zero `TIER2_*`/`tier2-placeholder` strings; T-11-06 PASS for all 6 verbs |
| GEN-06 | With no key configured, each verb fails loud (stderr banner + non-zero exit), never `ok:true` with empty/placeholder artifact | VERIFIED | T-11-05 PASS for all 6 verbs; each verb returns `{ ok: false, mode: 'no-key-configured' }` + `process.exitCode = 1` |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/anthropic.ts` | complete() + isNoLlmMode() chokepoint (GEN-01) | VERIFIED | 437 lines; exports `complete`, `isNoLlmMode`, `MissingApiKeyError`; uses `fetch` from `./http.js` only |
| `bin/lib/revise-swap.ts` | shared proposeSwap via complete() | VERIFIED | 84 lines; exports `proposeSwap`; offline short-circuit returns deterministic remove JSON |
| `bin/cli/intake.ts` | real intake via complete(); fail-loud | VERIFIED | imports `complete` from `../lib/anthropic.js`; MissingApiKeyError catch returns `{ ok: false }` |
| `bin/cli/research.ts` | real research via complete(); fail-loud; D-15 ordering | VERIFIED | imports `complete`; crossCheckRetractions before writeBibtex; Phase-12 seam commented |
| `bin/cli/outline.ts` | real outline via complete(); approval gate; fail-loud | VERIFIED | imports `complete`; approval gate (TTY/non-TTY); MissingApiKeyError path returns ok:false |
| `bin/cli/plan.ts` | real PLAN.md via complete(); shared proposeSwap; fail-loud | VERIFIED | imports `complete` and `proposeSwap from revise-swap.js`; MissingApiKeyError catch |
| `bin/cli/write.ts` | real draft via complete() after assertDrafterInput; fail-loud | VERIFIED | assertDrafterInput line 199 < complete( line 221; MissingApiKeyError propagates |
| `bin/cli/revise.ts` | shared proposeSwap; fail-loud | VERIFIED | imports `proposeSwap from revise-swap.js`; no local tier2ProposeSwap stub |
| `tests/llm-transport.test.ts` | T-11-01..T-11-08 + per-verb T-11-05/T-11-06 | VERIFIED | 19/19 tests PASS (0 skip, 0 fail) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bin/lib/anthropic.ts` | `bin/lib/http.ts` | `fetch(url, { method:'POST', source:'generic', noCache:true })` | WIRED | fetch imported from `./http.js`; called at line 373; `noCache:true` confirmed |
| `bin/lib/anthropic.ts` | `bin/lib/budget.ts` | `assertBudget` before fetch; `appendCost` after | WIRED | assertBudget line 330, appendCost line 419; both imported |
| `bin/lib/anthropic.ts` | `bin/lib/runtime.ts` | `getProviderApiKey` + `loadRuntimeConfig` | WIRED | Both imported and called in correct order (after offline check) |
| `bin/cli/intake.ts` | `bin/lib/anthropic.ts` | `complete({ system, messages:[{role:'user', content: egressSeed}] })` | WIRED | `import { complete, MissingApiKeyError } from '../lib/anthropic.js'` confirmed |
| `bin/cli/write.ts` | `bin/lib/drafter-input.ts` | `assertDrafterInput` before `complete()` | WIRED | assertDrafterInput line 199, complete line 221 — ordering verified |
| `bin/cli/plan.ts` | `bin/lib/revise-swap.ts` | `proposeSwap` import | WIRED | `import { proposeSwap } from '../lib/revise-swap.js'` |
| `bin/cli/revise.ts` | `bin/lib/revise-swap.ts` | `proposeSwap` import | WIRED | `import { proposeSwap } from '../lib/revise-swap.js'` |
| `bin/cli/research.ts` | `bin/lib/sources/retraction-cross-check.ts` | `crossCheckRetractions(candidates)` before `writeBibtex` | WIRED | crossCheckRetractions line 197, writeBibtex line 200 (D-15 preserved) |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `bin/lib/anthropic.ts::complete()` | `text`, `inputTokens`, `outputTokens` | Provider REST API via http.ts POST | Yes (or deterministic mock under PENSMITH_NO_LLM=1) | FLOWING |
| `bin/cli/intake.ts` | INTAKE.md content | `complete()` result.text | Yes (offline mock in CI; real provider text with key) | FLOWING |
| `bin/cli/research.ts` | LIBRARY.json entries | `complete()` + defensive SourceCandidateSchema.safeParse | Yes (empty candidates with WARN in offline/Phase-11; real in Phase-12) | FLOWING |
| `bin/cli/outline.ts` | OUTLINE.md content | `complete()` result.text | Yes | FLOWING |
| `bin/cli/plan.ts` | PLAN.md content | `complete()` result.text | Yes | FLOWING |
| `bin/cli/write.ts` | DRAFT.md content | `complete()` result.text after assertDrafterInput | Yes | FLOWING |
| `bin/cli/revise.ts` | swap proposal | `proposeSwap()` → `complete()` result.text | Yes (deterministic JSON in offline mode) | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| T-11-01: offline mock (no HTTP call) | `node --import tsx --test tests/llm-transport.test.ts` | 19 pass, 0 skip, 0 fail | PASS |
| T-11-02: assertBudget fires before fetch | same | BudgetExceededError without network — PASS | PASS |
| T-11-03: API key never leaks to disk/stdout/stderr | same | Disk sweep + capture confirms no sentinel — PASS | PASS |
| T-11-04: MissingApiKeyError propagates | same | Rejects with MissingApiKeyError — PASS | PASS |
| T-11-05: all 6 verbs fail loud on no key | same | All 6 exit non-zero + stderr banner — PASS | PASS |
| T-11-06: all 6 verbs write non-placeholder under PENSMITH_NO_LLM=1 | same | All 6 write offline mock artifact — PASS | PASS |
| T-11-07: Anthropic request body + headers shape | same | POST body {model,max_tokens,system,messages} + x-api-key — PASS | PASS |
| T-11-08: OpenAI request body + Authorization header | same | POST body {model,max_tokens,messages} + Bearer — PASS | PASS |
| Full suite | `npm test` | 875 pass, 0 fail, 0 skip | PASS |
| Tier-contract suite | `npm run test:tier-contract` | 48 pass, 0 fail — 16-verb bijection PASS | PASS |
| Lint (D-06 chokepoint) | `npm run lint` | 0 errors | PASS |
| TypeScript | `npm run typecheck` | 0 errors | PASS |

---

## Scope Fence Verification (Phase 12 Items Correctly Deferred)

| Item | Expected Disposition | Actual Status |
|------|---------------------|---------------|
| Live source-discovery in research (GEN-03) | Deferred to Phase 12 | CORRECTLY deferred — Phase-12/GEN-03 seam comment in research.ts; Phase-11 writes `{ $schemaVersion:1, entries:[] }` with WARN in offline mode |
| Intake STATE.json/paperId bootstrap (GEN-04) | Deferred to Phase 12 | CORRECTLY deferred — intake.ts wires transport without paperId plumbing |
| Humanizer Task transport (GEN-05) | Deferred to Phase 12 | CORRECTLY deferred — no humanizer changes in Phase-11 commits |
| SSE streaming | Deferred — http.ts has no SSE reader | CORRECTLY deferred — anthropic.ts uses non-streaming POST only |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `bin/lib/revise-swap.ts` line 6 | Comment mentions `tier2ProposeSwap` (historical context, not functional code) | Info | Not a stub — comment documents what was removed |
| `bin/cli/research.ts` lines 121-124 | Placeholder strings in `interpolate()` call vars (`'(topic from INTAKE.md — wire via Phase 12 / GEN-03)'`) | Info | Intentional Phase-12 seam — documented, not a silent failure; verb still calls `complete()` and produces a real LIBRARY.json |

No BLOCKERS. No unresolved TBD/FIXME/XXX markers. The research.ts placeholder var strings are inside an `interpolate()` call that feeds into `complete()` — Phase-11 correctly produces a real (but content-limited) LIBRARY.json and documents the seam for Phase 12.

---

## Human Verification Required

One item requires manual testing with a live API key:

### 1. Live LLM call produces non-empty real artifact

**Test:** Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) to a real key. Run one generative verb in Tier 2 on a fixture assignment (e.g., `ANTHROPIC_API_KEY=<key> pensmith new`). Confirm a non-empty, non-placeholder INTAKE.md is written and no key value appears in any log file.

**Expected:** A real LLM-generated artifact is written; `process.exitCode` is 0; no key value appears in session logs or stdout.

**Why human:** Costs money and requires a real provider key — never run in CI. The offline mock (T-11-06) and no-leak test (T-11-03) cover the code paths; only the live integration is not automated.

---

## Gaps Summary

No gaps. All three requirements (GEN-01, GEN-02, GEN-06) are fully satisfied with test evidence:

- **GEN-01:** `bin/lib/anthropic.ts` is the sole LLM call site. ESLint D-06 chokepoint passes. `assertBudget` fires before `fetch`. T-01-07 no-leak property verified by T-11-03 (passing).
- **GEN-02:** All 6 verbs call `complete()`. Zero placeholder strings remain. T-11-06 passes for all 6 verbs under `PENSMITH_NO_LLM=1` (offline mock counts as real for CI per scope definition).
- **GEN-06:** All 6 verbs return `{ ok: false, mode: 'no-key-configured' }` + `process.exitCode = 1` + stderr banner when no key configured. T-11-05 passes for all 6 verbs.

The one human-verification item (live API key integration) is a manual-only check per the VALIDATION.md contract — it does not block the phase goal.

---

_Verified: 2026-06-22_
_Verifier: Claude (gsd-verifier)_
