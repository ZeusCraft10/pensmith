// bin/lib/adapter-plan.ts — which source adapters research queries, in which
// order (SRC-10, D-19-16; PRD §8 "Source preference", §10 `[sources]`).
//
// Without `[sources] allowed_databases` the plan is the discipline preset's
// source preference (bin/lib/disciplines.ts `resolveDiscipline().sourcePreference`,
// PRD §8), mapped to adapters, followed by the rest of PRD §10's default five
// (openalex, semanticscholar, crossref, arxiv, pubmed). With it, the plan is
// exactly the listed databases, the preset's preferred ones first. The
// preference ids map to adapters as follows:
//   arxiv, semanticscholar, openalex, pubmed, crossref, books → the adapter of
//     the same registry key;
//   nber      → Crossref search restricted to NBER's DOI prefix 10.3386
//               (SearchOptions.doiPrefix), listed as its own entry `nber`;
//   jstor     → openalex + crossref   (JSTOR has no free, ToS-compliant search
//   psycnet   → pubmed + openalex      API; APA PsycNET neither; PhilPapers'
//   philpapers → openalex              documented API has no search endpoint —
//                                      PRD §8: their content is reached through
//                                      OpenAlex / Crossref / PubMed coverage).
// `zotero` joins (last) when the user's Zotero library is configured and, with
// allowed_databases, only when it is listed.
//
// Every adapter PRD §10 names that the plan leaves out is still reported, as
// `skipped (not in allowed_databases)` or `skipped (not configured)`, so the
// per-adapter table (SRC-07) always accounts for crossref, openalex, pubmed,
// arxiv and semanticscholar. A planned adapter the registry does not provide is
// `skipped (no adapter)`.
//
// The plan's order is the preference RANK research uses to break relevance
// ties (a work found by several adapters takes its best rank). Pure: callers
// pass the preference, the config table, the Zotero configuration and the
// registry's keys.

import type { SourcePreferenceId } from './disciplines.js';
import type { SearchOptions } from './sources/search-failure.js';

/** PRD §10's default databases (the adapters research queries when no preference names them). */
export const DEFAULT_DATABASES = ['openalex', 'semanticscholar', 'crossref', 'arxiv', 'pubmed'] as const;

/** NBER's DOI registrant prefix (its working papers are Crossref-registered). */
export const NBER_DOI_PREFIX = '10.3386';

/** One adapter research queries. */
export interface AdapterPlanEntry {
  /** What the user sees (`arxiv`, `nber`, …) — the per-adapter table row. */
  readonly id: string;
  /** The `sources` registry key searched (`nber` searches `crossref`). */
  readonly adapter: string;
  /** Extra search options for this entry (the `nber` DOI prefix). */
  readonly options: Pick<SearchOptions, 'doiPrefix'>;
  /** 0-based preference rank (lower is preferred). */
  readonly rank: number;
  /** The preference id it came from (`jstor` for the openalex it substitutes), when not itself. */
  readonly via?: string;
}

/** An adapter research reports but does not query. */
export interface AdapterPlanSkip {
  readonly id: string;
  /** `skipped (not in allowed_databases)`, `skipped (not configured)` or `skipped (no adapter)`. */
  readonly status: string;
}

export interface AdapterPlan {
  readonly entries: readonly AdapterPlanEntry[];
  readonly skipped: readonly AdapterPlanSkip[];
}

export interface AdapterPlanInput {
  /** The resolved preset's source preference (PRD §8 ids), most preferred first. */
  readonly preference: readonly SourcePreferenceId[] | readonly string[];
  /** `[sources] allowed_databases` (undefined = not set). */
  readonly allowed?: readonly string[] | undefined;
  /** True when the user's Zotero library is configured (API key or the local API). */
  readonly zoteroConfigured: boolean;
  /** The keys the source registry provides. */
  readonly available: readonly string[];
}

interface Target {
  readonly id: string;
  readonly adapter: string;
  readonly options: Pick<SearchOptions, 'doiPrefix'>;
  readonly via?: string;
}

/** The adapters a preference id reaches (substitutes for the services without a usable API). */
export function targetsFor(pref: string): Target[] {
  switch (pref) {
    case 'nber':
      return [{ id: 'nber', adapter: 'crossref', options: { doiPrefix: NBER_DOI_PREFIX } }];
    case 'jstor':
      return [
        { id: 'openalex', adapter: 'openalex', options: {}, via: 'jstor' },
        { id: 'crossref', adapter: 'crossref', options: {}, via: 'jstor' },
      ];
    case 'psycnet':
      return [
        { id: 'pubmed', adapter: 'pubmed', options: {}, via: 'psycnet' },
        { id: 'openalex', adapter: 'openalex', options: {}, via: 'psycnet' },
      ];
    case 'philpapers':
      return [{ id: 'openalex', adapter: 'openalex', options: {}, via: 'philpapers' }];
    default:
      return [{ id: pref, adapter: pref, options: {} }];
  }
}

