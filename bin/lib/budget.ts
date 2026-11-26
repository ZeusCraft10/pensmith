// bin/lib/budget.ts — budget assertion + cost ledger + concurrency primitive.
//
// Pre-call gates:
//   Every model call passes assertWithinCostCap before anything is sent: the
//   paper's whole spend (every COSTS.jsonl row) plus the call's estimate must
//   stay within the cost cap (PENSMITH_COST_CAP_USD, then [budget]
//   cost_cap_usd in config.toml, then $5), or CostCapExceededError refuses it.
//   complete() in anthropic.ts does this for every model call.
//   assertBudget is the general form for one scope's own allowance (the
//   GPTZero score uses it as well as the paper cap). Either way the caller
//   never reaches the paid call when the gate throws; NO post-call gate exists.
//
// Ledger:
//   .paper/COSTS.jsonl is append-only via O_APPEND. atomicAppendFile
//   handles the file open/write/fsync/close. Concurrent appends from parallel
//   sections are atomic for line size <= PIPE_BUF (4KB on POSIX, similar on
//   NTFS). This is the SOLE write path — direct fs.writeFile is forbidden by
//   the eslint chokepoint.
//
// Semaphore:
//   Bounded-parallel primitive. No external dep. In-process only — does NOT
//   coordinate across processes (use proper-lockfile / lock.ts for that).
//   Used by Phase 2+ wave scheduler to bound parallel section drafting.

import path from 'node:path';
import * as fsp from 'node:fs/promises';
import { paperDir, projectRoot } from './paths.js';
import { atomicAppendFile } from './atomic-write.js';
import { paperConfigFiles, readConfigTable } from './project-config.js';

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

// ---------- The paper's cost cap ----------

/** The cost cap when neither PENSMITH_COST_CAP_USD nor config.toml sets one. */
export const DEFAULT_COST_CAP_USD = 5;

export interface CostCap {
  capUsd: number;
  /** Past this total a running-cost warning is printed, once per run. */
  warnAtUsd: number | null;
  source: 'PENSMITH_COST_CAP_USD' | 'config.toml' | 'default';
}

/** A positive finite number, or null. */
function positive(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The cost cap for the paper at `root`: PENSMITH_COST_CAP_USD, then
 * `cost_cap_usd` under `[budget]` in .paper/config.toml or the project's
 * config.toml, then DEFAULT_COST_CAP_USD. A value that is not a positive
 * number is ignored. `warn_at_usd` comes from the same table.
 */
export function resolveCostCap(root: string = projectRoot()): CostCap {
  const tables = paperConfigFiles(root).map((f) => readConfigTable(f, 'budget'));
  const fromConfig = (key: string): number | null => {
    for (const t of tables) {
      const v = positive(t[key]);
      if (v !== null) return v;
    }
    return null;
  };
  const warnAtUsd = fromConfig('warn_at_usd');
  const env = positive(process.env['PENSMITH_COST_CAP_USD']);
  if (env !== null) return { capUsd: env, warnAtUsd, source: 'PENSMITH_COST_CAP_USD' };
  const configured = fromConfig('cost_cap_usd');
  if (configured !== null) return { capUsd: configured, warnAtUsd, source: 'config.toml' };
  return { capUsd: DEFAULT_COST_CAP_USD, warnAtUsd, source: 'default' };
}

const CAP_SOURCE_TEXT: Record<CostCap['source'], string> = {
  PENSMITH_COST_CAP_USD: 'set by PENSMITH_COST_CAP_USD',
  'config.toml': 'set in config.toml',
  default: 'the default',
};

/**
 * A paid call was refused because, with what the paper has spent, it could
 * take the paper past its cost cap. It is a refusal (exit 2), not an error.
 */
export class CostCapExceededError extends BudgetExceededError {
  readonly exitCode = 2;
  readonly source: CostCap['source'];
  constructor(cap: CostCap, spent: number, estimatedAdd: number) {
    super({ scope: 'paper', scopeId: 'cost-cap', cap: cap.capUsd }, spent, estimatedAdd);
    this.name = 'CostCapExceededError';
    this.source = cap.source;
    this.message =
      `this step could take the paper past its cost cap: $${spent.toFixed(4)} spent so far plus about ` +
      `$${estimatedAdd.toFixed(4)} for this call is more than the $${cap.capUsd.toFixed(2)} cap (${CAP_SOURCE_TEXT[cap.source]}). ` +
      'Nothing was sent. To allow more, raise PENSMITH_COST_CAP_USD, or cost_cap_usd under [budget] in .paper/config.toml; ' +
      '.paper/COSTS.jsonl lists what was spent.';
  }
}

let warnedAtUsd: number | null = null;

/**
 * Refuse a paid call that, with everything the paper has spent (every row of
 * .paper/COSTS.jsonl, whatever step it was for), could pass the cost cap.
 * Call it before the request is sent, with the call's estimated cost.
 *
 * The estimate is what the call is expected to use, not its output limit, so
 * one call can end a little past the cap; the next one is then refused.
 */
export async function assertWithinCostCap(estimateUsd: number): Promise<void> {
  const cap = resolveCostCap();
  const spent = await totalCost({});
  if (spent + estimateUsd > cap.capUsd) throw new CostCapExceededError(cap, spent, estimateUsd);
  if (cap.warnAtUsd !== null && spent + estimateUsd > cap.warnAtUsd && warnedAtUsd !== cap.warnAtUsd) {
    warnedAtUsd = cap.warnAtUsd;
    process.stderr.write(
      `pensmith: WARN — this paper has spent $${spent.toFixed(2)} of the $${cap.capUsd.toFixed(2)} cost cap ` +
      `(warn_at_usd is $${cap.warnAtUsd.toFixed(2)}).\n`,
    );
  }
}

// ---------- Semaphore (D-50) ----------

/**
 * In-process bounded-parallel primitive. Constructor validates that
 * maxConcurrency is a positive integer (rejects 0, negative, NaN, and
 * non-integer floats — these all indicate caller bugs).
 *
 * acquire() returns immediately if a slot is free, else queues a waiter
 * resolver. release() pops the next waiter (FIFO via waiters.shift()) and
 * grants its slot. release() throws if called more times than acquire —
 * this catches paired-call bugs early rather than silently letting
 * concurrency drift above max.
 *
 * withLock(fn) is the recommended call site: it pairs acquire+release in a
 * try/finally so an exception in fn cannot leak a slot (HARD-06 / T-15-06b).
 *
 * FIFO guarantee: waiters are resolved in strict FIFO order (waiters.shift()
 * pops the oldest waiter). No starvation under concurrent load.
 *
 * ── BARE-CALLER WARNING (T-15-06b) ──────────────────────────────────────────
 * If you call acquire()/release() directly (outside withLock), YOU MUST wrap
 * the held section in try/finally to avoid a permit leak on exception:
 *
 *   await sem.acquire();
 *   try {
 *     await doWork();          // any throw here …
 *   } finally {
 *     sem.release();           // … is caught; permit always returned
 *   }
 *
 * A leaked permit permanently reduces the pool below maxConcurrency.
 * withLock() already does this; prefer it over bare acquire/release.
 * ────────────────────────────────────────────────────────────────────────────
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
