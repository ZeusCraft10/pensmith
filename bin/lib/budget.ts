// bin/lib/budget.ts — session cost cap + cost ledger + concurrency primitive
// (RUN-18 / D-17-26; ARCH-09 / ARCH-10; D-45, D-46, D-50).
//
// Session cost cap (PRD §14 "Hard cost cap", D-17-26):
//   A session is one top-level process invocation (a bare-router chain
//   included; the MCP server process is one session — session-log.ts
//   currentSessionId()). The cap is `[budget] cost_cap_usd` (default $5.00),
//   overridden by PENSMITH_COST_CAP_USD. Before every model call the transport
//   (anthropic.ts complete()) calls reserveSessionBudget(projected): spend this
//   session + every in-flight reservation + projected > cap runs the V2
//   `cost-cap` gate — a terminal user is asked ONCE per session; a run that
//   cannot prompt (--yolo included; the gate is never yolo-skippable) sends
//   nothing and fails with EXIT_COST_CAP. The reservation holds the projection
//   until the call's actual cost is appended to the ledger, then is released,
//   so parallel calls (wave `write`) see each other's in-flight spend. The projection is the input
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
import { parseCostCapEnv, tryReadPaperConfigSync } from './config.js';

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
  /** The section: its number, or `1a` for a lettered section (section-id.ts loggedSectionId). */
  section?: number | string;
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
 * The session that recorded the LAST cost in COSTS.jsonl (append order) and
 * its total spend — what a standalone `pensmith status` meters, since its own
 * process never spends (a session is one process, D-17-26). Null when the
 * ledger holds no session-stamped record.
 */
export async function lastSessionSpend(root?: string): Promise<{ session: string; usd: number } | null> {
  const records = await readRecords(root);
  let last: string | null = null;
  for (const rec of records) if (typeof rec.session === 'string' && rec.session) last = rec.session;
  if (last === null) return null;
  let usd = 0;
  for (const rec of records) if (rec.session === last) usd += Number(rec.costUsd) || 0;
  return { session: last, usd };
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

/**
 * `PENSMITH_COST_CAP_USD` > `[budget] cost_cap_usd` > $5.00; warn from
 * `[budget] warn_at_usd`. A set-but-invalid PENSMITH_COST_CAP_USD throws a
 * one-line EXIT_USAGE PensmithError (config.ts parseCostCapEnv) — before any
 * model call, since every call checks the cap first.
 */
export function resolveCostCap(root: string = projectRoot(), env: NodeJS.ProcessEnv = process.env): CostCapSettings {
  const cfg = tryReadPaperConfigSync(root);
  const warnAtUsd = cfg?.budget?.warn_at_usd ?? null;
  const fromEnv = parseCostCapEnv(env['PENSMITH_COST_CAP_USD']);
  if (fromEnv !== null) return { capUsd: fromEnv, capSource: 'env', warnAtUsd };
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
  reservedUsd = 0;
  capMutex = Promise.resolve();
}

/** `$1.23`, or four decimals below one cent so a tiny cap or call never prints as $0.00. */
export function formatUsd(n: number): string {
  return n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

const usd = formatUsd;

// In-flight reservations. A call's cost reaches COSTS.jsonl only after it
// returns, so concurrent calls in ONE process (the MCP server runs tool calls
// for different sections in parallel) would each read the same "spent" and all
// pass. Every check therefore counts the projections of calls still in flight,
// and check-then-reserve runs under a small in-process mutex so two checks can
// never interleave between reading the ledger and reserving.
let reservedUsd = 0;
let capMutex: Promise<void> = Promise.resolve();

async function underCapMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = capMutex;
  let unlock!: () => void;
  capMutex = new Promise<void>((r) => { unlock = r; });
  await prev;
  try {
    return await fn();
  } finally {
    unlock();
  }
}

/** A held in-flight reservation; release() once the call's cost is recorded (or it failed). */
export interface BudgetReservation {
  release(): void;
}

/** Test-only: the USD currently reserved by calls in flight. */
export function _reservedUsdForTest(): number {
  return reservedUsd;
}

/**
 * The one cost-cap check (both paths print the same one-line message): spend
 * this session + calls in flight + `projectedUsd` over the cap runs the
 * never-skippable `cost-cap` gate — asked once per session in a terminal,
 * otherwise GateRefusedError(EXIT_COST_CAP) and nothing is sent.
 */
async function checkCap(args: {
  projectedUsd: number;
  what: string;
  /** The terminal question, given the formatted cap and session spend. */
  label: (cap: string, spent: string) => string;
  root: string;
}): Promise<void> {
  const { capUsd } = resolveCostCap(args.root);
  const spent = (await sessionSpend(args.root)) + reservedUsd;
  if (spent + args.projectedUsd <= capUsd || overCapApproved) return;
  const detail =
    `${args.what}: projected ${usd(args.projectedUsd)} + ${usd(spent)} spent this session ` +
    `> cap ${usd(capUsd)}; raise [budget] cost_cap_usd or PENSMITH_COST_CAP_USD`;
  const outcome = await runGate('cost-cap', {
    yolo: false,
    detail,
    question: { id: 'cost-cap', kind: 'confirm', label: args.label(usd(capUsd), usd(spent)), default: false },
  });
  if (outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true) {
    overCapApproved = true;
    return;
  }
  declineGate('cost-cap', `cost cap: stopped before calling the model (${detail})`);
}

/**
 * The per-call session cap check (RUN-18). Called by the transport BEFORE any
 * byte is sent, and it RESERVES the projection until the caller releases it
 * (after the call's cost is appended), so parallel calls see each other's
 * in-flight spend. Over the cap: ask once per session in a terminal; otherwise
 * GateRefusedError(EXIT_COST_CAP) — nothing is sent.
 */
export async function reserveSessionBudget(args: {
  projectedUsd: number;
  slug: string;
  model: string;
  root?: string;
}): Promise<BudgetReservation> {
  const root = args.root ?? projectRoot();
  const projected = Math.max(0, args.projectedUsd);
  return underCapMutex(async () => {
    await checkCap({
      projectedUsd: projected,
      what: `${args.slug} on ${args.model}`,
      label: (cap, spent) =>
        `The next model call (${args.slug} on ${args.model}, ~${usd(projected)}) would exceed your ${cap} cost cap (${spent} spent this session). Continue?`,
      root,
    });
    reservedUsd += projected;
    let released = false;
    return {
      release(): void {
        if (released) return;
        released = true;
        reservedUsd = Math.max(0, reservedUsd - projected);
      },
    };
  });
}

/**
 * The --yolo pre-flight (D-17-27): the projected cost of the steps THIS
 * invocation runs (estimator.ts EstimateScope) against the same cap, through the
 * same gate and the same one-line message as the per-call check.
 */
export async function assertInvocationBudget(args: { projectedUsd: number; what: string; root?: string }): Promise<void> {
  const root = args.root ?? projectRoot();
  await underCapMutex(() =>
    checkCap({
      projectedUsd: args.projectedUsd,
      what: args.what,
      label: (cap, spent) =>
        `This run (${args.what}, ~${usd(args.projectedUsd)}) would exceed your ${cap} cost cap (${spent} spent this session). Continue?`,
      root,
    }),
  );
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
