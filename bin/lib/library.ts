// bin/lib/library.ts — the paper's canonical bibliographic store.
//
// .paper/LIBRARY.json holds every work the paper may cite as a CSL-JSON item
// (bin/lib/schemas/library.ts). CITATIONS.bib and CITATIONS.ris are views of
// it, written in the same locked step as LIBRARY.json itself, so research,
// add and revise --research never rewrite the bibliography by hand.
//
// A work is found by its identifiers (bin/lib/library-item.ts), so a work
// research finds again, or the user adds again, keeps the citekey it was given
// the first time; a new work gets a key no other work has had. Nothing here
// removes a work, so a citekey a draft cites never comes to name another one.
//
// CITATIONS.bib is the file verify checks, and a person may edit it or an
// older pensmith may have written it. Before each write, any entry that is not
// what the library would write (an edited entry, or one the library does not
// hold) is read in as it is, and from then on written back byte for byte. So
// no entry, field or retraction flag is lost, and nothing verify checked is
// re-rendered.
//
// Every write goes through updateLibrary: one lock on LIBRARY.json for the
// read, the change and the three writes.

import { existsSync, readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate, type Migration } from './migrations/loader.js';
import { migrate as v1ToV2, migrateWithReport as v1ToV2WithReport, type LeftOut } from './migrations/library/v1_to_v2.js';
import { paperDir } from './paths.js';
import { generateCitekey } from './citekey.js';
import { freeCitekey, itemBibtex, libraryBibtex, splitBibtex } from './bibtex-write.js';
import { libraryRis } from './ris-write.js';
import { candidateIdentities, identityKeys, itemFromBibEntry, itemFromCandidate, itemIdentities } from './library-item.js';
import { bareArxivId } from './doi.js';
import { parseBibByCitekey, parseBibFieldsByCitekey } from './citations.js';
import {
  CURRENT_LIBRARY_VERSION,
  LibraryItemSchema,
  Schema as LibrarySchema,
  type Library,
  type LibraryItem,
  type Provenance,
} from './schemas/library.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

export type { Library, LibraryItem } from './schemas/library.js';

const MIGRATIONS: Record<number, Migration> = { 1: (v) => v1ToV2(v) };

/** .paper/LIBRARY.json under the project at `root`. */
export function libraryFile(root: string): string {
  return join(paperDir(root), 'LIBRARY.json');
}

function emptyLibrary(): Library {
  return { $schemaVersion: CURRENT_LIBRARY_VERSION, entries: [], bibtex_preamble: [] };
}

function isMissing(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  return e?.code === 'ENOENT' || e?.cause?.code === 'ENOENT';
}

/** The library in `file`; `leftOut` gathers the v1 entries a migration left out. */
async function readFrom(file: string, leftOut?: LeftOut[]): Promise<Library> {
  const migrations: Record<number, Migration> = leftOut
    ? {
      1: (v) => {
        const r = v1ToV2WithReport(v);
        leftOut.push(...r.leftOut);
        return r.library;
      },
    }
    : MIGRATIONS;
  try {
    return (await loadAndMigrate({
      file,
      schema: LibrarySchema,
      schemaName: 'library',
      currentVersion: CURRENT_LIBRARY_VERSION,
      migrations,
    })) as Library;
  } catch (err) {
    if (isMissing(err)) return emptyLibrary();
    throw err;
  }
}

/**
 * The library of the project at `root`, migrated to the current version in
 * memory (the file is upgraded at the next write). A project with no
 * LIBRARY.json has an empty library. A newer version on disk throws
 * ForwardIncompatError rather than being misread.
 */
export async function loadLibrary(root: string): Promise<Library> {
  return readFrom(libraryFile(root));
}

