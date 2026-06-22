---
phase: 11-tier-2-llm-transport
reviewed: 2026-06-22T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - bin/lib/anthropic.ts
  - bin/lib/revise-swap.ts
  - bin/cli/intake.ts
  - bin/cli/outline.ts
  - bin/cli/write.ts
  - bin/cli/research.ts
  - bin/cli/plan.ts
  - bin/cli/revise.ts
  - tests/llm-transport.test.ts
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: fixed
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-22
**Depth:** deep
**Files Reviewed:** 9
**Status:** fixed

## Summary

Phase 11 implements the Tier-2 LLM transport chokepoint (`anthropic.ts`) and wires six generative verbs to it. The core security properties — no-leak key path, D-06 network chokepoint, noCache on POST, offline short-circuit before key resolution — are structurally correct. The `appendCost`/`assertBudget` call order is correct in the transport. Session-log redaction (T-01-07) correctly excludes the key value.

However, two blockers exist: (1) the `write` verb's wave mode has no GEN-06 fail-loud probe, so a missing API key surfaces only as per-section failures rather than a clean early exit with a stderr banner and non-zero exit code — and process.exitCode is never set to 1 on wave failure; (2) all six verb-level probes hardcode `'anthropic'` as the provider ID regardless of the runtime config's active provider, breaking the probe when the user has configured OpenAI as primary.

There are also meaningful warnings around the Anthropic API error-type response (HTTP 200 with `{"type":"error",...}`) not being handled, T-11-07's header assertion being logically too weak (OR instead of AND), CompleteOptions message-list invariants documented but not enforced, and the wave mode returning `ok:false` without setting `process.exitCode`.

---

## Critical Issues

### CR-01: All verb GEN-06 probes hardcode `'anthropic'` — breaks fail-loud when OpenAI is the configured provider

**File:** `bin/cli/intake.ts:413`, `bin/cli/outline.ts:90`, `bin/cli/research.ts:98`, `bin/cli/plan.ts:76`, `bin/cli/revise.ts:84`

**Issue:** Every verb-level GEN-06 fail-loud probe calls `getProviderApiKey('anthropic')` with a literal string. Inside `complete()`, the actual provider is resolved dynamically as `providerIds[0]` from the runtime config — so when the user configures OpenAI as their sole provider (`runtime.json` has `providers: { openai: { name: 'openai', ... } }`), the verb-level probe will throw `MissingApiKeyError("no provider config for 'anthropic'")` even though `complete()` would succeed with the configured OpenAI key. The GEN-06 probe runs before any side effects, so no artifact is written and the user sees a spurious "no LLM key" error that has nothing to do with their actual configuration.

The probe was intended to surface missing keys early. With the hardcoded `'anthropic'` ID it instead surface a false-positive for any non-Anthropic runtime config, causing every OpenAI user who calls `pensmith new`, `pensmith outline`, `pensmith research`, `pensmith plan`, `pensmith revise` to hit a spurious error regardless of their actual key status.

**Fix:** Mirror the provider-resolution logic from `complete()`. Replace the hardcoded `'anthropic'` string with a dynamic resolution:

```typescript
// In each verb, replace:
await getProviderApiKey('anthropic');

// With:
import { loadRuntimeConfig } from '../lib/runtime.js';
// ...
const cfg = await loadRuntimeConfig();
const providerIds = Object.keys(cfg.providers ?? {});
const activeProviderId = providerIds[0] ?? 'anthropic';
await getProviderApiKey(activeProviderId);
```

Alternatively, expose a thin helper from `anthropic.ts` (e.g., `resolveProviderId(): Promise<string>`) so the resolution stays in one place and verbs only call that.

---

### CR-02: `write` wave mode missing GEN-06 probe + process.exitCode never set on wave failure

**File:** `bin/cli/write.ts:267–318`

**Issue:** The `write` verb's wave path (invoked when `args.n` is absent) has no GEN-06 fail-loud probe at all. Every other wired verb (intake, outline, research, plan, revise) probes for the API key before any other work. The `write` verb does this only in the single-section path (inside the `MissingApiKeyError` catch at line 339). In wave mode, `MissingApiKeyError` propagates up through `runAllSections` → `Promise.allSettled` → appears as a per-section `status: 'failed'` entry in the results. This means:

1. Wave mode with no key calls `runAllSections`, which launches wave-0 sections, each of which calls `writeOneSection`, which calls `complete()`, which throws `MissingApiKeyError`. The orchestrator catches it per-section and marks each section `failed`. The verb then returns `{ ok: false, mode: 'wave' }` — but `process.exitCode` is never set. Because citty does not map a verb return value to exit code, `pensmith write` (wave mode) exits 0 on a no-key condition. This violates GEN-06.

