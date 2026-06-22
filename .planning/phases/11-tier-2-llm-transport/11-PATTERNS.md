# Phase 11: Tier-2 LLM Transport - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/anthropic.ts` | service/chokepoint | request-response | `bin/lib/http.ts` | role-match (chokepoint shape) |
| `tests/llm-transport.test.ts` | test | request-response | `tests/http-cache-no-header-leak.test.ts` + `tests/runtime.test.ts` | role-match |
| `bin/cli/intake.ts` | controller | request-response | `bin/cli/research.ts` (current placeholder pattern) | exact |
| `bin/cli/research.ts` | controller | request-response | `bin/cli/research.ts` (self — replace placeholder) | exact |
| `bin/cli/outline.ts` | controller | request-response | `bin/cli/outline.ts` (self — replace placeholder) | exact |
| `bin/cli/plan.ts` | controller | request-response | `bin/cli/plan.ts` (self — replace `tier2ProposeSwap`) | exact |
| `bin/cli/write.ts` | controller | request-response | `bin/cli/write.ts` (self — replace TIER2_DRAFT in `writeOneSection`) | exact |
| `bin/cli/revise.ts` | controller | request-response | `bin/cli/revise.ts` (self — replace `tier2ProposeSwap`) | exact |

---

## Pattern Assignments

### `bin/lib/anthropic.ts` (service/chokepoint, request-response)

**Primary analog:** `bin/lib/http.ts`
**Secondary analogs:** `bin/lib/runtime.ts` (key resolution pattern), `bin/lib/budget.ts` (pre-call gate pattern)

This is a new chokepoint in the same architectural shape as `http.ts` — a single-import boundary for a specific I/O kind. The file header comment style, the exported public types, and the "sole call site" contract all mirror `http.ts`.

**File header comment pattern** (`bin/lib/http.ts` lines 1–11):
```typescript
// bin/lib/http.ts — HTTP client chokepoint per ARCH-12 / ARCH-13.
//
// SOLE call site for undici / node:http / node:https in the repo (D-06).
// The eslint chokepoint at eslint.config.js bans `import 'undici'` everywhere
// EXCEPT this file (per-file `no-restricted-imports: 'off'` exemption).
```
Copy the header shape for `anthropic.ts`:
```typescript
// bin/lib/anthropic.ts — LLM completion chokepoint (GEN-01).
//
// SOLE call site for LLM REST completions in the repo. All LLM network I/O
// routes through bin/lib/http.ts (D-06 chokepoint) — this module MUST NOT
// import undici, http, node:http, https, or any vendor SDK networking layer.
// Import @anthropic-ai/sdk and openai for TypeScript TYPES ONLY (never call
// new Anthropic(...) or new OpenAI(...) — those bypass the D-06 chokepoint).
//
// Critical no-leak property (T-01-07): the resolved API key VALUE is never
// logged, never written to disk, never interpolated into any log call.
// Passed only as the Authorization/x-api-key header VALUE to http.ts::fetch().
```

**Public types pattern** — derive from `bin/lib/http.ts` lines 174–207 (`HttpResponse`, `FetchOptions`):
```typescript
// bin/lib/http.ts lines 184-207
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  cached: boolean;
  cachedAt?: string;
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | Buffer;
  source?: HttpSource;
  noCache?: boolean;
  noRetry?: boolean;
  // ...
}
```
For `anthropic.ts`, the analogous public interface pair is:
```typescript
export interface CompleteOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;       // overrides runtime config defaultModel
  maxTokens?: number;   // defaults to DEFAULT_MAX_TOKENS
  scopeCapUsd?: number; // per-call cap; falls through to assertBudget
  scope?: BudgetSpec['scope'];  // defaults to 'task'
  scopeId?: string;     // defaults to 'llm-call'
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
```

**Imports pattern** — from `bin/lib/http.ts` lines 51–59 (the imports of lib chokepoints):
```typescript
// bin/lib/http.ts lines 51-59
import { request, getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pensmithHttpCacheDir } from './paths.js';
import { atomicWriteFile } from './atomic-write.js';
import { retry, parseRetryAfter } from './retry.js';
```
For `anthropic.ts`, the import block imports peers not network primitives:
```typescript
import type { Message } from '@anthropic-ai/sdk';        // types only — no network
import type { ChatCompletion } from 'openai/resources';   // types only — no network
import { fetch } from './http.js';
import { loadRuntimeConfig, getProviderApiKey, MissingApiKeyError } from './runtime.js';
import { assertBudget, appendCost, type BudgetSpec } from './budget.js';
import { estimateCost } from './pricing.js';
```

