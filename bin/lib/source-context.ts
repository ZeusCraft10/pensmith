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