2. Even on wave-mode failures from other errors, the `anyFailed` check on line 317 correctly sets `ok: false`, but no corresponding `process.exitCode = 1` is ever assigned, so the process exits 0 regardless of how many sections failed.

**Fix:**

```typescript
// Before the wave mode block begins, add the GEN-06 probe:
const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
if (!noLlm) {
  try {
    const cfg = await loadRuntimeConfig();
    const providerId = Object.keys(cfg.providers ?? {})[0] ?? 'anthropic';
    await getProviderApiKey(providerId);
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      process.stderr.write(
        'pensmith write: ERROR — no LLM key configured.\n' +
        'Set ANTHROPIC_API_KEY to enable real generation.\n' +
        'Run inside Claude Code (Tier 1) for key-free operation.\n',
      );
      process.exitCode = 1;
      return { ok: false, mode: 'no-key-configured' };
    }
    throw e;
  }
}

// And at the end of wave mode, set exitCode when any section failed:
const anyFailed = results.some((w) => w.sections.some((s) => s.status === 'failed'));
if (anyFailed) process.exitCode = 1;
return { ok: !anyFailed, mode: 'wave', waves: results };
```

---

## Warnings

### WR-01: Anthropic `{"type":"error"}` responses with HTTP 200 are not handled — silent wrong output

**File:** `bin/lib/anthropic.ts:176–209`

**Issue:** The Anthropic Messages API can return an HTTP 200 response whose body has `{"type":"error","error":{"type":"overloaded_error","message":"..."}}`. This is a documented API behavior (service overload, streaming errors, etc.) where the status line is 200 but the body signals failure. `parseAnthropicResponse` tries to read `parsed.content?.[0]` from this shape — the `content` field is absent on error-type responses, so the function throws the "Anthropic response missing content[0].text" error. The upstream `httpResponse.status >= 400` guard at line 384 never fires for HTTP 200. The result is an opaque `Error` without any of the provider's error detail.

The real problem is silent wrong output is not possible (the parse throws), but the error message hides the provider's error reason, making debugging very hard. More critically, if the error type body coincidentally has a `content` array with a non-text block (e.g., a `tool_use` block from a future API change), `parseAnthropicResponse` would throw with a confusing message instead of surfacing the actual error.

**Fix:** Check `parsed.type === 'error'` before attempting content extraction:

```typescript
function parseAnthropicResponse(rawBody: string) {
  let parsed: AnthropicMessage & { type?: string; error?: { type?: string; message?: string } };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(`anthropic.ts: failed to parse Anthropic response body as JSON (length=${rawBody.length})`);
  }
  // Handle error-type responses (HTTP 200 with type:'error')
  if ((parsed as Record<string, unknown>)['type'] === 'error') {
    const errType = (parsed as Record<string, unknown>)['error'];
    const detail = typeof errType === 'object' && errType !== null
      ? JSON.stringify(errType)
      : String(errType);
    throw new Error(`anthropic.ts: Anthropic returned an API error response: ${detail}`);
  }
  // ... rest of existing parsing
}
```

---

### WR-02: T-11-07 header assertion uses OR — passes even if `x-api-key` is absent

**File:** `tests/llm-transport.test.ts:581–583`

**Issue:** The assertion for the Anthropic header shape is:

```typescript
assert.ok(
  headerStr.includes('x-api-key') || headerStr.includes('anthropic-version'),
  ...
);
```

This passes if either `x-api-key` OR `anthropic-version` is present. Because `anthropic-version` is a static, unconditional header set at `buildAnthropicRequest` (line 133 of `anthropic.ts`), it will always be present regardless of whether the API key was injected. The assertion would pass even if the key injection at line 347 (`headers = { ...req.headers, 'x-api-key': key }`) were removed. The test is supposed to validate that the security-critical `x-api-key` header is present and carries the configured key — but its OR condition makes it permanently green without testing that invariant.

**Fix:** Change OR to AND, and separately assert the key value matches the configured sentinel:

```typescript
assert.ok(
  headerStr.includes('x-api-key') && headerStr.includes('anthropic-version'),
  `T-11-07: Anthropic request headers must include BOTH x-api-key and anthropic-version; got ${JSON.stringify(capturedHeaders)}`,
);
// Also assert the key value itself:
assert.ok(
  JSON.stringify(capturedHeaders).includes('sk-ant-test-body-shape-key'),
  'T-11-07: x-api-key header must carry the configured API key value',
);
```

