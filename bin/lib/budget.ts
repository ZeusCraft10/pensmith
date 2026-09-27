// bin/lib/budget.ts — session cost cap + cost ledger + concurrency primitive
// (RUN-18 / D-17-26; ARCH-09 / ARCH-10; D-45, D-46, D-50).
//
// Session cost cap (PRD §14 "Hard cost cap", D-17-26):
//   A session is one top-level process invocation (a bare-router chain
//   included; the MCP server process is one session — session-log.ts
//   currentSessionId()). The cap is `[budget] cost_cap_usd` (default $5.00),
//   overridden by PENSMITH_COST_CAP_USD. Before every model call the transport
//   calls assertSessionBudget(projected): spend-this-session + projected > cap
//   runs the V2 `cost-cap` gate — a terminal user is asked ONCE per session; a
//   run that cannot prompt (--yolo included; the gate is never yolo-skippable)
//   sends nothing and fails with EXIT_COST_CAP. The projection is the input
//   estimate plus min(recorded p90, max_tokens) output at the model price
//   (estimator.ts projectCall). Crossing `[budget] warn_at_usd` prints one
//   warning with the running total. This is the ONLY LLM cap: the per-scope
//   $0.50 caps and the Pass 2 / Pass 4 section caps are gone.
//
// Ledger (D-45, D-46):
//   .paper/COSTS.jsonl is append-only JSONL via O_APPEND (atomicAppendFile).
//   Records gain optional session / slug / section / provider / model /
//   served_model fields; readers treat missing fields as legacy, so there is
//   no version envelope and no migration.
//
// assertBudget(spec, estimate) — the legacy per-scope check — stays for the
// non-LLM GPTZero advisory (honesty.ts); LLM calls never use it.
//
// Semaphore (D-50): bounded-parallel primitive, in-process only.

import path from 'node:path';
import * as fsp from 'node:fs/promises';
import { paperDir, projectRoot } from './paths.js';
import { atomicAppendFile } from './atomic-write.js';
import { currentSessionId } from './session-log.js';
import { declineGate, runGate } from './gates.js';
import { tryReadPaperConfigSync } from './config.js';

export interface BudgetSpec {
  scope: 'paper' | 'section' | 'task';
  scopeId: string;
  cap: number;
}

export interface CostRecord {
  ts: string;
  scope: BudgetSpec['scope'];
  scopeId: string;
  provider: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  costUsd: number;
  /** D-17-26: the session (one top-level invocation) that spent this. */
  session?: string;
  slug?: string;
  section?: number;
  /** The model that actually served the response (differs after a refusal fallback). */
  served_model?: string;
}

/**
 * Thrown by the legacy per-scope assertBudget when spent + estimatedAdd
 * exceeds spec.cap (the GPTZero advisory only).
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

function costsPath(root: string = projectRoot()): string {
  return path.join(paperDir(root), 'COSTS.jsonl');
}

async function readRecords(root?: string): Promise<CostRecord[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(costsPath(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: CostRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CostRecord);
    } catch {
      // Defensive: a hand-edited partial line is skipped (O_APPEND keeps real lines whole).
    }
  }
  return out;
}

/**
 * Sum costUsd across COSTS.jsonl, optionally filtered by scope / scopeId /
 * session. A missing ledger is 0 (a fresh paper), never an error.
 */
export async function totalCost(
  filter: { scope?: BudgetSpec['scope']; scopeId?: string; session?: string; root?: string } = {},
): Promise<number> {
  let total = 0;
  for (const rec of await readRecords(filter.root)) {
    if (filter.scope && rec.scope !== filter.scope) continue;
    if (filter.scopeId && rec.scopeId !== filter.scopeId) continue;
    if (filter.session && rec.session !== filter.session) continue;
    total += Number(rec.costUsd) || 0;
  }
  return total;
}

/** Spend recorded by THIS session (this process invocation). */
export async function sessionSpend(root?: string): Promise<number> {
  return totalCost({ session: currentSessionId(), ...(root !== undefined ? { root } : {}) });
}

/**
 * Legacy per-scope pre-call check (the GPTZero advisory). Throws
 * BudgetExceededError when totalCost(scope) + estimate > spec.cap.
 */
