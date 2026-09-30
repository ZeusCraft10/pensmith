// bin/lib/source-context.ts — the ONE source-context builder (FEED-01, D-18-21).
//
// Every generative step that sees sources gets them from here: the outline
// request (every LIBRARY entry, in the outline projection), the planner request
// (the section's allowed set), the drafter request (exactly the section's PLAN.md
// `assigned_sources`) and, through Phase 23, the Tier-1 context tools. The
// records are the payload of a fenced `sources` block (prompt-request.ts,
// FEED-05); this module only decides WHAT a step may see.
//
// PURE: no fs, no network, no clock. Callers read LIBRARY.json (library.ts
// tryLoadLibrary) and pass the entries in. Output never contains a citekey or a
// title that is not in its input (tests/source-context.property.test.ts), and
// the section builder returns records only for the citekeys it is asked for, in
// that order, dropping keys the library does not hold — so a section can never
// be shown a source assigned only to another section (PRD §7.6).
//
// `full_text` has exactly one derivation, fullTextAvailable(entry), which is
// full-text.ts's (GRND-14, the Phase 18/19 merge): true only for text Pass 3
// can check — a non-asserted hashed bring-your-own PDF, an Unpaywall-confirmed
// `oa_url` with a (non-DataCite) DOI, or an arXiv id. The drafter template tells
// the model to quote directly only from `full_text: true` sources, and
// draft-containment.ts's `quote-without-full-text` violation enforces it. This
// module reads the recorded hashes only; `write` re-checks a BYO PDF through
// byo-text.ts before it builds the drafter request (write.ts withVerifiedByo).

import { fullTextAvailable as fullTextFromLibrary } from './full-text.js';
import { citationCheckRoute, uncheckableReason } from './verify/pass1-identifiers.js';
import type { LibraryEntry } from './schemas/library.js';

/** The library fields this module reads (a LibraryEntry, or a legacy v1 record). */
export interface SourceContextInput {
  readonly citekey: string;
  readonly title?: string | null | undefined;
  readonly authors?: readonly string[] | null | undefined;
  readonly year?: number | null | undefined;
  readonly venue?: string | null | undefined;
  readonly abstract?: string | null | undefined;
  readonly oa_url?: string | null | undefined;
  /** The bring-your-own PDF record (SRC-15): hashes, never text. */
  readonly byo?: LibraryEntry['byo'] | undefined;
  /** The bare arXiv id (its arXiv PDF is text Pass 3 can check, GRND-14). */
  readonly arxiv?: string | null | undefined;
  /** Source tier (SRC-09, Phase 19); read when present. */
  readonly tier?: unknown;
  /** The DOI (read by verifierBlindSpot). */
  readonly doi?: string | null | undefined;
  /** The PMID and ISBN (read by verifierBlindSpot: Pass 1 resolves them at PubMed and the books registries). */
  readonly pmid?: string | null | undefined;
  readonly isbn?: string | null | undefined;
  /** A synthetic --dry-run source (RUN-27). */
  readonly synthetic?: boolean | null | undefined;
  /** Flagged retracted at research time (Retraction Watch); Pass 1 always blocks a citation of it. */
  readonly retracted?: boolean | null | undefined;
}

/** One source as the planner and the drafter see it (18-PLAN.md §3.3). */
export type SourceContextRecord = {
  readonly citekey: string;
  readonly title: string;
  /** At most MAX_AUTHORS names ("Family, Given"). */
  readonly authors: readonly string[];
  readonly year: number | null;
  readonly venue: string | null;
  /** At most MAX_ABSTRACT_CHARS characters. */
  readonly abstract: string | null;
  readonly tier: string | null;
  /** True when the full text is available to verify a direct quote (fullTextAvailable). */
  readonly full_text: boolean;
};

/** One source as the outline author sees it (every LIBRARY entry). */
export type OutlineSourceRecord = {
  readonly citekey: string;
  readonly title: string;
  readonly first_author: string | null;
  readonly year: number | null;
  readonly tier: string | null;
  /** At most OUTLINE_ABSTRACT_CHARS characters. */
  readonly abstract: string | null;
};

export const MAX_AUTHORS = 5;
export const MAX_ABSTRACT_CHARS = 800;
export const OUTLINE_ABSTRACT_CHARS = 300;