---

### WR-03: `complete()` documents message-list invariants but does not enforce them — crashes deep in the provider

**File:** `bin/lib/anthropic.ts:53–54`

**Issue:** The `CompleteOptions` JSDoc states: "Must be non-empty; the last turn must be 'user'." Neither invariant is enforced at the function boundary. An empty `messages: []` array passes the budget-gate call (`opts.messages.reduce(...)` on an empty array returns 0 — safe), reaches `buildAnthropicRequest`, and produces `messages: []` in the POST body. The Anthropic API will return HTTP 400 for an empty messages array. An OpenAI API call with the last message being `'assistant'` role will similarly fail with HTTP 400. The error surfaces as an opaque HTTP 400 error from the provider with no guidance to the caller.

The fix is cheap and transforms a cryptic HTTP 400 from the provider into a comprehensible programmer error thrown before any network call:

**Fix:**

```typescript
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  // Validate message list invariants before any other work.
  if (opts.messages.length === 0) {
    throw new Error('anthropic.ts: complete() requires at least one message');
  }
  const lastMsg = opts.messages[opts.messages.length - 1];
  if (lastMsg?.role !== 'user') {
    throw new Error(
      `anthropic.ts: the last message must have role 'user'; got '${lastMsg?.role}'`,
    );
  }
  // ... Step 1: offline short-circuit ...
```

---

### WR-04: `revise-swap.ts` calls `isNoLlmMode()` directly — duplicates a check that `complete()` already performs

**File:** `bin/lib/revise-swap.ts:58–69`

**Issue:** `proposeSwap` checks `isNoLlmMode()` itself and returns a deterministic JSON stub. It then falls through to call `complete()`, which also checks `isNoLlmMode()` first (step 1 of the ordering contract). This duplication is harmless functionally — the double check is idempotent — but it creates a maintenance hazard: if the offline-mode short-circuit logic in `complete()` evolves (e.g., checking a second env var `PENSMITH_CASSETTE_MODE`), `proposeSwap`'s local copy would diverge. The whole point of the GEN-01 chokepoint is that callers do not need to know about offline mode.

There is one behavioral difference: the local stub returns a more specific "deterministic mechanical removal" JSON with the flagged citekey embedded, whereas `complete()`'s offline mock returns `[PENSMITH_NO_LLM placeholder — ...]`. The runRevise caller must parse this with `ReviseSwapSchema.safeParse` either way — the local stub's richer shape passes schema validation while the generic mock does not. If the local stub is removed and `complete()` is relied upon, the offline path would produce an unparseable response that falls through to the mechanical-remove path. This means the local offline check is load-bearing for the offline parity test (D-06, D-24).

This is a design smell worth documenting as a warning but not fixing in this phase: the duality cannot be cleanly collapsed without either special-casing `proposeSwap` in `complete()` or accepting that the offline test gets a different (but equally valid) end state.

**Fix:** Add a comment to `revise-swap.ts` explicitly acknowledging that the local offline check is load-bearing (not redundant) and must stay synchronized with any evolution of `isNoLlmMode()`:

```typescript
// LOAD-BEARING: this offline short-circuit is NOT merely redundant with
// complete()'s own isNoLlmMode() check. complete() returns a generic
// placeholder string that ReviseSwapSchema.safeParse rejects; this local
// stub returns a schema-valid RemoveAction JSON that preserves parity with
// the old tier2ProposeSwap behavior (D-06, D-24). If isNoLlmMode()'s
// logic ever expands (new env vars, cassette mode), update this guard too.
if (isNoLlmMode()) {
```

---

### WR-05: OpenAI `choices[0].message.content` can be `null` (not `string`) — runtime TypeError

**File:** `bin/lib/anthropic.ts:226–230`

**Issue:** The OpenAI ChatCompletion type allows `choices[0].message.content` to be `null` (this occurs when `finish_reason` is `'tool_calls'` or `'function_call'`). The type definition from the `openai` package types `content` as `string | null`. The current guard:

```typescript
const content = choice?.message?.content;
if (typeof content !== 'string' || content.length === 0) {
```

correctly catches `null` (because `typeof null !== 'string'`), throwing the descriptive error. So the guard is actually correct against `null`. However the error message says "missing choices[0].message.content" which is misleading — the field is present but null. More importantly, if the OpenAI API ever returns a `content: ""` (empty string for finish_reason stop), the guard also throws, which could be a legitimate (if unusual) response.

A whitespace-only content (`content: "   "`) passes the `content.length === 0` check but is arguably equally unusable. This is a real edge case for models that generate whitespace-only responses under certain conditions.

