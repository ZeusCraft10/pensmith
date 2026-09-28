// bin/lib/source-policy.ts — the `[sources]` policy of .paper/config.toml,
// enforced deterministically (SRC-09, SRC-10, D-19-16; PRD §10 `[sources]`).
//
// Every research path (`pensmith research`, `plan N --research`) filters its
// candidates through this module before the user sees them; an excluded
// candidate is listed in RESEARCH.md with the rule that excluded it. Pure: the
// caller reads config.toml (bin/lib/config.ts) and passes the `[sources]` table.
//
// Defaults (PRD §10; a key absent from config.toml takes its default):
//   min_year           unset — no year filter
//   allow_preprints    true
//   allow_books        true
//   allow_gov_reports  true
//   allow_news         false  (newspaper and magazine articles)
//   peer_reviewed_only false
//   require_doi        true   — meaning a REGISTRAR IDENTIFIER: a DOI, an ISBN
//                             (books), an arXiv id (preprints) or a PMID. The
//                             History, Literature and Philosophy presets prefer
//                             books, which have ISBNs rather than DOIs, and
//                             Pass 1 can re-check each of these identifiers
//                             against its registrar; a record with none of them
//                             cannot be re-checked and is excluded.
//
// Tier rules (allow_preprints, allow_books, allow_gov_reports,
// peer_reviewed_only) need the candidate's tier. Research applies the policy
// twice: before the evaluator with the deterministic tier (bin/lib/source-tier.ts)
// — an unknown tier is not excluded yet, so the model is never paid to judge a
// candidate the policy would drop — and after it with the final tier, when an
// unknown tier under `peer_reviewed_only` is excluded (it cannot be shown to be
// peer-reviewed).

import type { SourceTier } from './schemas/source-types.js';
import { normArxiv, normDoi, normIsbn, normPmid } from './migrations/library/shape.js';

/** The `[sources]` keys this module reads (a subset of bin/lib/schemas/config.ts SourcesSchema). */
export interface SourcesConfigInput {
  readonly require_doi?: boolean | undefined;
  readonly allow_preprints?: boolean | undefined;
  readonly allow_books?: boolean | undefined;
  readonly allow_gov_reports?: boolean | undefined;
  readonly allow_news?: boolean | undefined;
  readonly min_year?: number | undefined;
  readonly peer_reviewed_only?: boolean | undefined;
}

export interface SourcePolicy {
  readonly minYear: number | null;
  readonly allowPreprints: boolean;
  readonly allowBooks: boolean;
  readonly allowGovReports: boolean;
  readonly allowNews: boolean;
  readonly peerReviewedOnly: boolean;
  /** `require_doi`: a registrar identifier (DOI, ISBN, arXiv id or PMID) is required. */
  readonly requireIdentifier: boolean;
}

/** PRD §10 defaults. */
export const DEFAULT_SOURCE_POLICY: SourcePolicy = Object.freeze({
  minYear: null,
  allowPreprints: true,
  allowBooks: true,
  allowGovReports: true,
  allowNews: false,
  peerReviewedOnly: false,
  requireIdentifier: true,
});

/** The effective policy of a `[sources]` table (absent keys take their defaults). */
export function sourcePolicyFrom(sources: SourcesConfigInput | undefined): SourcePolicy {
  const s = sources ?? {};
  return Object.freeze({
    minYear: typeof s.min_year === 'number' ? s.min_year : DEFAULT_SOURCE_POLICY.minYear,
    allowPreprints: s.allow_preprints ?? DEFAULT_SOURCE_POLICY.allowPreprints,
    allowBooks: s.allow_books ?? DEFAULT_SOURCE_POLICY.allowBooks,
    allowGovReports: s.allow_gov_reports ?? DEFAULT_SOURCE_POLICY.allowGovReports,
    allowNews: s.allow_news ?? DEFAULT_SOURCE_POLICY.allowNews,
    peerReviewedOnly: s.peer_reviewed_only ?? DEFAULT_SOURCE_POLICY.peerReviewedOnly,
    requireIdentifier: s.require_doi ?? DEFAULT_SOURCE_POLICY.requireIdentifier,
  });
}

/** The config key whose rule excluded a candidate. */
export type PolicyRule =
  | 'min_year'
  | 'require_doi'
  | 'allow_news'
  | 'allow_preprints'
  | 'allow_books'
  | 'allow_gov_reports'
  | 'peer_reviewed_only';