/**
 * The adapter plan: the entries research queries (in preference order) and the
 * ones it reports as skipped.
 */
export function planAdapters(input: AdapterPlanInput): AdapterPlan {
  const available = new Set(input.available);
  const allowed = input.allowed === undefined ? null : new Set(input.allowed);

  // The candidate targets, in preference order, each id once.
  const ordered: Target[] = [];
  const seen = new Set<string>();
  const add = (t: Target): void => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    ordered.push(t);
  };
  for (const pref of input.preference) for (const t of targetsFor(pref)) add(t);
  if (allowed === null) {
    for (const db of DEFAULT_DATABASES) add({ id: db, adapter: db, options: {} });
  } else {
    // allowed_databases: exactly those, the preferred ones (already added) first.
    for (const db of input.allowed ?? []) for (const t of targetsFor(db)) add(t);
  }
  if (input.zoteroConfigured || allowed?.has('zotero') === true) add({ id: 'zotero', adapter: 'zotero', options: {} });

  const entries: AdapterPlanEntry[] = [];
  const skipped: AdapterPlanSkip[] = [];
  for (const t of ordered) {
    if (allowed !== null && !allowed.has(t.id)) {
      skipped.push({ id: t.id, status: 'skipped (not in allowed_databases)' });
      continue;
    }
    if (t.id === 'zotero' && !input.zoteroConfigured) {
      skipped.push({ id: t.id, status: 'skipped (not configured)' });
      continue;
    }
    if (!available.has(t.adapter)) {
      skipped.push({ id: t.id, status: 'skipped (no adapter)' });
      continue;
    }
    entries.push({ id: t.id, adapter: t.adapter, options: t.options, rank: entries.length, ...(t.via !== undefined ? { via: t.via } : {}) });
  }
  // Report every default database the plan leaves out (allowed_databases narrowed it).
  for (const db of DEFAULT_DATABASES) {
    if (!seen.has(db)) skipped.push({ id: db, status: 'skipped (not in allowed_databases)' });
  }
  if (!seen.has('zotero')) skipped.push({ id: 'zotero', status: 'skipped (not configured)' });
  return { entries, skipped };
}

/**
 * True when the user's Zotero library is configured for Tier 2 — the same
 * rule as bin/lib/sources/zotero.ts isZoteroConfigured(): a Zotero Web API
 * key, the Zotero 7 local API switched on, or a group library id (a public
 * group needs no key) (SRC-16). Presence only — the key's value is never read
 * here.
 */
export function zoteroConfigured(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env['ZOTERO_API_KEY']?.trim()) || env['PENSMITH_ZOTERO_LOCAL'] === '1' || Boolean(env['ZOTERO_GROUP_ID']?.trim());
}

// ---------------------------------------------------------------------------
// The research call budget (used by the research pass and the --estimate row)
// ---------------------------------------------------------------------------

/** Results asked of each adapter per query (T-12-03). */
export const RESEARCH_PER_QUERY_LIMIT = 10;

/** Most candidates one source-evaluator call judges (the payload stays bounded). */
export const EVALUATOR_BATCH = 150;

/** The number of source-evaluator calls `n` candidates need (0 for none). */
export function evaluatorCallsFor(n: number): number {
  return n <= 0 ? 0 : Math.ceil(n / EVALUATOR_BATCH);
}

/**
 * The candidates a research run is expected to hand the evaluator, for the
 * `--estimate` row (RUN-20): `queries` queries × `adapters` adapters ×
 * RESEARCH_PER_QUERY_LIMIT results, halved for duplicates across adapters and
 * queries that return fewer results than asked. An estimate, not a bound.
 */
export function estimatedResearchCandidates(queries: number, adapters: number): number {
  return Math.ceil((Math.max(0, queries) * Math.max(0, adapters) * RESEARCH_PER_QUERY_LIMIT) / 2);
}

/** Every adapter key a plan can name (for estimates made without a registry). */
export const PLANNABLE_ADAPTERS: readonly string[] = Object.freeze([...DEFAULT_DATABASES, 'books', 'zotero']);