**Fix:** Change the empty-content check to include whitespace-only:

```typescript
if (typeof content !== 'string' || content.trim().length === 0) {
  throw new Error(
    content === null
      ? `anthropic.ts: OpenAI response has null choices[0].message.content (finish_reason: ${JSON.stringify(choice?.finish_reason)})`
      : `anthropic.ts: OpenAI response missing choices[0].message.content — got: ${JSON.stringify(parsed.choices?.slice(0, 1))}`,
  );
}
```

---

## Info

### IN-01: T-11-03 no-leak test does not assert that request headers carry the key — only checks disk/stdout/stderr

**File:** `tests/llm-transport.test.ts:385–405`

**Issue:** The test instantiates `capturedRequestHeaders` and `capturedRequestBody` variables and then immediately `void`s them (lines 403–404) with a comment saying undici MockAgent doesn't expose an `.on()` handler. However, as confirmed by testing against undici v7, the `MockAgent.intercept().reply(fn)` callback receives the request headers and body as its argument. The test could capture the key value from the request headers and assert it is the sentinel, providing a positive assertion that the key was actually sent in the header — rather than only checking that it did not leak elsewhere. Without this positive assertion, T-11-03 would pass even if the transport made an unauthenticated POST (no `x-api-key` header).

**Fix:** Update the intercept reply to capture headers and add a positive assertion:

```typescript
pool
  .intercept({ path: '/v1/messages', method: 'POST' })
  .reply(200, (opts) => {
    const hdrs = (opts?.headers ?? {}) as Record<string, string>;
    capturedRequestHeaders = hdrs;
    return JSON.stringify({ /* mock response */ });
  }, { headers: { 'content-type': 'application/json' } });
// ... after complete() ...
// Positive assertion: key MUST appear in x-api-key header
assert.ok(
  JSON.stringify(capturedRequestHeaders).includes(KEY_SENTINEL),
  'T-11-03: KEY_SENTINEL must appear in the outbound x-api-key header',
);
```

---

### IN-02: `complete()` computes `cacheKey()` for every call including POST — wastes SHA-256 per LLM call

**File:** `bin/lib/http.ts:485`

**Issue:** `http.ts::fetch()` always computes the cache key at line 485 regardless of the HTTP method, even though the result is never used for POST calls (both the cache read at line 489 and cache write at line 567 are guarded by `method === 'GET'`). For LLM POSTs, this means a SHA-256 hash is computed over the full header set (including the auth header value in plaintext inside the hash input) on every LLM call. The hash output is safe (it cannot be reversed to recover the key) but the CPU work is wasted. This is an efficiency note, not a correctness issue.

**Note:** This is out of scope for v1 performance review but noted for completeness as it relates to the key-handling path.

---

### IN-03: `research.ts` loads both `topic-disambiguator` and `source-evaluator` prompts at verb startup, but `source-evaluator` is a Phase-12 runtime slug — eager load always passes since the file exists

**File:** `bin/cli/research.ts:78–83`

**Issue:** The comment says loading both slugs eagerly ensures "any on-disk hash drift surfaces at startup." This is correct behavior but the code comment claims it is "defense-in-depth" against the Phase-12 `source-evaluator` slug. Since the prompt files for both slugs already exist on disk (they are in the hash registry), the eager load always succeeds — if a future Phase-12 PR changes the prompt content without updating the hash, the hash mismatch throws exactly as intended. There is no bug here; this is an info-level observation that the "phase fence" comment could more clearly state that this load is a forward-compatibility guard rather than a current-phase requirement.

No code change needed; consider updating the comment to: "Load both Phase-11 ('topic-disambiguator') and Phase-12 ('source-evaluator') slugs to catch hash drift in either slug before any network call. source-evaluator is validated now so drift surfaces in this phase, not in Phase 12's first run."

---

## Fix Status (2026-06-22)

All findings except IN-02 and IN-03 were fixed in commit 403127e.

**Fixed:** CR-01, CR-02, WR-01, WR-02, WR-03, WR-05, IN-01
**Deferred (by design):** IN-02, IN-03 — not worth the churn; noted for awareness.
  - IN-02 (cache-key perf micro-opt): SHA-256 computed even for POST — efficiency only, not correctness.
  - IN-03 (research.ts comment clarity): comment update only, no behavioral impact.

`npm run check` result after fixes: **875 pass, 0 fail, 0 skip** (19 transport tests ran, none skipped).

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Fixed: 2026-06-22_
_Fixer: Claude (gsd-code-fixer)_
