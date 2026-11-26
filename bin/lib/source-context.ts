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
import { decodeEntities } from './csl-html.js';
import { fencedJson } from './untrusted-fence.js';
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

/**
 * The work's year as LIBRARY.json holds it, however early or late, so a
 * prompt shows 1265 for Aquinas and -350 for Aristotle. (work-record's
 * cslDateYear keeps only 1500 to 2100, the range Pass 1 compares with
 * registry records.) A year written as a string, as Zotero writes
 * date-parts, is read from its leading digits; a number that is not a whole
 * year, or a string that does not start with one, gives no year.
 */
function yearOf(item: LibraryItem): number | undefined {
  const y: unknown = (item.issued as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0];
  if (typeof y === 'number') return Number.isInteger(y) ? y : undefined;
  if (typeof y !== 'string') return undefined;
  const m = /^\s*(-?\d{1,4})(?!\d)/.exec(y);
  return m ? Number(m[1]) : undefined;
}

/**
 * A markup tag: `<` then a letter or `/` (`<jats:p>`, `</i>`, `<br/>`). A `<`
 * before a space or a digit is a comparison ("p < 0.05", "x<0.5") and stays.
 * The tag's name, without a namespace prefix, is captured.
 */
const TAG = /<\/?(?:[A-Za-z][\w.-]*:)*([A-Za-z][\w.-]*)(?:\s[^<>]*)?\/?>/g;

/**
 * Tags that mark up words inside a sentence (italics, superscripts, links,
 * inline maths). They are removed with nothing in their place, so
 * "<i>in vivo</i>, with" reads "in vivo, with", as the source has it, and a
 * quotation copied from the abstract matches the source. Any other tag (a
 * paragraph, a section title, a line break) ends a run of text and leaves a
 * space, so two paragraphs never run together.
 */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'b', 'bold', 'code', 'em', 'ext-link', 'font', 'i', 'inline-formula', 'italic', 'mi', 'mn', 'mo',
  'monospace', 'mrow', 'msub', 'msup', 'mtext', 'math', 'named-content', 'sc', 'small', 'span', 'strong',
  'styled-content', 'sub', 'sup', 'tex-math', 'tt', 'u', 'underline', 'xref',
]);

/** An abstract as plain text: registry markup (JATS tags) and entities resolved, runs of space removed, cut to `max` characters. */
export function plainAbstract(raw: string, max: number): string {
  const untagged = raw.replace(TAG, (_tag, name: string) => (INLINE_TAGS.has(name.toLowerCase()) ? '' : ' '));
  const text = decodeEntities(untagged).replace(/\s+/g, ' ').trim();
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
 * work for (every key, for no library). A key named twice is shown once.
 */
export function sourceContext(
  library: Library | null,
  keys: readonly string[],
  opts: { abstractChars?: number } = {},
): { sources: SourceContextEntry[]; missing: string[] } {
  const byKey = new Map((library?.entries ?? []).map((e) => [e.id, e]));
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
  return fencedJson(sources);
}

/**
 * How much of each abstract the outline author and the planner are shown:
 * they choose among the whole library, so each work gets less room than the
 * few a drafter sees.
 */
const LIBRARY_ABSTRACT_CHARS = 600;

/** Every work in the library (none for null), in library order, as fenced JSON for the outline author and the planner. */
export function renderLibraryContext(library: Library | null): string {
  const keys = library?.entries.map((e) => e.id) ?? [];
  return renderSourceContext(sourceContext(library, keys, { abstractChars: LIBRARY_ABSTRACT_CHARS }).sources);
}
