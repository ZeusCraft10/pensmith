---
phase: 11-tier-2-llm-transport
fixed_at: 2026-06-22T00:00:00Z
review_path: .planning/phases/11-tier-2-llm-transport/11-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 7
skipped: 2
status: partial
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-06-22
**Source review:** `.planning/phases/11-tier-2-llm-transport/11-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-04, WR-05, IN-01, IN-02, IN-03 — but IN-02 and IN-03 were excluded per user instruction)
- Fixed: 7 (CR-01, CR-02, WR-01, WR-02, WR-03, WR-05, IN-01)
- Skipped: 2 (IN-02, IN-03 — deferred per explicit user instruction, not worth churn)

Note: WR-04 was a documentation/comment finding only (add a comment to revise-swap.ts); user did not include it in the fix list. Treated as out of scope.

## Fixed Issues

### CR-01: All verb GEN-06 probes hardcode `'anthropic'`

**Files modified:** `bin/lib/anthropic.ts`, `bin/cli/intake.ts`, `bin/cli/outline.ts`, `bin/cli/research.ts`, `bin/cli/plan.ts`, `bin/cli/revise.ts`
**Commit:** 403127e
**Applied fix:** Extracted `resolveProviderId(): Promise<string>` from `anthropic.ts` as the single source of truth for provider-ID resolution (reads runtime config, returns first key or `'anthropic'` as default). Updated all 5 verb GEN-06 probes to `await resolveProviderId()` then `getProviderApiKey(providerId)` instead of hardcoding `'anthropic'`. The `complete()` function continues to do the resolution inline (to avoid a double `loadRuntimeConfig()` call) but the logic is now identical to what `resolveProviderId()` does.

---

### CR-02: `write` wave mode missing GEN-06 probe + exitCode never set

**Files modified:** `bin/cli/write.ts`
**Commit:** 403127e
**Applied fix:** Added a GEN-06 fail-loud probe at the top of the wave-mode branch (before `runAllSections` dispatch) — same `resolveProviderId()` + `getProviderApiKey()` pattern as the other verbs. Also added `if (anyFailed) process.exitCode = 1;` before the `return { ok: !anyFailed, mode: 'wave', waves: results }` line so wave failures exit the process non-zero.

---

### WR-01: Anthropic HTTP-200 error-type responses not handled

**Files modified:** `bin/lib/anthropic.ts`
**Commit:** 403127e
**Applied fix:** Added an early-exit guard in `parseAnthropicResponse()` that checks `parsed['type'] === 'error'` (via `unknown` cast to satisfy TypeScript's index-signature requirement) and throws a descriptive error surfacing the provider's `error` field JSON, before attempting to read `content[0]`.

---

### WR-02: T-11-07 header assertion uses OR

**Files modified:** `tests/llm-transport.test.ts`
**Commit:** 403127e
**Applied fix:** Changed `headerStr.includes('x-api-key') || headerStr.includes('anthropic-version')` to `&&`, and added a separate `assert.ok(JSON.stringify(capturedHeaders).includes('sk-ant-test-body-shape-key'), ...)` assertion so the test fails if the key value itself is absent from the request headers.

---

### WR-03: `complete()` does not enforce message-list invariants

**Files modified:** `bin/lib/anthropic.ts`
**Commit:** 403127e
**Applied fix:** Added two invariant checks at the top of `complete()` (before the offline short-circuit, before any network work): (1) `if (opts.messages.length === 0) throw` and (2) `if (lastMsg?.role !== 'user') throw`. Both throw descriptive `Error` instances that identify the violated invariant, replacing the former opaque HTTP 400.

---

### WR-05: Whitespace-only completion content not caught

**Files modified:** `bin/lib/anthropic.ts`
**Commit:** 403127e
**Applied fix:** Changed the guard in `parseOpenAiResponse()` from `content.length === 0` to `content.trim().length === 0` to catch whitespace-only responses. Also improved the error message: when `content === null` it now includes the `finish_reason` for better debugging; otherwise it keeps the original excerpt-based message.

---

### IN-01: T-11-03 no positive assertion that key appears in request headers

**Files modified:** `tests/llm-transport.test.ts`
**Commit:** 403127e
**Applied fix:** Changed the T-11-03 MockAgent intercept from a static reply to a `reply(fn)` callback that captures `opts.headers` into `capturedRequestHeaders` and pushes to `intercepted[]`. Added two assertions after the disk-sweep: (1) that the intercept was triggered at all, and (2) that `JSON.stringify(capturedRequestHeaders).includes(KEY_SENTINEL)` — confirming the API key actually appeared in the outbound `x-api-key` header.

---

## Skipped Issues

### IN-02: cache-key computed on POST (efficiency micro-opt)

**File:** `bin/lib/http.ts`
**Reason:** Deferred per explicit user instruction — "not worth the churn." SHA-256 computation on POST is wasteful but not incorrect; no security or correctness issue.
**Original issue:** `cacheKey()` called for every fetch including POST where the result is never used.

---

### IN-03: `research.ts` forward-compatibility comment clarity

**File:** `bin/cli/research.ts`
**Reason:** Deferred per explicit user instruction — "not worth the churn." Comment-only change with no behavioral impact.
**Original issue:** Comment could more clearly describe that the eager load of `source-evaluator` is a forward-compatibility guard, not a current-phase requirement.

---

_Fixed: 2026-06-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
