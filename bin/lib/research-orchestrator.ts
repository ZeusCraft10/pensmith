// bin/lib/research-orchestrator.ts — GEN-03 live-adapter discovery orchestrator.
//
// Fans out the searchable adapters (crossref, openalex, arxiv, pubmed,
// semanticscholar, zotero-mcp — NOT unpaywall.search), aggregates
// SourceCandidate[], merges the records of one work by identifier (the
// discipline's sourcePreference picks whose metadata is kept), then calls the
// source-evaluator LLM step to tier the results.
//
// Load-bearing constraints enforced here:
//   - 'search' in adapter guard: an adapter with no search() is skipped.
//   - unpaywall excluded by name: its search() always returns [] by design.
//   - per-query cap 10 (Pitfall 6 budget; T-12-03).
//   - Per-adapter search() failure → swallowed WARN (ARCH-03).
//   - Merge by identifier (DOI, arXiv ID, PMID, PMC ID, ISBN) through
//     groupCandidates in bin/lib/library.ts, the same rule the library stores
//     by. A title alone never merges two records: it cannot tell "Attention
//     is all you need" from "Attention is not all you need". A candidate with
//     no identifier is dropped with a WARN, since nothing could verify it.
//   - source-evaluator parse failure → keep ALL deduped candidates + WARN (T-11-10).
//   - SourceCandidateSchema.safeParse per adapter result element (T-11-10).
//   - Injectable adapter-registry seam for offline tests.
//   - Marks each record its own data shows as retracted before merging (no
//     request is made); does NOT write the library — bin/cli/research.ts does.
//
// Threat mitigations:
//   T-12-01: defensive Zod safeParse on all LLM JSON outputs.
//   T-12-02: candidateSources serialized as JSON (structured) for evaluator prompt.
//   T-12-03: per-query limit cap = 10; dedup BEFORE evaluator.
//   T-12-04: 'search' in adapter guard.
//   T-12-05: no new fetch surface — all network via existing adapter modules.
//   T-12-06: complete() owns no-leak header path.

import { z } from 'zod';
import { sources } from './sources/index.js';
import { SourceCandidateSchema, type SourceCandidate } from './schemas/source-candidate.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assignUniqueCitekeys } from './bibtex-write.js';
import { groupCandidates } from './library.js';
import { crossCheckRetractions } from './sources/retraction-cross-check.js';
import { packageRoot } from './paths.js';
import { complete } from './anthropic.js';
import { loadPrompt, interpolate } from './prompt-loader.js';
import { escapeTemplateTokens } from './intake-parse.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from './network-mode.js';

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
  search(query: string, opts?: { limit?: number }): Promise<SourceCandidate[]>;
}

/** Registry type accepted by runResearchOrchestrator for DI. */
export type AdapterRegistry = Record<string, SearchableAdapter | { fetchById?: unknown }>;

// ---------------------------------------------------------------------------
// Source-evaluator response schema (Zod — T-12-01 trust boundary).
// ---------------------------------------------------------------------------

const EvalVerdictSchema = z.object({
  citekey: z.string().min(1),
  keep: z.boolean(),
  reason: z.string().optional(),
});

const EvalResponseSchema = z.array(EvalVerdictSchema);

// ---------------------------------------------------------------------------
// Source preference
// ---------------------------------------------------------------------------

/**
 * The discipline's `sourcePreference` from templates/presets/disciplines.json
 * (an unknown discipline uses `other`): which source's record of a work is
 * kept when several return it. Empty when the presets cannot be read.
 */