/** loadLibrary, synchronously, for readers that cannot wait; null when the file cannot be read. */
export function readLibrarySync(root: string): Library | null {
  const file = libraryFile(root);
  if (!existsSync(file)) return emptyLibrary();
  try {
    let value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const version = typeof (value as { $schemaVersion?: unknown })?.$schemaVersion === 'number'
      ? (value as { $schemaVersion: number }).$schemaVersion
      : 1;
    for (let v = version; v < CURRENT_LIBRARY_VERSION; v++) value = MIGRATIONS[v]!(value);
    const parsed = LibrarySchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading CITATIONS.bib back in.
// ---------------------------------------------------------------------------

interface ParsedBib {
  entries: Map<string, Record<string, unknown>>;
  fields: Map<string, Record<string, string>>;
}

/** A bibliography as Pass 1 reads it: the CSL entries and the raw fields, by citekey. */
async function parseBib(text: string): Promise<ParsedBib> {
  return { entries: await parseBibByCitekey(text), fields: await parseBibFieldsByCitekey(text) };
}

/** The blocks of a bibliography that are not entries, which the library writes back first. */
const KEPT_BLOCKS: ReadonlySet<string> = new Set(['string', 'preamble', 'comment', 'text']);

/**
 * Read into `lib` every entry of `bibText` that is not what the library would
 * write for its key, keeping the entry's text. An edited entry replaces the
 * item under its key; the item's library-only data (abstract, open-access
 * link, the identifiers it was found by) is kept when the entry still names
 * the same work. Returns the keys read in.
 */
async function readInBibliography(lib: Library, rawBibText: string, at: string): Promise<string[]> {
  // A checkout with CRLF line endings (git's autocrlf) holds the same entries
  // the library wrote; compared byte for byte, every one would read as edited.
  const bibText = rawBibText.replace(/\r\n?/g, '\n');
  if (bibText.trim() === '') return [];
  const blocks = splitBibtex(bibText);
  // @comment blocks (JabRef keeps its metadata in one) and other text between
  // entries are kept beside the @string and @preamble blocks, written first.
  lib.bibtex_preamble = blocks.filter((b) => KEPT_BLOCKS.has(b.type)).map((b) => b.text.trim());
  const macros = blocks.filter((b) => b.type === 'string' || b.type === 'preamble').map((b) => b.text.trim());
  // A key given twice is read as Pass 1 reads it: the last entry counts.
  const entries = new Map(blocks.filter((b) => b.key !== '' && b.type !== 'comment').map((b) => [b.key, b.text.trim()]));
  const index = new Map(lib.entries.map((e, i) => [e.id, i]));
  const changed = [...entries].filter(([key, text]) => {
    const i = index.get(key);
    return i === undefined || itemBibtex(lib.entries[i]!) !== text;
  });
  if (changed.length === 0) return [];

  let bib: ParsedBib | null = null;
  try {
    bib = await parseBib(bibText);
  } catch {
    // One unreadable entry stops citation-js reading the file; each changed
    // entry is then read on its own, and one that still cannot be read is
    // kept as text alone (verify reports the file as unreadable).
  }
  const preamble = macros.join('\n');
  for (const [key, text] of changed) {
    let csl = bib?.entries.get(key);
    let fields = bib?.fields.get(key);
    if (!bib) {
      try {
        const one = await parseBib(`${preamble}\n${text}\n`);
        csl = one.entries.get(key);
        fields = one.fields.get(key);
      } catch {
        csl = undefined;
        fields = undefined;
      }
    }
    const i = index.get(key);
    const prior = i === undefined ? undefined : lib.entries[i]!;
    const item = itemFromBibEntry(key, text, csl, fields, prior?.custom.added_at ?? at, { source: 'CITATIONS.bib', at });
    if (prior) {
      item.custom.provenance = [...prior.custom.provenance, ...item.custom.provenance];
      const ids = itemIdentities(prior);
      if (item.custom.identities.some((k) => ids.includes(k))) {
        item.custom.identities = [...new Set([...item.custom.identities, ...ids])];
        if (prior.abstract && !item.abstract) item.abstract = prior.abstract;
        if (prior.custom.oa_pdf_url) item.custom.oa_pdf_url = prior.custom.oa_pdf_url;
        if (prior.custom.local_text) item.custom.local_text = prior.custom.local_text;
      }
      lib.entries[i!] = item;
    } else {
      index.set(key, lib.entries.length);
      lib.entries.push(item);
    }
  }
  return changed.map(([key]) => key);
}

/**
 * Change the library of the project at `root`: under one lock, read it (and
 * read in any CITATIONS.bib entry it would not write itself), let `fn` change
 * it, then write LIBRARY.json, CITATIONS.bib and CITATIONS.ris from it.
 */
export async function updateLibrary<T>(root: string, fn: (lib: Library, at: string) => T | Promise<T>): Promise<T> {
  const file = libraryFile(root);
  const paper = paperDir(root);
  const bibPath = join(paper, 'CITATIONS.bib');
  return withLock(file, async () => {
    const leftOut: LeftOut[] = [];
    const lib = await readFrom(file, leftOut);
    const at = new Date().toISOString();
    const bibText = existsSync(bibPath) ? await fsp.readFile(bibPath, 'utf8') : '';
    await readInBibliography(lib, bibText, at);
    const result = await fn(lib, at);
    const valid = LibrarySchema.parse(lib);
    // LIBRARY.json first: if the views are not written, the next write
    // writes them from it.
    await atomicWriteFile(file, JSON.stringify(valid, null, 2) + '\n');
    await atomicWriteFile(bibPath, libraryBibtex(valid));
    await atomicWriteFile(join(paper, 'CITATIONS.ris'), libraryRis(valid));
    if (leftOut.length > 0) {
      process.stderr.write(
        `pensmith: WARN — LIBRARY.json was upgraded, leaving out ${leftOut.length} source(s) with no DOI, arXiv ID, ` +
        `PubMed ID or ISBN, which nothing could verify (they were not in CITATIONS.bib either): ` +
        `${leftOut.map((l) => `${l.citekey} ("${l.title}")`).join(', ')}. Their keys are not given to other works.\n`,
      );
    }
    return result;
  });
}

/** Every key a new work may not be given, lowercased: the library's, and those it retired. */
function takenKeys(lib: Library): Set<string> {
  return new Set([...lib.entries.map((e) => e.id), ...(lib.retired_keys ?? [])].map((k) => k.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Merging research candidates by identifier.
// ---------------------------------------------------------------------------

/**
 * Which record of a work the library takes its metadata from when several
 * sources return it, best first, after the discipline's own preference
 * (templates/presets/disciplines.json `sourcePreference`). Registries with
 * structured names and journal data come before display-name sources.
 */
const DEFAULT_SOURCE_ORDER: readonly string[] = ['crossref', 'pubmed', 'zotero-mcp', 'openalex', 'semanticscholar', 'arxiv', 'unpaywall'];

function sourceRank(preference: readonly string[]): (source: string) => number {
  const order = [...preference, ...DEFAULT_SOURCE_ORDER.filter((s) => !preference.includes(s))];
  return (source) => {
    const i = order.indexOf(source);
    return i === -1 ? order.length : i;
  };
}

export interface MergeOptions {
  /** The discipline's source preference, most trusted first. */
  preference?: readonly string[];
  /** Recorded once for each work merged, beside the registries it came from. */
  via?: Omit<Provenance, 'at'>;
}

export interface MergedWork {
  /** The key the work is cited by. */
  citekey: string;
  /** Whether the library already held the work. */
  status: 'added' | 'existing';
  title: string;
  /** The candidates that are this work. */
  candidates: SourceCandidate[];
}

export interface MergeResult {
  works: MergedWork[];
  /** Candidates with no DOI, arXiv ID, PMID, PMC ID or ISBN: nothing could verify them, so none is stored. */
  skipped: SourceCandidate[];
}

interface Group {
  members: SourceCandidate[];
  keys: string[];
}

/** Candidates that share any identifier, grouped as one work each, in first-seen order. */
function groupByIdentity(candidates: SourceCandidate[]): Group[] {
  const groups: Group[] = [];
  for (const c of candidates) {
    const keys = candidateIdentities(c);
    const hits = groups.filter((g) => g.keys.some((k) => keys.includes(k)));
    const into = hits[0] ?? { members: [], keys: [] };
    if (!hits[0]) groups.push(into);
    for (const other of hits.slice(1)) {
      into.members.push(...other.members);
      into.keys.push(...other.keys);
      groups.splice(groups.indexOf(other), 1);
    }
    into.members.push(c);
    into.keys = [...new Set([...into.keys, ...keys])];
  }
  return groups;
}

/**
 * One candidate for a group: the preferred source's record, with an abstract
 * or open-access link another record has, retracted if any record says so,
 * and the other records' identifiers and sources kept as also_known_as and
 * merged_from. Only the preferred record's own identifiers are printed.
 */
function mergedCandidate(g: Group, rank: (s: string) => number): SourceCandidate {
  const ordered = [...g.members].sort((a, b) => rank(a.source) - rank(b.source));
  const base: SourceCandidate = { ...ordered[0]! };
  const others = ordered.slice(1);
  if (others.length === 0) return base;
  const abstract = ordered.find((m) => m.abstract)?.abstract;
  if (abstract && !base.abstract) base.abstract = abstract;
  const oa = ordered.find((m) => m.oa_pdf_url)?.oa_pdf_url;
  if (oa && !base.oa_pdf_url) base.oa_pdf_url = oa;
  const retracted = ordered.find((m) => m.retracted);
  if (retracted) {
    base.retracted = true;
    if (!base.retraction_details && retracted.retraction_details) base.retraction_details = retracted.retraction_details;
  }
  base.also_known_as = g.keys;
  base.merged_from = [
    ...(base.merged_from ?? []),
    ...others.flatMap((m) => [{ source: m.source, id: m.id }, ...(m.merged_from ?? [])]),
  ];
  return base;
}

/**
 * The works among `candidates`: those sharing an identifier merged into one
 * (mergedCandidate), in first-seen order, and the candidates with no
 * identifier, which nothing could verify. research shows the user these
 * works; mergeCandidates stores them.
 */
export function groupCandidates(
  candidates: SourceCandidate[],
  preference: readonly string[] = [],
): { works: SourceCandidate[]; skipped: SourceCandidate[] } {
  const rank = sourceRank(preference);
  const skipped = candidates.filter((c) => candidateIdentities(c).length === 0);
  const groups = groupByIdentity(candidates.filter((c) => candidateIdentities(c).length > 0));
  return { works: groups.map((g) => mergedCandidate(g, rank)), skipped };
}

/**
 * Merge `candidates` into `lib`. Candidates sharing an identifier are one
 * work. A work the library already holds keeps its key and its entry; it
 * gains the other identifiers it is known by, an abstract or open-access link
 * it lacked, and a retraction a record reports. A new work gets the key
 * generated from its first author and year, suffixed past every key already
 * used (new works are keyed in a fixed order, so the keys do not depend on the
 * order the sources answered in). Candidates with no identifier are skipped.
 */
export function mergeCandidates(lib: Library, candidates: SourceCandidate[], at: string, opts: MergeOptions = {}): MergeResult {
  const skipped = candidates.filter((c) => candidateIdentities(c).length === 0);
  const groups = groupByIdentity(candidates.filter((c) => candidateIdentities(c).length > 0));
  const rank = sourceRank(opts.preference ?? []);

  const byIdentity = new Map<string, LibraryItem>();
  for (const item of lib.entries) for (const k of itemIdentities(item)) if (!byIdentity.has(k)) byIdentity.set(k, item);
  const taken = takenKeys(lib);

  const provenanceOf = (c: SourceCandidate): Provenance[] => [
    { source: c.source, id: c.id, at },
    ...(c.merged_from ?? []).map((m) => ({ ...m, at })),
    ...(opts.via ? [{ ...opts.via, at }] : []),
  ];

  const work = new Map<Group, MergedWork>();
  const fresh: Array<{ g: Group; c: SourceCandidate; base: string }> = [];
  for (const g of groups) {
    const c = mergedCandidate(g, rank);
    const known = g.keys.map((k) => byIdentity.get(k)).find((x): x is LibraryItem => x !== undefined);
    if (!known) {
      fresh.push({ g, c, base: generateCitekey(c) });
      continue;
    }
    known.custom.identities = [...new Set([...known.custom.identities, ...g.keys])];
    known.custom.provenance.push(...provenanceOf(c));
    if (!known.abstract && c.abstract) known.abstract = c.abstract;
    if (!known.custom.oa_pdf_url && c.oa_pdf_url) known.custom.oa_pdf_url = c.oa_pdf_url;
    if (c.retracted && !known.custom.retracted) {
      known.custom.retracted = true;
      if (c.retraction_details) known.custom.retraction_details = c.retraction_details;
    }
    for (const k of g.keys) if (!byIdentity.has(k)) byIdentity.set(k, known);
    work.set(g, { citekey: known.id, status: 'existing', title: known.title, candidates: g.members });
  }

  fresh.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.g.keys[0]! < b.g.keys[0]! ? -1 : 1));
  for (const { g, c, base } of fresh) {
    const citekey = freeCitekey(base, taken);
    const item = itemFromCandidate(c, citekey, at, { identities: g.keys, provenance: provenanceOf(c) });
    lib.entries.push(item);
    for (const k of g.keys) byIdentity.set(k, item);
    work.set(g, { citekey, status: 'added', title: item.title, candidates: g.members });
  }

  return { works: groups.map((g) => work.get(g)!), skipped };
}

/** Merge `candidates` into the library of the project at `root` (mergeCandidates), writing it and its views. */
export function addToLibrary(root: string, candidates: SourceCandidate[], opts: MergeOptions = {}): Promise<MergeResult> {
  return updateLibrary(root, (lib, at) => mergeCandidates(lib, candidates, at, opts));
}

// ---------------------------------------------------------------------------
// Importing a bibliography file (`pensmith add refs.bib` / `refs.json`).
// ---------------------------------------------------------------------------

/** The result of importing a file: each entry's work, and the entries no identifier names. */
export interface ImportResult {
  works: Array<Omit<MergedWork, 'candidates'>>;
  /** Keys (as imported) of entries with no DOI, arXiv ID, PMID or ISBN: verify can never confirm them. */
  unidentified: string[];
}

/**
 * Put an imported `item` into `lib`: a work the library already holds (by
 * identifier) keeps its key and is not added again; a new one keeps its own
 * key when no work has it, and otherwise gets the next free one. Returns the
 * work and the key it is filed under.
 */
function placeImported(lib: Library, item: LibraryItem, taken: Set<string>): Omit<MergedWork, 'candidates'> {
  const ids = itemIdentities(item);
  const known = lib.entries.find((e) => itemIdentities(e).some((k) => ids.includes(k)));
  if (known) {
    known.custom.identities = [...new Set([...known.custom.identities, ...ids])];
    known.custom.provenance.push(...item.custom.provenance);
    return { citekey: known.id, status: 'existing', title: known.title };
  }
  const key = freeCitekey(item.id, taken);
  if (key !== item.id) {
    // The entry is written as it was imported, under its new key.
    if (item.custom.bibtex) item.custom.bibtex = item.custom.bibtex.replace(/^(@\s*\w+\s*[{(]\s*)[^,\s]+/, `$1${key}`);
    item.id = key;
  }
  lib.entries.push(item);
  return { citekey: key, status: 'added', title: item.title };
}

/**
 * Import the entries of BibTeX `text` (read from `file`) into `lib`, each
 * written back exactly as it is in the file (under a new key only when its
 * own is taken). @string blocks it defines are kept for the entries that use
 * them.
 */
export async function importBibliography(lib: Library, rawText: string, at: string, file: string): Promise<ImportResult> {
  const text = rawText.replace(/\r\n?/g, '\n');
  const blocks = splitBibtex(text);
  const preamble = blocks.filter((b) => b.type === 'string' || b.type === 'preamble').map((b) => b.text.trim());
  for (const p of preamble) if (!lib.bibtex_preamble.includes(p)) lib.bibtex_preamble.push(p);
  const bib = await parseBib(text);
  const taken = takenKeys(lib);
  const result: ImportResult = { works: [], unidentified: [] };
  for (const b of blocks) {
    if (b.key === '' || b.type === 'comment') continue;
    const item = itemFromBibEntry(b.key, b.text.trim(), bib.entries.get(b.key), bib.fields.get(b.key), at, { source: 'bibtex', file, at });
    if (itemIdentities(item).length === 0) result.unidentified.push(b.key);
    result.works.push(placeImported(lib, item, taken));
  }
  return result;
}

// A key BibTeX takes as it is and a citation can name: letters, digits and
// underscores, from a letter. citation-js writes any other key as a label of
// its own making, which would file one work under two keys, one in
// LIBRARY.json and another in CITATIONS.bib. Zotero's own export uses each
// item's URI as its id.
const IMPORTABLE_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

// CSL's name variables: lists of name objects.
const CSL_NAME_VARIABLES: ReadonlySet<string> = new Set([
  'author', 'editor', 'translator', 'container-author', 'collection-editor', 'composer', 'director',
  'editorial-director', 'illustrator', 'interviewer', 'original-author', 'recipient', 'reviewed-author',
  'chair', 'compiler', 'contributor', 'curator', 'executive-producer', 'guest', 'host', 'narrator',
  'organizer', 'performer', 'producer', 'script-writer', 'series-creator',
]);

/** A CSL name without its empty parts, or null when none is left. */
function cslName(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = Object.fromEntries(Object.entries(raw).filter(([, v]) => !(typeof v === 'string' && v.trim() === '')));
  return ['family', 'given', 'literal'].some((k) => typeof name[k] === 'string') ? name : null;
}

/**
 * A CSL-JSON item as the library reads one. CSL lets a number variable
 * (volume, issue, page, number, edition) be a number and a name part be
 * empty; the library keeps variables as non-empty strings, so one such item
 * would otherwise make the whole file unreadable.
 */
function normalizedCsl(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = String(v);
    } else if (typeof v === 'string') {
      if (v.trim() !== '') out[k] = v;
    } else if (CSL_NAME_VARIABLES.has(k) && Array.isArray(v)) {
      const names = v.map(cslName).filter((n): n is Record<string, unknown> => n !== null);
      if (names.length > 0) out[k] = names;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Import CSL-JSON `items` (read from `file`): each a library item under its
 * own `citation-key` or `id` when that is a key BibTeX can write and no work
 * has it, else under a key made from its first author and year.
 */
export function importCslJson(lib: Library, items: unknown[], at: string, file: string): ImportResult {
  const taken = takenKeys(lib);
  const result: ImportResult = { works: [], unidentified: [] };
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const csl = normalizedCsl(raw as Record<string, unknown>);
    const year = Number((csl['issued'] as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0]?.[0]);
    const authors = Array.isArray(csl['author']) ? (csl['author'] as Array<Record<string, unknown>>) : [];
    const first = authors[0];
    const ownKey = [csl['citation-key'], csl['id']].find((k): k is string => typeof k === 'string' && IMPORTABLE_KEY.test(k));
    const key = ownKey ?? generateCitekey({
      authors: first ? [String(first['family'] ?? first['literal'] ?? first['given'] ?? '')] : [],
      ...(Number.isInteger(year) ? { year } : {}),
    });
    const fields = Object.fromEntries(Object.entries(csl).filter(([k]) => k !== 'custom' && k !== 'citation-key'));
    const str = (k: string): string | undefined => (typeof csl[k] === 'string' ? (csl[k] as string) : undefined);
    const arxiv = bareArxivId(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i.exec(str('URL') ?? '')?.[1] ?? '') ?? bareArxivId(str('number') ?? '');
    const item = LibraryItemSchema.parse({
      ...fields,
      id: key,
      type: str('type') ?? 'document',
      title: str('title') ?? '',
      custom: {
        ...(arxiv ? { arxiv } : {}),
        identities: identityKeys({ doi: str('DOI'), arxiv: arxiv ?? undefined, pmid: str('PMID'), pmcid: str('PMCID'), isbn: str('ISBN') }),
        provenance: [{ source: 'csl-json', file, at }],
        added_at: at,
      },
    });
    if (itemIdentities(item).length === 0) result.unidentified.push(key);
    result.works.push(placeImported(lib, item, taken));
  }
  return result;
}