/**
 * Whether a source's full text is available (so the drafter may quote it and
 * Pass 3 can check the quote). THE single derivation of `full_text`: it
 * delegates to full-text.ts, whose basis is exactly Pass 3's (GRND-14).
 */
export function fullTextAvailable(entry: Pick<SourceContextInput, 'byo' | 'oa_url' | 'doi' | 'arxiv'>): boolean {
  return fullTextFromLibrary({
    byo: entry.byo ?? null,
    oa_url: entry.oa_url ?? null,
    doi: entry.doi ?? null,
    arxiv: entry.arxiv ?? null,
  });
}

/** Cut `text` to at most `max` UTF-16 units without splitting a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // a high surrogate would be orphaned
  return text.slice(0, end);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function textOrNull(v: unknown, max?: number): string | null {
  if (typeof v !== 'string') return null;
  const t = oneLine(v);
  if (t.length === 0) return null;
  return max === undefined ? t : clip(t, max);
}

function yearOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function tierOf(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function authorsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const a of v) {
    if (typeof a !== 'string') continue;
    const t = oneLine(a);
    if (t.length > 0) out.push(t);
    if (out.length === MAX_AUTHORS) break;
  }
  return out;
}

/**
 * The longest abstract Pass 2's claim-support judge is sent (VRFY-21,
 * D-20-28): a registrar abstract has no length limit of its own, and an
 * unbounded payload is both cost and a denial-of-service surface.
 */
export const CLAIM_SUPPORT_ABSTRACT_CHARS = 4000;

/**
 * A source's abstract as Pass 2 sends it (the one accessor Pass 2 reads —
 * the LIBRARY.json entry first, else the bib entry's `abstract`): one line,
 * clipped like every other abstract of this module (clip), or null when there
 * is none. `evidence` is checked against exactly this text.
 */
export function claimSupportAbstract(entry: { readonly abstract?: unknown } | null | undefined): string | null {
  return textOrNull(entry?.abstract, CLAIM_SUPPORT_ABSTRACT_CHARS);
}

/** The library as a citekey map (the first entry wins for a duplicated key). */
function byCitekey(entries: readonly SourceContextInput[]): Map<string, SourceContextInput> {
  const map = new Map<string, SourceContextInput>();
  for (const e of entries) {
    if (e === null || typeof e !== 'object' || typeof e.citekey !== 'string' || e.citekey.length === 0) continue;
    if (!map.has(e.citekey)) map.set(e.citekey, e);
  }
  return map;
}

/** The planner/drafter record of one library entry. */
export function sourceContextRecord(entry: SourceContextInput): SourceContextRecord {
  return {
    citekey: entry.citekey,
    title: textOrNull(entry.title) ?? '(untitled)',
    authors: authorsOf(entry.authors),
    year: yearOf(entry.year),
    venue: textOrNull(entry.venue),
    abstract: textOrNull(entry.abstract, MAX_ABSTRACT_CHARS),
    tier: tierOf(entry.tier),
    full_text: fullTextAvailable(entry),
  };
}

/**
 * The records of `citekeys` — in that order, each at most once — from the
 * library `entries`. A citekey the library does not hold is dropped (the
 * caller validates membership separately and reports it).
 */
export function buildSourceContext(
  entries: readonly SourceContextInput[],
  citekeys: readonly string[],
): SourceContextRecord[] {
  const map = byCitekey(entries);
  const out: SourceContextRecord[] = [];
  const seen = new Set<string>();
  for (const key of citekeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = map.get(key);
    if (entry !== undefined) out.push(sourceContextRecord(entry));
  }
  return out;
}

/** The outline projection of every library entry, in library order. */
export function buildOutlineSources(entries: readonly SourceContextInput[]): OutlineSourceRecord[] {
  const out: OutlineSourceRecord[] = [];
  for (const entry of byCitekey(entries).values()) {
    out.push({
      citekey: entry.citekey,
      title: textOrNull(entry.title) ?? '(untitled)',
      first_author: authorsOf(entry.authors)[0] ?? null,
      year: yearOf(entry.year),
      tier: tierOf(entry.tier),
      abstract: textOrNull(entry.abstract, OUTLINE_ABSTRACT_CHARS),
    });
  }
  return out;
}

/** The citekeys a library holds. */
export function libraryCitekeys(entries: readonly SourceContextInput[]): Set<string> {
  return new Set(byCitekey(entries).keys());
}