export async function assertBudget(spec: BudgetSpec, estimateUsd: number): Promise<void> {
  const spent = await totalCost({ scope: spec.scope, scopeId: spec.scopeId });
  if (spent + estimateUsd > spec.cap) {
    throw new BudgetExceededError(spec, spent, estimateUsd);
  }
}

// ---------- Session cost cap (RUN-18) ----------

export const DEFAULT_SESSION_CAP_USD = 5;

export interface CostCapSettings {
  capUsd: number;
  capSource: 'default' | 'config' | 'env';
  warnAtUsd: number | null;
}

/** `PENSMITH_COST_CAP_USD` (finite, > 0) > `[budget] cost_cap_usd` > $5.00; warn from `[budget] warn_at_usd`. */
export function resolveCostCap(root: string = projectRoot(), env: NodeJS.ProcessEnv = process.env): CostCapSettings {
  const cfg = tryReadPaperConfigSync(root);
  const warnAtUsd = cfg?.budget?.warn_at_usd ?? null;
  const raw = env['PENSMITH_COST_CAP_USD'];
  const fromEnv = raw !== undefined && raw !== '' ? Number(raw) : NaN;
  if (Number.isFinite(fromEnv) && fromEnv > 0) return { capUsd: fromEnv, capSource: 'env', warnAtUsd };
  const fromCfg = cfg?.budget?.cost_cap_usd;
  if (typeof fromCfg === 'number' && fromCfg > 0) return { capUsd: fromCfg, capSource: 'config', warnAtUsd };
  return { capUsd: DEFAULT_SESSION_CAP_USD, capSource: 'default', warnAtUsd };
}

let overCapApproved = false;
let warnPrinted = false;

/** Test-only: forget the once-per-session cap approval and warning. */
export function _resetCostCapForTest(): void {
  overCapApproved = false;
  warnPrinted = false;
}

/** `$1.23`, or four decimals below one cent so a tiny cap or call never prints as $0.00. */
export function formatUsd(n: number): string {
  return n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

const usd = formatUsd;

/**
 * The per-call session cap check (RUN-18). Called by the transport BEFORE any
 * byte is sent. Over the cap: ask once per session in a terminal; otherwise
 * GateRefusedError(EXIT_COST_CAP) — nothing is sent.
 */
export async function assertSessionBudget(args: {
  projectedUsd: number;
  slug: string;
  model: string;
  root?: string;
}): Promise<void> {
  const root = args.root ?? projectRoot();
  const { capUsd } = resolveCostCap(root);
  const spent = await sessionSpend(root);
  if (spent + args.projectedUsd <= capUsd || overCapApproved) return;
  const detail =
    `${args.slug} on ${args.model}: projected ${usd(args.projectedUsd)} + ${usd(spent)} spent this session ` +
    `> cap ${usd(capUsd)}; raise [budget] cost_cap_usd or PENSMITH_COST_CAP_USD`;
  const outcome = await runGate('cost-cap', {
    yolo: false,
    detail,
    question: {
      id: 'cost-cap',
      kind: 'confirm',
      label:
        `The next model call (${args.slug} on ${args.model}, ~${usd(args.projectedUsd)}) would exceed your ` +
        `${usd(capUsd)} cost cap (${usd(spent)} spent this session). Continue?`,
      default: false,
    },
  });
  if (outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true) {
    overCapApproved = true;
    return;
  }
  declineGate('cost-cap', `cost cap: stopped before calling the model (${detail})`);
}

/**
 * Append a cost record to .paper/COSTS.jsonl via O_APPEND (D-45/D-46), stamped
 * with the session id. Crossing `[budget] warn_at_usd` prints one warning.
 * Throws on a disk-write failure (D-45: never silently lose a paid cost).
 */
export async function appendCost(record: CostRecord, root: string = projectRoot()): Promise<void> {
  const stamped: CostRecord = { ...record, session: record.session ?? currentSessionId() };
  await atomicAppendFile(costsPath(root), JSON.stringify(stamped) + '\n');
  if (warnPrinted) return;
  const { warnAtUsd, capUsd } = resolveCostCap(root);
  if (warnAtUsd === null) return;
  const spent = await sessionSpend(root);
  if (spent >= warnAtUsd) {
    warnPrinted = true;
    process.stderr.write(
      `pensmith: cost warning — ${usd(spent)} spent this session (warn_at_usd ${usd(warnAtUsd)}, cap ${usd(capUsd)}).\n`,
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
