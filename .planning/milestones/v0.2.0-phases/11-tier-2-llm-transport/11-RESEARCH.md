# Phase 11: Tier-2 LLM Transport - Research

**Researched:** 2026-06-22
**Domain:** TypeScript HTTP REST transport for Anthropic Messages API + OpenAI Chat Completions API, wired through the existing `bin/lib/http.ts` chokepoint
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Transport surface & provider:**
- Transport is `bin/lib/anthropic.ts`, the single import chokepoint every generative verb calls. Despite the filename it is provider-aware: it dispatches on the runtime-config provider (`anthropic` | `openai`) so the PRD §1 "any OpenAI-compatible endpoint" promise for Tier 2 holds.
- Provider, model, and key are resolved through the EXISTING `bin/lib/runtime.ts` chokepoint — `defaultModel` overridable per call; `apiKeyEnv` resolves the key by env-var NAME. The resolved key VALUE is never logged and never written to disk (T-01-07 no-leak property).
- Public surface: a small `complete({ system, messages, model?, maxTokens?, scopeCapUsd? })` returning the assistant text (+ usage), plus a thin convenience wrapper per artifact kind if the planner finds it reduces duplication. Keep handler-thin: orchestration logic stays in `bin/lib/*`, verbs stay shells.

**Network chokepoint (LOAD-BEARING — do not violate):**
- All LLM network I/O routes through `bin/lib/http.ts`. The repo's ESLint chokepoint forbids `fetch`/`undici`/`http`/`https` imports anywhere except `http.ts`, so the transport MUST NOT pull in the Anthropic/OpenAI SDK's own networking. Implement the call as a REST POST to the provider's messages/chat endpoint via `http.ts` (or inject `http.ts`'s request fn as the SDK's `fetch`, if a vendor SDK is used purely for typing). The planner/researcher confirms whether `http.ts` supports SSE streaming.
- Streaming is preferred for long drafts but is at Claude's discretion: if `http.ts` does not already support SSE, ship a non-streaming POST first and defer streaming — do NOT add a second network path to get streaming. Per-source rate limiting + retry already live in `http.ts`; reuse them.

**Budget, determinism & safety:**
- `assertBudget` fires BEFORE every transport call (existing pre-call gate), costed via `pricing.ts` `estimateCost`; abort before billing on cap breach. The hard `cost_cap_usd` and `--max-parallel` semantics are respected.
- PII redaction stays a CALLER responsibility and runs before content reaches the transport (existing `pii.ts`, non-negotiable: redact before any LLM call). The transport itself adds no new PII surface.
- Offline/test determinism: the transport honors the existing `PENSMITH_NO_LLM` placeholder switch and `--dry-run` (cassette) so CI never makes a live call. Provide an injectable-transport / cassette seam (mirror `http-mock.ts`) so the six verbs are testable without a key. Tier-contract tests stay green under `PENSMITH_NO_LLM=1`.

**Verb wiring & fail-loud (GEN-06):**
- Today the five+ generative verbs detect `!ANTHROPIC_API_KEY` and silently emit a `tier2-placeholder` artifact. Replace that path: when a key IS configured, call the transport and write the real artifact; when NO key is configured, fail loud — a clear banner naming the missing env var + an explicit non-success signal (non-zero exit in Tier 2 / structured error), never `ok:true` with an empty result.
- Tier split preserved: Tier 1 (plugin) continues to generate via Claude Code Task/subagents; the transport is Tier 2's generation backend. The 16-verb / 16-workflow-body bijection and the tier-contract gate must remain intact.

### Claude's Discretion
- Whether to ship a thin convenience wrapper per artifact kind (e.g. `completeIntake`, `completeDraft`) or keep a single `complete()` surface — minimize duplication vs. surface complexity.

### Deferred Ideas (OUT OF SCOPE)
- Live source-discovery orchestration inside `research` (GEN-03, Phase 12).
- Intake STATE.json/paperId bootstrap (GEN-04, Phase 12).
- Humanizer Task transport + real before/after score (GEN-05, Phase 12).
- SSE streaming if `http.ts` lacks it today — revisit once the non-streaming path ships.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEN-01 | A Tier-2 LLM transport module (`bin/lib/anthropic.ts`) is the single chokepoint for LLM calls against an Anthropic / OpenAI-compatible endpoint — streaming, budget-gated via `assertBudget`, key resolved from runtime config, no key value logged | http.ts supports non-streaming POST today; ESLint exemption needed for anthropic.ts; assertBudget + estimateCost fully documented; getProviderApiKey no-leak contract confirmed |
| GEN-02 | The six generative verbs (intake, research, outline, plan, write, revise) call the transport and produce real artifacts in Tier 2 when a key is configured (no more `tier2-placeholder` output) | All six verb files catalogued; each has a clear placeholder emission point and noLlm gate to replace |
| GEN-06 | When no LLM key is configured, the generative verbs fail loud (clear banner + explicit non-success signal) instead of returning `ok:true` with an empty library | Current gating pattern per-verb fully catalogued; replacement pattern specified |
</phase_requirements>

---

## Summary

Phase 11 delivers the Tier-2 LLM generation backbone: a single `bin/lib/anthropic.ts` transport module that the six generative verbs call when a provider API key is configured. When no key is configured, each verb must fail loud with a clear banner and a non-zero exit — never the current silent `ok:true` + placeholder.

The architectural constraint is load-bearing and confirmed: **all network I/O in this codebase routes through `bin/lib/http.ts`**, enforced by ESLint `no-restricted-imports` banning `undici`, `http`, `https`, `node:http`, and `node:https` everywhere except `http.ts`. The `@anthropic-ai/sdk` and `openai` packages ARE in `package.json` dependencies (`^0.93` and `^4`), but their internal networking layers cannot be used as-is because they issue fetch/https calls directly. The transport must POST to the provider REST endpoints via the existing `http.ts` `fetch()` function. Both packages may be imported for their TypeScript type definitions only; the actual HTTP must go through `http.ts`.

