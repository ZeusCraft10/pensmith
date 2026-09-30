// bin/lib/research-orchestrator.ts — the research pass shared by
// `pensmith research` (SRC-07..SRC-10) and `plan N --research` (GRND-17).
//
// One pass, in this order (D-19-15, D-19-16):
//   1. DISCOVER — every query goes to every adapter of the adapter plan
//      (bin/lib/adapter-plan.ts: the preset's source preference, then PRD §10's
//      default five, or exactly `[sources] allowed_databases`), with
//      `fromYear` from `[sources] min_year`. Each adapter's outcome is recorded
//      per query and aggregated per adapter: a count, `failed (<reason>)` (the
//      adapter's own complete reason, e.g. `HTTP 429 — rate limited; set
//      PENSMITH_S2_API_KEY`), `offline: no recorded fixture`, or a plan skip.
//      Results are schema-validated, reserved dry-run identifiers dropped
//      outside --dry-run (RUN-27), deduplicated (normalized DOI, then title
//      Jaro-Winkler) and given batch-unique citekeys. A work several adapters
//      found keeps its best preference rank.
//   2. TIER + POLICY — the deterministic tier (bin/lib/source-tier.ts) of each
//      candidate; the `[sources]` policy (bin/lib/source-policy.ts) with that
//      tier, so the evaluator is never paid to judge what the policy drops.
//   3. EVALUATE — the source-evaluator model, through the one prompt layout
//      (bin/lib/prompt-request.ts buildPromptRequest): the candidates are sent
//      ONCE, fenced, at most EVALUATOR_BATCH per call. Its verdicts are applied
//      by the pure applySourceEvaluations() (also Tier 1's, PLUG-07): kept,
//      rejected (with the reason), or — when a call failed after its corrective
//      retry or a candidate got no verdict — `not evaluated`, kept with a
//      disclosure. There is NO keep-all fallback: a candidate the evaluator
//      rejected is rejected (SRC-07).
//   4. POLICY again with the final tier (the evaluator decides the tier the
//      metadata did not), then RANK: relevance, ties by preference rank.
//
// The verbs own the approval gates, the retraction cross-check, the library
// write (bin/lib/library.ts upsertSources) and RESEARCH.md; this module renders
// the research log (renderResearchLog) around the sources block research-md.ts
// renders from LIBRARY.json (D-19-17).
//
// Network modes (RUN-01..RUN-04, RUN-27): under --dry-run the only source is
// the labelled synthetic provider (bin/lib/sources/dry-run.ts); offline, an
// adapter without a recorded fixture reports `offline: no recorded fixture`.
//
// Test seam: __setResearchRegistryForTest() swaps the adapter registry for the
// real verbs, and only inside a test context (NODE_TEST_CONTEXT /
// PENSMITH_TEST=1) — a shipped run can never be pointed at fake adapters.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { sources } from './sources/index.js';
import * as dryRunProvider from './sources/dry-run.js';
import type { SearchOptions } from './sources/search-failure.js';
import { SourceCandidateSchema, type SourceCandidate } from './schemas/source-candidate.js';
import { confirmRegistrarRecords, type CrossrefLookup } from './sources/registrar-confirm.js';
import type { SourceTier } from './schemas/source-types.js';
import type { LibraryEntry } from './schemas/library.js';
import { normalizeDoi, isReservedDryRunId } from './doi.js';
import { isOfflineEgressError, offlineLabel } from './http.js';
import { networkMode, offlineMarkerLine, isTestContext } from './http-mock.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { paperDir } from './paths.js';
import { jaroWinkler, TITLE_JW_THRESHOLD } from './fuzzy.js';
import { assignUniqueCitekeys } from './bibtex-write.js';
import { complete, isFatalLlmError } from './anthropic.js';
import type { SourceEvaluation } from './llm-contracts.js';
import { buildPromptRequest, requestHints, type PromptJson } from './prompt-request.js';
import { candidateToEntry, doiVersionBase } from './migrations/library/shape.js';
import { deterministicTier } from './source-tier.js';
import { applySourcePolicy, type PolicyExclusion, type PolicyInput, type SourcePolicy } from './source-policy.js';
import { planAdapters, zoteroConfigured, RESEARCH_PER_QUERY_LIMIT, EVALUATOR_BATCH, evaluatorCallsFor, type AdapterPlan } from './adapter-plan.js';
import { resolveDiscipline } from './disciplines.js';
import { RESEARCH_LOG_END, formatReference, inertMarkup, markerLines } from './research-md.js';

export { RESEARCH_LOG_END };

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export { RESEARCH_PER_QUERY_LIMIT, EVALUATOR_BATCH, evaluatorCallsFor };

/** Longest abstract excerpt sent to the evaluator, in characters. */
export const EVALUATOR_ABSTRACT_CHARS = 500;

/** Most authors sent to the evaluator per candidate. */
export const EVALUATOR_AUTHORS = 5;

// ---------------------------------------------------------------------------
// Adapter registry (+ the test seam)
// ---------------------------------------------------------------------------

/** The adapter shape the fan-out needs. */
export interface SearchableAdapter {
  search(query: string, opts?: SearchOptions): Promise<SourceCandidate[]>;
}

/** A registry of adapters by key (the `sources` registry, or a test's fakes). */
export type AdapterRegistry = Record<string, SearchableAdapter | { fetchById?: unknown }>;

let testRegistry: AdapterRegistry | null = null;

/**
 * Test seam (active only in a test context): the registry every research pass
 * uses until reset with null. Throws outside a test context.
 */
export function __setResearchRegistryForTest(registry: AdapterRegistry | null): void {
  if (registry !== null && !isTestContext()) {
    throw new Error('__setResearchRegistryForTest is available only under the test runner');
  }
  testRegistry = registry;
}