**Offline-mode predicate pattern** — from `bin/lib/http-mock.ts` lines 134–141:
```typescript
// bin/lib/http-mock.ts lines 134-141
/**
 * Offline mode is the DEFAULT (PR-time CI never sets PENSMITH_NETWORK_TESTS).
 * The weekly cron-refresh job sets PENSMITH_NETWORK_TESTS=1 to opt into
 * live HTTP and re-record cassettes.
 */
export function isOfflineMode(): boolean {
  return process.env['PENSMITH_NETWORK_TESTS'] !== '1';
}
```
Copy this shape for `anthropic.ts`'s offline seam:
```typescript
export function isNoLlmMode(): boolean {
  return process.env['PENSMITH_NO_LLM'] === '1';
}
```

**Pre-call gate (assertBudget) pattern** — from `bin/lib/budget.ts` lines 113–132:
```typescript
// bin/lib/budget.ts lines 113-132
/**
 * Pre-call budget gate (D-44). MUST be called BEFORE any paid API request.
 *
 *   await assertBudget({scope, scopeId, cap}, estimateUsd);
 *   const result = await llm.call(...);
 *   await appendCost({...result.usage, scope, scopeId});
 */
export async function assertBudget(spec: BudgetSpec, estimateUsd: number): Promise<void> {
  const spent = await totalCost({ scope: spec.scope, scopeId: spec.scopeId });
  if (spent + estimateUsd > spec.cap) {
    throw new BudgetExceededError(spec, spent, estimateUsd);
  }
}
```
The `complete()` function in `anthropic.ts` MUST follow the same caller pattern verbatim:
```typescript
// Inside complete():
await assertBudget(budgetSpec, estimateUsd);   // BEFORE any http.ts call
const response = await fetch(url, httpOpts);   // the LLM POST
await appendCost(costRecord);                  // AFTER, using ACTUAL usage tokens
```

**Key resolution no-leak pattern** — from `bin/lib/runtime.ts` lines 385–411:
```typescript
// bin/lib/runtime.ts lines 385-411
export async function getProviderApiKey(
  providerId: string,
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string> {
  const cfg = await loadRuntimeConfig(opts);
  const provider = cfg.providers?.[providerId];
  if (!provider) {
    throw new MissingApiKeyError(`no provider config for "${providerId}"`);
  }
  const envName = provider.apiKeyEnv;
  const value = process.env[envName];
  if (!value || value.length === 0) {
    throw new MissingApiKeyError(
      `env var ${envName} is not set (required for provider "${providerId}")`,
    );
  }
  // NEVER log the value — only the env-var name + providerId. T-01-07.
  log().event({ event: 'runtime.apiKey', providerId, envName });
  return value;
}
```
In `anthropic.ts`, the resolved key value goes ONLY to the HTTP headers object, never to any log call. No `JSON.stringify` of objects containing the key.

**Provider dispatch pattern** — from `bin/lib/runtime.ts` lines 172–179 (provider defaults) and pricing.ts lines 59–73 (provider table structure):
```typescript
// bin/lib/runtime.ts lines 172-179
function defaults(): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    $schemaVersion: CURRENT_RUNTIME_CONFIG_VERSION,
    providers: {
      anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    },
  });
}
```
The `provider.name` field (`'anthropic' | 'openai'`) drives a switch in `complete()`:
```typescript
switch (provider.name) {
  case 'anthropic':
    // x-api-key header, anthropic-version header, messages body shape
    break;
  case 'openai':
    // authorization: Bearer header, system folded into messages[0]
    break;
}
```

