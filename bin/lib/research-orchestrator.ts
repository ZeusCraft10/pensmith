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
//   - The source evaluator sees the candidates as fenced data, each under an
//     id of its own, and answers JSON to a schema checked in code (one repair
//     round). An answer that still cannot be used, or one that keeps none,
//     keeps nothing on its own: SourceEvaluationError hands the candidates
//     back for the author to choose from. Under PENSMITH_NO_LLM no evaluator
//     runs and all are kept.
//   - SourceCandidateSchema.safeParse per adapter result element (T-11-10).
//   - Injectable adapter-registry seam for offline tests.
//   - Marks each record its own data shows as retracted before merging (no
//     request is made); does NOT write the library — bin/cli/research.ts does.
//
// Threat mitigations:
//   T-12-01: the evaluator's answer is checked against its schema and the candidate ids.
//   T-12-02: titles and abstracts reach the evaluator inside the untrusted-data fence.
//   T-12-03: per-query limit cap = 10; dedup BEFORE evaluator.
//   T-12-04: 'search' in adapter guard.
//   T-12-05: no new fetch surface — all network via existing adapter modules.
//   T-12-06: complete() owns no-leak header path.

import { z } from 'zod/v4';
import { sources } from './sources/index.js';
import { SourceCandidateSchema, type SourceCandidate } from './schemas/source-candidate.js';
import { assignUniqueCitekeys } from './bibtex-write.js';
import { groupCandidates } from './library.js';
import { crossCheckRetractions } from './sources/retraction-cross-check.js';
import { disciplinePreset } from './citations.js';
import { loadPrompt, interpolate } from './prompt-loader.js';
import { escapeTemplateTokens } from './intake-parse.js';
import { isOfflineMode, OFFLINE_SKIP_NOTE } from './network-mode.js';
import { completeChecked } from './structured-call.js';
import { CostCapExceededError } from './budget.js';
import { plainAbstract } from './source-context.js';
import { fenceUntrusted, stripFenceMarkers } from './untrusted-fence.js';

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
// Source-evaluator answer
// ---------------------------------------------------------------------------

/** What the source evaluator returns: one verdict per candidate, by the id it was shown. */
const EvaluationSchema = z.object({
  verdicts: z.array(z.object({ id: z.string(), keep: z.boolean(), reason: z.string() }).strict()),
}).strict();
type Evaluation = z.infer<typeof EvaluationSchema>;

/** Every reason `e` is not one verdict for each of `ids`; empty when it is. */
function evaluationProblems(e: Evaluation, ids: readonly string[]): string[] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const v of e.verdicts) {
    if (!known.has(v.id)) problems.push(`${v.id} is not the id of any candidate`);
    else if (seen.has(v.id)) problems.push(`${v.id} has more than one verdict`);
    seen.add(v.id);
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length > 0) problems.push(`no verdict for ${missing.join(', ')}; give one for every candidate`);
  return problems;
}

/**
 * The source evaluator gave no answer that could be used, or kept none of the
 * candidates. Nothing is kept on its own: `candidates` (every one found) go
 * to the author to choose from, since an evaluator that rejects every one may
 * have misjudged the topic, and research that keeps nothing is not done.
 */
export class SourceEvaluationError extends Error {
  readonly candidates: SourceCandidate[];
  /** True when the evaluator answered and kept none; false when it gave no usable answer. */
  readonly keptNone: boolean;
  /** `why` is the reason its answer could not be used, or null when it kept none. */
  constructor(candidates: SourceCandidate[], why: string | null) {
    super(why === null
      ? `the source evaluator kept none of the ${candidates.length} candidates`
      : `the source evaluator gave no usable answer (${why})`);
    this.name = 'SourceEvaluationError';
    this.candidates = candidates;
    this.keptNone = why === null;
  }
}

// ---------------------------------------------------------------------------
// Source preference
// ---------------------------------------------------------------------------

/**
 * The discipline's `sourcePreference` from templates/presets/disciplines.json
 * (an unknown discipline uses `other`): which source's record of a work is
 * kept when several return it. Empty when the presets cannot be read.
 */
export function sourcePreferenceFor(discipline: string): string[] {
  const pref = disciplinePreset(discipline)?.['sourcePreference'];
  return Array.isArray(pref) ? pref.filter((s): s is string => typeof s === 'string') : [];
}

// ---------------------------------------------------------------------------
// Source-evaluator LLM step
// ---------------------------------------------------------------------------

/** How much of each abstract the evaluator is shown. */
const EVALUATOR_ABSTRACT_CHARS = 500;
/** How many authors of each candidate the evaluator is shown. */
const EVALUATOR_AUTHORS = 6;

/**
 * Ask the source evaluator which candidates to keep. Each candidate goes in,
 * fenced, under an id of its own (c1, c2, ...): two works can share a
 * provisional citekey, an id cannot. Returns the ones it keeps; throws
 * SourceEvaluationError when it gives no usable answer or keeps none, so that
 * nothing is kept that it did not choose.
 */
async function evaluateCandidates(
  candidates: SourceCandidate[],
  opts: { topic: string; scope: string; discipline: string },
): Promise<SourceCandidate[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((_, i) => `c${i + 1}`);
  const shown = candidates.map((c, i) => ({
    id: ids[i]!,
    title: c.title,
    authors: c.authors.slice(0, EVALUATOR_AUTHORS),
    ...(c.year !== undefined ? { year: c.year } : {}),
    ...(c.container_title ? { venue: c.container_title } : {}),
    ...(c.doi ? { doi: c.doi } : {}),
    source: c.source,
    ...(c.abstract ? { abstract: plainAbstract(c.abstract, EVALUATOR_ABSTRACT_CHARS) } : {}),
    ...(c.retracted ? { retracted: true } : {}),
  }));
  const text = (s: string): string => escapeTemplateTokens(stripFenceMarkers(s));
  const system = interpolate(loadPrompt('source-evaluator'), {
    candidateSources: escapeTemplateTokens(fenceUntrusted(JSON.stringify(shown, null, 2))),
    topic: text(opts.topic),
    scope: text(opts.scope),
    discipline: text(opts.discipline),
  });

  let answer;
  try {
    answer = await completeChecked({
      system,
      messages: [{ role: 'user', content: `Judge the ${candidates.length} candidate sources.` }],
      role: 'evaluate',
      scope: 'task',
      scopeId: 'research-evaluator',
      schema: EvaluationSchema,
      problemsOf: (e) => evaluationProblems(e, ids),
      noun: 'evaluation',
    });
  } catch (err) {
    // The paper is at its cost cap: that is a refusal of its own, not a bad answer.
    if (err instanceof CostCapExceededError) throw err;
    throw new SourceEvaluationError(candidates, err instanceof Error ? err.message : String(err));
  }
  if ('placeholder' in answer) {
    process.stderr.write(
      `pensmith research: WARN — no source evaluator ran (PENSMITH_NO_LLM); all ${candidates.length} candidates go on unjudged.\n`,
    );
    return candidates;
  }
  if ('problems' in answer) throw new SourceEvaluationError(candidates, answer.problems.join('; '));

  const keep = new Set(answer.value.verdicts.filter((v) => v.keep).map((v) => v.id));
  const kept = candidates.filter((_, i) => keep.has(ids[i]!));
  if (kept.length === 0) throw new SourceEvaluationError(candidates, null);
  return kept;
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
 *   6. Calls the source evaluator, which keeps the candidates it names (or
 *      throws SourceEvaluationError, keeping none, when its answer cannot be
 *      used or keeps none).
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

  // The source evaluator keeps what it names; a failed evaluation keeps nothing.
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