/** The registry a research pass searches: the test seam, the dry-run provider, or the real adapters. */
export function researchRegistry(): AdapterRegistry {
  if (testRegistry !== null && isTestContext()) return testRegistry;
  if (networkMode().dryRun) return { 'dry-run': dryRunProvider };
  return sources as AdapterRegistry;
}

function isSearchable(name: string, a: unknown): a is SearchableAdapter {
  // unpaywall.search is inert by design; retraction-watch is fetchById-only (D-15).
  return name !== 'unpaywall' && typeof a === 'object' && a !== null && typeof (a as { search?: unknown }).search === 'function';
}

/** The searchable keys of a registry, in registry order. */
export function searchableKeys(registry: AdapterRegistry): string[] {
  return Object.entries(registry).filter(([name, a]) => isSearchable(name, a)).map(([name]) => name);
}

/**
 * The adapter plan of a paper. `byPreference` (every real run): the resolved
 * preset's source preference (the brief's discipline, overridden by
 * `[project] discipline_preset`), the `[sources]` table and Zotero's
 * configuration decide which adapters of the registry are queried, in which
 * order (bin/lib/adapter-plan.ts). Otherwise (the --dry-run provider, an
 * explicitly injected registry) every searchable adapter of the registry is
 * queried in registry order.
 */