export interface PolicyExclusion {
  readonly rule: PolicyRule;
  /** One line naming the rule and the fact that broke it, e.g. `min_year = 2015 (published 2009)`. */
  readonly reason: string;
}

/** The metadata the policy reads (a SourceCandidate or a LIBRARY entry satisfies it). */
export interface PolicyInput {
  readonly source?: string | undefined;
  readonly id?: string | undefined;
  readonly year?: number | null | undefined;
  readonly type?: string | null | undefined;
  readonly doi?: string | null | undefined;
  readonly isbn?: string | null | undefined;
  readonly arxiv?: string | null | undefined;
  readonly pmid?: string | null | undefined;
}

/** True when the work carries a registrar identifier Pass 1 can re-check: a DOI, an ISBN, an arXiv id or a PMID. */
export function hasRegistrarIdentifier(c: PolicyInput): boolean {
  if (normDoi(c.doi) !== null || normIsbn(c.isbn) !== null || normArxiv(c.arxiv) !== null || normPmid(c.pmid) !== null) return true;
  // An adapter's own id is a registrar identifier for arXiv and PubMed records.
  if (c.source === 'arxiv' && normArxiv(c.id) !== null) return true;
  if (c.source === 'pubmed' && normPmid(c.id) !== null) return true;
  return false;
}

const NEWS_TYPES: ReadonlySet<string> = new Set(['article-newspaper', 'article-magazine']);

export interface PolicyCheckOptions {
  /**
   * True once the tier is final (after the evaluator): an unknown tier then
   * fails `peer_reviewed_only`. Before the evaluator an unknown tier is not
   * excluded by any tier rule.
   */
  readonly tierFinal: boolean;
}

/**
 * The first rule of `policy` that excludes the candidate, or null when it is
 * allowed. Rules are checked in a fixed order (year, identifier, news, then the
 * tier rules), so the reported rule is deterministic.
 */
export function policyExclusion(
  c: PolicyInput,
  tier: SourceTier | null,
  policy: SourcePolicy,
  opts: PolicyCheckOptions,
): PolicyExclusion | null {
  if (policy.minYear !== null && typeof c.year === 'number' && c.year < policy.minYear) {
    return { rule: 'min_year', reason: `min_year = ${policy.minYear} (published ${c.year})` };
  }
  if (policy.requireIdentifier && !hasRegistrarIdentifier(c)) {
    return { rule: 'require_doi', reason: 'require_doi = true (no DOI, ISBN, arXiv id or PMID to verify it against)' };
  }
  if (!policy.allowNews && typeof c.type === 'string' && NEWS_TYPES.has(c.type)) {
    return { rule: 'allow_news', reason: `allow_news = false (${c.type === 'article-newspaper' ? 'a newspaper' : 'a magazine'} article)` };
  }
  if (!policy.allowPreprints && tier === 'preprint') {
    return { rule: 'allow_preprints', reason: 'allow_preprints = false (a preprint)' };
  }
  if (!policy.allowBooks && tier === 'book') {
    return { rule: 'allow_books', reason: 'allow_books = false (a book)' };
  }
  if (!policy.allowGovReports && tier === 'gov-report') {
    return { rule: 'allow_gov_reports', reason: 'allow_gov_reports = false (a government report)' };
  }
  if (policy.peerReviewedOnly) {
    if (tier !== null && tier !== 'peer-reviewed') {
      return { rule: 'peer_reviewed_only', reason: `peer_reviewed_only = true (tier: ${tier})` };
    }
    if (tier === null && opts.tierFinal) {
      return { rule: 'peer_reviewed_only', reason: 'peer_reviewed_only = true (tier unknown: not shown to be peer-reviewed)' };
    }
  }
  return null;
}

/** The candidates split into those the policy allows and those it excludes (each with its rule). */
export function applySourcePolicy<T extends PolicyInput>(
  candidates: readonly T[],
  tierOf: (c: T) => SourceTier | null,
  policy: SourcePolicy,
  opts: PolicyCheckOptions,
): { allowed: T[]; excluded: Array<{ candidate: T; exclusion: PolicyExclusion }> } {
  const allowed: T[] = [];
  const excluded: Array<{ candidate: T; exclusion: PolicyExclusion }> = [];
  for (const c of candidates) {
    const exclusion = policyExclusion(c, tierOf(c), policy, opts);
    if (exclusion) excluded.push({ candidate: c, exclusion });
    else allowed.push(c);
  }
  return { allowed, excluded };
}
