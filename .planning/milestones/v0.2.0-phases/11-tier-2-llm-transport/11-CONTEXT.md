# Phase 11: Tier-2 LLM transport - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in PROJECT.md non-negotiables + the 2026-06-22 improvement review

<domain>
## Phase Boundary

Deliver a single Tier-2 LLM transport so the portable CLI can generate real artifacts. In scope: a `bin/lib/anthropic.ts` transport module (the sole call site for LLM completion), wiring it into the six generative verbs (intake, research, outline, plan, write, revise) so they produce real output when a key is configured, and a loud failure when no key is configured (GEN-01, GEN-02, GEN-06).

Out of scope (later phases): the live source-discovery orchestration inside `research` (GEN-03, Phase 12), intake STATE.json bootstrap (GEN-04, Phase 12), humanizer Task transport (GEN-05, Phase 12), citation-at-export (Phase 13). Phase 11 makes the *generation call path* real; downstream phases use it.
</domain>

<decisions>
## Implementation Decisions

### Transport surface & provider
- The transport is `bin/lib/anthropic.ts`, the single import chokepoint every generative verb calls. Despite the filename it is provider-aware: it dispatches on the runtime-config provider (`anthropic` | `openai`) so the PRD §1 "any OpenAI-compatible endpoint" promise for Tier 2 holds.
- Provider, model, and key are resolved through the EXISTING `bin/lib/runtime.ts` chokepoint (the SDK-provider config loader) — `defaultModel` overridable per call; `apiKeyEnv` resolves the key by env-var NAME. The resolved key VALUE is never logged and never written to disk (re-assert the T-01-07 no-leak property).
- Public surface: a small `complete({ system, messages, model?, maxTokens?, scopeCapUsd? })` returning the assistant text (+ usage), plus a thin convenience wrapper per artifact kind if the planner finds it reduces duplication. Keep handler-thin: orchestration logic stays in `bin/lib/*`, verbs stay shells.

### Network chokepoint (LOAD-BEARING — do not violate)
- **All LLM network I/O routes through `bin/lib/http.ts`.** The repo's ESLint chokepoint forbids `fetch`/`undici`/`http`/`https` imports anywhere except `http.ts`, so the transport MUST NOT pull in the Anthropic/OpenAI SDK's own networking. Implement the call as a REST POST to the provider's messages/chat endpoint via `http.ts` (or inject `http.ts`'s request fn as the SDK's `fetch`, if a vendor SDK is used purely for typing). The planner/researcher confirms whether `http.ts` supports SSE streaming.
- Streaming is preferred for long drafts but is at Claude's discretion: if `http.ts` does not already support SSE, ship a non-streaming POST first and defer streaming — do NOT add a second network path to get streaming. Per-source rate limiting + retry already live in `http.ts`; reuse them.

### Budget, determinism & safety
- `assertBudget` fires BEFORE every transport call (existing pre-call gate), costed via `pricing.ts` `estimateCost`; abort before billing on cap breach. The hard `cost_cap_usd` and `--max-parallel` semantics are respected.
- PII redaction stays a CALLER responsibility and runs before content reaches the transport (existing `pii.ts`, non-negotiable: redact before any LLM call). The transport itself adds no new PII surface.
- Offline/test determinism: the transport honors the existing `PENSMITH_NO_LLM` placeholder switch and `--dry-run` (cassette) so CI never makes a live call. Provide an injectable-transport / cassette seam (mirror `http-mock.ts`) so the six verbs are testable without a key. Tier-contract tests stay green under `PENSMITH_NO_LLM=1`.

### Verb wiring & fail-loud (GEN-06)
- Today the five+ generative verbs detect `!ANTHROPIC_API_KEY` and silently emit a `tier2-placeholder` artifact (`research.ts:33,89,96`, and siblings in intake/outline/plan/write/revise). Replace that path: when a key IS configured, call the transport and write the real artifact; when NO key is configured, fail loud — a clear banner naming the missing env var + an explicit non-success signal (non-zero exit in Tier 2 / structured error), never `ok:true` with an empty result.
- Tier split preserved: Tier 1 (plugin) continues to generate via Claude Code Task/subagents; the transport is Tier 2's generation backend. The 16-verb / 16-workflow-body bijection and the tier-contract gate must remain intact.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/runtime.ts` — SDK-provider config chokepoint (provider list, `defaultModel`, `getProviderApiKey` by env name, no-leak). The transport resolves everything through this.
- `bin/lib/http.ts` — the network chokepoint (undici, TokenBucket rate limiting, full-jitter retry, TTL cache). All LLM calls go through here.
- `bin/lib/budget.ts` + `bin/lib/pricing.ts` — `assertBudget` pre-call gate + `estimateCost` cost table.
- `bin/lib/http-mock.ts` / cassette loader + `PENSMITH_NO_LLM` — the determinism seam pattern to mirror for offline transport tests.
- `bin/lib/pii.ts` — redaction that must run before content reaches the transport.

### Established Patterns
- Single-call-site chokepoints enforced by ESLint AST rules + red-team fixtures (D-06 http, D-07 atomic-write/DOI). The transport is a new chokepoint of the same shape.
- Verbs are thin shells in `bin/cli/*.ts`; logic lives in `bin/lib/*`.

### Integration Points
- Consumers: `bin/cli/{intake,research,outline,plan,write,revise}.ts` — each currently writes a `tier2-placeholder` artifact and must be re-pointed at the transport.
- `bin/lib/runtime.ts` (provider/key/model), `bin/lib/budget.ts` (pre-call gate).
</code_context>

<specifics>
## Specific Ideas

- GEN-01 success: every LLM call routes through `bin/lib/anthropic.ts`; no key value in session log or stdout; `assertBudget` precedes each call.
- GEN-02 success: running any of the six generative verbs in Tier 2 with a valid key produces a real artifact (no `tier2-placeholder`).
- GEN-06 success: with no key configured, each verb prints a clear error banner + non-zero exit, never a silent `ok:true` empty result.
</specifics>

<deferred>
## Deferred Ideas

- Live source-discovery orchestration inside `research` (GEN-03 → Phase 12).
- Intake STATE.json/paperId bootstrap (GEN-04 → Phase 12).
- Humanizer Task transport + real before/after score (GEN-05 → Phase 12).
- SSE streaming if `http.ts` lacks it today — revisit once the non-streaming path ships.
</deferred>
