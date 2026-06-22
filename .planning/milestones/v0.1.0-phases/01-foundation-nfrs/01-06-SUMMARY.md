---
phase: 01-foundation-nfrs
plan: 06
subsystem: financial-safety
tags: [budget, cost-ledger, semaphore, ARCH-09, ARCH-10, ARCH-11, D-44, D-45, D-46, D-50]
requires:
  - 01-01 (paths.ts → paperDir)
  - 01-02 (atomic-write.ts → atomicAppendFile)
provides:
  - "bin/lib/budget.ts: assertBudget pre-call gate, appendCost ledger, totalCost reader, Semaphore concurrency primitive, BudgetExceededError"
  - "bin/lib/cost-fixture.ts: deterministic synthetic price table + estimateCost for tests"
affects:
  - "Phase 2+ SDK provider wrappers (W11) — call assertBudget before every paid API request, appendCost after"
  - "Phase 2+ wave scheduler — uses Semaphore to bound parallel section drafting"
tech-stack:
  added: []  # No new deps. Pure stdlib + W1/W2 chokepoints.
  patterns:
    - "pre-call gate (D-44): caller pattern is 'assertBudget THEN llm.call THEN appendCost'; throw happens BEFORE the API call so no money is spent"
    - "O_APPEND ledger (D-45/D-46): appendCost goes through atomicAppendFile so concurrent section drafters don't tear lines"
    - "in-process Semaphore (D-50): no external dep; FIFO waiter queue; withLock try/finally"
key-files:
  created:
    - bin/lib/budget.ts
    - bin/lib/cost-fixture.ts
    - tests/budget.test.ts
    - tests/cost-fixture.test.ts
  modified: []
decisions:
  - "estimateCost('unknown', 'unknown', ...) returns 0 (per PLAN line 355) instead of throwing. Rationale: tests for unknown models should not crash; the runtime price layer (W11) is the production gatekeeper for missing-pricing errors."
  - "Tests isolate paperDir() via process.chdir(mkdtemp) + finally restore. node:test runs sequentially in one process so chdir is safe; the restore-in-finally is mandatory to prevent cwd leakage between tests."
  - "Semaphore validates ctor with Number.isInteger + >= 1 (rejects 0, negatives, NaN, floats) so caller-side bugs surface immediately rather than silently letting concurrency drift above max."
  - "release() throws on over-release (current === 0). Same rationale: paired-call bugs should be loud, not silent."
metrics:
  duration: ~25min
  completed: 2026-05-08
  tests_added: 16    # 9 budget + 7 cost-fixture
  tests_total: 142   # 126 baseline + 16 new
  files_created: 4
  loc_added: ~210 (budget.ts) + ~50 (cost-fixture.ts) + ~140 (budget.test.ts) + ~65 (cost-fixture.test.ts) ≈ 465
---

# Phase 1 Plan 06: Budget Gate + Cost Ledger + Semaphore Summary

Implemented the financial-safety library: a pre-LLM-call budget gate (assertBudget), an O_APPEND-atomic JSONL cost ledger (appendCost / totalCost) routed through W2's atomicAppendFile, and an in-process bounded-concurrency Semaphore for the Phase 2+ wave scheduler. Plus a deterministic synthetic price fixture so tests don't drift when real provider pricing changes.

## Public API (4 exports across 2 modules)

### `bin/lib/budget.ts`

```ts
// Types
export interface BudgetSpec { scope: 'paper' | 'section' | 'task'; scopeId: string; cap: number; }
export interface CostRecord {
  ts: string;                // ISO8601
  scope: BudgetSpec['scope'];
  scopeId: string;
  provider: 'anthropic' | 'openai' | 'crossref' | 'openalex' | 'other';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

// Budget gate (D-44) — MUST be called BEFORE any paid API request
export async function assertBudget(spec: BudgetSpec, estimateUsd: number): Promise<void>;

// Cost ledger (D-45/D-46) — append-only via atomicAppendFile
export async function appendCost(record: CostRecord): Promise<void>;
export async function totalCost(filter: { scope?; scopeId? }): Promise<number>;

// Diagnostic error
export class BudgetExceededError extends Error {
  scope; cap; spent; estimatedAdd;
}

// Concurrency primitive (D-50)
export class Semaphore {
  constructor(maxConcurrency: number);  // throws if not positive integer
  acquire(): Promise<void>;
  release(): void;                      // throws on over-release
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}
```