// ---------------------------------------------------------------------------
// Which sources the citation verifier can check (GRND-18, D-18-37).
//
// Offering the outline or the planner a source Pass 1 can never pass only
// strands the section at verify, so outline and plan are fed the checkable
// ones and name the others. What Pass 1 can check is ONE predicate shared with
// Pass 1 itself (verify/pass1-identifiers.ts citationCheckRoute): a Crossref
// DOI; a DataCite DOI — Zenodo, figshare, Dryad at DataCite (VRFY-11), an
// arXiv DOI at arXiv; another agency's DOI (content negotiation, else its
// other identifiers); no DOI but an arXiv id (arXiv), a PMID (PubMed) or an
// ISBN (the books registries). Withheld: a source flagged retracted (Pass 1
// always blocks it, review round 3), one with no DOI, arXiv id, PMID or ISBN
// (Pass 1's metadata search may find no match — UNRESOLVABLE), and a
// synthetic --dry-run source outside a dry run.
// ---------------------------------------------------------------------------

export { DATACITE_DOI_PREFIXES, NO_IDENTIFIER_REASON } from './verify/pass1-identifiers.js';

/** The reason a retracted source is withheld (verifierBlindSpot); it never becomes citable. */
export const RETRACTED_REASON = 'retracted (Retraction Watch)';

/** The reason a synthetic --dry-run source is withheld outside a dry run. */
export const SYNTHETIC_REASON = 'a synthetic --dry-run source';

/**
 * Why the citation verifier would never pass a citation of `entry` (null when
 * it can): retracted, a synthetic --dry-run source outside a dry run, or
 * identifiers no registrar Pass 1 asks can resolve (uncheckableReason). Pure:
 * the caller passes whether this is a dry run.
 */
export function verifierBlindSpot(
  entry: Pick<SourceContextInput, 'doi' | 'arxiv' | 'pmid' | 'isbn' | 'synthetic' | 'retracted'>,
  dryRun: boolean,
): string | null {
  if (entry.retracted === true) return RETRACTED_REASON;
  if (entry.synthetic === true && !dryRun) return SYNTHETIC_REASON;
  const route = citationCheckRoute(entry);
  if (route.kind === 'dry-run-doi') return dryRun ? null : SYNTHETIC_REASON;
  return uncheckableReason(entry);
}

/** The library split into the sources the verifier can check and the others (with why), in library order. */
export function partitionCheckable<T extends SourceContextInput>(
  entries: readonly T[],
  dryRun: boolean,
): { checkable: T[]; excluded: Array<{ citekey: string; reason: string }> } {
  const checkable: T[] = [];
  const excluded: Array<{ citekey: string; reason: string }> = [];
  for (const e of entries) {
    if (e === null || typeof e !== 'object') continue;
    const why = verifierBlindSpot(e, dryRun);
    if (why === null) checkable.push(e);
    else excluded.push({ citekey: e.citekey, reason: why });
  }
  return { checkable, excluded };
}

/** One line naming the sources left out because the verifier cannot check them (at most `max` named). */
export function describeExcluded(excluded: ReadonlyArray<{ citekey: string; reason: string }>, max = 8): string {
  const named = excluded.slice(0, max).map((x) => `${x.citekey} (${x.reason})`).join(', ');
  return excluded.length > max ? `${named}, and ${excluded.length - max} more` : named;
}

/**
 * What the user can do about the withheld sources: a source with no
 * identifier the verifier resolves becomes usable once one is added; a
 * retracted one is never cited; a synthetic one exists only in a dry run.
 */
export function excludedRemedy(excluded: ReadonlyArray<{ citekey: string; reason: string }>): string {
  const retracted = excluded.some((x) => x.reason === RETRACTED_REASON);
  const synthetic = excluded.some((x) => x.reason === SYNTHETIC_REASON);
  const fixable = excluded.some((x) => x.reason !== RETRACTED_REASON && x.reason !== SYNTHETIC_REASON);
  const parts: string[] = [];
  if (fixable) {
    parts.push('to use one the verifier cannot check, `pensmith add` its DOI, arXiv id, PMID or ISBN');
  }
  if (retracted) parts.push('a retracted source is never cited');
  if (synthetic) parts.push('a synthetic --dry-run source is never cited outside a dry run');
  return parts.join('; ');
}
