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
// `full_text` has exactly one derivation, fullTextAvailable(entry). Phase 18:
// a BYO PDF record or an open-access URL. Phase 19 (SRC-03/SRC-15/GRND-14)
// refines THAT function only; the drafter template already tells the model to
// quote directly only from `full_text: true` sources.

/** The library fields this module reads (a LibraryEntry, or a legacy v1 record). */
export interface SourceContextInput {
  readonly citekey: string;
  readonly title?: string | null | undefined;
  readonly authors?: readonly string[] | null | undefined;
  readonly year?: number | null | undefined;
  readonly venue?: string | null | undefined;
  readonly abstract?: string | null | undefined;
  readonly oa_url?: string | null | undefined;
  readonly byo?: unknown;
  /** Source tier (SRC-09, Phase 19); read when present. */
  readonly tier?: unknown;
  /** The DOI (read by verifierBlindSpot). */
  readonly doi?: string | null | undefined;
  /** A synthetic --dry-run source (RUN-27). */
  readonly synthetic?: boolean | null | undefined;
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
 * Pass 3 can check the quote). THE single derivation of `full_text`.
 */
export function fullTextAvailable(entry: Pick<SourceContextInput, 'byo' | 'oa_url'>): boolean {
  const byo = entry.byo;
  if (byo === true || (typeof byo === 'object' && byo !== null)) return true;
  return typeof entry.oa_url === 'string' && entry.oa_url.trim().length > 0;
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
// Which sources the citation verifier can check (GRND-18).
//
// Pass 1 (verify/pass1.ts) re-fetches every cited source by its DOI through
// Crossref: a source with no DOI is FABRICATED ("no DOI in citation entry") and
// one whose DOI Crossref does not register — arXiv's DataCite DOIs and the other
// DataCite repositories — is FABRICATED ("did not resolve via Crossref"), on
// every run. Offering such a source to the outline or the planner only strands
// the section at verify, so outline and plan are fed the checkable ones and
// name the others. When Pass 1 gains an arXiv / DataCite path (Phase 19/20),
// THIS predicate is what widens.
// ---------------------------------------------------------------------------

/** DOI prefixes registered with DataCite, which Crossref does not resolve: arXiv, Zenodo, figshare, Dryad. */
export const DATACITE_DOI_PREFIXES: readonly string[] = Object.freeze(['10.48550', '10.5281', '10.6084', '10.5061']);

/**
 * Why the citation verifier cannot check `entry` (null when it can): no DOI, a
 * DataCite DOI, or a synthetic --dry-run source outside a dry run. Pure: the
 * caller passes whether this is a dry run.
 */
export function verifierBlindSpot(entry: Pick<SourceContextInput, 'doi' | 'synthetic'>, dryRun: boolean): string | null {
  const doi = typeof entry.doi === 'string' ? entry.doi.trim().toLowerCase() : '';
  if (doi.length === 0) return 'no DOI';
  const prefix = doi.split('/')[0] ?? '';
  if (DATACITE_DOI_PREFIXES.includes(prefix)) return `a DataCite DOI (${prefix}) Crossref does not resolve`;
  if (entry.synthetic === true && !dryRun) return 'a synthetic --dry-run source';
  return null;
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
