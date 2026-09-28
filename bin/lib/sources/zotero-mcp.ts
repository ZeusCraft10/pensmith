// bin/lib/sources/zotero-mcp.ts — the Zotero item normalizer (SRC-16, D-24).
//
// Zotero items reach pensmith two ways, and both come through here:
//   - Tier 2: bin/lib/sources/zotero.ts pulls them from the Zotero Web API
//     (api.zotero.org, with ZOTERO_API_KEY) or the Zotero 7 local API
//     (http://127.0.0.1:23119, PENSMITH_ZOTERO_LOCAL=1) through http.ts;
//   - Tier 1: Claude calls the user's own Zotero MCP server (e.g.
//     https://github.com/54yyyu/zotero-mcp: `zotero_search_items`,
//     `zotero_get_collection_items`, `zotero_get_item_metadata` with
//     format="json") and submits the items to the MCP tool
//     `paper_ingest_zotero_items` (mcp/tools.ts → bin/lib/zotero-ingest.ts).
// Either way an item is the Zotero API's JSON: a full item `{key, library,
// data: {…}}` or its `data` object alone. validateZoteroItem() checks the
// fields pensmith reads (a malformed item is rejected with the zod path of the
// problem), and normalizeZoteroItem() maps it onto the library candidate shape:
//
//   creators        → authors (primary creators, `Family, Given`; a single-field
//                     name is a braced literal `{Name}`) and editors (editor,
//                     seriesEditor); an editor-only work uses its editors as
//                     authors (as Crossref editor-only works do, D-19-13)
//   itemType        → type (CSL spelling: journalArticle → article-journal, …)
//   DOI / ISBN      → doi / isbn (also from `extra` lines)
//   extra           → arXiv / PMID / PMCID / DOI lines, a Better BibTeX
//                     `Citation Key:` line (kept as the citekey, like Zotero
//                     7's own citationKey field)
//   archiveID / url → arXiv id (a preprint's `arXiv:1706.03762`)
//   abstractNote, publicationTitle (or the book / proceedings / website /
//   university / institution title), volume, issue, pages, publisher, date
//   the item       → a `zotero` ref {library, key} (users/<id>, groups/<id> or
//                     local), which lets the library writer merge a re-pulled
//                     identifier-less item instead of duplicating it.
// Notes, attachments and annotations are not works and are skipped.
//
// This module does no I/O and knows nothing about keys: it never sees
// ZOTERO_API_KEY (the client adds the header), so nothing here can leak it.

import { z } from 'zod';
import { generateCitekey } from '../citekey.js';
import { normalizeDoi, normalizeArxiv, normalizePmid, normalizePmcid } from '../doi.js';
import { normIsbn } from '../migrations/library/shape.js';
import type { LibraryCandidate } from '../migrations/library/shape.js';
import { SourceCandidateSchema, type SourceCandidate } from '../schemas/source-candidate.js';
import type { SourceType, ZoteroRef } from '../schemas/source-types.js';

// ---------------------------------------------------------------------------
// The item schema (the fields pensmith reads; everything else passes through).
// ---------------------------------------------------------------------------

/** A Zotero item key: 8 characters from Zotero's alphabet. */
export const ZOTERO_KEY = /^[A-Z0-9]{8}$/;

const Text = z.string();
const Short = z.union([z.string(), z.number()]);

const CreatorSchema = z
  .object({
    creatorType: Text.optional(),
    firstName: Text.optional(),
    lastName: Text.optional(),
    name: Text.optional(),
  })
  .passthrough();

export const ZoteroItemDataSchema = z
  .object({
    key: z.string().regex(ZOTERO_KEY, 'a Zotero item key is 8 characters (A-Z, 0-9)'),
    itemType: z.string().min(1, 'itemType is required'),
    title: Text.optional(),
    creators: z.array(CreatorSchema).optional(),
    date: Text.optional(),
    DOI: Text.optional(),
    ISBN: Text.optional(),
    extra: Text.optional(),
    abstractNote: Text.optional(),
    publicationTitle: Text.optional(),
    bookTitle: Text.optional(),
    proceedingsTitle: Text.optional(),
    websiteTitle: Text.optional(),
    blogTitle: Text.optional(),
    university: Text.optional(),
    institution: Text.optional(),
    repository: Text.optional(),
    archiveID: Text.optional(),
    url: Text.optional(),
    volume: Short.optional(),
    issue: Short.optional(),
    pages: Short.optional(),
    publisher: Text.optional(),
  })
  .passthrough();

const ZoteroLibraryInfoSchema = z
  .object({
    type: z.enum(['user', 'group']),
    id: z.number().int().nonnegative(),
  })
  .passthrough();

/** A full Zotero API item: `{key, library, data}`. */
export const ZoteroApiItemSchema = z
  .object({
    key: z.string().regex(ZOTERO_KEY, 'a Zotero item key is 8 characters (A-Z, 0-9)').optional(),
    library: ZoteroLibraryInfoSchema.optional(),
    data: ZoteroItemDataSchema,
  })
  .passthrough();

