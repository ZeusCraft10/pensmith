---
phase: 11-tier-2-llm-transport
plan: "02"
subsystem: llm-transport
tags: [llm, transport, chokepoint, budget, no-leak, provider-dispatch]
dependency_graph:
  requires:
    - "11-01 (Wave-0 RED-by-skip test scaffold)"
    - "bin/lib/http.ts (HTTP chokepoint — D-06)"
    - "bin/lib/runtime.ts (provider key resolution)"
    - "bin/lib/budget.ts (assertBudget + appendCost)"
    - "bin/lib/pricing.ts (estimateCost)"
  provides:
    - "bin/lib/anthropic.ts — complete() + isNoLlmMode() (GEN-01)"
  affects:
    - "Wave 2 (plans 11-03 + 11-04) — six generative verbs call complete()"
tech_stack:
  added:
    - "bin/lib/anthropic.ts (new chokepoint module)"
  patterns:
    - "Offline-seam predicate (isNoLlmMode mirrors isOfflineMode from http-mock.ts)"
    - "Pre-call budget gate: assertBudget before fetch, appendCost after"
    - "No-leak: key value only in http.ts headers arg, never in logs/disk/cache"
    - "Provider switch dispatch: anthropic Messages API vs openai Chat Completions"
    - "Type-only SDK imports (@anthropic-ai/sdk, openai) — no network from SDK"
key_files:
  created:
    - bin/lib/anthropic.ts
  modified:
    - eslint.config.js
    - tests/llm-transport.test.ts
decisions:
  - "Used `import type Anthropic from '@anthropic-ai/sdk'` with `Anthropic.Message` alias — the SDK exports its Message type under the default namespace, not as a named export"
  - "Added eslint.config.js exemption for tests/llm-transport.test.ts (undici MockAgent needed for HTTP intercept; fsp.writeFile for budget-gate seed) — same pattern as http.test.ts exemption"
  - "Fixed pre-existing Wave-0 scaffold lint issues (unused vars, prefer-const) as Rule 3 auto-fix — they blocked npm run lint"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-22"
  tasks_completed: 2
  files_count: 3
---

# Phase 11 Plan 02: LLM Transport Chokepoint (Wave 1) Summary

**One-liner:** Implemented `bin/lib/anthropic.ts` as the single LLM completion chokepoint — offline seam, budget gate, no-leak key routing, and anthropic/openai provider dispatch via http.ts POST only.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | complete() core — offline seam, key resolution, budget gate, http.ts POST | 8c32056 | bin/lib/anthropic.ts (created), eslint.config.js, tests/llm-transport.test.ts |
| 2 | Provider dispatch (anthropic vs openai request + response shapes) | 8c32056 (same commit — atomic) | bin/lib/anthropic.ts |

## Tests Flipped from skip to PASS

| Test ID | Description |
|---------|-------------|
| isNoLlmMode unit | isNoLlmMode() returns true iff PENSMITH_NO_LLM===1 |
| T-11-01 | complete() returns offline mock under PENSMITH_NO_LLM=1 with no HTTP call |
| T-11-02 | complete() raises BudgetExceededError BEFORE any HTTP call when budget exceeded |
| T-11-03 | API key value never leaks to disk files, stdout, or stderr (no-leak) |
| T-11-04 | complete() rejects with MissingApiKeyError when no API key configured |
| T-11-07 | Anthropic provider sends correct POST body and headers to api.anthropic.com |
| T-11-08 | OpenAI provider sends correct POST body and Authorization header to api.openai.com |

T-11-05 and T-11-06 (per-verb integration tests) correctly remain skipped — verbs not yet wired (Wave 2).

## Verification Results

- `node --import tsx --test tests/llm-transport.test.ts`: 7 PASS, 12 skip (Wave-2 verbs), 0 fail
- `npm run lint`: PASS (0 errors)
- `npm run typecheck`: PASS (0 errors)
- `npm run test:tier-contract`: 48/48 PASS (PENSMITH_NO_LLM offline seam keeps tier-contract green with no key)
- `npm test`: 863 pass, 0 fail, 12 skip (full suite)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing lint failures in Wave-0 test scaffold**

- **Found during:** Task 1 (`npm run lint` step)
- **Issue:** `tests/llm-transport.test.ts` (committed in plan 11-01) had 11 ESLint errors: `undici` import banned by chokepoint rule, `fsp.writeFile` banned, unused vars (`tsxLoaderArg`, `tmpRoot`, `_agent`), `prefer-const` violations
- **Fix:**
  1. Added exemption block to `eslint.config.js` for `tests/llm-transport.test.ts` disabling `no-restricted-imports` and `no-restricted-syntax` (same pattern as `http.test.ts` exemption — MockAgent requires undici, budget-gate seed uses fsp.writeFile)
  2. Removed unused `tsxLoaderArg` function from the test file
  3. Changed unused callback params from named to positional (`async () =>` instead of `async (tmpRoot, _agent) =>`) in T-11-01 and T-11-04
  4. Changed T-11-02 callback to drop unused `_agent` parameter
  5. Changed `let` to `const` for `capturedRequestHeaders` and `capturedRequestBody` in T-11-03
- **Files modified:** `eslint.config.js`, `tests/llm-transport.test.ts`
- **Commit:** 8c32056

**2. [Rule 1 - Bug] @anthropic-ai/sdk `Message` is not a named export**

- **Found during:** Task 1 (`npm run typecheck` step)
- **Issue:** Plan specified `import type { Message } from '@anthropic-ai/sdk'` but the SDK exports `Message` under the default namespace (`Anthropic.Message`), not as a named export — TypeScript error TS2614
- **Fix:** Changed to `import type Anthropic from '@anthropic-ai/sdk'` and created a local `type AnthropicMessage = Anthropic.Message` alias
- **Files modified:** `bin/lib/anthropic.ts`
- **Commit:** 8c32056

## Known Stubs

None. `bin/lib/anthropic.ts` is fully implemented. The per-verb integration tests (T-11-05, T-11-06) correctly skip because the verbs (`intake.ts`, `research.ts`, etc.) still contain their Wave-0 `TIER2_*` placeholder constants — these will be wired in Wave 2 (plans 11-03 + 11-04).

## Threat Flags

No new trust boundaries introduced beyond those in the plan's threat model. The three boundaries in the plan (pensmith→provider REST, caller content→API, transport→cache) are all correctly mitigated:
- Key never reaches logs/disk/cache (T-11-03 no-leak verified)
- Budget gate fires before every fetch (T-11-02 verified)
- noCache:true prevents auth header reaching cache (defense-in-depth)

## Self-Check: PASSED

- `bin/lib/anthropic.ts` exists and exports `complete` and `isNoLlmMode` — FOUND
- Commit 8c32056 exists — FOUND
- `grep -c 'isNoLlmMode\|complete' bin/lib/anthropic.ts` returns > 0 — FOUND
- No `new Anthropic(` or `new OpenAI(` in anthropic.ts — VERIFIED
- `api.anthropic.com` and `api.openai.com` both present in anthropic.ts — VERIFIED
- No `key` variable interpolated in any throw message — VERIFIED
