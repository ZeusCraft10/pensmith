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
import { migrate as v1ToV2 } from './migrations/library/v1_to_v2.js';
import { paperDir } from './paths.js';
import { generateCitekey } from './citekey.js';
import { freeCitekey, itemBibtex, libraryBibtex, splitBibtex } from './bibtex-write.js';
import { libraryRis } from './ris-write.js';
import { candidateIdentities, itemFromBibEntry, itemFromCandidate, itemIdentities } from './library-item.js';
import { parseBibByCitekey, parseBibFieldsByCitekey } from './citations.js';
import {
  CURRENT_LIBRARY_VERSION,
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

async function readFrom(file: string): Promise<Library> {
  try {
    return (await loadAndMigrate({
      file,
      schema: LibrarySchema,
      schemaName: 'library',
      currentVersion: CURRENT_LIBRARY_VERSION,
      migrations: MIGRATIONS,
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

/**
 * Read into `lib` every entry of `bibText` that is not what the library would
 * write for its key, keeping the entry's text. An edited entry replaces the
 * item under its key; the item's library-only data (abstract, open-access
 * link, the identifiers it was found by) is kept when the entry still names
 * the same work. Returns the keys read in.
 */
async function readInBibliography(lib: Library, bibText: string, at: string): Promise<string[]> {
  if (bibText.trim() === '') return [];
  const blocks = splitBibtex(bibText);
  lib.bibtex_preamble = blocks.filter((b) => b.type === 'string' || b.type === 'preamble').map((b) => b.text.trim());
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
  const preamble = lib.bibtex_preamble.join('\n');
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
    const lib = await readFrom(file);
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
    return result;
  });
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
 * or open-access link another record has, and retracted if any record says so.
 * Only the preferred record's own identifiers are printed.
 */
function mergedCandidate(members: SourceCandidate[], rank: (s: string) => number): SourceCandidate {
  const ordered = [...members].sort((a, b) => rank(a.source) - rank(b.source));
  const base = { ...ordered[0]! };
  base.abstract ??= ordered.find((m) => m.abstract)?.abstract;
  if (base.abstract === undefined) delete base.abstract;
  const oa = ordered.find((m) => m.oa_pdf_url)?.oa_pdf_url;
  if (!base.oa_pdf_url && oa) base.oa_pdf_url = oa;
  const retracted = ordered.find((m) => m.retracted);
  if (retracted) {
    base.retracted = true;
    if (!base.retraction_details && retracted.retraction_details) base.retraction_details = retracted.retraction_details;
  }
  return base;
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
  const taken = new Set(lib.entries.map((e) => e.id.toLowerCase()));

  const provenanceOf = (g: Group): Provenance[] => [
    ...g.members.map((m) => ({ source: m.source, id: m.id, at })),
    ...(opts.via ? [{ ...opts.via, at }] : []),
  ];

  const work = new Map<Group, MergedWork>();
  const fresh: Array<{ g: Group; c: SourceCandidate; base: string }> = [];
  for (const g of groups) {
    const c = mergedCandidate(g.members, rank);
    const known = g.keys.map((k) => byIdentity.get(k)).find((x): x is LibraryItem => x !== undefined);
    if (!known) {
      fresh.push({ g, c, base: generateCitekey(c) });
      continue;
    }
    known.custom.identities = [...new Set([...known.custom.identities, ...g.keys])];
    known.custom.provenance.push(...provenanceOf(g));
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
    const item = itemFromCandidate(c, citekey, at, { identities: g.keys, provenance: provenanceOf(g) });
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