export function sourcePreferenceFor(discipline: string): string[] {
  try {
    const presets = JSON.parse(readFileSync(path.join(packageRoot(), 'templates', 'presets', 'disciplines.json'), 'utf8')) as Record<string, { sourcePreference?: unknown }>;
    const pref = (presets[discipline.toLowerCase()] ?? presets['other'])?.sourcePreference;
    return Array.isArray(pref) ? pref.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Source-evaluator LLM step
// ---------------------------------------------------------------------------

/**
 * Run the source-evaluator LLM step to tier the deduplicated candidates.
 *
 * On any parse failure (PENSMITH_NO_LLM=1 mock returns non-JSON, or hostile
 * LLM output): emits a WARN and returns ALL deduped candidates (defensive
 * fallback — T-11-10).
 */
async function evaluateCandidates(
  candidates: SourceCandidate[],
  opts: { topic: string; scope: string; discipline: string },
): Promise<SourceCandidate[]> {
  if (candidates.length === 0) return [];

  let evalResponseText: string;
  try {
    const evaluatorPrompt = loadPrompt('source-evaluator');
    const interpolatedEvaluator = interpolate(evaluatorPrompt, {
      // T-12-02: structured JSON encoding prevents direct prompt injection from
      // abstract/title content. candidateSources is safe in the JSON context.
      candidateSources: JSON.stringify(
        candidates.map((c) => ({
          source: c.source,
          id: c.id,
          title: c.title,
          authors: c.authors,
          year: c.year,
          doi: c.doi,
          // WR-03: cap abstracts at 500 chars to prevent arbitrarily large prompts.
          // 20-50 candidates × 3000-5000 char abstracts → 60K-150K chars without cap.
          abstract: c.abstract ? c.abstract.slice(0, 500) : undefined,
          retracted: c.retracted,
          citekey: c.citekey,
        })),
        null,
        2,
      ),
      // CR-01: escape user-controlled strings before interpolation so {{...}} tokens
      // in topic/discipline/scope cannot cause secondary template expansion.
      topic: escapeTemplateTokens(opts.topic),
      scope: escapeTemplateTokens(opts.scope),
      discipline: escapeTemplateTokens(opts.discipline),
    });

    const result = await complete({
      system:
        'You are an academic research assistant. Evaluate the candidate sources and ' +
        'return a JSON array of verdict objects in the exact format specified. ' +
        'No prose outside the JSON array.',
      messages: [{ role: 'user', content: interpolatedEvaluator }],
      scope: 'task',
      scopeId: 'research-evaluator',
    });
    evalResponseText = result.text;
  } catch (err) {
    process.stderr.write(
      `pensmith research: WARN — source-evaluator LLM call failed (${String(err)}); ` +
      `keeping all ${candidates.length} deduped candidates (T-11-10 defensive fallback).\n`,
    );
    return candidates;
  }

  // Defensive JSON parse (T-12-01 trust boundary).
  let parsed: unknown;
  try {
    parsed = JSON.parse(evalResponseText);
  } catch {
    process.stderr.write(
      `pensmith research: WARN — source-evaluator response is not valid JSON ` +
      `(expected under PENSMITH_NO_LLM=1); keeping all ${candidates.length} candidates ` +
      `(T-11-10 defensive fallback).\n`,
    );
    return candidates;
  }

  const verdictResult = EvalResponseSchema.safeParse(parsed);
  if (!verdictResult.success) {
    process.stderr.write(
      `pensmith research: WARN — source-evaluator response failed schema validation; ` +
      `keeping all ${candidates.length} candidates (T-11-10 defensive fallback).\n`,
    );
    return candidates;
  }

  const keepSet = new Set(
    verdictResult.data.filter((v) => v.keep).map((v) => v.citekey),
  );

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
// Options shape
// ---------------------------------------------------------------------------

export interface ResearchOrchestratorOptions {
  /** Assignment text (full INTAKE.md content or raw assignment). */
  assignment: string;
  /** Topic phrase for query context and evaluator prompt. */
  topic: string;
  /** INTK-03 discipline slug (e.g. 'computer-science', 'other'). */
  discipline: string;
  /** Paper root directory (unused currently — reserved for future path wiring). */
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
 *   1. Selects the searchable adapter set (adapters with a search(),
 *      excludes unpaywall by name — its search() always returns []).
 *   2. For each query in the chosen scope, calls adapter.search(query, {limit:10}).
 *   3. Swallows per-adapter errors (non-fatal WARN; ARCH-03).
 *   4. Validates each result through SourceCandidateSchema.safeParse (T-11-10).
 *   5. Merges the records of one work by identifier (groupCandidates), keeping
 *      the discipline's preferred source's metadata; drops candidates with none.
 *   6. Calls the source-evaluator LLM step (defensive fallback: keep all on failure).
 *   7. Returns the final SourceCandidate[].
 *
 * Does NOT write the library: bin/cli/research.ts does, after the user
 * approves the candidates.
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
  optsArg?: Omit<ResearchOrchestratorOptions, 'assignment' | 'topic' | 'discipline'> & {
    topic: string;
    discipline: string;
    assignment?: string;
    scopeLabel?: string;
  },
): Promise<SourceCandidate[]> {
  // Normalize overloads.
  let queries: string[];
  let topic: string;
  let discipline: string;
  let scopeLabel: string;
  let adapterRegistry: AdapterRegistry;
  let forceCandidates: SourceCandidate[] | undefined;

  if (Array.isArray(queriesOrOpts)) {
    // Called from research.ts with (queries[], opts).
    queries = queriesOrOpts;
    topic = optsArg!.topic;
    discipline = optsArg!.discipline;
    scopeLabel = optsArg?.scopeLabel ?? 'auto';
    adapterRegistry = optsArg?.__adapterRegistry ?? (sources as AdapterRegistry);
    forceCandidates = undefined;
  } else {
    // Called from tests with a single opts object.
    const singleOpts = queriesOrOpts;
    topic = singleOpts.topic;
    discipline = singleOpts.discipline;
    scopeLabel = 'auto';
    adapterRegistry = singleOpts.__adapterRegistry ?? (sources as AdapterRegistry);
    forceCandidates = singleOpts.__forceCandidates;
    // When called from tests without explicit queries, derive a default query
    // from the topic string (the topic-disambiguator step belongs to research.ts).
    queries = [topic];
  }

  // Offline: no adapter may be queried. Say so instead of reporting "0 found".
  if (isOfflineMode()) {
    process.stderr.write(`pensmith research: source discovery ${OFFLINE_SKIP_NOTE} — no registry was queried.\n`);
    return [];
  }

  // Short-circuit: test-only forced candidates (zero-candidate path simulation).
  if (forceCandidates !== undefined) {
    if (forceCandidates.length === 0) {
      process.stderr.write(
        `pensmith research: WARN — 0 candidates found across all adapters (forced empty).\n`,
      );
    }
    return forceCandidates;
  }

  // Build the searchable adapter set.
  // Guard 1: 'search' in adapter (T-12-04).
  // Guard 2: name !== 'unpaywall' — its search() always returns [] by design.
  const searchableEntries = Object.entries(adapterRegistry).filter(
    ([name, adapter]) =>
      name !== 'unpaywall' && 'search' in adapter,
  ) as Array<[string, SearchableAdapter]>;

  // Fan-out: for each query, call each adapter in parallel, collect results.
  const allRaw: SourceCandidate[] = [];

  for (const query of queries) {
    const perQueryResults = await Promise.allSettled(
      searchableEntries.map(async ([adapterName, adapter]) => {
        try {
          const results = await adapter.search(query, { limit: 10 });
          return { adapterName, results };
        } catch (err) {
          process.stderr.write(
            `pensmith research: WARN — adapter "${adapterName}" search("${query}") failed ` +
            `(${String(err)}); skipping this adapter result.\n`,
          );
          return { adapterName, results: [] };
        }
      }),
    );

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
      const { adapterName, results } = settled.value;
      // Validate each result through SourceCandidateSchema.safeParse (T-11-10).
      for (const item of results) {
        const parsed = SourceCandidateSchema.safeParse(item);
        if (parsed.success) {
          allRaw.push(parsed.data);
        } else {
          process.stderr.write(
            `pensmith research: WARN — adapter "${adapterName}" returned a candidate ` +
            `that failed SourceCandidateSchema validation (dropped, T-11-10): ` +
            `${parsed.error.message.slice(0, 120)}\n`,
          );
        }
      }
    }
  }

  if (allRaw.length === 0) {
    process.stderr.write(
      `pensmith research: WARN — 0 candidates found across all adapters for queries: ` +
      `${queries.slice(0, 3).join(', ')}${queries.length > 3 ? ' ...' : ''}.\n`,
    );
    return [];
  }

  // Each record says for itself whether the work is retracted; that is read
  // before the records of one work are merged, so a retraction only a
  // non-preferred source's record shows is kept.
  crossCheckRetractions(allRaw);
  // One candidate per work: records sharing an identifier are merged.
  const { works, skipped } = groupCandidates(allRaw, sourcePreferenceFor(discipline));
  if (skipped.length > 0) {
    process.stderr.write(
      `pensmith research: WARN — ${skipped.length} candidate(s) had no DOI, arXiv ID, PubMed ID or ISBN ` +
      `and were left out: nothing could verify them.\n`,
    );
  }

  // Citekeys unique across the run: the evaluator keep-set and the approval
  // gate filter by them. They are provisional; the library gives each work
  // the key it keeps (an earlier run's key for a work it already holds).
  const uniquelyKeyed = assignUniqueCitekeys(works);

  // Source-evaluator LLM tier step (defensive: keep all on failure).
  const evaluated = await evaluateCandidates(uniquelyKeyed, {
    topic,
    scope: scopeLabel,
    discipline,
  });

  return evaluated;
}

/**
 * Alias exported as `runResearchDiscovery` for research.ts import compatibility.
 * Both names point to the same implementation.
 */
export const runResearchDiscovery = runResearchOrchestrator;