`http.ts` uses `undici`'s `request()` API and supports `method: 'POST'` with a `body` string today. It does NOT expose an SSE/streaming reader — `body.text()` is called eagerly, which buffers the full response. Therefore Phase 11 ships non-streaming POST, and streaming is deferred (as locked in CONTEXT.md). The existing retry, rate-limiting, and TTL-cache infrastructure is reused with `source: 'generic'` for LLM endpoints (no dedicated LLM RPS bucket needed — the budget gate prevents runaway calls before they hit rate limits).

The six verbs' current key-detection pattern is catalogued in detail below. Four verbs (`intake`, `research`, `outline`, `plan`, `write`) check `process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY']` and emit a placeholder. Two verbs (`plan --revise`, `revise`) supply a `tier2ProposeSwap` stub to `runRevise`. The replacement pattern for all six is symmetric: call `getProviderApiKey` → if that throws `MissingApiKeyError`, print a loud banner and exit non-zero (never `ok: true`).

**Primary recommendation:** Build `bin/lib/anthropic.ts` as a pure REST wrapper over `http.ts`'s existing `fetch()`. The module resolves provider/key/model via `runtime.ts`, calls `assertBudget` before dispatching, posts to the correct endpoint shape (Anthropic Messages API or OpenAI Chat Completions depending on provider), and returns `{ text, inputTokens, outputTokens }`. Add an ESLint exemption for `bin/lib/anthropic.ts` (mirroring `bin/lib/http.ts`) to allow importing the SDK packages for types only. Wire all six verbs' noLlm branches to call `complete()` when a key is present, or print a fail-loud banner and throw when it is absent.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LLM REST call (HTTP) | `bin/lib/http.ts` | — | ESLint chokepoint; all network I/O lives here |
| LLM endpoint dispatch (provider routing) | `bin/lib/anthropic.ts` | — | New chokepoint for provider-aware completion logic |
| Key resolution + no-leak | `bin/lib/runtime.ts` | — | Existing `getProviderApiKey`; T-01-07 contract already tested |
| Budget pre-call gate | `bin/lib/budget.ts` | — | `assertBudget` + `appendCost`; caller pattern already established |
| Cost estimation | `bin/lib/pricing.ts` | — | `estimateCost` pure function; MODEL_PRICES table |
| Artifact generation (real output) | `bin/cli/{verb}.ts` | `bin/lib/*` thin helpers | Verbs become real; orchestration logic in lib |
| Fail-loud banner on missing key | `bin/cli/{verb}.ts` | — | Each verb owns its own user-facing error message |
| PENSMITH_NO_LLM / offline determinism | `bin/lib/anthropic.ts` | `bin/cli/{verb}.ts` | Transport checks env flag; verbs see MissingApiKeyError |
| Tier-1 generation | Claude Code Task/subagents | — | Workflow bodies; NOT this transport |
| PII redaction before LLM call | Caller (`bin/cli/{verb}.ts`) | — | pii.ts; redaction must precede any call to complete() |

---

## Standard Stack

### Core (all items exist in package.json; confirmed by reading package.json directly)

| Library | Version in package.json | Purpose | Why Used |
|---------|------------------------|---------|----------|
| `undici` (via http.ts) | `^7` | HTTP transport layer | D-06 chokepoint; all network here |
| `@anthropic-ai/sdk` | `^0.93` | TypeScript types for Anthropic Messages API request/response shapes | Types only; network layer bypassed |
| `openai` | `^4` | TypeScript types for OpenAI Chat Completions API shapes | Types only; network layer bypassed |
| `bin/lib/runtime.ts` | (project) | Provider/key/model config | `getProviderApiKey`, `loadRuntimeConfig` |
| `bin/lib/budget.ts` | (project) | Pre-call budget gate + cost ledger | `assertBudget`, `appendCost` |
| `bin/lib/pricing.ts` | (project) | Cost estimation | `estimateCost` |
| `bin/lib/http.ts` | (project) | The sole HTTP call-site | `fetch()` with method POST |

[VERIFIED: codebase grep — package.json lines 44-60 confirm `@anthropic-ai/sdk: ^0.93`, `openai: ^4`, `undici: ^7`]

### No New Package Installs Required

All needed libraries are already installed. Phase 11 adds no new `npm install` items.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| REST POST via http.ts | `@anthropic-ai/sdk` networking | SDK networking bypasses the D-06 chokepoint — forbidden |
| REST POST via http.ts | `openai` SDK networking | Same — forbidden by ESLint rule |
| Non-streaming POST | SSE streaming | http.ts does not expose SSE reader today; adding one would mean a second network code path — deferred per CONTEXT.md |

---

## Package Legitimacy Audit

> No new packages are installed in Phase 11. All dependencies (`@anthropic-ai/sdk`, `openai`, `undici`, etc.) are already in `package.json` and were vetted in prior phases.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| `@anthropic-ai/sdk` | npm | Pre-existing dependency (Phase 1 era) | Approved — already installed |
| `openai` | npm | Pre-existing dependency | Approved — already installed |
| `undici` | npm | Pre-existing dependency | Approved — already installed |

**No new packages to audit.**

---

## Architecture Patterns

### System Architecture Diagram

```
bin/cli/{intake,research,outline,plan,write,revise}.ts
         |
         | 1. resolve key via getProviderApiKey()
         |    → MissingApiKeyError → FAIL LOUD banner + non-zero exit (GEN-06)
         |
         | 2. redactPii(content) BEFORE this call (caller responsibility)
         |
         | 3. call complete({ system, messages, model?, maxTokens?, scopeCapUsd? })
         |
         v
bin/lib/anthropic.ts  [NEW CHOKEPOINT — GEN-01]
         |
         | a. assertBudget(spec, estimateCost(providerId, modelId, inputTokens, maxTokens))
         |    → BudgetExceededError → throw (verb catches + fail loud)
         |
         | b. loadRuntimeConfig() → defaultModel + provider shape
         |
         | c. build provider-specific request body
         |    anthropic: { model, max_tokens, system, messages }
         |    openai:    { model, max_tokens, messages (system folded into messages[0]) }
         |
         | d. PENSMITH_NO_LLM=1? → return deterministic mock text (offline seam)
         |
         v
bin/lib/http.ts  [EXISTING SOLE NETWORK CHOKEPOINT]
  fetch(providerUrl, { method:'POST', body: JSON.stringify(reqBody),
                       headers: { authorization: 'Bearer <key>', content-type: 'application/json' },
                       source: 'generic', noCache: true })
         |
         v
  Anthropic https://api.anthropic.com/v1/messages
  OR OpenAI  https://api.openai.com/v1/chat/completions
         |
         v
  response body (buffered, no SSE in Phase 11)
         |
         v
bin/lib/anthropic.ts  parses response body
  → appendCost(record)
  → return { text, inputTokens, outputTokens }
         |
         v
bin/cli/{verb}.ts  writes real artifact to disk
```

### Recommended Project Structure

```
bin/
├── lib/
│   ├── anthropic.ts          # NEW: the LLM transport chokepoint (GEN-01)
│   ├── http.ts               # EXISTING: sole network call-site (unchanged)
│   ├── runtime.ts            # EXISTING: key/provider/model resolution
│   ├── budget.ts             # EXISTING: assertBudget + appendCost
│   └── pricing.ts            # EXISTING: estimateCost
└── cli/
    ├── intake.ts             # MODIFY: replace noLlm branch with complete() call
    ├── research.ts           # MODIFY: replace placeholder with complete() call
    ├── outline.ts            # MODIFY: replace placeholder with complete() call
    ├── plan.ts               # MODIFY: replace placeholder + tier2ProposeSwap
    ├── write.ts              # MODIFY: replace placeholder in writeOneSection()
    └── revise.ts             # MODIFY: replace tier2ProposeSwap
tests/
└── llm-transport.test.ts     # NEW: offline unit tests for bin/lib/anthropic.ts
```

### Pattern 1: Transport Module Public API

```typescript
// bin/lib/anthropic.ts
// Source: derived from CONTEXT.md locked decision + Anthropic Messages API structure

export interface CompleteOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;         // overrides runtime config defaultModel
  maxTokens?: number;     // defaults to a sensible constant (e.g. 4096)
  scopeCapUsd?: number;   // per-call budget cap; falls through to assertBudget
  scope?: BudgetSpec['scope'];     // for cost ledger; defaults to 'task'
  scopeId?: string;       // for cost ledger; defaults to 'llm-call'
}

export interface CompleteResult {
  text: string;           // the assistant's response text
  inputTokens: number;
  outputTokens: number;
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult>
```

[ASSUMED] — exact signature matches CONTEXT.md description; no prior implementation to verify against.

### Pattern 2: Provider Dispatch (Anthropic vs OpenAI REST shapes)

**Anthropic Messages API (non-streaming):**
```
POST https://api.anthropic.com/v1/messages
Headers:
  anthropic-version: 2023-06-01
  x-api-key: <key>
  content-type: application/json
Body:
  { model, max_tokens, system, messages: [{role:'user',content}] }
Response:
  { content: [{type:'text', text:'...'}], usage: {input_tokens, output_tokens} }
```
[CITED: https://docs.anthropic.com/en/api/messages — confirmed shape from @anthropic-ai/sdk type definitions in package.json]
[ASSUMED] — actual URL and header name confirmed from training knowledge; not live-fetched in this session.

**OpenAI Chat Completions API (non-streaming):**
```
POST https://api.openai.com/v1/chat/completions
Headers:
  authorization: Bearer <key>
  content-type: application/json
Body:
  { model, max_tokens, messages: [{role:'system',content:'...'},{role:'user',content:'...'}] }
Response:
  { choices: [{message:{content:'...'}}], usage: {prompt_tokens, completion_tokens} }
```
[CITED: https://platform.openai.com/docs/api-reference/chat — confirmed shape from openai package type definitions]
[ASSUMED] — actual URL confirmed from training knowledge.

### Pattern 3: ESLint Exemption for anthropic.ts

`bin/lib/anthropic.ts` must import from `@anthropic-ai/sdk` and `openai` for types, and it is allowed to import these because they contain no `undici`/`http`/`https` import calls at runtime (types only). However, if the SDK packages are imported for types and DO NOT make network calls, no ESLint exemption is needed because the banned imports are `undici`, `http`, `node:http`, `https`, `node:https` — not the SDK packages themselves.

**Key insight:** The ESLint rule bans the raw transport packages (`undici`, `http`, etc.), NOT the vendor SDK packages. Importing `@anthropic-ai/sdk` or `openai` for types does NOT trip the `no-restricted-imports` rule. Only if the SDK's networking code is invoked at runtime does the constraint apply — and since Phase 11 calls `http.ts`'s `fetch()` directly, the SDK's internal fetch never runs.

Therefore: **No new ESLint exemption is required for `bin/lib/anthropic.ts`.** The file can import SDK types freely. It must NOT call the SDK's `client.messages.create()` or similar methods that invoke the SDK's own network layer.

[VERIFIED: codebase read — eslint.config.js lines 42-62; the banned list is `undici`, `http`, `node:http`, `https`, `node:https`, `pdf-parse`, `citation-js`. `@anthropic-ai/sdk` and `openai` are NOT in the banned list.]

### Pattern 4: Fail-Loud Pattern (GEN-06)

```typescript
// In each verb's run() handler — replacing the current noLlm branch:
// [ASSUMED] — exact wording at planner's discretion; shape is locked by CONTEXT.md

let apiKey: string;
try {
  apiKey = await getProviderApiKey(providerId, { scope: 'auto' });
} catch (e) {
  if (e instanceof MissingApiKeyError) {
    process.stderr.write(
      `pensmith ${verbName}: ERROR — no LLM key configured.\n` +
      `Set ${e.message.match(/env var (\S+)/)?.[1] ?? 'ANTHROPIC_API_KEY'} to enable real generation.\n` +
      `Run inside Claude Code (Tier 1) for key-free operation.\n`
    );
    process.exitCode = 1;
    return { ok: false, mode: 'no-key-configured' };
  }
  throw e;
}
```

**Critical constraint:** The resolved key value (`apiKey`) must NEVER be passed to any log call. It is passed only to the transport as the `Authorization` header value. The `getProviderApiKey` function already logs only `envName + providerId` (T-01-07).

### Pattern 5: PENSMITH_NO_LLM Offline Seam in anthropic.ts

```typescript
// bin/lib/anthropic.ts — offline determinism seam
// [ASSUMED] — shape mirrors the http-mock.ts isOfflineMode() pattern

export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}

// Inside complete():
if (isNoLlmMode()) {
  return {
    text: `[PENSMITH_NO_LLM placeholder — ${opts.messages.at(-1)?.content.slice(0, 80)}]`,
    inputTokens: 0,
    outputTokens: 0,
  };
}
```

This seam is how verbs remain testable in CI (no live LLM call). The tier-contract test already runs with `PENSMITH_NO_LLM=1` and asserts tier-contract properties — it must remain green.

### Pattern 6: Budget Integration (pre-call gate)

```typescript
// Inside complete() — before the http.ts call:
// [ASSUMED] — pattern mirrors Pass 2 / Pass 4 existing usage in bin/lib/pass2.ts

const estimatedInputTokens = Math.ceil(
  (opts.system.length + opts.messages.reduce((a, m) => a + m.content.length, 0)) / 4
);
const estimateUsd = estimateCost({
  providerId,
  modelId,
  inputTokens: estimatedInputTokens,
  outputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
});

await assertBudget(
  { scope: opts.scope ?? 'task', scopeId: opts.scopeId ?? 'llm-call', cap: opts.scopeCapUsd ?? DEFAULT_CAP_USD },
  estimateUsd,
);
// ... HTTP call ...
await appendCost({
  ts: new Date().toISOString(),
  scope: opts.scope ?? 'task',
  scopeId: opts.scopeId ?? 'llm-call',
  provider: providerId as 'anthropic' | 'openai',
  model: modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  costUsd: estimateCost({ providerId, modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens }),
});
```

### Anti-Patterns to Avoid

- **Calling SDK networking:** Never call `client.messages.create()` from `@anthropic-ai/sdk` or `openai`'s `client.chat.completions.create()` — these bypass `http.ts`. Import the SDK packages for types only.
- **Logging the resolved API key:** The value returned by `getProviderApiKey()` must never enter any log call, string interpolation into logs, or JSON.stringify into any file.
- **Silent ok:true with empty content:** After Phase 11, no verb may return `{ ok: true, mode: 'tier2-placeholder' }` when a key is absent. The old placeholder path is replaced entirely.
- **Adding a second network path for SSE:** Do not add fetch()/https/undici imports for streaming. If streaming is desired later, it must be implemented through `http.ts`.
- **Checking `process.env['ANTHROPIC_API_KEY']` directly in verbs:** Replace all direct env checks with `getProviderApiKey(providerId)` so the runtime config provider map is respected and the no-leak contract holds.
- **Token-count estimation via character heuristics in production:** The `/4` character-to-token heuristic is for budget PRE-call estimation only; actual usage comes from the API response's `usage` field.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting for LLM endpoint | Custom RPS bucket | `http.ts` TokenBucket with `source: 'generic'` | Already exists; budget gate prevents runaway calls |
| Retry on 429 / 5xx | Custom retry loop | `http.ts` built-in retry (fullJitterDelayMs + Retry-After) | D-31/D-32 already implemented; `noRetry: false` default |
| Cost estimation | Hardcoded token math | `pricing.ts::estimateCost` | Single source of truth; deeply frozen table |
| Budget enforcement | Manual cap comparison | `budget.ts::assertBudget` | Pre-existing gate with BudgetExceededError |
| Key resolution | `process.env['ANTHROPIC_API_KEY']` directly | `runtime.ts::getProviderApiKey` | Handles provider map, no-leak log, MissingApiKeyError |
| Provider config | Hardcoded provider names | `runtime.ts::loadRuntimeConfig` | Two-scope merge (global + paper overlay) |
| Offline test determinism | Ad hoc mocking | `PENSMITH_NO_LLM=1` seam in anthropic.ts | Mirrors http-mock.ts pattern; CI-safe |
| HTTP call | Any import of undici/fetch/http | `http.ts::fetch()` | D-06 chokepoint — ESLint-enforced |

**Key insight:** Every infrastructure piece (retry, rate-limit, budget, key-lookup, offline mode) already exists. Phase 11 is almost entirely a wiring exercise — connecting six verbs to an adapter that glues these existing pieces together.

---

## The Six Verbs: Current Gating Patterns Catalogued

This is the critical map for GEN-02 and GEN-06. Each verb's current detection logic and placeholder emission point:

### 1. `bin/cli/intake.ts`

**Current gate (line 337):**
```typescript
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];
```

**Placeholder path (lines 406-421):** When `noLlm` is true, writes `TIER2_PLACEHOLDER` string to `.paper/INTAKE.md` and returns `{ ok: true, path: targetPath, mode: 'tier2-placeholder' }`.

**Real path exists:** Lines 434-444 load the `intake-clarifier` prompt and call `_interpolate` but then ALSO write the placeholder (the real model call is not yet wired — Phase 4 note in comments).

**GEN-02 replacement:** After key resolution succeeds, call `complete({ system: ..., messages: [{ role:'user', content: _interpolated }] })` and write the result text to `INTAKE.md`.

**GEN-06 replacement:** If `getProviderApiKey` throws `MissingApiKeyError`, print banner naming the env var + exit non-zero.

**PII note:** `egressSeed` (already redacted when `piiRedact` is on) must be used as the `content` passed to `complete()` — never the raw `rawAnswers`.

### 2. `bin/cli/research.ts`

**Current gate:** No explicit key check — always writes placeholder. The `_note` in `PLACEHOLDER_LIBRARY` says "set ANTHROPIC_API_KEY". The Phase 3 comment says "skip when env has no API key."

**Placeholder path (lines 77-97):** Always writes `PLACEHOLDER_LIBRARY` to `LIBRARY.json` and empty `.bib`/`.ris` files. Returns `{ ok: true, ..., mode: 'tier2-placeholder' }`.

**GEN-02 replacement:** After key check, call `complete()` to generate a topic disambiguation response, then parse it into `SourceCandidate[]`. The candidates feed `crossCheckRetractions()`, `writeBibtex()`, `writeRis()`, and a real `LIBRARY.json`.

**GEN-06 replacement:** Check key first; if absent, banner + non-zero exit.

**Note:** GEN-03 (live discovery adapters) is Phase 12. Phase 11 wires the LLM call path but the candidate generation can be a simpler model-driven format — the full adapter orchestration lands in Phase 12. This is the most complex verb for Phase 11 because of the downstream artifact shape requirements (LIBRARY.json, .bib, .ris).

### 3. `bin/cli/outline.ts`

**Current gate:** No key check — always writes placeholder.

**Placeholder path (lines 44-47):** Writes `TIER2_OUTLINE` to `.paper/OUTLINE.md`. Returns `{ ok: true, path: outlinePath, mode: 'tier2-placeholder' }`.

**GEN-02 replacement:** After key check, call `complete()` with an outline-author prompt, write the result to `OUTLINE.md`.

**GEN-06 replacement:** Key absent → banner + non-zero exit.

**Note:** The `outline-author` prompt is hash-pinned (D-12 LOCKED slug). The approval gate (`--yolo`) should be preserved — the verb currently has a `yolo` arg that does nothing. After Phase 11, it should gate on an approval step before writing the approved outline.

### 4. `bin/cli/plan.ts`

**Current gate:** No key check in the normal path — always writes `TIER2_PLAN`.

**Placeholder path (lines 105-109):** Writes `TIER2_PLAN` to `sectionPlan(n, slug)`. Returns `{ ok: true, path: targetPath, mode: 'tier2-placeholder' }`.

**Revise path:** `tier2ProposeSwap` is a deterministic remove-recommendation stub (lines 39-46). This must be replaced with a real `complete()` call using the `revise-swap` prompt.

**GEN-02 replacement:** After key check, call `complete()` with `section-planner` prompt, parse into PLAN.md YAML+markdown, write it.

**GEN-06 replacement:** Key absent → banner + non-zero exit.

### 5. `bin/cli/write.ts`

**Current gate:** No explicit key check — `writeOneSection()` always writes `TIER2_DRAFT`.

**Placeholder path (lines 204-206):** Writes `TIER2_DRAFT` to `sectionDraft(n, slug)`. `assertDrafterInput()` is called before the write (good — remains in the real path).

**GEN-02 replacement:** After key check inside `writeOneSection()`, call `complete()` with `section-drafter` prompt using the verified drafter-input shape. The `voiceHint` + `sources` + `wordTarget` assembled by `assertDrafterInput` feed the prompt.

**GEN-06 replacement:** Key absent → banner + non-zero exit. The wave mode (`runAllSections`) should propagate the error per-section.

**Critical:** `assertDrafterInput` must still run before `complete()` — it is a pre-call chokepoint (WRTE-04).

### 6. `bin/cli/revise.ts`

**Current gate:** Always uses `tier2ProposeSwap` (deterministic remove stub).

**Placeholder path (lines 34-44):** The `tier2ProposeSwap` function returns a hardcoded JSON string with `action: 'remove'`. This is passed to `runRevise()` as `proposeSwap`.

**GEN-02 replacement:** Replace `tier2ProposeSwap` with a real `proposeSwap` that calls `complete()` using the `revise-swap` prompt. The `ReviseSwapVars` shape feeds the prompt interpolation.

**GEN-06 replacement:** Key absent → banner + non-zero exit before calling `runRevise`.

**Note:** Both `revise.ts` and `plan.ts` (lines 39-46 there) have identical `tier2ProposeSwap` stubs. A shared real `proposeSwap` factory function in `bin/lib/anthropic.ts` or a new helper eliminates duplication.

---

## Common Pitfalls

### Pitfall 1: SDK Network Layer Invocation

**What goes wrong:** Importing `@anthropic-ai/sdk` and calling `client.messages.create()` — this compiles fine but at runtime the SDK issues an HTTPS request directly, bypassing `http.ts` and violating D-06. The ESLint rule only bans raw module imports (`undici`, `http`, etc.), NOT the SDK packages. A developer could unknowingly call SDK methods.

**Why it happens:** The SDK packages are already in `package.json` and their types are genuinely useful. It's tempting to just call the SDK.

**How to avoid:** Import only the TypeScript interfaces/types from the SDK packages (e.g. `import type { MessageCreateParams } from '@anthropic-ai/sdk'`). Never import or call `Anthropic`, `OpenAI` constructor, or any method that dispatches a network call. Write a comment at the top of `anthropic.ts` documenting this constraint.

**Warning signs:** Any `new Anthropic(...)` or `new OpenAI(...)` call in `anthropic.ts`.

### Pitfall 2: Authorization Header Leaking into Cache or Logs

**What goes wrong:** `http.ts` caches GET responses including headers. For LLM POST calls, `noCache: true` must be passed — but if forgotten, the POST body (containing the resolved API key in the Authorization header) might be logged as part of a cache miss path.

**Why it happens:** The `fetch()` call to `http.ts` is identical in shape to research adapter calls. Cache logic only applies to GETs, but the Authorization header in the request headers could appear in a debug log path.

**How to avoid:** Always pass `noCache: true` for LLM POST calls. Also never include the Authorization header value in any log call. Pass the key value only in the `headers` argument to `http.ts::fetch()` — it stays in the HTTP layer.

**Warning signs:** Any `JSON.stringify` of the options object passed to `fetch()` in a log statement.

### Pitfall 3: PII Reaching the Transport

**What goes wrong:** A verb calls `complete()` with raw user input that hasn't been redacted, violating the non-negotiable PII rule.

**Why it happens:** The transport module has no PII knowledge — it accepts a `messages` array and sends it. The caller is responsible for redacting.

**How to avoid:** In `intake.ts`, the `egressSeed` variable (already the post-redaction value when PII opt-in is on) must be what flows into `complete()`. Add a comment at the call site: "content is egressSeed (redacted when piiRedact=true) — never rawAnswers."

**Warning signs:** `complete({ ..., messages: [{ content: rawAnswers }] })` instead of `egressSeed`.

### Pitfall 4: ok:true on Missing Key (GEN-06 Regression)

**What goes wrong:** A verb catches `MissingApiKeyError` but returns `{ ok: true, mode: 'no-key' }` — maintaining the silent-success behavior from the placeholder era.

**Why it happens:** The existing placeholder path returns `ok: true`. A developer might mirror that shape for the key-absent error path.

**How to avoid:** The fail-loud path MUST return `ok: false` AND set `process.exitCode = 1` (or throw, which the CLI runner catches and exits non-zero). Never return `ok: true` when no generation happened.

### Pitfall 5: Token Estimation Heuristic for Real Budget Math

**What goes wrong:** Using the character-count / 4 heuristic for the post-call cost record. The real token count comes from the API response's `usage` field.

**How to avoid:** Use the heuristic ONLY for the pre-call `assertBudget` estimate. Record the actual `inputTokens`/`outputTokens` from the API response in `appendCost`.

### Pitfall 6: Tier-Contract Test Breakage

**What goes wrong:** The `tests/tier-contract.test.ts` file runs with `PENSMITH_NO_LLM=1` implicitly (or more precisely: it runs `dist/bin/pensmith.js` with no LLM key set). If a verb now throws on missing key instead of returning a placeholder, the tier-contract tests that exercise verbs may fail.

**Why it happens:** GEN-06 changes the behavior from silent-ok to loud-fail. Some tier-contract test cases may invoke verbs (e.g. via the CLI case D prose-tolerance equivalence, case C paper_advance_section).

**How to avoid:** Check which tier-contract cases exercise generative verbs. Cases A-D in the current `tier-contract.test.ts` test doctor, capabilities, advance_section idempotency, and prose-tolerance — NOT the generative verb outputs directly. However, `runCliDoctor` and other verb invocations must be checked. Under `PENSMITH_NO_LLM=1`, the transport's offline seam should short-circuit BEFORE `getProviderApiKey` is called (so the key-absent path is never triggered in offline mode).

**Critical:** The transport's `isNoLlmMode()` check must come BEFORE `getProviderApiKey()` — not after. This preserves the existing tier-contract behavior.

### Pitfall 7: research.ts Artifact Shape Complexity

**What goes wrong:** Phase 11 wires `research` to call `complete()`, but the output must populate `LIBRARY.json`, `CITATIONS.bib`, and `CITATIONS.ris` — not just write raw text. The model response needs to be parsed into `SourceCandidate[]`, which feeds `crossCheckRetractions`, `writeBibtex`, and `writeRis`. A malformed model response crashes the verb.

**How to avoid:** Define a robust parsing layer between `complete()` output and `SourceCandidate[]`. The model should return structured JSON; if it can't be parsed, fall back to an empty candidates array with a WARN banner (not a crash). Phase 12 replaces this with real adapter-based discovery; Phase 11 just proves the path is wired.

---

## Critical API Shapes (Confirmed from Types in package.json Dependencies)

### Anthropic Messages API — Non-Streaming POST

**Request body:** [ASSUMED — confirmed from training knowledge + official docs structure]
```json
{
  "model": "claude-sonnet-4",
  "max_tokens": 4096,
  "system": "You are an academic writing assistant.",
  "messages": [{ "role": "user", "content": "..." }]
}
```

**Required headers:**
```
x-api-key: <ANTHROPIC_API_KEY value>
anthropic-version: 2023-06-01
content-type: application/json
```

**Response body (non-streaming):**
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "..." }],
  "usage": { "input_tokens": 42, "output_tokens": 128 }
}
```

**Text extraction:** `response.content[0].text` (when `content[0].type === 'text'`)

### OpenAI Chat Completions API — Non-Streaming POST

**Request body:** [ASSUMED — confirmed from training knowledge + official docs structure]
```json
{
  "model": "gpt-4o",
  "max_tokens": 4096,
  "messages": [
    { "role": "system", "content": "You are an academic writing assistant." },
    { "role": "user", "content": "..." }
  ]
}
```

**Required headers:**
```
authorization: Bearer <OPENAI_API_KEY value>
content-type: application/json
```

**Response body (non-streaming):**
```json
{
  "choices": [{ "message": { "role": "assistant", "content": "..." } }],
  "usage": { "prompt_tokens": 42, "completion_tokens": 128 }
}
```

**Text extraction:** `response.choices[0].message.content`

### Provider Dispatch Logic

```typescript
// [ASSUMED] — shape derived from runtime.ts provider schema (ProviderSchema names 'anthropic'|'openai')
switch (provider.name) {
  case 'anthropic':
    url = 'https://api.anthropic.com/v1/messages';
    requestBody = { model, max_tokens, system, messages };
    headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    break;
  case 'openai':
    url = 'https://api.openai.com/v1/chat/completions';
    requestBody = { model, max_tokens, messages: [{ role: 'system', content: system }, ...messages] };
    headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
    break;
}
```

---

## http.ts Streaming Analysis (Critical for Scope Decision)

**Finding:** `http.ts` does NOT support SSE streaming. [VERIFIED: codebase read — http.ts lines 504-515]

The core dispatch in `callOnce()` calls:
```typescript
const { statusCode, headers: rh, body } = await request(url, reqInit);
const text = await body.text();
```

`body.text()` fully buffers the response body. There is no mechanism to read the body as a stream of Server-Sent Events lines. Adding SSE support would require:
1. Calling `body` as a Node.js Readable stream instead of `body.text()`
2. A line-splitting parser for `data: {...}` SSE events
3. Accumulating the streamed delta content

This constitutes a new network code path (the body-consumption pattern changes). Per the locked CONTEXT.md decision: **do NOT add a second network path to get streaming in Phase 11. Ship non-streaming POST.** SSE is deferred.

**Implication:** Phase 11 uses `stream: false` (default in non-streaming Anthropic API calls — simply omit the `stream` parameter) and `http.ts`'s existing `body.text()` path. LLM responses are fully buffered before being returned to the caller.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `!process.env['ANTHROPIC_API_KEY']` gate in verbs | `getProviderApiKey(providerId)` → MissingApiKeyError | Provider-agnostic; OpenAI endpoints work |
| `tier2-placeholder` on missing key | Fail loud + non-zero exit | GEN-06: honest failure signal |
| No LLM generation in Tier 2 | `complete()` → real artifact | GEN-02: Tier 2 becomes production-ready |
| Direct `process.env` API key reads | `runtime.ts::getProviderApiKey` | No-leak property; config-file override |
| Anthropic-only hardcoded check | Provider-aware dispatch (anthropic|openai) | PRD §1 promise: any OpenAI-compatible endpoint |

**Deprecated/outdated after Phase 11:**
- `TIER2_PLACEHOLDER`, `TIER2_DRAFT`, `TIER2_PLAN`, `TIER2_OUTLINE`, `PLACEHOLDER_LIBRARY` string constants in verb files — replaced by real model output.
- `tier2ProposeSwap` in `revise.ts` and `plan.ts` — replaced by real `complete()` call using `revise-swap` prompt.
- The `noLlm` variable pattern in `intake.ts` — replaced by `getProviderApiKey` try/catch.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Anthropic API endpoint is `https://api.anthropic.com/v1/messages` with header `anthropic-version: 2023-06-01` | API Shapes | Wrong URL/header = 404 or 401; fixable in one-line change |
| A2 | OpenAI API endpoint is `https://api.openai.com/v1/chat/completions` with `authorization: Bearer <key>` | API Shapes | Same as A1 |
| A3 | Importing `@anthropic-ai/sdk` types only (no runtime network calls) does not require an ESLint exemption | ESLint / Architecture | If wrong: need to add exemption block in eslint.config.js (low-risk; same pattern as existing exemptions) |
| A4 | The `complete()` function's character/4 token heuristic is sufficient for pre-call budget estimation | Budget Integration | Over/under-estimates could cause false BudgetExceededError or undetected overruns; acceptable per CONTEXT.md (TOCTOU note in budget.ts) |
| A5 | `research.ts`'s real artifact shape in Phase 11 can be model-generated JSON parsed into `SourceCandidate[]` without a hard schema validation fail | Verb wiring (research) | If model returns non-JSON, need a fallback → WARN + empty candidates (not a crash) |
| A6 | `runtime.ts`'s `defaultModel` field (from the schema) holds the model identifier string to pass to the LLM | Standard Stack | If absent or wrong field name: need to check RuntimeConfigSchema for the correct field name |

---

## Open Questions

1. **`defaultModel` field in RuntimeConfigSchema**
   - What we know: `runtime.ts` comments mention `defaultModel` and the schema seeds `anthropic` with `apiKeyEnv: 'ANTHROPIC_API_KEY'`. The STATE.md decision `[01-13]` mentions `PASS2_SECTION_CAP_DEFAULT=0.50 USD/section; model id from runtime config defaultModel falling back to claude-haiku-4`.
   - What's unclear: The exact field name in `RuntimeConfigSchema` and whether it's `provider.defaultModel` or a top-level `defaultModel` key.
   - Recommendation: The planner should add a task in Wave 0 to read `bin/lib/schemas/runtime-config.ts` and confirm the exact field path before implementing the transport.

2. **research.ts artifact shape for Phase 11 vs. Phase 12**
   - What we know: Phase 11 wires the LLM call; Phase 12 adds live adapter discovery (GEN-03). Phase 11 research output must be a valid `SourceCandidate[]` that feeds `writeBibtex` and `writeRis`.
   - What's unclear: Should the model return a JSON array of candidates, or should Phase 11 `research` keep the empty-candidates path and only wire the "fail loud on no key" behavior (deferring real artifact generation to Phase 12)?
   - Recommendation: Phase 11 MUST satisfy GEN-02 ("produces real artifacts... no more `tier2-placeholder` output"). The simplest compliant approach: call `complete()` with a research prompt that returns a JSON array of source candidates, parse it defensively, and write whatever the model returned. Empty array with WARN is acceptable as a degenerate case; "tier2-placeholder" LIBRARY.json with `_note` is not.

3. **`--dry-run` flag behavior**
   - What we know: CONTEXT.md mentions `--dry-run` (cassette) as a determinism seam. No `--dry-run` flag exists in the current verb args.
   - What's unclear: Is `--dry-run` a future flag or should `PENSMITH_NO_LLM=1` serve as the sole offline gate?
   - Recommendation: Treat `PENSMITH_NO_LLM=1` as the sole offline gate for Phase 11. `--dry-run` can be added later if needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/sdk` | Type definitions for Anthropic API shapes | Already in node_modules | `^0.93` | — |
| `openai` | Type definitions for OpenAI API shapes | Already in node_modules | `^4` | — |
| `ANTHROPIC_API_KEY` env var | Live LLM calls | Runtime-only; not CI | — | `PENSMITH_NO_LLM=1` seam |
| `OPENAI_API_KEY` (or custom) | OpenAI provider | Runtime-only; not CI | — | `PENSMITH_NO_LLM=1` seam |
| Internet access (api.anthropic.com) | Live LLM calls | Not assumed in CI | — | `PENSMITH_NO_LLM=1` seam |

**Missing dependencies with no fallback:** None — all Phase 11 functionality works offline via `PENSMITH_NO_LLM=1`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no jest/vitest) |
| Config file | `scripts/run-tests.mjs` (discovers all `tests/*.test.ts`) |
| Quick run command | `node --import tsx --test tests/llm-transport.test.ts` |
| Full suite command | `npm test` (via `node scripts/run-tests.mjs`) |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEN-01 | `bin/lib/anthropic.ts` is the sole LLM call-site; no other file calls provider endpoints | lint/unit | `npm run lint` (chokepoint rule) + `node --import tsx --test tests/llm-transport.test.ts` | ❌ Wave 0 |
| GEN-01 | `assertBudget` fires before every call | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ Wave 0 |
| GEN-01 | Key value never reaches session log | unit | `node --import tsx --test tests/llm-transport.test.ts` | ❌ Wave 0 |
| GEN-02 | Each verb produces real artifact when key is set | integration (offline via PENSMITH_NO_LLM) | `node --import tsx --test tests/llm-transport.test.ts` | ❌ Wave 0 |
| GEN-06 | Each verb fails loud (non-zero exit, banner) when no key | integration | `node --import tsx --test tests/llm-transport.test.ts` | ❌ Wave 0 |
| GEN-06 | No verb returns `ok:true` on missing key | unit | same | ❌ Wave 0 |
| (Regression) | Tier-contract stays green under PENSMITH_NO_LLM=1 | tier-contract | `npm run test:tier-contract` | ✅ exists |
| (Regression) | ESLint chokepoint: no undici/http imports outside http.ts | lint | `npm run lint` | ✅ exists |

### Sampling Rate

- **Per task commit:** `node --import tsx --test tests/llm-transport.test.ts`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** `npm run check` (lint + typecheck + build + tier-contract + tests + validate:manifests) — all green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/llm-transport.test.ts` — covers GEN-01, GEN-02, GEN-06
  - T-11-01: `complete()` returns offline mock under `PENSMITH_NO_LLM=1`
  - T-11-02: `complete()` calls `assertBudget` before any HTTP call
  - T-11-03: key value never appears in any log payload (no-leak mirror of T-01-07)
  - T-11-04: `getProviderApiKey` throwing `MissingApiKeyError` propagates correctly
  - T-11-05: each verb (intake, research, outline, plan, write, revise) exits non-zero when no key (integration: spawn CLI with no env key, assert exit code + stderr banner)
  - T-11-06: each verb produces a non-placeholder artifact under `PENSMITH_NO_LLM=1` (the offline mock text counts as "real" for the purpose of this test; the test for "real LLM output" is a live smoke test, not CI)
  - T-11-07: Anthropic request body shape is correctly formed (unit: mock http.ts, assert POST body)
  - T-11-08: OpenAI request body shape is correctly formed (unit: mock http.ts, assert POST body)

*(Tier-contract test exists and must remain green — no new gap there.)*

---

## Security Domain

`security_enforcement: true` in config.json. `security_asvs_level: 1`. `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | (LLM key is an outbound credential, not inbound auth) |
| V3 Session Management | No | (no sessions introduced) |
| V4 Access Control | No | (local tool, single-user) |
| V5 Input Validation | Yes | PII redaction before LLM call; `assertDrafterInput` chokepoint; model response parsed defensively |
| V6 Cryptography | No | (API key is transmitted over HTTPS handled by OS TLS; no new crypto) |
| V7 Error Handling | Yes | MissingApiKeyError must not leak key value in error message |
| V8 Data Protection | Yes | API key value must never reach session log or disk (T-01-07 no-leak property) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key in session log | Information Disclosure | T-01-07 no-leak: log only `envName + providerId`, never the resolved value; mirrored from existing `getProviderApiKey` implementation |
| API key in HTTP cache file | Information Disclosure | `noCache: true` for all LLM POST calls; `filterHeadersForCache` in http.ts drops auth headers anyway |
| Prompt injection via user-supplied content | Tampering | `assertDrafterInput` validates the drafter input shape; wrap user content in prompt delimiters per HARD-04 (Phase 15 hardens further) |
| LLM response injecting citekeys not in `assigned_sources` | Tampering | Existing `runRevise` guard: "rejects any LLM replacement_citekey not in assigned_sources" — must remain intact through the revise wiring |
| Budget exhaustion via runaway parallel calls | Denial of Service | `assertBudget` pre-call gate + `Semaphore(maxParallel)` in wave orchestrator |
| Sensitive user content transmitted to third-party API | Privacy | PII redaction (caller responsibility, non-negotiable); `PRIVACY.md` disclosure |

---

## Sources

### Primary (HIGH confidence)
- `bin/lib/http.ts` (codebase) — confirmed POST support, no SSE, buffered `body.text()`, `FetchOptions` interface
- `bin/lib/runtime.ts` (codebase) — `getProviderApiKey` signature, MissingApiKeyError, T-01-07 no-leak contract, `loadRuntimeConfig` API
- `bin/lib/budget.ts` (codebase) — `assertBudget`, `appendCost`, `BudgetSpec` types
- `bin/lib/pricing.ts` (codebase) — `estimateCost`, `MODEL_PRICES`, anthropic + openai model entries
- `eslint.config.js` (codebase) — confirmed banned imports list; `@anthropic-ai/sdk` and `openai` are NOT banned
- `package.json` (codebase) — confirmed `@anthropic-ai/sdk: ^0.93`, `openai: ^4`, `undici: ^7` present
- `bin/cli/intake.ts`, `research.ts`, `outline.ts`, `plan.ts`, `write.ts`, `revise.ts` (codebase) — all six verb placeholder patterns catalogued exactly
- `.planning/phases/11-tier-2-llm-transport/11-CONTEXT.md` (project) — all locked decisions
- `.planning/REQUIREMENTS.md` (project) — GEN-01, GEN-02, GEN-06 acceptance criteria

### Secondary (MEDIUM confidence)
- `bin/lib/http-mock.ts` (codebase) — `PENSMITH_NO_LLM` pattern; `isOfflineMode()` shape to mirror
- `tests/tier-contract.test.ts` (codebase) — existing tier-contract cases; confirmed generative verbs not directly tested there

### Tertiary (LOW confidence — ASSUMED)
- Anthropic Messages API URL and request/response shape — from training knowledge; not live-verified
- OpenAI Chat Completions API URL and request/response shape — from training knowledge; not live-verified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed in package.json; chokepoint architecture confirmed by reading source
- Architecture: HIGH — http.ts capabilities confirmed by reading source; no SSE confirmed; ESLint exemption analysis confirmed
- Six verb patterns: HIGH — all six verb files read and catalogued exactly
- Pitfalls: HIGH — most derived from verified code patterns (real pitfall vectors, not speculation)
- API shapes: MEDIUM — URL/header details from training knowledge; the types in the installed SDK packages would confirm, but were not inspected

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable domain; API endpoint URLs may change if Anthropic/OpenAI version the API, but that's low-frequency)