export type ZoteroItemData = z.infer<typeof ZoteroItemDataSchema>;
export type ZoteroApiItem = z.infer<typeof ZoteroApiItemSchema>;

/** A validated item: its data and, when the full item said so, its library. */
export interface ZoteroItem {
  readonly data: ZoteroItemData;
  /** `users/<id>` / `groups/<id>` from the item's own `library`, when present. */
  readonly library: string | null;
}

export type ZoteroValidation = { readonly ok: true; readonly item: ZoteroItem } | { readonly ok: false; readonly error: string };

function issuePath(prefix: string, path: ReadonlyArray<string | number>): string {
  return path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : `${acc}.${p}`), prefix);
}

/**
 * Validate one raw item (a full Zotero API item, or its `data` object). The
 * error names the offending field with its path, e.g.
 * `items[2].data.key: a Zotero item key is 8 characters (A-Z, 0-9)`.
 */
export function validateZoteroItem(raw: unknown, label = 'item'): ZoteroValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${label}: expected a Zotero item object, got ${Array.isArray(raw) ? 'an array' : raw === null ? 'null' : typeof raw}` };
  }
  const full = 'data' in raw;
  const parsed = full ? ZoteroApiItemSchema.safeParse(raw) : ZoteroItemDataSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = issuePath(label, first?.path ?? []);
    return { ok: false, error: `${where}: ${first?.message ?? 'invalid'}` };
  }
  if (full) {
    const item = parsed.data as ZoteroApiItem;
    const lib = item.library;
    const library = lib ? `${lib.type === 'group' ? 'groups' : 'users'}/${lib.id}` : null;
    return { ok: true, item: { data: item.data, library } };
  }
  return { ok: true, item: { data: parsed.data as ZoteroItemData, library: null } };
}

// ---------------------------------------------------------------------------
// Normalization.
// ---------------------------------------------------------------------------

/** Item types that are not works (Zotero children and annotations). */
const NON_WORK_TYPES: ReadonlySet<string> = new Set(['attachment', 'note', 'annotation']);

/** Zotero itemType → CSL type (the SOURCE_TYPES vocabulary). */
const TYPE_MAP: Readonly<Record<string, SourceType>> = {
  journalArticle: 'article-journal',
  conferencePaper: 'paper-conference',
  bookSection: 'chapter',
  encyclopediaArticle: 'chapter',
  dictionaryEntry: 'chapter',
  book: 'book',
  report: 'report',
  thesis: 'thesis',
  preprint: 'preprint',
  dataset: 'dataset',
  newspaperArticle: 'article-newspaper',
  magazineArticle: 'article-magazine',
  webpage: 'webpage',
  blogPost: 'webpage',
  forumPost: 'webpage',
};

const EDITOR_TYPES: ReadonlySet<string> = new Set(['editor', 'seriesEditor']);
/** Secondary roles that are neither the work's authors nor its editors. */
const NON_AUTHOR_TYPES: ReadonlySet<string> = new Set(['translator', 'reviewedAuthor', 'contributor', 'commenter', 'counsel', 'wordsBy', 'castMember', 'guest', 'recipient', 'cosponsor']);

function clean(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

/** A Zotero creator as an author string: `Family, Given`, `Family`, or a braced single-field name. */
function creatorName(c: z.infer<typeof CreatorSchema>): string | null {
  const last = clean(c.lastName);
  const first = clean(c.firstName);
  if (last) return first ? `${last}, ${first}` : last;
  const single = clean(c.name);
  if (single) return `{${single.replace(/[{}]/g, '')}}`;
  return first;
}

/** `Key: value` lines of Zotero's `extra` field (CRLF-tolerant; first value wins). */
export function parseExtra(extra: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (extra ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z .-]*?)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const k = m[1].toLowerCase();
    if (!out.has(k)) out.set(k, m[2]);
  }
  return out;
}

/** A bare arXiv id (no prefix, no version) from an id, `arXiv:` form or arxiv.org URL. */
function bareArxiv(v: string | null | undefined): string | null {
  if (!v) return null;
  const url = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?(?:[?#].*)?$/i.exec(v);
  const n = normalizeArxiv(url?.[1] ?? v);
  return n ? n.replace(/^arxiv:/, '').replace(/v\d+$/, '') : null;
}

function yearOf(date: string | undefined, extra: Map<string, string>): number | undefined {
  for (const s of [date, extra.get('original date'), extra.get('issued')]) {
    const m = /\b(1[0-9]{3}|2[01][0-9]{2}|2200)\b/.exec(s ?? '');
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

/** A library candidate from Zotero, with the adapter tag `zotero` and its item ref. */
export type ZoteroCandidate = LibraryCandidate & {
  readonly source: 'zotero';
  readonly id: string;
  readonly title: string;
  readonly authors: string[];
  readonly zotero: ZoteroRef;
};

/**
 * Normalize one validated item. `library` is the item's library when the item
 * itself does not say (`users/<id>`, `groups/<id>` or `local`). Returns null
 * for a note / attachment / annotation or an item without a title.
 */
export function normalizeZoteroItem(item: ZoteroItem, library: string): ZoteroCandidate | null {
  const d = item.data;
  if (NON_WORK_TYPES.has(d.itemType)) return null;
  const title = clean(d.title);
  if (!title) return null;
  const extra = parseExtra(d.extra);
  const authors: string[] = [];
  const editors: string[] = [];
  for (const c of d.creators ?? []) {
    const name = creatorName(c);
    if (!name) continue;
    const role = c.creatorType ?? 'author';
    if (EDITOR_TYPES.has(role)) editors.push(name);
    else if (!NON_AUTHOR_TYPES.has(role)) authors.push(name);
  }
  if (authors.length === 0 && editors.length > 0) authors.push(...editors);

  const doi = normalizeDoi(clean(d.DOI) ?? '') ?? normalizeDoi(extra.get('doi') ?? '');
  const isbn = (clean(d.ISBN) ?? extra.get('isbn') ?? '')
    .split(/[\s,;]+/)
    .map((s) => normIsbn(s))
    .find((s): s is string => s !== null);
  const arxiv = bareArxiv(extra.get('arxiv')) ?? bareArxiv(clean(d.archiveID)) ?? bareArxiv(clean(d.url));
  const pmid = normalizePmid(extra.get('pmid') ?? '');
  const pmcid = normalizePmcid(extra.get('pmcid') ?? '');
  const year = yearOf(d.date, extra);
  const type = TYPE_MAP[d.itemType] ?? 'other';
  const venue =
    clean(d.publicationTitle) ??
    clean(d.proceedingsTitle) ??
    clean(d.bookTitle) ??
    clean(d.websiteTitle) ??
    clean(d.blogTitle) ??
    (d.itemType === 'preprint' ? clean(d.repository) : null);
  const publisher = clean(d.publisher) ?? (d.itemType === 'thesis' ? clean(d.university) : d.itemType === 'report' ? clean(d.institution) : null);
  // users/0 is the Zotero local API's name for "this computer's library".
  const ref: ZoteroRef = { library: item.library !== null && item.library !== 'users/0' ? item.library : library, key: d.key };
  // Zotero 7's citationKey field, else a Better BibTeX `Citation Key:` line,
  // else the generated key (the library writer keeps a valid Pandoc key verbatim).
  const citekey =
    clean((d as Record<string, unknown>)['citationKey']) ?? extra.get('citation key') ?? generateCitekey({ authors, ...(year !== undefined ? { year } : {}) });

  return {
    source: 'zotero',
    id: `zotero:${ref.library}/${ref.key}`,
    citekey,
    title,
    authors,
    editors,
    ...(year !== undefined ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(isbn ? { isbn } : {}),
    ...(arxiv ? { arxiv } : {}),
    ...(pmid ? { pmid } : {}),
    ...(pmcid ? { pmcid } : {}),
    ...(clean(d.abstractNote) ? { abstract: clean(d.abstractNote) as string } : {}),
    ...(venue ? { venue } : {}),
    ...(clean(d.volume) ? { volume: clean(d.volume) as string } : {}),
    ...(clean(d.issue) ? { issue: clean(d.issue) as string } : {}),
    ...(clean(d.pages) ? { pages: clean(d.pages) as string } : {}),
    ...(publisher ? { publisher } : {}),
    type,
    zotero: ref,
    // No last_verified: a Zotero record is the user's own copy, not a
    // registrar verification (the freshness recheck still applies to it).
  };
}

/**
 * The research-adapter view of a Zotero candidate (SourceCandidate, which needs
 * at least one author and a D-14 citekey), or null when the item cannot be one.
 */
export function toSourceCandidate(c: ZoteroCandidate): SourceCandidate | null {
  const citekey = /^[a-z][a-z0-9_-]*$/.test(c.citekey ?? '')
    ? (c.citekey as string)
    : generateCitekey({ authors: c.authors, ...(typeof c.year === 'number' ? { year: c.year } : {}) });
  const parsed = SourceCandidateSchema.safeParse({
    source: 'zotero',
    id: c.id,
    title: c.title,
    authors: c.authors,
    ...(typeof c.year === 'number' ? { year: c.year } : {}),
    ...(c.doi ? { doi: c.doi } : {}),
    ...(c.abstract ? { abstract: c.abstract } : {}),
    ...(c.arxiv ? { arxiv: c.arxiv } : {}),
    ...(c.isbn ? { isbn: c.isbn } : {}),
    ...(c.pmid ? { pmid: c.pmid } : {}),
    ...(c.pmcid ? { pmcid: c.pmcid } : {}),
    ...(c.venue ? { venue: c.venue } : {}),
    ...(c.volume ? { volume: String(c.volume) } : {}),
    ...(c.issue ? { issue: String(c.issue) } : {}),
    ...(c.pages ? { pages: c.pages } : {}),
    ...(c.publisher ? { publisher: c.publisher } : {}),
    ...(c.type ? { type: c.type } : {}),
    ...(c.editors && c.editors.length > 0 ? { editors: c.editors } : {}),
    zotero: c.zotero,
    retracted: false,
    last_verified: c.last_verified ?? new Date().toISOString(),
    citekey,
    raw: null,
  });
  return parsed.success ? parsed.data : null;
}
