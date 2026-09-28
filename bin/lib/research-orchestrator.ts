// bin/lib/research-orchestrator.ts — GEN-03 live-adapter discovery orchestrator.
//
// Fans out the searchable adapters (crossref, openalex, arxiv, pubmed,
// semanticscholar, zotero-mcp — NOT retraction-watch, NOT unpaywall.search),
// aggregates SourceCandidate[], applies DOI + Jaro-Winkler title dedup,
// then calls the source-evaluator LLM step to tier the results.
//
// Load-bearing constraints enforced here:
//   - 'search' in adapter guard: retraction-watch (fetchById-only) is excluded.
//   - unpaywall excluded by name: its search() always returns [] by design.
//   - per-query cap 10 (Pitfall 6 budget; T-12-03).
//   - Per-adapter search() failure → swallowed WARN (ARCH-03).
//   - DOI dedup: normalizeDoi() map, first-wins (prefer abstract).
//   - Title dedup: jaroWinkler >= TITLE_JW_THRESHOLD for no-DOI candidates.
//   - source-evaluator parse failure → keep ALL deduped candidates + WARN (T-11-10).
//   - SourceCandidateSchema.safeParse per adapter result element (T-11-10).
//   - Injectable adapter-registry seam for offline tests.
//   - Does NOT call crossCheckRetractions, writeBibtex, writeRis — research.ts owns.
//
// Network modes (RUN-01..RUN-04, RUN-27, D-17-10, D-17-11):
//   - --dry-run: ONLY the labelled synthetic dry-run provider is searched
//     (bin/lib/sources/dry-run.ts) — zero sockets, deterministic sources, all
//     flagged synthetic.
//   - sources offline (PENSMITH_OFFLINE=1 / test runner): adapters replay exact
//     recorded fixtures; a miss is a typed OfflineEgressError, counted per
//     adapter, and a query with no recorded results prints
//     "offline: no recorded results for this query" and yields 0 candidates.
//   - outside --dry-run, reserved dry-run identifiers are filtered out.
//   - Every research run writes .paper/RESEARCH.md: the offline marker (when
//     offline), the scope, the queries, per-adapter counts and failures, and the
//     candidates discovered. The generated log is the top block of the file and
//     ends at RESEARCH_LOG_END; anything below that line (e.g. findings appended
//     by `revise --research`, or other curated notes) is kept verbatim
//     when a later run rewrites the log — a re-run never destroys notes.
//
// Threat mitigations:
//   T-12-01: defensive Zod safeParse on all LLM JSON outputs.
//   T-12-02: candidates serialized as JSON (structured) in ONE fenced data block
//            of the evaluator request, sent once (FEED-05, SWP-61).
//   T-12-03: per-query limit cap = 10; dedup BEFORE evaluator.
//   T-12-04: 'search' in adapter guard (retraction-watch excluded).
//   T-12-05: no new fetch surface — all network via existing adapter modules.
//   T-12-06: complete() owns no-leak header path.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { sources } from './sources/index.js';
import * as dryRunProvider from './sources/dry-run.js';
import type { SearchOptions } from './sources/search-failure.js';
import { SourceCandidateSchema, type SourceCandidate } from './schemas/source-candidate.js';
import { normalizeDoi, isReservedDryRunId } from './doi.js';
import { isOfflineEgressError, offlineLabel } from './http.js';
import { networkMode, offlineMarkerLine } from './http-mock.js';
import { atomicWriteFile } from './atomic-write.js';
import { paperDir } from './paths.js';
import { jaroWinkler, TITLE_JW_THRESHOLD } from './fuzzy.js';
import { assignUniqueCitekeys } from './bibtex-write.js';
import { complete, isFatalLlmError } from './anthropic.js';
import type { SourceEvaluation } from './llm-contracts.js';
import { buildPromptRequest, requestHints, type PromptJson } from './prompt-request.js';

// ---------------------------------------------------------------------------
// Injectable adapter registry seam (mirrors zotero-mcp.ts setZoteroClientForTest).
// Tests inject a fake registry via the optional parameter — production uses the
// real `sources` registry from sources/index.ts.
// ---------------------------------------------------------------------------

/**
 * Minimal adapter shape required by the orchestrator fan-out. Adapters that
 * expose `search` are included in the fan-out; others are excluded.
 */
export interface SearchableAdapter {
  search(query: string, opts?: SearchOptions): Promise<SourceCandidate[]>;
}

/** Registry type accepted by runResearchOrchestrator for DI. */
export type AdapterRegistry = Record<string, SearchableAdapter | { fetchById?: unknown }>;

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