### `bin/lib/cost-fixture.ts`

```ts
export const FIXTURE_PRICES: { [`${provider}:${model}`]: { inputUsdPerMtok, outputUsdPerMtok } };
export type FixtureModelKey = keyof typeof FIXTURE_PRICES;
export function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number;
```

5 model rows: opus-4, sonnet-4, haiku-4, gpt-4-turbo, gpt-4o-mini. Unknown (provider, model) → 0.

## The pre-call gate pattern (D-44 — load-bearing)

The CONTRACT is "assertBudget BEFORE the LLM call". Every paid-API caller in Phase 2+ MUST follow this exact ordering:

```ts
await assertBudget({ scope, scopeId, cap }, estimateUsd);  // throws if exceeded → no API call
const result = await provider.call(...);                    // billable request
await appendCost({ ts, scope, scopeId, provider, model, inputTokens, outputTokens, costUsd });
```

If `totalCost(scope, scopeId) + estimateUsd > spec.cap`, `assertBudget` throws `BudgetExceededError` and the caller never reaches the API. There is **no post-call gate**. This is the financial-safety boundary.

The W11 provider wrapper (Phase 2) is the SOLE call site for provider HTTP, and is responsible for wiring this trio. Code review + the chokepoint pattern means bypass requires explicitly forking the wrapper.

### Race acceptance (T-01-RACE-03)

Two concurrent `assertBudget` calls can both pass before either's `appendCost` lands. v0.1 accepts this TOCTOU window — bounded by the per-section cap, the worst case is one extra estimate per parallel section. Phase 2 may add a lock around the `assertBudget+call+appendCost` triple if real-world testing shows the drift matters; v0.1 does not.

## The COSTS.jsonl ledger contract (D-45 / D-46)

- **Path**: `paperDir() + '/COSTS.jsonl'` → `<project_root>/.paper/COSTS.jsonl`
- **Format**: one JSON record per line, terminated with `\n`
- **Write path**: `appendCost` → `atomicAppendFile` (W2) → `O_APPEND` open → write → fsync → close
- **Atomicity**: per-line atomic for size ≤ PIPE_BUF (4KB POSIX). Cost records are ~200 bytes — well under the limit.
- **Concurrency**: parallel `appendCost` calls from separate sections are safe; verified by `tests/budget.test.ts` `appendCost: parallel appends both persist` (Promise.all of 2 appends, both lines present, total = 0.20).
- **Read path**: `totalCost(filter)` reads the whole file, splits on `\n`, JSON.parses each non-empty line, filters by scope/scopeId, sums `costUsd`. Missing file → 0 (fresh paper). Malformed line → skipped (defense-in-depth; should be unreachable per O_APPEND atomicity but tolerated for hand-edited ledgers).
- **Failure semantics**: `appendCost` throws on disk-write failure (D-45 chose hard-fail over silent loss — if we can't record a cost, we shouldn't have silently paid for it).
- **Chokepoint compliance**: `budget.ts` has zero direct `fs.writeFile` / `fs.appendFile` calls. The eslint `no-restricted-syntax` rule on `CallExpression[callee.property.name='writeFile']` applies — `budget.ts` is NOT exempted, only `bin/lib/atomic-write.ts` is.

## The Semaphore primitive (D-50)

In-process bounded-parallel primitive. No external dep. Used by Phase 2+ wave scheduler to bound parallel section drafting (e.g. "max 3 sections in flight at once").

- `constructor(maxConcurrency)` validates `Number.isInteger(n) && n >= 1` — rejects `0`, negatives, `NaN`, and non-integer floats. Caller bugs surface at construction.
- `acquire()` returns immediately if a slot is free, else queues a waiter resolver.
- `release()` pops the next waiter (FIFO) and grants its slot. Throws if `current === 0` (release-without-acquire is a paired-call bug, not a no-op).
- `withLock(fn)` is the recommended call site: `acquire` → `try fn()` → `finally release`. Exception-safe.

**NOT cross-process** — for that, use `bin/lib/lock.ts` (proper-lockfile) from Plan 01-03. Semaphore is single-process only.

## Tests (16 new, all passing)

### `tests/budget.test.ts` (9 tests)

