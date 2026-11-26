// bin/lib/source-context.ts — the works a prompt is shown, from LIBRARY.json.
//
// The planner, the drafter and revise-swap decide which work supports which
// claim, so they are shown the works: citekey, title, authors, year, venue
// and abstract. They come from LIBRARY.json, the paper's canonical store
// (CITATIONS.bib is a view of it). The drafter and revise-swap see only the
// sources the section's PLAN.md assigns (PRD §7.6); the outline author and
// the planner see the library they choose from.
//
// Titles and abstracts are third-party text, so the list goes into a prompt
// as JSON inside the untrusted-data fence (untrusted-fence.ts).

import { z } from 'zod/v4';
import { displayName } from './author-normalize.js';
import { escapeTemplateTokens } from './intake-parse.js';
import { fenceUntrusted } from './untrusted-fence.js';
import type { Library, LibraryItem } from './schemas/library.js';
import type { CslName } from './schemas/source-candidate.js';

/** One work as a prompt is shown it. `retracted` is present only when its own record shows it retracted. */
export const SourceContextEntrySchema = z.object({
  citekey: z.string().min(1),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  abstract: z.string().optional(),
  retracted: z.literal(true).optional(),
}).strict();
export type SourceContextEntry = z.infer<typeof SourceContextEntrySchema>;

/** How many authors are named before "et al.". */
const AUTHORS_SHOWN = 6;

/** How much of an abstract a prompt is shown, unless the caller says otherwise. */
export const ABSTRACT_CHARS = 2000;

function yearOf(item: LibraryItem): number | undefined {
  const y = (item.issued as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0];
  return typeof y === 'number' ? y : undefined;
}

/** An abstract as plain text: registry markup (JATS tags) and runs of space removed, cut to `max` characters. */
export function plainAbstract(raw: string, max: number): string {
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function entryOf(item: LibraryItem, abstractChars: number): SourceContextEntry {
  const names = (item.author ?? item.editor ?? []) as CslName[];
  const authors = names.slice(0, AUTHORS_SHOWN).map(displayName).filter((n) => n.length > 0);
  if (names.length > AUTHORS_SHOWN) authors.push('et al.');
  const year = yearOf(item);
  const venue = item['container-title'] ?? item.publisher;
  const abstract = item.abstract ? plainAbstract(item.abstract, abstractChars) : '';
  return {
    citekey: item.id,
    title: item.title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(abstract ? { abstract } : {}),
    ...(item.custom.retracted ? { retracted: true as const } : {}),
  };
}

/**
 * The works `keys` name, in that order, and the keys the library holds no
 * work for. A key named twice is shown once.
 */
export function sourceContext(
  library: Library,
  keys: readonly string[],
  opts: { abstractChars?: number } = {},
): { sources: SourceContextEntry[]; missing: string[] } {
  const byKey = new Map(library.entries.map((e) => [e.id, e]));
  const sources: SourceContextEntry[] = [];
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    const item = byKey.get(key);
    if (item) sources.push(entryOf(item, opts.abstractChars ?? ABSTRACT_CHARS));
    else missing.push(key);
  }
  return { sources, missing };
}

/** `sources` as fenced JSON, ready to interpolate into a prompt. */
export function renderSourceContext(sources: readonly SourceContextEntry[]): string {
  return escapeTemplateTokens(fenceUntrusted(JSON.stringify(sources, null, 2)));
}

/**
 * How much of each abstract the outline author and the planner are shown:
 * they choose among the whole library, so each work gets less room than the
 * few a drafter sees.
 */
const LIBRARY_ABSTRACT_CHARS = 600;

/** Every work in the library (none for null), in library order, as fenced JSON for the outline author and the planner. */
export function renderLibraryContext(library: Library | null): string {
  if (!library) return renderSourceContext([]);
  const keys = library.entries.map((e) => e.id);
  return renderSourceContext(sourceContext(library, keys, { abstractChars: LIBRARY_ABSTRACT_CHARS }).sources);
}