/**
 * DOI-first dedup: first-wins, prefer the record with an abstract.
 * Returns a new array; does not mutate input.
 */
function dedupCandidates(raw: SourceCandidate[]): SourceCandidate[] {
  // Phase 1: DOI dedup
  const doiMap = new Map<string, SourceCandidate>();
  const noDoi: SourceCandidate[] = [];

  for (const c of raw) {
    if (c.doi) {
      const key = normalizeDoi(c.doi);
      if (key) {
        const existing = doiMap.get(key);
        if (!existing) {
          doiMap.set(key, c);
        } else if (!existing.abstract && c.abstract) {
          // Prefer the record with an abstract (better metadata).
          doiMap.set(key, c);
        }
        // else: first-wins (existing stays).
        continue;
      }
    }
    noDoi.push(c);
  }

  // Phase 2: title dedup for no-DOI candidates using Jaro-Winkler.
  const titleDeduped: SourceCandidate[] = [];
  for (const c of noDoi) {
    let isDuplicate = false;

    // Check against DOI-deduped set first.
    for (const existing of doiMap.values()) {
      // WR-02: skip title comparison when either title is empty/whitespace.
      // jaroWinkler("","") === 1 >= threshold, which would falsely drop a second
      // empty-title candidate as a duplicate. DOI dedup still applies above.
      if (!c.title.trim() || !existing.title.trim()) continue;
      if (jaroWinkler(c.title, existing.title) >= TITLE_JW_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      // Check against already-accepted no-DOI candidates.
      for (const accepted of titleDeduped) {
        // WR-02: same empty-title guard as above.
        if (!c.title.trim() || !accepted.title.trim()) continue;
        if (jaroWinkler(c.title, accepted.title) >= TITLE_JW_THRESHOLD) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      titleDeduped.push(c);
    }
  }

  return [...doiMap.values(), ...titleDeduped];
}

// ---------------------------------------------------------------------------
// Source-evaluator LLM step
// ---------------------------------------------------------------------------

/** At most `max` UTF-16 units of `text`, never ending inside a surrogate pair. */
function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * One candidate as the evaluator's `candidates` block carries it (18-PLAN.md
 * §3.3): built field by field in a fixed order so identical candidates give
 * identical request bytes (replay hashes, prompt-cache keys); `null` where the
 * adapter reported nothing. The adapter's `raw` payload never reaches a model.
 */
function evaluatorCandidate(c: SourceCandidate): PromptJson {
  return {
    citekey: c.citekey,
    title: c.title,
    authors: c.authors.slice(0, 5),
    year: c.year ?? null,
    // The candidate schema carries no venue; an arXiv search result is an arXiv
    // preprint by construction (the template's preprint rule reads this).
    venue: c.source === 'arxiv' ? 'arXiv' : null,
    doi: c.doi ?? null,
    // WR-03: abstracts capped at 500 characters to bound the request.
    abstract: c.abstract ? truncateText(c.abstract, 500) : null,
  };
}

/**
 * Run the source-evaluator LLM step to tier the deduplicated candidates.
 *
 * source-evaluator is a STRUCTURED slug (RUN-25): complete() returns
 * {verdicts:[{citekey, keep, reason?}]} validated against the llm-contracts.ts
 * schema (the old bare-array reply is accepted by the tolerant parser). The
 * request is the fixed template as the system prompt (the cacheable prefix,
 * RUN-26) and one data message whose `candidates` block — fenced, sent once
 * (D-18-03/04, SWP-61) — follows the topic, discipline and scope. Under
 * PENSMITH_NO_LLM the stub keeps every candidate. An advisory failure
 * (provider error, refusal, truncation, a reply that never matched the
 * schema) keeps ALL deduped candidates with a WARN (T-11-10); the session cost
 * cap, a missing key and invalid configuration propagate (isFatalLlmError).
 */
async function evaluateCandidates(
  candidates: SourceCandidate[],
  opts: { topic: string; scope: string; discipline: string },
): Promise<SourceCandidate[]> {
  if (candidates.length === 0) return [];

  let verdicts: SourceEvaluation['verdicts'];
  try {
    const request = buildPromptRequest('source-evaluator', {
      topic: opts.topic,
      discipline: opts.discipline,
      scope: opts.scope,
      candidates: candidates.map(evaluatorCandidate),
    });
    const result = await complete<SourceEvaluation>({
      slug: 'source-evaluator',
      system: request.system,
      messages: request.messages,
      stubHint: requestHints(request),
    });
    verdicts = (result.data as SourceEvaluation).verdicts;
  } catch (err) {
    if (isFatalLlmError(err)) throw err;
    process.stderr.write(
      `pensmith research: WARN — source-evaluator step failed (${(err as Error).message}); ` +
      `keeping all ${candidates.length} deduped candidates (T-11-10 defensive fallback).\n`,
    );
    return candidates;
  }

  const keepSet = new Set(verdicts.filter((v) => v.keep).map((v) => v.citekey));

  // If the evaluator said keep nothing (edge case: hostile or confused response),
  // fall back to keeping all candidates.
  if (keepSet.size === 0) {
    process.stderr.write(
      `pensmith research: WARN — source-evaluator returned keep:false for all candidates; ` +
      `keeping all ${candidates.length} (defensive fallback to avoid empty result).\n`,
    );
    return candidates;
  }

  const filtered = candidates.filter((c) => keepSet.has(c.citekey));

  // If the evaluator filtered out ALL known citekeys (citekey mismatch), fall back.
  if (filtered.length === 0 && candidates.length > 0) {
    process.stderr.write(
      `pensmith research: WARN — source-evaluator citekey mismatch (no candidates match ` +
      `keep-set); keeping all ${candidates.length} (T-11-10 defensive fallback).\n`,
    );
    return candidates;
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Reserved-id filter + research log (RUN-27, D-17-10)
// ---------------------------------------------------------------------------

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

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.split(/\r?\n/)[0] ?? '').slice(0, 160);
}

/** One adapter's outcome for one query. */
interface AdapterLogRow {
  query: string;
  adapter: string;
  count: number;
  /** 'ok' | 'no results' | 'offline: no recorded fixture' | 'dry-run: no recorded fixture' | 'failed (<reason>)' */
  status: string;
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * The line that ends the generated research log in .paper/RESEARCH.md. Every
 * `pensmith research` run rewrites the text above it; the text below it is
 * never touched (D-17-10; `revise --research` appends, curated notes).
 */
export const RESEARCH_LOG_END =
  '<!-- end of the research log: `pensmith research` rewrites everything above this line; notes below it are kept -->';

/**
 * The new RESEARCH.md: the freshly rendered log, the end line, then whatever an
 * existing file kept below its end line — or, for a file without one (notes
 * written before any research log existed), the whole existing file.
 */
export function mergeResearchLog(log: string, existing: string | null): string {
  let kept = '';
  if (existing !== null) {
    const at = existing.indexOf(RESEARCH_LOG_END);
    kept = at >= 0 ? existing.slice(at + RESEARCH_LOG_END.length) : existing;
    kept = kept.replace(/^(?:\r?\n)+/, '');
  }
  const head = `${log.replace(/\s+$/, '')}\n\n${RESEARCH_LOG_END}\n`;
  return kept.trim().length > 0 ? `${head}\n${kept}` : head;
}

/**
 * Render .paper/RESEARCH.md (D-10): the offline marker first (when offline),
 * then the scope, the queries, per-adapter counts and failures, and the
 * candidates. List items only — no `### ` blocks, so the curated-claims
 * parser never mistakes a candidate for a curated `supports:` entry.
 */
export function renderResearchLog(input: {
  scope: string;
  topic: string;
  discipline: string;
  queries: readonly string[];
  log: readonly AdapterLogRow[];
  candidates: readonly SourceCandidate[];
}): string {
  const marker = offlineMarkerLine();
  const lines: string[] = [];
  if (marker !== null) lines.push(marker, '');
  lines.push(
    '# Research log',
    '',
    `Scope: ${input.scope}`,
    `Topic: ${input.topic || '(unknown)'}`,
    `Discipline: ${input.discipline || '(unknown)'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Queries',
    '',
    ...(input.queries.length > 0 ? input.queries.map((q, i) => `${i + 1}. ${q}`) : ['_(none)_']),
    '',
    '## Adapters',
    '',
    '| Query | Adapter | Results | Status |',
    '|-------|---------|---------|--------|',
    ...(input.log.length > 0
      ? input.log.map((r) => `| ${cell(r.query)} | ${r.adapter} | ${r.count} | ${cell(r.status)} |`)
      : ['| _(none)_ | — | 0 | no adapter ran |']),
    '',
    `## Candidates (${input.candidates.length})`,
    '',
  );
  if (input.candidates.length === 0) {
    lines.push(
      networkMode().sourcesOffline && !networkMode().dryRun
        ? '_offline: no recorded results for these queries — re-run online._'
        : '_No candidates discovered._',
    );
  }
  for (const c of input.candidates) {
    const who = c.authors.slice(0, 3).join('; ') + (c.authors.length > 3 ? '; et al.' : '');
    const id = c.doi ? `doi:${c.doi}` : `id:${c.id}`;
    const synthetic = c.synthetic === true ? ' — synthetic dry-run source' : '';
    lines.push(`- [@${c.citekey}] ${c.title} (${c.year ?? 'n.d.'}) — ${who} — ${id} — ${c.source}${synthetic}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Options shape
// ---------------------------------------------------------------------------

export interface ResearchOrchestratorOptions {
  /** Assignment text (full INTAKE.md content or raw assignment). */
  assignment: string;
  /** Topic phrase for query context and evaluator prompt. */
  topic: string;
  /** INTK-03 discipline slug (e.g. 'computer-science', 'other'). */
  discipline: string;
  /**
   * Project root (the folder containing .paper/). When given, the research log
   * is written to <paperRoot>/.paper/RESEARCH.md. The (queries, opts) overload
   * used by `pensmith research` always writes it (default: paperDir()).
   */
  paperRoot?: string;
  /**
   * Test-only: injectable adapter registry seam.
   * Defaults to the production `sources` registry from sources/index.ts.
   * Pass an object with adapters exposing `search()` to override for offline tests.
   */
  __adapterRegistry?: AdapterRegistry;
  /**
   * Test-only: force the candidate array returned by the fan-out (bypasses
   * adapter network entirely). Used by the zero-candidate degenerate test.
   */
  __forceCandidates?: SourceCandidate[];
}

// ---------------------------------------------------------------------------
// Main export: runResearchOrchestrator
// ---------------------------------------------------------------------------

/**
 * Fan out the searchable adapters, aggregate, dedup, and evaluate candidates.
 *
 * This function:
 *   1. Selects the searchable adapter set (excludes retraction-watch by guard,
 *      excludes unpaywall by name — its search() always returns []).
 *   2. For each query in the chosen scope, calls adapter.search(query, {limit:10}).
 *   3. Swallows per-adapter errors (non-fatal WARN; ARCH-03).
 *   4. Validates each result through SourceCandidateSchema.safeParse (T-11-10).
 *   5. Deduplicates via normalizeDoi (DOI) + jaroWinkler >= TITLE_JW_THRESHOLD (title).
 *   6. Calls the source-evaluator LLM step (defensive fallback: keep all on failure).
 *   7. Returns the final SourceCandidate[].
 *
 * Does NOT call crossCheckRetractions, writeBibtex, or writeRis — those
 * chokepoints belong exclusively to bin/cli/research.ts (D-15).
 *
 * @param queries  Array of query strings from the chosen topic-disambiguator scope.
 * @param opts     Orchestrator options including topic/discipline/assignment context.
 */
export async function runResearchOrchestrator(
  opts: ResearchOrchestratorOptions,
): Promise<SourceCandidate[]>;

/**
 * Overload: called from research.ts with explicit queries + opts.
 */
export async function runResearchOrchestrator(
  queries: string[],
  opts: Omit<ResearchOrchestratorOptions, 'assignment' | 'topic' | 'discipline'> & {
    topic: string;
    discipline: string;
    assignment?: string;
    scopeLabel?: string;
  },
): Promise<SourceCandidate[]>;

export async function runResearchOrchestrator(
  queriesOrOpts: string[] | ResearchOrchestratorOptions,
  optsArg?: DiscoverOptions,
): Promise<SourceCandidate[]> {
  const discovery = await discover(queriesOrOpts, optsArg);
  await discovery.writeLog(discovery.candidates);
  return discovery.candidates;
}

/** The (queries, opts) options of `pensmith research`. */
type DiscoverOptions = Omit<ResearchOrchestratorOptions, 'assignment' | 'topic' | 'discipline'> & {
  topic: string;
  discipline: string;
  assignment?: string;
  scopeLabel?: string;
};

/** Discovered candidates plus the deferred writer of their research log. */
export interface ResearchDiscovery {
  readonly candidates: SourceCandidate[];
  /**
   * Write .paper/RESEARCH.md for this discovery (a no-op when the caller has
   * no paper root). `pensmith research` calls it only AFTER its approval gates
   * pass (RUN-28), so a refused or aborted research writes nothing.
   */
  writeLog(candidates: SourceCandidate[]): Promise<void>;
}

/**
 * Discovery WITHOUT writing the research log: `pensmith research` runs its
 * candidate approval gate first and then calls `writeLog`.
 */
export async function discoverSources(queries: string[], opts: DiscoverOptions): Promise<ResearchDiscovery> {
  return discover(queries, opts);
}

async function discover(
  queriesOrOpts: string[] | ResearchOrchestratorOptions,
  optsArg?: DiscoverOptions,
): Promise<ResearchDiscovery> {
  // Normalize overloads.
  let queries: string[];
  let topic: string;
  let discipline: string;
  let scopeLabel: string;
  let adapterRegistry: AdapterRegistry;
  let explicitRegistry: AdapterRegistry | undefined;
  let forceCandidates: SourceCandidate[] | undefined;
  let researchMdPath: string | null;

  if (Array.isArray(queriesOrOpts)) {
    // Called from research.ts with (queries[], opts).
    queries = queriesOrOpts;
    topic = optsArg!.topic;
    discipline = optsArg!.discipline;
    scopeLabel = optsArg?.scopeLabel ?? 'auto';
    explicitRegistry = optsArg?.__adapterRegistry;
    adapterRegistry = explicitRegistry ?? (sources as AdapterRegistry);
    forceCandidates = undefined;
    // `pensmith research` always writes the research log (D-17-10).
    researchMdPath = path.join(
      optsArg?.paperRoot !== undefined ? paperDir(optsArg.paperRoot) : paperDir(),
      'RESEARCH.md',
    );
  } else {
    // Called from tests with a single opts object.
    const singleOpts = queriesOrOpts;
    topic = singleOpts.topic;
    discipline = singleOpts.discipline;
    scopeLabel = 'auto';
    explicitRegistry = singleOpts.__adapterRegistry;
    adapterRegistry = explicitRegistry ?? (sources as AdapterRegistry);
    forceCandidates = singleOpts.__forceCandidates;
    researchMdPath =
      singleOpts.paperRoot !== undefined ? path.join(paperDir(singleOpts.paperRoot), 'RESEARCH.md') : null;
    // When called from tests without explicit queries, derive a default query
    // from the topic string (the topic-disambiguator step belongs to research.ts).
    queries = [topic];
  }

  // Short-circuit: test-only forced candidates (zero-candidate path simulation).
  if (forceCandidates !== undefined) {
    if (forceCandidates.length === 0) {
      process.stderr.write(
        `pensmith research: WARN — 0 candidates found across all adapters (forced empty).\n`,
      );
    }
    return { candidates: forceCandidates, writeLog: async () => undefined };
  }

  const mode = networkMode();

  // RUN-27: under --dry-run the ONLY source is the labelled synthetic provider
  // (unless a test injected its own registry).
  if (mode.dryRun && explicitRegistry === undefined) {
    adapterRegistry = { 'dry-run': dryRunProvider };
  }

  // Build the searchable adapter set.
  // Guard 1: 'search' in adapter — excludes retraction-watch (D-15/T-12-04).
  // Guard 2: name !== 'unpaywall' — its search() always returns [] by design.
  const searchableEntries = Object.entries(adapterRegistry).filter(
    ([name, adapter]) =>
      name !== 'unpaywall' && 'search' in adapter,
  ) as Array<[string, SearchableAdapter]>;

  // Fan-out: for each query, call each adapter in parallel, collect results.
  const allRaw: SourceCandidate[] = [];
  const log: AdapterLogRow[] = [];

  // D-17-10: an adapter whose request failed (a 429 after retries, a 5xx, a
  // transport error) is `failed (<reason>)` in RESEARCH.md — never `no results`
  // — and gets one stderr line after the fan-out (per adapter, all queries).
  const failures = new Map<string, { reason: string; queries: number }>();
  const noteFailure = (adapterName: string, reason: string): void => {
    const f = failures.get(adapterName);
    if (f) f.queries += 1;
    else failures.set(adapterName, { reason, queries: 1 });
  };

  for (const query of queries) {
    const perQueryResults = await Promise.allSettled(
      searchableEntries.map(async ([adapterName, adapter]) => {
        let failure: string | null = null;
        try {
          const results = await adapter.search(query, {
            limit: 10,
            onFailure: (reason) => {
              failure ??= reason;
            },
          });
          if (failure !== null && results.length === 0) {
            noteFailure(adapterName, failure);
            return { adapterName, results, status: `failed (${failure})` };
          }
          return { adapterName, results, status: 'ok' as const };
        } catch (err) {
          if (isOfflineEgressError(err)) {
            // RUN-03: an offline miss is a distinct "no recorded fixture" result.
            return { adapterName, results: [] as SourceCandidate[], status: `${offlineLabel(err)}: no recorded fixture` };
          }
          noteFailure(adapterName, firstLine(err));
          return { adapterName, results: [] as SourceCandidate[], status: `failed (${firstLine(err)})` };
        }
      }),
    );

    let queryCount = 0;
    let offlineMisses = 0;
    for (const settled of perQueryResults) {
      if (settled.status === 'rejected') {
        // Promise.allSettled should not reject since we catch inside,
        // but handle defensively.
        process.stderr.write(
          `pensmith research: WARN — unexpected rejection during adapter fan-out: ` +
          `${String(settled.reason)}\n`,
        );
        continue;
      }
      const { adapterName, results, status } = settled.value;
      if (status !== 'ok' && status.endsWith('no recorded fixture')) offlineMisses += 1;
      let kept = 0;
      // Validate each result through SourceCandidateSchema.safeParse (T-11-10).
      for (const item of results) {
        const parsed = SourceCandidateSchema.safeParse(item);
        if (!parsed.success) {
          process.stderr.write(
            `pensmith research: WARN — adapter "${adapterName}" returned a candidate ` +
            `that failed SourceCandidateSchema validation (dropped, T-11-10): ` +
            `${parsed.error.message.slice(0, 120)}\n`,
          );
          continue;
        }
        // RUN-27: outside --dry-run a reserved dry-run identifier never enters
        // the library, whatever adapter produced it.
        if (!mode.dryRun && isReservedCandidate(parsed.data)) {
          process.stderr.write(
            `pensmith research: WARN — dropped a reserved dry-run identifier from "${adapterName}" ` +
            `(${parsed.data.doi ?? parsed.data.id}); synthetic sources exist only under --dry-run.\n`,
          );
          continue;
        }
        allRaw.push(parsed.data);
        kept += 1;
      }
      queryCount += kept;
      log.push({ query, adapter: adapterName, count: kept, status: status === 'ok' && kept === 0 ? 'no results' : status });
    }

    if (mode.sourcesOffline && !mode.dryRun && queryCount === 0 && offlineMisses > 0) {
      process.stderr.write(`offline: no recorded results for this query ("${query}")\n`);
    }
  }

  for (const [adapterName, f] of failures) {
    process.stderr.write(
      `pensmith research: WARN — ${adapterName} failed (${f.reason}) for ${f.queries} of ${queries.length} ` +
        `quer${queries.length === 1 ? 'y' : 'ies'}; its results are missing from this run (see RESEARCH.md)\n`,
    );
  }

  const writeLog = async (candidates: SourceCandidate[]): Promise<void> => {
    if (researchMdPath === null) return;
    const existing = existsSync(researchMdPath) ? readFileSync(researchMdPath, 'utf8') : null;
    await atomicWriteFile(
      researchMdPath,
      mergeResearchLog(renderResearchLog({ scope: scopeLabel, topic, discipline, queries, log, candidates }), existing),
    );
  };

  if (allRaw.length === 0) {
    process.stderr.write(
      `pensmith research: WARN — 0 candidates found across all adapters for queries: ` +
      `${queries.slice(0, 3).join(', ')}${queries.length > 3 ? ' ...' : ''}.\n`,
    );
    return { candidates: [], writeLog };
  }

  // Dedup: DOI first-wins (prefer abstract), then title JW >= threshold.
  const deduped = dedupCandidates(allRaw);

  // Audit #21/#31/#32: assign globally-unique citekeys to the deduped set BEFORE
  // it flows to the evaluator keep-set, the approval gate, LIBRARY.json, and
  // CITATIONS.bib. The citekey is the primary key all of those filter on; two
  // same-base-key papers (same first author + year) must not share one, or the
  // keep-sets prune the wrong rows and LIBRARY.json diverges from the suffixed
  // bib. Done here (not in each writer) so every downstream consumer agrees.
  const uniquelyKeyed = assignUniqueCitekeys(deduped);

  // Source-evaluator LLM tier step (defensive: keep all on failure).
  const evaluated = await evaluateCandidates(uniquelyKeyed, {
    topic,
    scope: scopeLabel,
    discipline,
  });

  return { candidates: evaluated, writeLog };
}

/**
 * Alias exported as `runResearchDiscovery` for research.ts import compatibility.
 * Both names point to the same implementation.
 */
export const runResearchDiscovery = runResearchOrchestrator;
