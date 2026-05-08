// bin/lib/budget.ts — budget assertion + cost ledger + concurrency primitive
// per ARCH-09 / ARCH-10 / ARCH-11 (D-44, D-45, D-46, D-50).
//
// Pre-call gate (D-44):
//   The CONTRACT is "assertBudget BEFORE LLM call". Caller pattern:
//     await assertBudget({scope, scopeId, cap}, estimateUsd);
//     const result = await llm.call(...);
//     await appendCost({...result.usage, scope, scopeId});
//   If estimateUsd + already-spent > cap → throws BudgetExceededError → caller
//   never reaches the LLM call. NO post-call gate exists.
//
// Ledger (D-45, D-46):
//   .paper/COSTS.jsonl is append-only via O_APPEND. atomicAppendFile (W2)
//   handles the file open/write/fsync/close. Concurrent appends from parallel
//   sections are atomic for line size <= PIPE_BUF (4KB on POSIX, similar on
//   NTFS). This is the SOLE write path — direct fs.writeFile is forbidden by
//   the eslint chokepoint (D-07).
//
// Semaphore (D-50):
//   Bounded-parallel primitive. No external dep. In-process only — does NOT
//   coordinate across processes (use proper-lockfile / lock.ts for that).
//   Used by Phase 2+ wave scheduler to bound parallel section drafting.

import path from 'node:path';
import * as fsp from 'node:fs/promises';
import { paperDir } from './paths.js';
import { atomicAppendFile } from './atomic-write.js';

export interface BudgetSpec {
  scope: 'paper' | 'section' | 'task';
  scopeId: string;
  cap: number;
}

export interface CostRecord {
  ts: string;
  scope: BudgetSpec['scope'];
  scopeId: string;
  provider: 'anthropic' | 'openai' | 'crossref' | 'openalex' | 'other';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
}

/**
 * Thrown by assertBudget when spent + estimatedAdd exceeds spec.cap.
 *
 * Exposes scope / cap / spent / estimatedAdd so callers can format
 * user-facing diagnostics (Phase 2+ TUI) without re-parsing the message.
 */
export class BudgetExceededError extends Error {
  scope: BudgetSpec['scope'];
  cap: number;
  spent: number;
  estimatedAdd: number;
  constructor(spec: BudgetSpec, spent: number, estimatedAdd: number) {
    super(
      `Budget exceeded for ${spec.scope}:${spec.scopeId} — cap=$${spec.cap.toFixed(2)} spent=$${spent.toFixed(4)} estimatedAdd=$${estimatedAdd.toFixed(4)}`,
    );
    this.name = 'BudgetExceededError';
    this.scope = spec.scope;
    this.cap = spec.cap;
    this.spent = spent;
    this.estimatedAdd = estimatedAdd;
  }
}

function costsPath(): string {
  return path.join(paperDir(), 'COSTS.jsonl');
}

/**
 * Sum costUsd across COSTS.jsonl, optionally filtered by scope/scopeId.
 *
 * Returns 0 if the file does not exist (a fresh paper has no ledger yet —
 * not an error condition). Malformed lines are skipped defensively;
 * atomicAppendFile guarantees per-line atomicity so this should never
 * happen in practice, but tolerating it costs nothing and protects against
 * manual edits that leave a partial line.
 */
export async function totalCost(
  filter: { scope?: BudgetSpec['scope']; scopeId?: string } = {},
): Promise<number> {
  const file = costsPath();
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let total = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec: CostRecord;
    try {
      rec = JSON.parse(line) as CostRecord;
    } catch {
      // Defensive: skip malformed line. Per D-46 (O_APPEND atomicity) this
      // should be unreachable, but tolerate it for hand-edited ledgers.
      continue;
    }
    if (filter.scope && rec.scope !== filter.scope) continue;
    if (filter.scopeId && rec.scopeId !== filter.scopeId) continue;
    total += Number(rec.costUsd) || 0;
  }
  return total;
}

/**
 * Pre-call budget gate (D-44). MUST be called BEFORE any paid API request.
 *
 *   await assertBudget({scope, scopeId, cap}, estimateUsd);
 *   const result = await llm.call(...);
 *   await appendCost({...result.usage, scope, scopeId});
 *
 * If totalCost(filter) + estimateUsd > spec.cap, throws BudgetExceededError.
 * The caller's API call is never made — this is the financial-safety
 * boundary.
 *
 * Race note (T-01-RACE-03): two concurrent assertBudget calls can both pass
 * the check before either's appendCost lands. v0.1 accepts this TOCTOU
 * window; per-section caps bound the worst-case overrun to one extra
 * estimate per parallel section.
 */
export async function assertBudget(spec: BudgetSpec, estimateUsd: number): Promise<void> {
  const spent = await totalCost({ scope: spec.scope, scopeId: spec.scopeId });
  if (spent + estimateUsd > spec.cap) {
    throw new BudgetExceededError(spec, spent, estimateUsd);
  }
}

/**
 * Append a cost record to .paper/COSTS.jsonl via O_APPEND (D-45/D-46).
 *
 * Each record becomes one JSONL line. atomicAppendFile guarantees per-line
 * atomicity for size <= PIPE_BUF (4KB) — well above the ~200-byte typical
 * record size, so concurrent appends from parallel sections never tear.
 *
 * Throws on disk-write failure (D-45 chose hard-fail over silent loss to
 * prevent cost-leakage: if we can't record a cost, we shouldn't have
 * silently paid for it).
 */
export async function appendCost(record: CostRecord): Promise<void> {
  const line = JSON.stringify(record) + '\n';
  await atomicAppendFile(costsPath(), line);
}

// ---------- Semaphore (D-50) ----------

/**
 * In-process bounded-parallel primitive. Constructor validates that
 * maxConcurrency is a positive integer (rejects 0, negative, NaN, and
 * non-integer floats — these all indicate caller bugs).
 *
 * acquire() returns immediately if a slot is free, else queues a waiter
 * resolver. release() pops the next waiter (FIFO) and grants its slot.
 * release() throws if called more times than acquire — this catches
 * paired-call bugs early rather than silently letting concurrency drift
 * above max.
 *
 * withLock(fn) is the recommended call site: it pairs acquire+release in a
 * try/finally so an exception in fn cannot leak a slot.
 */
export class Semaphore {
  private max: number;
  private current = 0;
  private waiters: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(
        `Semaphore: maxConcurrency must be a positive integer; got ${maxConcurrency}`,
      );
    }
    this.max = maxConcurrency;
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current += 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.current += 1;
        resolve();
      });
    });
  }

  release(): void {
    if (this.current === 0) {
      throw new Error('Semaphore.release called more times than acquire');
    }
    this.current -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