**HTTP POST call pattern** — from `bin/lib/http.ts` lines 476–575 (`fetch` public export). The key arguments for LLM POST calls:
```typescript
// bin/lib/http.ts lines 476-515 (fetch signature + callOnce)
export async function fetch(url: string, opts: FetchOptions = {}): Promise<HttpResponse>
// ...
// Inside callOnce:
const reqInit: Parameters<typeof request>[1] = {
  method,
  headers,
  headersTimeout: timeoutMs,
  bodyTimeout: timeoutMs,
};
if (opts.body !== undefined) {
  reqInit.body = opts.body;
}
const { statusCode, headers: rh, body } = await request(url, reqInit);
const text = await body.text();  // fully buffered — no SSE in Phase 11
```
For LLM calls in `anthropic.ts`, always pass `noCache: true` and `method: 'POST'`:
```typescript
const httpResponse = await fetch(url, {
  method: 'POST',
  headers,          // Authorization/x-api-key header with key value
  body: JSON.stringify(requestBody),
  source: 'generic',
  noCache: true,    // CRITICAL: prevents Authorization header from reaching cache
  noRetry: false,   // use http.ts's built-in retry for 429/5xx
});
```

---

### `tests/llm-transport.test.ts` (test, request-response)

**Primary analog:** `tests/http-cache-no-header-leak.test.ts`
**Secondary analog:** `tests/runtime.test.ts`, `tests/budget.test.ts`