export function researchAdapterPlan(args: {
  registry: AdapterRegistry;
  byPreference: boolean;
  discipline: string;
  configDiscipline?: string | undefined;
  allowed?: readonly string[] | undefined;
  env?: Readonly<Record<string, string | undefined>>;
}): AdapterPlan {
  const available = searchableKeys(args.registry);
  if (!args.byPreference) {
    return { entries: available.map((id, rank) => ({ id, adapter: id, options: {}, rank })), skipped: [] };
  }
  const resolved = resolveDiscipline({ discipline: { intake: args.discipline, config: args.configDiscipline } });
  return planAdapters({
    preference: resolved.sourcePreference,
    allowed: args.allowed,
    zoteroConfigured: zoteroConfigured(args.env ?? process.env),
    available,
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** One adapter's outcome for one query. */
export interface QueryOutcome {
  readonly query: string;
  readonly adapter: string;
  readonly count: number;
  /** `ok` | `no results` | `offline: no recorded fixture` | `failed (<reason>)` */
  readonly status: string;
  /**
   * What the adapter answered without (Phase 20, D-20-16: `abstracts
   * unavailable (…)` when PubMed's efetch did not answer) — the search itself
   * succeeded; the note is shown on the adapter's status line.
   */
  readonly note?: string;
}

/** One adapter's outcome over every query (or a plan skip). */
export interface AdapterOutcome {
  readonly adapter: string;
  readonly count: number;
  readonly status: string;
}

/** A deduplicated candidate with the adapters that found it. */
export interface DiscoveredCandidate {
  readonly candidate: SourceCandidate;
  /** Plan entry ids that returned this work. */
  readonly foundBy: readonly string[];
  /** The best (lowest) preference rank among them. */
  readonly rank: number;
}

export interface DiscoveryResult {
  readonly candidates: DiscoveredCandidate[];
  readonly adapters: AdapterOutcome[];
  readonly perQuery: QueryOutcome[];
  /** Candidates found before deduplication. */
  readonly found: number;
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.split(/\r?\n/)[0] ?? '').slice(0, 200);
}

/**
 * An evaluator batch's failure, as research reports it. The provider errors
 * end with the advice for a verb that writes the model's output ("nothing was
 * written — re-run"); research keeps these candidates as "not evaluated"
 * (D-19-16) and does write them, so that clause is replaced by what happens.
 */
function evaluatorFailure(err: unknown): string {
  const line = firstLine(err).replace(/[;,]?\s*(?:the truncated reply was discarded and )?nothing was written(?:\s*—.*)?$/i, '');
  return `${line}; these candidates are kept unevaluated`;
}

/** True when a candidate carries any reserved dry-run identifier (RUN-27). */
function isReservedCandidate(c: SourceCandidate): boolean {
  return (
    c.synthetic === true ||
    c.source === 'dry-run' ||
    isReservedDryRunId(c.doi) ||
    isReservedDryRunId(c.id) ||
    isReservedDryRunId(c.arxiv) ||
    isReservedDryRunId(c.isbn)
  );
}

interface Found {
  candidate: SourceCandidate;
  foundBy: string[];
  rank: number;
}

/**
 * Merge `b` into the kept record `a`: the adapters and best rank; the record
 * with an abstract wins — except that, for two records of ONE DOI (`sameDoi`),
 * a registrar's record beats an arXiv record (review round 1 of the Phase
 * 18/19 merge): arXiv lists the journal's DOI (arxiv:doi) on the preprint's
 * title and authors, so keeping the arXiv record would pair the version of
 * record's DOI with the preprint's metadata and Pass 1 would compare the two
 * (MIS-CITED whenever the title or author order changed on publication). The
 * registrar's record keeps its metadata and takes the preprint's arXiv id (and
 * its abstract when it has none).
 */
function mergeFound(a: Found, b: Found, sameDoi = false): Found {
  const foundBy = [...a.foundBy, ...b.foundBy.filter((x) => !a.foundBy.includes(x))];
  const rank = Math.min(a.rank, b.rank);
  const aArxiv = a.candidate.source === 'arxiv';
  if (sameDoi && aArxiv !== (b.candidate.source === 'arxiv')) {
    const record = aArxiv ? b.candidate : a.candidate;
    const preprint = aArxiv ? a.candidate : b.candidate;
    const arxiv = record.arxiv ?? preprint.arxiv;
    const candidate: SourceCandidate = {
      ...record,
      ...(arxiv !== undefined ? { arxiv } : {}),
      ...(!record.abstract && preprint.abstract ? { abstract: preprint.abstract } : {}),
    };
    return { candidate, foundBy, rank };
  }
  const candidate = !a.candidate.abstract && b.candidate.abstract ? b.candidate : a.candidate;
  return { candidate, foundBy, rank };
}

/**
 * DOI-first dedup (first wins, the record with an abstract preferred) — the
 * versioned DOIs of one posted work (`<base>.vN`) count as one DOI (review
 * round 2) — then title Jaro-Winkler.
 */
function dedup(raw: Found[]): Found[] {
  const byDoi = new Map<string, Found>();
  const order: Array<{ doi: string } | { item: Found }> = [];
  for (const f of raw) {
    const norm = f.candidate.doi ? normalizeDoi(f.candidate.doi) : null;
    const key = norm ? doiVersionBase(norm) ?? norm : null;
    if (key) {
      const prev = byDoi.get(key);
      if (prev) byDoi.set(key, mergeFound(prev, f, true));
      else {
        byDoi.set(key, f);
        order.push({ doi: key });
      }
      continue;
    }
    order.push({ item: f });
  }
  const out: Found[] = [];
  for (const o of order) {
    if ('doi' in o) {
      out.push(byDoi.get(o.doi) as Found);
      continue;
    }
    const f = o.item;
    const title = f.candidate.title.trim();
    // WR-02: an empty title never matches (jaroWinkler("","") === 1).
    const at = title ? out.findIndex((x) => x.candidate.title.trim() !== '' && jaroWinkler(title, x.candidate.title) >= TITLE_JW_THRESHOLD) : -1;
    if (at >= 0) out[at] = mergeFound(out[at] as Found, f);
    else out.push(f);
  }
  return out;
}

function aggregateStatus(rows: readonly QueryOutcome[], total: number): string {
  const n = rows.length;
  const failed = rows.filter((r) => r.status.startsWith('failed ('));
  const offline = rows.filter((r) => r.status.endsWith('no recorded fixture'));
  if (n > 0 && failed.length === n) {
    const reasons = [...new Set(failed.map((r) => r.status))];
    return reasons.length === 1 ? (reasons[0] as string) : `${reasons[0] as string} (and ${reasons.length - 1} other reason(s))`;
  }
  if (n > 0 && offline.length === n) return (offline[0] as QueryOutcome).status;
  const parts: string[] = [total > 0 ? 'ok' : 'no results'];
  if (failed.length > 0) parts.push(`${failed[0]?.status ?? 'failed'} for ${failed.length} of ${n} queries`);
  if (offline.length > 0) parts.push(`no recorded fixture for ${offline.length} of ${n} queries`);
  // D-20-16: what the adapter answered without (e.g. PubMed abstracts).
  const noted = rows.filter((r) => r.note !== undefined);
  if (noted.length > 0) parts.push(`${noted[0]?.note as string}${n > 1 ? ` for ${noted.length} of ${n} queries` : ''}`);
  return parts.join('; ');
}

/**
 * Whose search a discovery WARN line names, and where its adapter outcomes
 * are shown: `pensmith research` writes them to RESEARCH.md's run log;
 * `plan N --research` never touches RESEARCH.md (GRND-17) and prints its
 * adapter table instead.
 */
export interface ResearchWarnContext {
  readonly label: string;
  readonly see: string;
}

const RESEARCH_WARN_CONTEXT: ResearchWarnContext = { label: 'pensmith research', see: 'RESEARCH.md' };

/**
 * Run every query against every plan entry (adapters in parallel per query).
 * Never throws for an adapter failure: it becomes that adapter's status.
 */
export async function discoverCandidates(args: {
  queries: readonly string[];
  plan: AdapterPlan;
  registry: AdapterRegistry;
  fromYear?: number | undefined;
  /** Stderr sink for the per-adapter WARN lines (default process.stderr). */
  warn?: (line: string) => void;
  /** Who is searching and where its adapter outcomes are shown (see ResearchWarnContext). */
  context?: ResearchWarnContext;
}): Promise<DiscoveryResult> {
  const warn = args.warn ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const { label, see } = args.context ?? RESEARCH_WARN_CONTEXT;
  const mode = networkMode();
  const raw: Found[] = [];
  const perQuery: QueryOutcome[] = [];
  let found = 0;

  for (const query of args.queries) {
    const settled = await Promise.all(
      args.plan.entries.map(async (entry) => {
        const adapter = args.registry[entry.adapter];
        if (!isSearchable(entry.adapter, adapter)) {
          return { entry, results: [] as SourceCandidate[], status: 'skipped (no adapter)' };
        }
        let failure: string | null = null;
        let note: string | null = null;
        try {
          const opts: SearchOptions = {
            limit: RESEARCH_PER_QUERY_LIMIT,
            onFailure: (reason) => {
              failure ??= reason;
            },
            onWarning: (n) => {
              note ??= n;
            },
            ...(args.fromYear !== undefined ? { fromYear: args.fromYear } : {}),
            ...(entry.options.doiPrefix !== undefined ? { doiPrefix: entry.options.doiPrefix } : {}),
          };
          const results = await adapter.search(query, opts);
          if (failure !== null && results.length === 0) return { entry, results, status: `failed (${failure})` };
          return { entry, results, status: 'ok', ...(note !== null ? { note: note as string } : {}) };
        } catch (err) {
          if (isOfflineEgressError(err)) {
            // RUN-03: an offline miss is a distinct "no recorded fixture" result.
            return { entry, results: [] as SourceCandidate[], status: `${offlineLabel(err)}: no recorded fixture` };
          }
          return { entry, results: [] as SourceCandidate[], status: `failed (${firstLine(err)})` };
        }
      }),
    );
    let queryCount = 0;
    let offlineMisses = 0;
    for (const settledOne of settled) {
      const { entry, results, status } = settledOne;
      const note = 'note' in settledOne ? settledOne.note : undefined;
      if (status.endsWith('no recorded fixture')) offlineMisses += 1;
      let kept = 0;
      for (const item of results) {
        // T-11-10: every adapter result is validated.
        const parsed = SourceCandidateSchema.safeParse(item);
        if (!parsed.success) {
          warn(
            `${label}: WARN — adapter "${entry.id}" returned a candidate that failed SourceCandidateSchema ` +
              `validation (dropped, T-11-10): ${parsed.error.message.slice(0, 120)}`,
          );
          continue;
        }
        // RUN-27: outside --dry-run a reserved dry-run identifier never enters the library.
        if (!mode.dryRun && isReservedCandidate(parsed.data)) {
          warn(
            `${label}: WARN — dropped a reserved dry-run identifier from "${entry.id}" ` +
              `(${parsed.data.doi ?? parsed.data.id}); synthetic sources exist only under --dry-run.`,
          );
          continue;
        }
        raw.push({ candidate: parsed.data, foundBy: [entry.id], rank: entry.rank });
        kept += 1;
      }
      found += kept;
      queryCount += kept;
      perQuery.push({
        query,
        adapter: entry.id,
        count: kept,
        status: status === 'ok' && kept === 0 ? 'no results' : status,
        ...(note !== undefined && kept > 0 ? { note } : {}),
      });
    }
    if (mode.sourcesOffline && !mode.dryRun && queryCount === 0 && offlineMisses > 0) {
      warn(`offline: no recorded results for this query ("${query}")`);
    }
  }

  const adapters: AdapterOutcome[] = args.plan.entries.map((entry) => {
    const rows = perQuery.filter((r) => r.adapter === entry.id);
    const count = rows.reduce((a, r) => a + r.count, 0);
    return { adapter: entry.id, count, status: aggregateStatus(rows, count) };
  });
  // D-17-10: one stderr line per failed adapter (all queries).
  for (const entry of args.plan.entries) {
    const rows = perQuery.filter((r) => r.adapter === entry.id && r.status.startsWith('failed ('));
    if (rows.length === 0) continue;
    const reason = (rows[0] as QueryOutcome).status.slice('failed ('.length, -1);
    const n = args.queries.length;
    warn(
      `${label}: WARN — ${entry.id} failed (${reason}) for ${rows.length} of ${n} ` +
        `quer${n === 1 ? 'y' : 'ies'}; its results are missing from this run (see ${see})`,
    );
  }
  for (const s of args.plan.skipped) adapters.push({ adapter: s.id, count: 0, status: s.status });

  const deduped = dedup(raw);
  // Audit #21/#31/#32: batch-unique citekeys BEFORE the evaluator, the gate and
  // the library write — every consumer filters on the citekey.
  const keyed = assignUniqueCitekeys(deduped.map((f) => f.candidate));
  const candidates = deduped.map((f, i) => ({ candidate: keyed[i] as SourceCandidate, foundBy: f.foundBy, rank: f.rank }));
  return { candidates, adapters, perQuery, found };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** One validated evaluator verdict (the SourceEvaluatorSchema element). */
export type SourceVerdict = SourceEvaluation['verdicts'][number];

export type EvaluationDecision = 'kept' | 'rejected' | 'not-evaluated';

/** A candidate with the evaluator's decision applied. */
export interface EvaluatedSource<T> {
  readonly candidate: T;
  readonly decision: EvaluationDecision;
  /** The final tier: the deterministic tier hint when there is one, else the evaluator's. */
  readonly tier: SourceTier | null;
  readonly relevance: number | null;
  /** The evaluator's reason (a kept source's why-relevant note); null when not evaluated. */
  readonly reason: string | null;
}

export interface AppliedEvaluations<T> {
  readonly kept: EvaluatedSource<T>[];
  readonly rejected: EvaluatedSource<T>[];
  /** Kept too (never silently dropped), with a disclosure: no verdict came back for them. */
  readonly notEvaluated: EvaluatedSource<T>[];
  /** Verdict citekeys that name no candidate (ignored). */
  readonly unknownVerdicts: string[];
}

/**
 * Apply evaluator verdicts to candidates (pure; Tier 1's
 * paper_submit_source_evaluations applies the same function, PLUG-07). The
 * first verdict per citekey counts; a candidate without a verdict is
 * `not evaluated`; the tier hint (the deterministic tier) wins over the
 * verdict's tier. Input order is preserved within each list.
 */
export function applySourceEvaluations<T extends { citekey: string }>(
  candidates: readonly T[],
  verdicts: readonly SourceVerdict[],
  tierHints: ReadonlyMap<string, SourceTier | null>,
): AppliedEvaluations<T> {
  const byKey = new Map<string, SourceVerdict>();
  const known = new Set(candidates.map((c) => c.citekey));
  const unknownVerdicts: string[] = [];
  for (const v of verdicts) {
    if (!known.has(v.citekey)) {
      if (!unknownVerdicts.includes(v.citekey)) unknownVerdicts.push(v.citekey);
      continue;
    }
    if (!byKey.has(v.citekey)) byKey.set(v.citekey, v);
  }
  const kept: EvaluatedSource<T>[] = [];
  const rejected: EvaluatedSource<T>[] = [];
  const notEvaluated: EvaluatedSource<T>[] = [];
  for (const c of candidates) {
    const hint = tierHints.get(c.citekey) ?? null;
    const v = byKey.get(c.citekey);
    if (!v) {
      notEvaluated.push({ candidate: c, decision: 'not-evaluated', tier: hint, relevance: null, reason: null });
      continue;
    }
    const e: EvaluatedSource<T> = {
      candidate: c,
      decision: v.keep ? 'kept' : 'rejected',
      tier: hint ?? v.tier,
      relevance: v.relevance,
      reason: v.reason.trim() || null,
    };
    (v.keep ? kept : rejected).push(e);
  }
  return { kept, rejected, notEvaluated, unknownVerdicts };
}

/** Truncate to at most `max` characters, never inside a surrogate pair. */
function codePointSlice(text: string, max: number): string {
  const cps = Array.from(text);
  return cps.length <= max ? text : cps.slice(0, max).join('');
}

/** The evaluator payload of one candidate, field by field in a fixed order (deterministic bytes). */
export function evaluatorPayload(c: SourceCandidate, view: LibraryEntry, tierHint: SourceTier | null): PromptJson {
  return {
    citekey: c.citekey,
    title: c.title,
    authors: c.authors.slice(0, EVALUATOR_AUTHORS),
    year: c.year ?? null,
    venue: view.venue ?? null,
    type: view.type ?? null,
    doi: view.doi ?? null,
    tier_hint: tierHint,
    abstract: c.abstract ? codePointSlice(c.abstract.replace(/\s+/g, ' ').trim(), EVALUATOR_ABSTRACT_CHARS) : null,
  };
}

export interface EvaluatorRun {
  readonly verdicts: SourceVerdict[];
  /** Calls made (one per batch). */
  readonly calls: number;
  /** One line per failed batch: `<n> candidate(s): <reason>`. */
  readonly failures: string[];
}

/**
 * Run the source-evaluator over `items` in batches of EVALUATOR_BATCH. A
 * batch whose call fails (after the corrective retry) yields no verdicts —
 * its candidates become `not evaluated` — and a failure line; the session cost
 * cap, a missing key, invalid configuration and a replay miss propagate
 * (isFatalLlmError).
 */
export async function runSourceEvaluator(
  items: ReadonlyArray<{ candidate: SourceCandidate; view: LibraryEntry; tierHint: SourceTier | null }>,
  ctx: { topic: string; discipline: string; scope: string },
): Promise<EvaluatorRun> {
  const verdicts: SourceVerdict[] = [];
  const failures: string[] = [];
  let calls = 0;
  for (let i = 0; i < items.length; i += EVALUATOR_BATCH) {
    const batch = items.slice(i, i + EVALUATOR_BATCH);
    const req = buildPromptRequest('source-evaluator', {
      topic: ctx.topic,
      discipline: ctx.discipline,
      scope: ctx.scope,
      candidates: batch.map((b) => evaluatorPayload(b.candidate, b.view, b.tierHint)),
    });
    calls += 1;
    try {
      const result = await complete<SourceEvaluation>({
        slug: 'source-evaluator',
        system: req.system,
        messages: req.messages,
        stubHint: requestHints(req),
      });
      verdicts.push(...(result.data as SourceEvaluation).verdicts);
    } catch (err) {
      if (isFatalLlmError(err)) throw err;
      failures.push(`${batch.length} candidate(s): ${evaluatorFailure(err)}`);
    }
  }
  return { verdicts, calls, failures };
}

// ---------------------------------------------------------------------------
// The research pass
// ---------------------------------------------------------------------------

export type ResearchDecision = EvaluationDecision | 'excluded';

/** One candidate of a research pass, with everything the verbs show and persist. */
export interface ResearchItem {
  readonly candidate: SourceCandidate;
  /** The candidate as a LIBRARY entry (normalized identifiers, venue, type) — display and payload. */
  readonly view: LibraryEntry;
  readonly foundBy: readonly string[];
  readonly rank: number;
  readonly tierHint: SourceTier | null;
  readonly tier: SourceTier | null;
  readonly relevance: number | null;
  readonly reason: string | null;
  readonly decision: ResearchDecision;
  /** Set when the `[sources]` policy excluded it. */
  readonly exclusion?: PolicyExclusion;
}

/**
 * The evaluator's judgement of one of the user's own library entries
 * (bring-your-own, Zotero): it annotates the entry — tier, relevance, the
 * why-relevant note — and never removes it (19-PLAN §7.2, SRC-15).
 */
export interface OwnEvaluation {
  readonly entry: LibraryEntry;
  readonly decision: EvaluationDecision;
  readonly tier: SourceTier | null;
  readonly relevance: number | null;
  readonly reason: string | null;
}

/** The provenance prefixes of the user's own sources. */
const OWN_PREFIXES = new Set(['byo', 'zotero']);

/** An entry's first own-source provenance (`byo:arxiv` → {prefix: byo, source: arxiv}), or null. */
export function ownProvenance(entry: Pick<LibraryEntry, 'provenance'>): { prefix: string; source: string | null } | null {
  for (const p of entry.provenance) {
    const [prefix = p, source] = p.split(':');
    if (OWN_PREFIXES.has(prefix)) return { prefix, source: source ?? null };
  }
  return null;
}

/**
 * The user's own library entries research asks the evaluator about: tagged
 * bring-your-own or zotero, not evaluated yet, and carrying a registrar
 * identifier — so the library writer merges the annotation into that very
 * entry. A local-only (unhydrated) PDF has no identifier and stays as it is.
 */
export function ownSourcesToEvaluate(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries.filter(
    (e) => ownProvenance(e) !== null && e.relevance === null && !e.synthetic && [e.doi, e.arxiv, e.pmid, e.pmcid, e.isbn].some((x) => x !== null),
  );
}

/** A library entry as the evaluator's candidate (its payload fields and its citekey). */
function entryAsCandidate(e: LibraryEntry): SourceCandidate {
  const own = ownProvenance(e);
  return {
    source: own?.prefix === 'zotero' ? 'zotero' : 'byo',
    id: e.doi ?? e.arxiv ?? e.pmid ?? e.isbn ?? e.citekey,
    ...(e.doi !== null ? { doi: e.doi } : {}),
    ...(e.arxiv !== null ? { arxiv: e.arxiv } : {}),
    ...(e.isbn !== null ? { isbn: e.isbn } : {}),
    title: e.title ?? '',
    authors: [...e.authors],
    ...(e.year !== null ? { year: e.year } : {}),
    ...(e.abstract !== null ? { abstract: e.abstract } : {}),
    retracted: e.retracted,
    last_verified: e.last_verified,
    citekey: e.citekey,
    raw: {},
  } as SourceCandidate;
}

export interface ResearchPassResult {
  readonly adapters: AdapterOutcome[];
  readonly perQuery: QueryOutcome[];
  /** Candidates found (before dedup). */
  readonly found: number;
  /** Distinct works after dedup. */
  readonly distinct: number;
  /** Kept by the evaluator or not evaluated, ranked (relevance, then preference). */
  readonly kept: ResearchItem[];
  readonly rejected: ResearchItem[];
  readonly excluded: ResearchItem[];
  readonly notEvaluated: number;
  readonly evaluator: { readonly calls: number; readonly failures: string[]; readonly unknownVerdicts: string[] };
  /** The evaluator's annotations of the user's own entries (never kept / rejected / excluded here). */
  readonly own: OwnEvaluation[];
}

/** Relevance (highest first; unscored after scored), then preference rank, then discovery order. */
export function rankItems<T extends { relevance: number | null; rank: number }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ra = a.item.relevance ?? -1;
      const rb = b.item.relevance ?? -1;
      if (ra !== rb) return rb - ra;
      if (a.item.rank !== b.item.rank) return a.item.rank - b.item.rank;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/** The policy's view of a candidate (identifiers normalized by the library shape). */
function policyInputOf(b: { candidate: SourceCandidate; view: LibraryEntry }): PolicyInput {
  return {
    source: b.candidate.source,
    id: b.candidate.id,
    year: b.view.year,
    type: b.view.type,
    doi: b.view.doi,
    isbn: b.view.isbn,
    arxiv: b.view.arxiv,
    pmid: b.view.pmid,
  };
}

/**
 * Discover, tier, filter, evaluate and rank. Writes nothing: the verbs gate,
 * cross-check retractions, write the library and the log.
 */
export async function runResearchPass(args: {
  queries: readonly string[];
  plan: AdapterPlan;
  registry: AdapterRegistry;
  policy: SourcePolicy;
  topic: string;
  discipline: string;
  /** The evaluator's `<scope>` block: the chosen scope (or the section query). */
  scope: string;
  warn?: (line: string) => void;
  /** Whose search the WARN lines name (default `pensmith research`, see RESEARCH.md). */
  context?: ResearchWarnContext;
  /**
   * The user's own library entries to annotate (ownSourcesToEvaluate): they
   * join the evaluator's batch after the discovered candidates, and their
   * verdicts come back in `own` — the policy and the prune never touch them.
   */
  own?: readonly LibraryEntry[];
}): Promise<ResearchPassResult> {
  const discovery = await discoverCandidates({
    queries: args.queries,
    plan: args.plan,
    registry: args.registry,
    fromYear: args.policy.minYear ?? undefined,
    ...(args.warn ? { warn: args.warn } : {}),
    ...(args.context ? { context: args.context } : {}),
  });
  const now = new Date().toISOString();
  const base = discovery.candidates.map((d) => {
    const view = candidateToEntry(d.candidate, [], now);
    const tierHint = deterministicTier({ ...d.candidate, venue: view.venue, type: view.type, doi: view.doi, arxiv: view.arxiv, isbn: view.isbn });
    return { ...d, view, tierHint };
  });

  // Policy before the evaluator: deterministic tiers only (an unknown tier waits).
  const excluded: ResearchItem[] = [];
  const pre: typeof base = [];
  for (const b of base) {
    const r = applySourcePolicy([policyInputOf(b)], () => b.tierHint, args.policy, { tierFinal: false });
    const ex = r.excluded[0];
    if (ex) {
      excluded.push({ ...b, tier: b.tierHint, relevance: null, reason: null, decision: 'excluded', exclusion: ex.exclusion });
    } else pre.push(b);
  }

  // The most preferred adapters' candidates go first (the first batch, when there are several).
  pre.sort((a, b) => a.rank - b.rank);

  // The user's own entries join the batch — except one a discovered candidate
  // already is (same citekey or identifier): that candidate's evaluation merges
  // into the entry through the library writer anyway.
  const taken = new Set(base.map((b) => b.candidate.citekey));
  const ids = new Set(base.flatMap((b) => [b.view.doi, b.view.arxiv, b.view.pmid, b.view.isbn].filter((x): x is string => x !== null)));
  const ownItems = (args.own ?? [])
    .filter((e) => !taken.has(e.citekey) && ![e.doi, e.arxiv, e.pmid, e.isbn].some((x) => x !== null && ids.has(x)))
    .map((e) => {
      const candidate = entryAsCandidate(e);
      const tierHint = deterministicTier({ ...candidate, venue: e.venue, type: e.type, doi: e.doi, arxiv: e.arxiv, isbn: e.isbn });
      return { entry: e, candidate, view: e, tierHint };
    });

  const toEvaluate = [...pre, ...ownItems];
  const run = toEvaluate.length > 0 ? await runSourceEvaluator(toEvaluate, { topic: args.topic, discipline: args.discipline, scope: args.scope }) : { verdicts: [], calls: 0, failures: [] };
  const hints = new Map(pre.map((b) => [b.candidate.citekey, b.tierHint] as const));
  const ownHints = new Map(ownItems.map((o) => [o.candidate.citekey, o.tierHint] as const));
  const ownApplied = applySourceEvaluations(ownItems.map((o) => o.candidate), run.verdicts, ownHints);
  const ownByKey = new Map(ownItems.map((o) => [o.candidate.citekey, o.entry] as const));
  const own: OwnEvaluation[] = [...ownApplied.kept, ...ownApplied.rejected].map((e) => ({
    entry: ownByKey.get(e.candidate.citekey) as LibraryEntry,
    decision: e.decision,
    tier: e.tier,
    relevance: e.relevance,
    reason: e.reason,
  }));
  const applied = applySourceEvaluations(pre.map((b) => b.candidate), run.verdicts.filter((v) => !ownByKey.has(v.citekey)), hints);
  const byKey = new Map(pre.map((b) => [b.candidate.citekey, b] as const));
  const toItem = (e: EvaluatedSource<SourceCandidate>): ResearchItem => {
    const b = byKey.get(e.candidate.citekey) as (typeof base)[number];
    return { ...b, tier: e.tier, relevance: e.relevance, reason: e.reason, decision: e.decision };
  };

  // Policy again with the final tier (the evaluator decided the tiers the metadata did not).
  const kept: ResearchItem[] = [];
  const rejected: ResearchItem[] = [];
  for (const e of [...applied.kept, ...applied.notEvaluated, ...applied.rejected].map(toItem)) {
    const ex = applySourcePolicy([policyInputOf(e)], () => e.tier, args.policy, { tierFinal: true }).excluded[0];
    if (ex) excluded.push({ ...e, decision: 'excluded', exclusion: ex.exclusion });
    else if (e.decision === 'rejected') rejected.push(e);
    else kept.push(e);
  }
  return {
    adapters: discovery.adapters,
    perQuery: discovery.perQuery,
    found: discovery.found,
    distinct: discovery.candidates.length,
    kept: await confirmKept(rankItems(kept), args.registry, now),
    rejected: rankItems(rejected),
    excluded,
    notEvaluated: kept.filter((k) => k.decision === 'not-evaluated').length,
    evaluator: { calls: run.calls, failures: run.failures, unknownVerdicts: applied.unknownVerdicts },
    own,
  };
}

/**
 * The kept candidates an aggregator found, confirmed at Crossref (Phase 20,
 * VRFY-13; sources/registrar-confirm.ts): a record that pairs the journal
 * DOI with another version's year gets the DOI's own fields, so what research
 * writes is what verify finds. Only with a registry whose `crossref` adapter
 * can look a DOI up (never the --dry-run provider or a test's fakes without
 * one).
 */
async function confirmKept(items: ResearchItem[], registry: AdapterRegistry, now: string): Promise<ResearchItem[]> {
  const crossref = registry['crossref'] as { lookupById?: unknown } | undefined;
  if (crossref === undefined || typeof crossref.lookupById !== 'function') return items;
  const lookupById = crossref.lookupById as CrossrefLookup;
  const { candidates } = await confirmRegistrarRecords(items.map((i) => i.candidate), (doi) => lookupById(doi));
  return items.map((item, i) => {
    const c = candidates[i] ?? item.candidate;
    return c === item.candidate ? item : { ...item, candidate: c, view: candidateToEntry(c, [], now) };
  });
}

// ---------------------------------------------------------------------------
// Presentation: the per-adapter table, the tier summary, the research log
// ---------------------------------------------------------------------------

/** The stdout per-adapter table (PRD §7.2, SRC-07): `  <adapter>  <count>  <status>`. */
export function renderAdapterTable(adapters: readonly AdapterOutcome[]): string[] {
  const w = Math.max(8, ...adapters.map((a) => a.adapter.length));
  const cw = Math.max(1, ...adapters.map((a) => String(a.count).length));
  return adapters.map((a) => `  ${a.adapter.padEnd(w)}  ${String(a.count).padStart(cw)}  ${a.status}`);
}

/** `38 kept (peer-reviewed 21, preprint 12, book 3, other 2)`. */
export function tierSummary(items: readonly { tier: SourceTier | null }[]): string {
  const order: Array<SourceTier | null> = ['peer-reviewed', 'preprint', 'book', 'gov-report', 'other', null];
  const parts: string[] = [];
  for (const t of order) {
    const n = items.filter((i) => i.tier === t).length;
    if (n > 0) parts.push(`${t ?? 'tier unknown'} ${n}`);
  }
  return `${items.length} kept${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

/** How one upsert's outcomes split, for the count lines research prints. */
export interface UpsertCounts {
  /** Citekeys of the works new to LIBRARY.json. */
  readonly added: string[];
  /** Distinct citekeys of works LIBRARY.json already held before this write. */
  readonly known: string[];
  /**
   * Candidates that collapsed into another candidate of the same write (the
   * same work found twice, a preprint and its version of record), or hit a
   * known work a second time — neither new nor a separate library entry.
   */
  readonly duplicates: number;
}

/**
 * Split upsertSources outcomes into new works, works the library already had
 * and within-write duplicates. A non-`added` outcome whose citekey was added
 * by this same write matched a sibling candidate, not the prior library, so it
 * is a duplicate — counting it as "already in library" would claim a fresh
 * library held sources it never had.
 */
export function upsertCounts(outcomes: readonly { citekey: string; status: string }[]): UpsertCounts {
  const added = [...new Set(outcomes.filter((o) => o.status === 'added').map((o) => o.citekey))];
  const fresh = new Set(added);
  const known = [...new Set(outcomes.filter((o) => o.status !== 'added' && !fresh.has(o.citekey)).map((o) => o.citekey))];
  return { added, known, duplicates: outcomes.length - added.length - known.length };
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** An excluded or rejected candidate, as a RESEARCH.md list item. */
export interface LogExclusion {
  readonly citekey: string;
  readonly reference: string;
  /** `policy: <rule reason>`, `evaluator: <reason>` or `deselected at the approval gate`. */
  readonly why: string;
}

/** A retraction line for RESEARCH.md. */
export interface LogRetraction {
  readonly citekey: string;
  readonly detail: string | null;
}

export interface ResearchLogInput {
  readonly scope: string;
  readonly topic: string;
  readonly discipline: string;
  readonly generated: string;
  readonly queries: readonly string[];
  /** A disclosure under the queries (the deterministic expansion, padding, clamping), or null. */
  readonly queryNote: string | null;
  readonly summary: string;
  /** Disclosure lines (not evaluated, evaluator failures). */
  readonly notes: readonly string[];
  readonly adapters: readonly AdapterOutcome[];
  readonly perQuery: readonly QueryOutcome[];
  readonly excluded: readonly LogExclusion[];
  readonly retracted: readonly LogRetraction[];
  readonly retractionUnknown: readonly LogRetraction[];
  /** The sources block (research-md.ts renderSourcesBlock of LIBRARY.json). */
  readonly sourcesBlock: string;
}

/**
 * The generated part of .paper/RESEARCH.md (19-PLAN §3.4): the offline marker
 * (when offline), the header, queries, per-adapter and per-query tables, the
 * exclusions and retractions, then the sources block. List items only — no
 * `### ` blocks — so the curated-claims parser never mistakes an entry for a
 * curated `supports:` note.
 */
export function renderResearchLog(input: ResearchLogInput): string {
  const lines: string[] = [];
  const marker = offlineMarkerLine();
  if (marker !== null) lines.push(marker, '');
  lines.push(
    '# Research log',
    '',
    `Scope: ${oneLine(input.scope)}`,
    `Topic: ${oneLine(input.topic) || '(unknown)'}`,
    `Discipline: ${input.discipline || '(unknown)'}`,
    `Generated: ${input.generated}`,
    `Result: ${oneLine(input.summary)}`,
    ...input.notes.map((n) => `Note: ${oneLine(n)}`),
    '',
    '## Queries',
    '',
    ...(input.queries.length > 0 ? input.queries.map((q, i) => `${i + 1}. ${q}`) : ['_(none)_']),
  );
  if (input.queryNote) lines.push('', `(${input.queryNote})`);
  lines.push(
    '',
    '## Adapters',
    '',
    '| Adapter | Results | Status |',
    '|---------|---------|--------|',
    ...(input.adapters.length > 0
      ? input.adapters.map((a) => `| ${a.adapter} | ${a.count} | ${cell(a.status)} |`)
      : ['| _(none)_ | 0 | no adapter ran |']),
    '',
    '## Per query',
    '',
    '| Query | Adapter | Results | Status |',
    '|-------|---------|---------|--------|',
    ...(input.perQuery.length > 0
      ? input.perQuery.map((r) => `| ${cell(r.query)} | ${r.adapter} | ${r.count} | ${cell(r.status)} |`)
      : ['| _(none)_ | — | 0 | no adapter ran |']),
    '',
    `## Excluded (${input.excluded.length})`,
    '',
    ...(input.excluded.length > 0
      ? input.excluded.map((x) => `- [@${x.citekey}] ${oneLine(x.reference)} — ${oneLine(x.why)}`)
      : ['_None._']),
  );
  if (input.retracted.length > 0 || input.retractionUnknown.length > 0) {
    lines.push('', '## Retractions', '');
    for (const r of input.retracted) lines.push(`- RETRACTED: [@${r.citekey}]${r.detail ? ` — ${oneLine(r.detail)}` : ''} (fails Pass 1 if cited)`);
    for (const r of input.retractionUnknown) {
      lines.push(`- retraction status unknown: [@${r.citekey}]${r.detail ? ` — ${oneLine(r.detail)}` : ''} (re-checked at verify time)`);
    }
  }
  // Every value above comes from registrars, the model or the user's sources:
  // a marker comment inside one must never read as a marker (research-md.ts).
  return [...lines.map(inertMarkup), '', input.sourcesBlock, ''].join('\n');
}

/**
 * The new RESEARCH.md: the freshly rendered log, the end line, then whatever an
 * existing file kept below its end line — or, for a file without one (notes
 * written before any research log existed), the whole existing file.
 */
export function mergeResearchLog(log: string, existing: string | null): string {
  let kept = '';
  if (existing !== null) {
    const at = markerLines(existing, RESEARCH_LOG_END)[0] ?? -1;
    kept = at >= 0 ? existing.slice(at + RESEARCH_LOG_END.length) : existing;
    kept = kept.replace(/^(?:\r?\n)+/, '');
  }
  const head = `${log.replace(/\s+$/, '')}\n\n${RESEARCH_LOG_END}\n`;
  return kept.trim().length > 0 ? `${head}\n${kept}` : head;
}

/** `<root>/.paper/RESEARCH.md`. */
export function researchMdPath(root: string): string {
  return path.join(paperDir(root), 'RESEARCH.md');
}

/** Write the research log (under the RESEARCH.md lock), keeping everything below the end line. */
export async function writeResearchLog(root: string, log: string): Promise<string> {
  const file = researchMdPath(root);
  await withLock(file, async () => {
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
    await atomicWriteFile(file, mergeResearchLog(log, existing));
  });
  return file;
}

/** The exclusion list items of a pass (policy first, then the evaluator's rejections). */
export function logExclusions(excluded: readonly ResearchItem[], rejected: readonly ResearchItem[]): LogExclusion[] {
  return [
    ...excluded.map((x) => ({ citekey: x.candidate.citekey, reference: formatReference(x.view), why: `policy: ${x.exclusion?.reason ?? 'excluded'}` })),
    ...rejected.map((x) => ({ citekey: x.candidate.citekey, reference: formatReference(x.view), why: `evaluator: ${x.reason ?? 'rejected'}` })),
  ];
}

/** The evaluator disclosure lines of a pass (not evaluated, failed calls, unknown citekeys). */
export function evaluatorNotes(pass: ResearchPassResult): string[] {
  const notes: string[] = [];
  if (pass.notEvaluated > 0) {
    notes.push(
      `${pass.notEvaluated} source(s) were not evaluated (no evaluator verdict came back for them); ` +
        'they are kept, marked "not evaluated" — review them before citing',
    );
  }
  for (const f of pass.evaluator.failures) notes.push(`the source evaluator failed for ${f}`);
  if (pass.evaluator.unknownVerdicts.length > 0) {
    notes.push(`the source evaluator returned verdicts for unknown citekeys (ignored): ${pass.evaluator.unknownVerdicts.slice(0, 5).join(', ')}`);
  }
  return notes;
}