| Test | What it proves |
|------|----------------|
| `assertBudget: passes when spent + estimate < cap` | Happy path |
| `assertBudget: throws BudgetExceededError when spent + estimate > cap` | Pre-call gate fires + error fields populated (scope/cap/spent/estimatedAdd) |
| `appendCost + totalCost: roundtrip sums match` | 3 records → sum = 0.6 |
| `totalCost: filters by scopeId` | Per-section isolation |
| `totalCost: returns 0 when COSTS.jsonl is missing` | ENOENT → 0, not throw |
| `appendCost: parallel appends both persist (O_APPEND atomicity)` | Promise.all of 2 → both lines present |
| `Semaphore: enforces max-N concurrency` | 5 parallel withLock on Semaphore(2) → maxSeen === 2 |
| `Semaphore: release without acquire throws` | Paired-call enforcement |
| `Semaphore: invalid maxConcurrency throws` | Rejects 0, -1, 1.5, NaN |

### `tests/cost-fixture.test.ts` (7 tests)

| Test | What it proves |
|------|----------------|
| `FIXTURE_PRICES contains all expected models` | Registry sanity |
| `estimateCost: opus-4 input 1M tok = $15.00` | Input arithmetic |
| `estimateCost: opus-4 output 1M tok = $75.00` | Output arithmetic |
| `estimateCost: opus-4 mixed 0.5M+0.5M = $45.00` | Mixed arithmetic |
| `estimateCost: zero tokens = $0` | Zero-edge |
| `estimateCost: unknown provider/model returns 0` | Unknown semantics (PLAN line 355) |
| `estimateCost: deterministic across 100 iterations` | No hidden state |

### Test isolation strategy

`paperDir()` resolves under `process.cwd()`, so each test wraps its body in:
```ts
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
```
node:test runs tests sequentially in a single process so `process.chdir` is safe; the `finally` restore is mandatory to prevent cwd leakage between tests.

## Deviations from Plan

None — plan executed exactly as written. The PLAN's `<interfaces>` example used `from './paths.ts'` import paths; established project convention (per CLAUDE memory + Wave 1 hard-fix) is `from './paths.js'` with NodeNext, which is what was actually written. This is a documentation drift in the PLAN, not a deviation in execution — the established convention took precedence as documented in the dispatch base.

## Decisions Made

1. **Unknown model returns 0 (not throws)** — picked per PLAN line 355. The runtime price layer (W11) is the production gatekeeper for missing-pricing errors; keeping the fixture lenient means tests for unknown-model handling don't crash and the gate is exercised by the budget cap, not the price lookup.

2. **Test isolation via process.chdir** — chosen over a paperDir() injection point because injecting cwd into paths.ts would proliferate to every Phase 2+ caller. `process.chdir` is a single test-helper concern that doesn't leak into source.

3. **Semaphore validates ctor (Number.isInteger + >= 1)** — rejects 0, negatives, NaN, and floats explicitly. Caller bugs surface immediately rather than letting concurrency drift above max silently.

4. **release() throws on over-release** — same rationale; paired-call bugs are loud, not silent.

## Carry-forward

- **Phase 2+ SDK provider wrapper (W11)** — wires the `assertBudget → llm.call → appendCost` pattern around every paid API request. Anthropic + OpenAI + (later) any other paid provider goes through this single wrapper.
- **Phase 2+ wave scheduler** — uses `new Semaphore(N)` to bound parallel section drafting. Default N is per-config; PRD §17 leaves the algorithm itself open.
- **Phase 2+ TUI / status bar** — reads `totalCost({scope:'paper'})` for the "$ spent so far" indicator. Tests already prove the read path.
- **Plan 01-07 (next)** — adds 5 zod schemas + migrations. Independent of budget.ts; no carry-over wiring required. The cost-fixture pattern (deterministic synthetic data for tests) generalizes to schema fixtures if helpful.

## Self-Check: PASSED

- bin/lib/budget.ts exists: FOUND
- bin/lib/cost-fixture.ts exists: FOUND
- tests/budget.test.ts exists: FOUND
- tests/cost-fixture.test.ts exists: FOUND
- Commit `65fb183` (feat 01-06 budget.ts): FOUND in `git log`
- Commit `8567e88` (test 01-06 cost-fixture + tests): FOUND in `git log`
- 142/142 tests passing
- `npx tsc --noEmit` exit 0
- `npm run lint` exit 0
- No direct `fs.writeFile` / `fs.appendFile` in budget.ts (chokepoint clean)