**Test framework + import pattern** — from `tests/http-cache-no-header-leak.test.ts` lines 14–28:
```typescript
// tests/http-cache-no-header-leak.test.ts lines 14-28
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';
import { fetch, _resetWarnedForTest, _resetBucketsForTest } from '../bin/lib/http.js';
import { pensmithHttpCacheDir } from '../bin/lib/paths.js';
```
For `llm-transport.test.ts`:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { complete, isNoLlmMode } from '../bin/lib/anthropic.js';
```

**Fresh-state isolation helper pattern** — from `tests/http-cache-no-header-leak.test.ts` lines 35–62:
```typescript
// tests/http-cache-no-header-leak.test.ts lines 35-62
async function withFreshState<T>(fn: () => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-cache-leak-'));
  const savedLad = process.env.LOCALAPPDATA;
  const savedXdg = process.env.XDG_DATA_HOME;
  const savedHome = process.env.HOME;
  const savedEmail = process.env.PENSMITH_CONTACT_EMAIL;
  const savedDispatcher: Dispatcher = getGlobalDispatcher();
  process.env.LOCALAPPDATA = tmpRoot;
  process.env.XDG_DATA_HOME = tmpRoot;
  process.env.HOME = tmpRoot;
  process.env.PENSMITH_CONTACT_EMAIL = 'test@example.org';
  // ...
  try {
    return await fn();
  } finally {
    // restore all env vars + dispatcher
    setGlobalDispatcher(savedDispatcher);
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
```
For `llm-transport.test.ts`, the helper must also save/restore `PENSMITH_NO_LLM`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and install/teardown the `MockAgent` (which mocks `http.ts`'s `request()` call to the provider endpoint). Also set up `LOCALAPPDATA`/`XDG_DATA_HOME`/`HOME` so `budget.ts` + `runtime.ts` resolve into the tmpdir.

**Dynamic import for module-singleton reset** — from `tests/runtime.test.ts` lines 52–64:
```typescript
// tests/runtime.test.ts lines 52-64
test('loadRuntimeConfig with no file returns schema defaults...', async () => {
  mkPaperRoot();
  const { loadRuntimeConfig } = await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  // ...
});
```
Tests for `anthropic.ts` that need isolated module state should use `await import('../bin/lib/anthropic.js')` inside each test function after resetting env vars.

**Budget test isolation with chdir** — from `tests/budget.test.ts` lines 31–45:
```typescript
// tests/budget.test.ts lines 31-45
async function withProjectRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-budget-'));
  const orig = process.cwd();
  try {
    process.chdir(root);
    await fsp.mkdir(path.join(root, '.paper'), { recursive: true });
    await fn(root);
  } finally {
    process.chdir(orig);
    await fsp.rm(root, { recursive: true, force: true });
  }
}
```
Tests that invoke `assertBudget`/`appendCost` via the transport need `process.chdir` to a tmpdir with a pre-created `.paper/` directory (budget writes to `.paper/COSTS.jsonl`).

**No-leak sentinel test pattern** — from `tests/http-cache-no-header-leak.test.ts` lines 87–146 and `tests/runtime.test.ts` (T-01-07 test):
```typescript
// tests/http-cache-no-header-leak.test.ts lines 87-146
test('CR-03 / FLAG-06: Set-Cookie / Authorization / x-amz-* never reach the cache file', async () => {
  await withFreshState(async () => {
    const url = 'https://api.crossref.org/works/10.1038/header-leak-test';
    const agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    // ... intercept + assert sentinel absent from disk files
  });
});
```
For T-11-03 (no-leak test), the pattern is: set `ANTHROPIC_API_KEY` to a sentinel string, invoke `complete()` (in no-LLM offline mode or with mocked http.ts that records what was passed to it), then assert the sentinel value never appears in any log file, stdout capture, or `.paper/COSTS.jsonl` line.

**MockAgent HTTP intercept pattern** — from `tests/http.test.ts` lines 54–80:
```typescript
// tests/http.test.ts lines 54-80
function loadCassette(name: string): Cassette {
  const file = path.resolve(process.cwd(), 'tests', 'fixtures', 'http-cassettes', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Cassette;
}

function applyCassette(cassette: Cassette): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const u = new URL(cassette.request.url);
  const pool = agent.get(u.origin);
  for (const r of cassette.responses) {
    pool
      .intercept({ path: u.pathname + u.search, method: cassette.request.method })
      .reply(r.status, r.body, { headers: r.headers });
  }
  return agent;
}
```
For T-11-07/T-11-08 (request body shape tests), install a `MockAgent` that intercepts `https://api.anthropic.com` or `https://api.openai.com`, captures the request body, and asserts the correct JSON shape was sent. The mock must be torn down in `finally` via `agent.close()`.

---

### `bin/cli/intake.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/intake.ts` lines 333–440 (self — the existing noLlm gating block)

**Current gating pattern to REPLACE** (lines 337 and 406–421):
```typescript
// bin/cli/intake.ts line 337
const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];

// bin/cli/intake.ts lines 406-421
if (noLlm) {
  let body = egressSeed
    ? `${TIER2_PLACEHOLDER}\n## Seed (from --from ${args.from})\n\n${egressSeed}\n`
    : TIER2_PLACEHOLDER;
  // ...
  await atomicWriteFile(targetPath, body);
  process.stdout.write(`pensmith new: wrote Tier-2 placeholder to ${targetPath}\n`);
  await runSideEffects();
  return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
}
```

**Replacement pattern (GEN-06 fail-loud + GEN-02 real call):**
```typescript
// Replace the noLlm block with getProviderApiKey + complete():
let apiKey: string;
try {
  apiKey = await getProviderApiKey('anthropic');   // or from loadRuntimeConfig
} catch (e) {
  if (e instanceof MissingApiKeyError) {
    process.stderr.write(
      `pensmith new: ERROR — no LLM key configured.\n` +
      `Set ANTHROPIC_API_KEY (or configure a provider) to enable real generation.\n` +
      `Run inside Claude Code (Tier 1) for key-free operation.\n`,
    );
    process.exitCode = 1;
    return { ok: false, mode: 'no-key-configured' };
  }
  throw e;
}
// PII note (CRITICAL): pass egressSeed (already redacted when piiRedact=true),
// never rawAnswers. Comment MUST document this at the call site.
const result = await complete({
  system: '...intake-clarifier system prompt...',
  messages: [{ role: 'user', content: egressSeed }],   // egressSeed = REDACTED text
  scope: 'task',
  scopeId: 'intake',
});
await atomicWriteFile(targetPath, result.text);
```

**PENSMITH_NO_LLM check ordering (CRITICAL — Pitfall 6):** The transport's `isNoLlmMode()` check fires INSIDE `complete()` BEFORE `getProviderApiKey` is called. This means verbs do NOT need to check `PENSMITH_NO_LLM` themselves — calling `complete()` is sufficient for offline test safety.

---

### `bin/cli/research.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/research.ts` (self — lines 27–99 — the full placeholder run() block)

**Current placeholder pattern to REPLACE** (lines 74–98):
```typescript
// bin/cli/research.ts lines 74-98
const candidates: SourceCandidate[] = [];
await crossCheckRetractions(candidates);
await atomicWriteFile(libraryPath, PLACEHOLDER_LIBRARY);
await writeBibtex(candidates, bibPath);
await writeRis(candidates, risPath);
process.stdout.write(
  `pensmith research: wrote Tier-2 placeholder library...`
);
return { ok: true, library: libraryPath, bib: bibPath, ris: risPath, mode: 'tier2-placeholder' };
```

**Replacement pattern:** Add key check first (same fail-loud block as intake above), then call `complete()` with the `topic-disambiguator` prompt to generate candidate JSON, parse it defensively into `SourceCandidate[]`, then feed that array through `crossCheckRetractions` → `writeBibtex` → `writeRis`. The PLACEHOLDER_LIBRARY constant is deprecated — replace with a real LIBRARY.json built from the model response. Defensive parse: wrap JSON.parse in try/catch; on failure emit WARN + fall back to `candidates = []` (not a crash, not a placeholder with `_note`).

---

### `bin/cli/outline.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/outline.ts` (self — the full 51-line file)

**Current placeholder pattern to REPLACE** (lines 43–48):
```typescript
// bin/cli/outline.ts lines 43-48
async run() {
  const outlinePath = path.join(paperDir(), 'OUTLINE.md');
  await atomicWriteFile(outlinePath, TIER2_OUTLINE);
  process.stdout.write(`pensmith outline: wrote Tier-2 placeholder to ${outlinePath}\n`);
  return { ok: true, path: outlinePath, mode: 'tier2-placeholder' };
}
```

**Replacement pattern:** Same fail-loud → `complete()` → write pattern. Call `complete()` with `outline-author` prompt (D-12 LOCKED slug). The `yolo` arg must gate on an approval step (per CONTEXT.md note): when `!args.yolo`, prompt for confirmation before calling `atomicWriteFile`. TIER2_OUTLINE constant is deprecated.

---

### `bin/cli/plan.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/plan.ts` (self — lines 39–113)

**Current placeholder patterns to REPLACE:**
1. `tier2ProposeSwap` function (lines 39–47): deterministic remove stub
2. Plain PLAN.md write (lines 105–109):
```typescript
// bin/cli/plan.ts lines 105-109
const targetPath = sectionPlan(n, slug);
await atomicWriteFile(targetPath, TIER2_PLAN);
process.stdout.write(`pensmith plan: wrote Tier-2 placeholder PLAN.md to ${targetPath}\n`);
return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
```

**Replacement pattern for `tier2ProposeSwap`:**
```typescript
// Replace the stub with a real proposeSwap that calls complete():
async function proposeSwap(vars: ReviseSwapVars): Promise<string> {
  const prompt = loadPrompt('revise-swap');
  const interpolated = interpolate(prompt, vars as unknown as Record<string, string>);
  const result = await complete({
    system: '...revise-swap system prompt...',
    messages: [{ role: 'user', content: interpolated }],
    scope: 'task',
    scopeId: `revise-${vars.flagged_citekey}`,
  });
  return result.text;
}
```
Note: both `plan.ts` and `revise.ts` share the identical `tier2ProposeSwap` stub — the real replacement should be a SHARED factory in `bin/lib/anthropic.ts` or a new `bin/lib/revise-swap.ts` helper to avoid duplication.

---

### `bin/cli/write.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/write.ts` (self — lines 160–207, `writeOneSection` function)

**Current placeholder in `writeOneSection`** (lines 204–206):
```typescript
// bin/cli/write.ts lines 204-206
const targetPath = sectionDraft(n, slug);
await atomicWriteFile(targetPath, TIER2_DRAFT);
return targetPath;
```

**Critical constraint:** `assertDrafterInput` (lines 196–202) MUST remain before the `complete()` call — it is the WRTE-04 pre-call chokepoint:
```typescript
// bin/cli/write.ts lines 196-202
assertDrafterInput({
  planPath: `.paper/sections/${String(n).padStart(2, '0')}-${slug}/PLAN.md`,
  sources: [],
  wordTarget: 300,
  voiceHint,
  ...(styleProfilePath ? { styleProfilePath } : {}),
});
// Phase 11: complete() call goes HERE (after assertDrafterInput, before atomicWriteFile)
```
The wave mode (`runAllSections`) propagates per-section errors — `MissingApiKeyError` thrown from `writeOneSection` should surface per-section, consistent with the wave orchestrator's existing error-propagation contract.

---

### `bin/cli/revise.ts` (controller MODIFY, request-response)

**Analog:** `bin/cli/revise.ts` (self — lines 34–45 and 86–97)

**Current placeholder to REPLACE** (lines 34–45):
```typescript
// bin/cli/revise.ts lines 34-45
function tier2ProposeSwap(vars: ReviseSwapVars): Promise<string> {
  return Promise.resolve(JSON.stringify({
    action: 'remove',
    flagged_citekey: vars.flagged_citekey,
    replacement_citekey: null,
    rationale: 'Tier-2 placeholder: no model transport wired; recommending mechanical removal of the flagged citation.',
    patch: { before_excerpt: `[@${vars.flagged_citekey}]`, after_excerpt: '' },
  }));
}
```

**Replacement pattern:** Same as `plan.ts` — replace `tier2ProposeSwap` with a real `proposeSwap` factory that calls `complete()` with `revise-swap` prompt. The `runRevise` call at lines 86–97 passes `proposeSwap` as a parameter — the replacement must match the `(vars: ReviseSwapVars) => Promise<string>` signature exactly.

**Shared deduplication opportunity:** Both `revise.ts` and `plan.ts` contain identical `tier2ProposeSwap` stubs. The real implementation should live in ONE place (`bin/lib/anthropic.ts` or a dedicated `bin/lib/revise-swap.ts`), imported by both verbs, eliminating the duplication.

---

## Shared Patterns

### Fail-Loud on Missing Key (GEN-06)
**Source:** `bin/lib/runtime.ts` lines 385–411 (`getProviderApiKey` + `MissingApiKeyError`)
**Apply to:** All six verb files

```typescript
// bin/lib/runtime.ts lines 99-105
export class MissingApiKeyError extends Error {
  code = 'MISSING_API_KEY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}
```

Pattern for each verb's `run()` handler — the try/catch block:
```typescript
// Shape locked by CONTEXT.md §Verb wiring & fail-loud
let apiKey: string;
try {
  apiKey = await getProviderApiKey(providerId);
} catch (e) {
  if (e instanceof MissingApiKeyError) {
    process.stderr.write(
      `pensmith ${verbName}: ERROR — no LLM key configured.\n` +
      `Set <ENV_VAR_NAME> to enable real generation.\n` +
      `Run inside Claude Code (Tier 1) for key-free operation.\n`,
    );
    process.exitCode = 1;
    return { ok: false, mode: 'no-key-configured' };
  }
  throw e;
}
```

**CRITICAL:** Never return `{ ok: true }` when no generation happened. The `ok: false` + `process.exitCode = 1` is the non-negotiable GEN-06 contract. (Current placeholder returns `ok: true, mode: 'tier2-placeholder'` — that is the exact anti-pattern being replaced.)

**CRITICAL ordering (Pitfall 6):** `isNoLlmMode()` inside `complete()` fires BEFORE `getProviderApiKey`. When `PENSMITH_NO_LLM=1`, the transport short-circuits immediately and returns the offline mock text — `getProviderApiKey` is never called, so `MissingApiKeyError` is never thrown. The tier-contract test suite (which runs with no key configured) remains green because it implicitly exercises the offline seam, not the fail-loud path.

### No-Leak Property (T-01-07)
**Source:** `bin/lib/runtime.ts` lines 403–411 (logging envName only, never the value)
**Apply to:** `bin/lib/anthropic.ts` and all six verb files

```typescript
// bin/lib/runtime.ts lines 403-411
// NEVER log the value — only the env-var name + providerId. T-01-07.
log().event({
  event: 'runtime.apiKey',
  providerId,
  envName,
  // NO 'value' field — the resolved string is returned to the caller ONLY
});
return value;
```

In `anthropic.ts`, the resolved key must ONLY appear in the `headers` argument to `http.ts::fetch()`. It must never be:
- Interpolated into any string that reaches `console.log`, `process.stderr.write`, or a session-log event
- Included in any `JSON.stringify` call on an object that contains it
- Passed to `appendCost` or any budget record

The pre-computed `present: boolean` pattern from `runtime.ts::getOpenAlexApiKey` (lines 443–455) is the model for safe key-presence logging:
```typescript
// bin/lib/runtime.ts lines 443-455
const resolved = process.env[envName];
const present = !!(resolved && resolved.length > 0);
// NEVER log the resolved string — only the env-var name + presence boolean. T-01-07.
log().event({ event: 'runtime.openalex', envName, optional, present });
```

### Budget Pre-Call Gate
**Source:** `bin/lib/budget.ts` lines 113–148 (`assertBudget` + `appendCost`)
**Apply to:** `bin/lib/anthropic.ts` (inside `complete()`)

The canonical call pattern (from `budget.ts` lines 8–10 header comment):
```typescript
// bin/lib/budget.ts lines 8-10
await assertBudget({scope, scopeId, cap}, estimateUsd);
const result = await llm.call(...);
await appendCost({...result.usage, scope, scopeId});
```

Cost estimation uses `estimateCost` from `bin/lib/pricing.ts` lines 121–142:
```typescript
// bin/lib/pricing.ts lines 121-142
export function estimateCost(args: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  // formula: (inputTokens / 1e6) * inputPerMtok + (outputTokens / 1e6) * outputPerMtok
}
```
Pre-call: estimate input tokens via `Math.ceil(charCount / 4)` heuristic (for the budget gate only — this is acknowledged TOCTOU per CONTEXT.md). Post-call: use ACTUAL `inputTokens`/`outputTokens` from the API response's `usage` field in `appendCost`.

### HTTP Chokepoint Post Call
**Source:** `bin/lib/http.ts` lines 476–575 (`fetch` function)
**Apply to:** `bin/lib/anthropic.ts` (the HTTP call inside `complete()`)

The `FetchOptions` interface (lines 192–207) confirms `noCache`, `source`, `method`, `headers`, and `body` are valid options. For LLM POST calls:
- `method: 'POST'` — mandatory
- `noCache: true` — CRITICAL (prevents Authorization header from being cached)
- `source: 'generic'` — uses the generic 5 RPS bucket
- `body: JSON.stringify(requestBody)` — serialized request payload
- `headers` — contains the Authorization/x-api-key value (the ONLY place the key value lives at runtime)

The `FilterHeadersForCache` allowlist in `http.ts` (lines 408–425) already drops Authorization from cache files, but `noCache: true` provides defense-in-depth for POST calls regardless.

### AtomicWriteFile for Artifact Output
**Source:** All six verb files use `atomicWriteFile` from `bin/lib/atomic-write.ts`
**Apply to:** All six verb files (artifact write step after `complete()`)

```typescript
// Pattern from bin/cli/research.ts line 77
await atomicWriteFile(libraryPath, PLACEHOLDER_LIBRARY);
// After Phase 11:
await atomicWriteFile(libraryPath, realContent);  // real model output
```

### loadPrompt for Hash-Pinned Slugs (D-12)
**Source:** `bin/cli/research.ts` lines 59–61 (loadPrompt eager validation), `bin/cli/intake.ts` line 434 (`loadPrompt('intake-clarifier')`)
**Apply to:** All six verb files (each verb has a D-12 LOCKED prompt slug)

```typescript
// bin/cli/intake.ts line 434
const prompt = loadPrompt('intake-clarifier');
```
Each verb must call `loadPrompt` with its locked slug. The `prompt-loader.ts` module validates the hash at runtime (defense-in-depth). The resolved prompt template is then interpolated via `interpolate(prompt, vars)` before being passed to `complete()`.

---

## No Analog Found

No files fall into this category — all 8 files have close analogs in the existing codebase.

---

## Metadata

**Analog search scope:**
- `bin/lib/*.ts` — all lib chokepoints read
- `bin/cli/*.ts` — all six target verb files read (self-analogs for modification)
- `tests/*.test.ts` — representative test files for isolation patterns, mock patterns, no-leak assertions

**Files scanned:** 14 source files read in full (http.ts, http-mock.ts, runtime.ts, budget.ts, pricing.ts, research.ts, intake.ts, outline.ts, plan.ts, write.ts, revise.ts, http.test.ts, budget.test.ts, http-cache-no-header-leak.test.ts, runtime.test.ts)

**Pattern extraction date:** 2026-06-22

**Key invariants the planner must preserve:**
1. `isNoLlmMode()` check inside `complete()` fires BEFORE `getProviderApiKey` — offline tests stay green
2. `assertBudget` fires BEFORE `http.ts::fetch()` call — pre-call gate is non-negotiable
3. `assertDrafterInput` in `write.ts` fires BEFORE `complete()` — WRTE-04 chokepoint preserved
4. Key value appears ONLY in `headers` argument to `http.ts::fetch()` — T-01-07 no-leak enforced
5. Fail-loud verbs return `ok: false` + `process.exitCode = 1` — never `ok: true` on missing key
6. `noCache: true` on every LLM POST — defense-in-depth for Authorization header
