---
phase: 12-live-research-intake-bootstrap-humanizer-task
fixed_at: 2026-06-22T00:00:00Z
review_path: .planning/phases/12-live-research-intake-bootstrap-humanizer-task/12-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-06-22
**Source review:** `.planning/phases/12-live-research-intake-bootstrap-humanizer-task/12-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04; WR-05/IN-01/IN-02 explicitly deferred by user)
- Fixed: 6
- Skipped: 1 (WR-05 — deferred per user instruction)

## Fixed Issues

### CR-01: Prompt injection via unescaped `{{}}` in interpolate() slots

**Files modified:** `bin/lib/intake-parse.ts`, `bin/cli/research.ts`, `bin/lib/research-orchestrator.ts`
**Applied fix:** Added `escapeTemplateTokens(s)` helper (exported from `intake-parse.ts`) that replaces `{{` with `{ {` and `}}` with `} }`. Applied to all user-controlled strings (topic, discipline, assignment) in the `research.ts` topic-disambiguator call and the `research-orchestrator.ts` source-evaluator call. Both call sites import the single shared implementation from `intake-parse.ts`. Also added 2 regression tests in `tests/intake-parse-security.test.ts`.

### CR-02: `normalizeDiscipline` substring mis-mapping via `key.includes()`

**Files modified:** `bin/lib/intake-parse.ts`
**Applied fix:** Replaced the `key.includes(pattern)` fallback loop with a word-boundary regex: `new RegExp(\`\\b${escapedPattern}\\b\`, 'i')`. Hyphens in compound patterns (e.g. `computer-science`) are treated as `[-\s]` to match both hyphen and space forms. Short abbreviations (`ai`, `ml`, `cs`, `lit`, `soc`, `phil`, `bio`, `hist`) now only match whole words. Added 3 regression tests in `tests/intake-parse-security.test.ts` asserting false-positive cases no longer fire and true-positive cases still resolve correctly.

### WR-01: Scope-gate silent bypass when `ask()` returns unrecognised value

**Files modified:** `bin/cli/research.ts`
**Applied fix:** Extracted `answerValue` from the cast, then used an `if/else` block — when `scopes.find()` returns `undefined`, emits a WARN to stderr (`"scope selection returned unrecognised value ... falling back to first scope"`) rather than silently using the pre-gate default.

### WR-02: Empty-title false duplicate in `dedupCandidates`

**Files modified:** `bin/lib/research-orchestrator.ts`
**Applied fix:** Added a guard before each `jaroWinkler()` call in the title-dedup loop: `if (!c.title.trim() || !existing.title.trim()) continue;`. When either title is empty/whitespace, the comparison is skipped and the candidate is treated as non-duplicate. DOI dedup (Phase 1) is unaffected.

### WR-03: Abstract not truncated before LLM serialization

**Files modified:** `bin/lib/research-orchestrator.ts`
**Applied fix:** In `evaluateCandidates`, the `abstract` field is now capped at 500 characters before serialization: `abstract: c.abstract ? c.abstract.slice(0, 500) : undefined`. Comment documents the budget rationale (T-12-03).

### WR-04: `StateAlreadyExistsError` caught by `.code` string check instead of `instanceof`

**Files modified:** `bin/cli/intake.ts`
**Applied fix:** Added `StateAlreadyExistsError` to the import from `../lib/state.js`, and changed the catch guard from `(e as { code?: string }).code !== 'STATE_ALREADY_EXISTS'` to `!(e instanceof StateAlreadyExistsError)`. This is consistent with the canonical pattern in `state.ts:177` and avoids swallowing unrelated errors that happen to carry a matching `.code` field.

## Skipped Issues

### WR-05: `scopeLabel` hard-coded to `'auto'` in single-opts orchestrator overload

**File:** `bin/lib/research-orchestrator.ts:332`
**Reason:** Deferred per explicit user instruction ("Skip WR-05, IN-01, IN-02").
**Original issue:** When `runResearchOrchestrator` is called via the single-opts overload (tests), `scopeLabel` is always `'auto'` regardless of actual scope, causing the source evaluator to always receive `scope: 'auto'` in test context.

---

**Build result:** `npm run build` — clean (tsc 0 errors)
**Lint result:** `npm run lint` — clean (eslint 0 warnings/errors)
**Typecheck result:** `npm run typecheck` — clean (tsc --noEmit 0 errors)
**Test result:** 894 pass, 0 fail, 0 skip (up from 889; +5 new regression tests for CR-01 and CR-02)

_Fixed: 2026-06-22_
_Fixer: Claude Sonnet 4.6 (gsd-code-fixer)_
_Iteration: 1_
