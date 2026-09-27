// bin/lib/library.ts — the ONE writer of the per-paper source library
// (BRDTH-01 / D-17-43; LIB-01 / D-59 foundation).
//
// `.paper/LIBRARY.json` is the paper's source of truth for sources, and
// `.paper/CITATIONS.bib` and `.paper/CITATIONS.ris` are RENDERED from it. This
// module is the only code that writes any of the three (chokepoint row
// `library-writer`, scripts/chokepoints/library-writer.json). Every ingest path
// — research (Step 7), `add`, `plan --research`, and later BYO PDFs and Zotero —
// calls upsertSources().
//
// It composes the lower-level chokepoints:
//   atomicWriteFile (D-04)  — crash-safe writes via tmp+rename
//   withLock        (D-26)  — one critical section per paper library
//   loadAndMigrate  (D-37)  — version envelope, v1→v2 migration, zod validation
//   openSessionLog  (D-49)  — JSONL structured log, kind:'event'
//
// upsertSources, under ONE lock on LIBRARY.json (read → merge → validate →
// write LIBRARY.json → render CITATIONS.bib + CITATIONS.ris):
//   1. Imports any CITATIONS.bib entry whose key is not in LIBRARY.json (the
//      pre-BRDTH-01 `add` wrote only the bib; a user may have hand-edited it),
//      tagged `bib-import`, so re-rendering the bib never drops a citation a
//      draft may use. An unparseable bib is kept as a backup next to it.
//   2. For each candidate, finds the existing entry for the same work:
//        a. doi.ts-normalized DOI (primary or alternate), then
//        b. arXiv id, PMID, PMCID, ISBN(-13), then
//        c. the version rule: normalized titles with Jaro-Winkler >= 0.95, the
//           same first-author family name, and years at most 1 apart — applied
//           only when at least one side is NOT a version of record (a
//           preprint-server DOI such as SSRN / Research Square / arXiv /
//           bioRxiv, or no DOI at all). Two distinct version-of-record DOIs
//           never collapse (annual editorials share titles and authors).
//   3. Merges into it: the richer field wins (longer abstract, longer author
//      list, any missing identifier / OA URL / venue), provenance tags are
//      unioned, `retracted` is sticky, `last_verified` keeps the latest time.
//      When a version of record meets a preprint, the version of record's DOI
//      becomes primary and the preprint DOI moves to alternate_dois — which are
//      CANDIDATES only (Pass 1 accepts one only when the registrar asserts the
//      relation, VRFY-14) — and the record's title / year / venue / authors win.
//   4. Otherwise appends a new entry whose citekey is unique in the library
//      (base-26 collision suffix, audit #21).
//   An existing entry's citekey NEVER changes: it is the primary key shared with
//   CITATIONS.bib, PLAN.md assigned_sources[] and the drafts' [@citekey] tokens.
//
// Paper root (D-17-32): every function takes the project root (the folder that
// contains `.paper/`) and resolves `.paper/` itself; the `.paper` directory
// itself is accepted too, so callers written either way address one file.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate, ForwardIncompatError } from './migrations/loader.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import { migrate as migrateLibraryV1toV2 } from './migrations/library/v1_to_v2.js';
import {
  candidateToEntry,
  isPreprintDoi,
  normArxiv,
  normTitle,
  type LibraryCandidate,
} from './migrations/library/shape.js';
import {
  Schema as LibrarySchema,
  CURRENT_LIBRARY_VERSION,
  CITEKEY_GRAMMAR,
  type Library,
  type LibraryEntry,
} from './schemas/library.js';
import { renderBibtex, suffixForCollision } from './bibtex-write.js';
import { renderRis } from './ris-write.js';
import { parseBib } from './citations.js';
import { jaroWinkler } from './fuzzy.js';
import { firstAuthorSurname } from './author-normalize.js';
import { generateCitekey } from './citekey.js';
import { paperDir } from './paths.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

export type { LibraryCandidate } from './migrations/library/shape.js';
export type { Library, LibraryEntry } from './schemas/library.js';

/** The version-matching threshold on normalized titles (D-17-43). */
export const VERSION_TITLE_JW = 0.95;

/** Registered forward migrations for LIBRARY.json, keyed by FROM version. */
export const LIBRARY_MIGRATIONS: Record<number, (input: unknown) => unknown> = {
  1: (input) => migrateLibraryV1toV2(input),
};

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class LibraryNotFoundError extends Error {
  code = 'LIBRARY_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LibraryNotFoundError';
  }
}

export class LibraryAlreadyExistsError extends Error {
  code = 'LIBRARY_ALREADY_EXISTS' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LibraryAlreadyExistsError';
  }
}

/**
 * An existing LIBRARY.json that cannot be read (bad JSON, or not the library
 * schema) — an expected, user-fixable condition: one line naming the file and
 * how to recover (RUN-12), never an internal-error hint.
 */
export class LibraryInvalidError extends PensmithError {
  constructor(file: string, detail: string) {
    super(
      `${file} is not a valid pensmith library (${detail}) — repair it, or move it aside (rename it, e.g. to ` +
        'LIBRARY.json.bak) and re-run: the library is rebuilt from research and CITATIONS.bib',
      EXIT_ERROR,
    );
    this.name = 'LibraryInvalidError';
  }
}

// ---------------------------------------------------------------------------
// Paths.
// ---------------------------------------------------------------------------

export interface LibraryPaths {
  /** The `.paper` directory. */
  dir: string;
  library: string;
  bib: string;
  ris: string;
}

/** The three library files of the paper at `root` (project root, or its `.paper`). */
export function libraryPaths(root: string): LibraryPaths {
  const abs = path.resolve(root);
  const dir = path.basename(abs) === '.paper' ? abs : paperDir(abs);
  return {
    dir,
    library: path.join(dir, 'LIBRARY.json'),
    bib: path.join(dir, 'CITATIONS.bib'),
    ris: path.join(dir, 'CITATIONS.ris'),
  };
}

// Lazy module-level logger (reads paths.ts at first use, so tests that redirect
// the data dir before importing observe the redirect).
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) _log = openSessionLog({ scope: 'auto' }).child({ module: 'library' });
  return _log;
}

function isEnoent(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  return err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT';
}

/** Read + migrate + validate, WITHOUT the lock (callers hold it). Null when absent. */
async function readUnlocked(file: string, writeBack: boolean): Promise<Library | null> {
  try {
    return (await loadAndMigrate({
      file,
      schema: LibrarySchema,
      schemaName: 'library',
      currentVersion: CURRENT_LIBRARY_VERSION,
      migrations: LIBRARY_MIGRATIONS,
      writeBack,
    })) as Library;
  } catch (e) {
    if (isEnoent(e)) return null;
    throw e;
  }
}

/** Write `text` to `file` unless it already holds exactly that (no mtime churn). */
async function writeIfChanged(file: string, text: string): Promise<boolean> {
  try {
    if ((await fsp.readFile(file, 'utf8')) === text) return false;
  } catch {
    /* absent — write it */
  }
  await atomicWriteFile(file, text);
  return true;
}

/** Persist a validated library and its two rendered citation files (lock held). */
async function persist(paths: LibraryPaths, library: Library): Promise<void> {
  const validated = LibrarySchema.parse(library);
  await writeIfChanged(paths.library, JSON.stringify(validated, null, 2) + '\n');
  await writeIfChanged(paths.bib, renderBibtex(validated.entries));
  await writeIfChanged(paths.ris, renderRis(validated.entries));
}

// ---------------------------------------------------------------------------
// Read API.
// ---------------------------------------------------------------------------

/**
 * Create an empty v2 LIBRARY.json for the paper at `root`. Refuses to
 * overwrite an existing one (LibraryAlreadyExistsError). The existence check
 * runs INSIDE the lock (BLOCKER-01), so concurrent inits cannot both seed.
 */
export async function initLibrary(root: string): Promise<Library> {
  const paths = libraryPaths(root);
  const seeded: Library = LibrarySchema.parse({ $schemaVersion: CURRENT_LIBRARY_VERSION, entries: [] });
  await withLock(paths.library, async () => {
    try {
      await fsp.access(paths.library);
      throw new LibraryAlreadyExistsError(`LIBRARY.json already exists at ${paths.library}`);
    } catch (e) {
      if (e instanceof LibraryAlreadyExistsError) throw e;
      if ((e as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw e;
    }
    await atomicWriteFile(paths.library, JSON.stringify(seeded, null, 2) + '\n');
  });
  log().event({ event: 'library.init', entryCount: 0, schemaVersion: seeded.$schemaVersion });
  return seeded;
}

/**
 * Read LIBRARY.json, migrating an older version forward (and writing the
 * migrated file back, under the lock — BLOCKER-02), and validate it.
 * LibraryNotFoundError when absent; ForwardIncompatError (newer file) and
 * SchemaValidationError propagate unchanged (T-01-COMPAT-01).
 */
export async function loadLibrary(root: string): Promise<Library> {
  const paths = libraryPaths(root);
  const value = await withLock(paths.library, () => readUnlocked(paths.library, true));
  if (!value) throw new LibraryNotFoundError(`LIBRARY.json not found at ${paths.library}`);
  log().event({ event: 'library.load', entryCount: value.entries.length, schemaVersion: value.$schemaVersion });
  return value;
}

/**
 * Check, read-only, that the paper's LIBRARY.json (when present) loads: a
 * verb that will write the library (research) calls it BEFORE any search or
 * model call, so a corrupt file costs nothing. Throws LibraryInvalidError
 * (one line) for bad JSON or a schema mismatch; a newer-version file keeps its
 * ForwardIncompatError (upgrade pensmith). Never writes, never migrates.
 */
export async function assertLibraryReadable(root: string): Promise<void> {
  const paths = libraryPaths(root);
  try {
    await withLock(paths.library, () => readUnlocked(paths.library, false));
  } catch (e) {
    if (e instanceof ForwardIncompatError) throw e;
    const detail = (e instanceof Error ? e.message : String(e)).replace(/^pensmith: /, '').split('\n')[0] ?? '';
    throw new LibraryInvalidError(paths.library, detail.length > 200 ? `${detail.slice(0, 200)}…` : detail);
  }
}

/** loadLibrary, or null when the paper has no LIBRARY.json yet. */
export async function tryLoadLibrary(root: string): Promise<Library | null> {
  try {
    return await loadLibrary(root);
  } catch (e) {
    if (e instanceof LibraryNotFoundError) return null;
    throw e;
  }
}

/**
 * The first entry matching `predicate`, or undefined. Reads a snapshot; use
 * upsertSources' outcomes for add-then-find atomicity.
 */
export async function findEntry(
  root: string,
  predicate: (e: LibraryEntry) => boolean,
): Promise<LibraryEntry | undefined> {
  const lib = await loadLibrary(root);
  return lib.entries.find(predicate);
}

// ---------------------------------------------------------------------------
// Matching and merging.
// ---------------------------------------------------------------------------

export type MatchKind = 'doi' | 'arxiv' | 'pmid' | 'pmcid' | 'isbn' | 'version';

function familyName(authors: string[]): string {
  return firstAuthorSurname(authors[0] ?? '').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** A version of record: has a DOI that no preprint server minted. */
function isVersionOfRecord(e: LibraryEntry): boolean {
  return e.doi !== null && !isPreprintDoi(e.doi);
}

/** Same work by the version rule (title JW, first author, year), see header. */
export function sameWorkVersion(a: LibraryEntry, b: LibraryEntry): boolean {
  if (!a.title || !b.title || a.year === null || b.year === null) return false;
  if (Math.abs(a.year - b.year) > 1) return false;
  if (isVersionOfRecord(a) && isVersionOfRecord(b)) return false;
  const fa = familyName(a.authors);
  const fb = familyName(b.authors);
  if (!fa || fa !== fb) return false;
  const ta = normTitle(a.title);
  const tb = normTitle(b.title);
  if (!ta || !tb) return false;
  return jaroWinkler(ta, tb) >= VERSION_TITLE_JW;
}

function findMatch(entries: LibraryEntry[], d: LibraryEntry): { entry: LibraryEntry; by: MatchKind } | null {
  if (d.doi || d.alternate_dois.length > 0) {
    const mine = new Set([d.doi, ...d.alternate_dois].filter((x): x is string => x !== null));
    const hit = entries.find((e) => [e.doi, ...e.alternate_dois].some((x) => x !== null && mine.has(x)));
    if (hit) return { entry: hit, by: 'doi' };
  }
  const byField = (k: 'arxiv' | 'pmid' | 'pmcid' | 'isbn'): LibraryEntry | undefined =>
    d[k] ? entries.find((e) => e[k] === d[k]) : undefined;
  for (const k of ['arxiv', 'pmid', 'pmcid', 'isbn'] as const) {
    const hit = byField(k);
    if (hit) return { entry: hit, by: k };
  }
  const version = entries.find((e) => sameWorkVersion(e, d));
  return version ? { entry: version, by: 'version' } : null;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function longer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

/** Merge `d` (incoming) into `e` in place. Returns true when `e` changed. */
function mergeInto(e: LibraryEntry, d: LibraryEntry, now: string): boolean {
  const before = JSON.stringify(e);

  // The version of record wins the primary DOI over a preprint DOI.
  // `incomingIsRecord`: the incoming record becomes the version of record, so
  // its bibliographic fields (what the citation will point at) win.
  let incomingIsRecord = false;
  if (d.doi && d.doi !== e.doi) {
    if (!e.doi) {
      e.doi = d.doi;
      incomingIsRecord = !isPreprintDoi(d.doi);
    } else if (isPreprintDoi(e.doi) && !isPreprintDoi(d.doi)) {
      e.alternate_dois = union(e.alternate_dois, [e.doi]);
      e.doi = d.doi;
      incomingIsRecord = true;
    } else {
      e.alternate_dois = union(e.alternate_dois, [d.doi]);
    }
  }
  e.alternate_dois = union(e.alternate_dois, d.alternate_dois).filter((x) => x !== e.doi);

  for (const k of ['arxiv', 'pmid', 'pmcid', 'isbn'] as const) {
    if (e[k] === null && d[k] !== null) e[k] = d[k];
  }

  if (incomingIsRecord) {
    e.title = d.title ?? e.title;
    e.year = d.year ?? e.year;
    e.venue = d.venue ?? e.venue;
    if (d.authors.length > 0) e.authors = d.authors;
  } else {
    e.title = e.title ?? d.title;
    e.year = e.year ?? d.year;
    e.venue = e.venue ?? d.venue;
    if (d.authors.length > e.authors.length) e.authors = d.authors;
  }
  e.abstract = longer(e.abstract, d.abstract);
  e.oa_url = e.oa_url ?? d.oa_url;
  e.provenance = union(e.provenance, d.provenance);
  e.retracted = e.retracted || d.retracted;
  e.retraction_details = e.retraction_details ?? d.retraction_details;
  e.synthetic = e.synthetic || d.synthetic;
  e.last_verified = later(e.last_verified, d.last_verified);
  e.byo = e.byo ?? d.byo;

  const changed = JSON.stringify(e) !== before;
  if (changed) e.updatedAt = now;
  return changed;
}

function uniqueCitekey(d: LibraryEntry, taken: Set<string>): string {
  if (!taken.has(d.citekey)) return d.citekey;
  const base = generateCitekey({
    authors: d.authors,
    ...(d.year !== null ? { year: d.year } : {}),
  });
  if (!taken.has(base)) return base;
  for (let n = 1; ; n += 1) {
    const k = base + suffixForCollision(n);
    if (!taken.has(k)) return k;
  }
}

// ---------------------------------------------------------------------------
// Legacy bib import (entries that exist only in CITATIONS.bib).
// ---------------------------------------------------------------------------

const BIB_KEY_RE = /^@\w+\s*\{\s*([^,\s]+)\s*,/gm;

function cslToCandidate(csl: Record<string, unknown>): LibraryCandidate {
  const x = csl as {
    id?: unknown;
    title?: unknown;
    author?: Array<{ family?: unknown; given?: unknown; literal?: unknown }>;
    DOI?: unknown;
    ISBN?: unknown;
    number?: unknown;
    note?: unknown;
    abstract?: unknown;
    URL?: unknown;
    issued?: { 'date-parts'?: unknown[][] };
    'container-title'?: unknown;
  };
  const title = Array.isArray(x.title) ? x.title[0] : x.title;
  const authors = (Array.isArray(x.author) ? x.author : [])
    .map((a) => {
      const fam = typeof a?.family === 'string' ? a.family.trim() : '';
      const giv = typeof a?.given === 'string' ? a.given.trim() : '';
      if (fam) return giv ? `${fam}, ${giv}` : fam;
      return typeof a?.literal === 'string' ? a.literal.trim() : '';
    })
    .filter((a) => a.length > 0);
  const yearRaw = x.issued?.['date-parts']?.[0]?.[0];
  const year = typeof yearRaw === 'number' ? yearRaw : typeof yearRaw === 'string' && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  // CSL `number` is also a journal issue number: only an arXiv-SHAPED value is an id.
  const arxiv = typeof x.number === 'string' ? normArxiv(x.number) : null;
  return {
    citekey: typeof x.id === 'string' ? x.id : undefined,
    doi: typeof x.DOI === 'string' ? x.DOI : null,
    isbn: typeof x.ISBN === 'string' ? x.ISBN : null,
    arxiv,
    title: typeof title === 'string' ? title : null,
    authors,
    year,
    venue: typeof x['container-title'] === 'string' ? x['container-title'] : null,
    abstract: typeof x.abstract === 'string' ? x.abstract : null,
    retracted: x.note === 'RETRACTED',
  };
}

/**
 * Import CITATIONS.bib entries whose key LIBRARY.json lacks (lock held). Keys
 * are kept verbatim (a draft may cite them), even when the DOI duplicates an
 * existing entry (the pre-BRDTH-01 `add` produced engel2009a-style duplicates
 * that sections may already reference). Returns the imported keys.
 */
async function importOrphanBibEntries(paths: LibraryPaths, entries: LibraryEntry[], now: string): Promise<string[]> {
  let text: string;
  try {
    text = await fsp.readFile(paths.bib, 'utf8');
  } catch {
    return [];
  }
  if (!text.trim()) return [];
  const known = new Set(entries.map((e) => e.citekey));
  const bibKeys = [...text.matchAll(BIB_KEY_RE)].map((m) => m[1]!);
  if (bibKeys.length > 0 && bibKeys.every((k) => known.has(k))) return [];

  let parsed: Array<Record<string, unknown>>;
  try {
    parsed = await parseBib(text);
  } catch (e) {
    // Never silently clobber a bib we cannot read: keep it next to the new one.
    const backup = `${paths.bib}.unparsed-${now.replace(/[:.]/g, '-')}.bak`;
    await atomicWriteFile(backup, text);
    process.stderr.write(
      `pensmith: WARN — .paper/CITATIONS.bib could not be parsed (${(e as Error).message}); ` +
        `it is re-rendered from LIBRARY.json and the old file is kept at ${backup}\n`,
    );
    return [];
  }
  const imported: string[] = [];
  for (const csl of parsed) {
    const c = cslToCandidate(csl);
    const key = typeof c.citekey === 'string' && CITEKEY_GRAMMAR.test(c.citekey) ? c.citekey : null;
    if (!key || known.has(key)) continue;
    const entry = candidateToEntry({ ...c, citekey: key }, ['bib-import'], now);
    entry.citekey = key;
    entries.push(entry);
    known.add(key);
    imported.push(key);
  }
  return imported;
}

// ---------------------------------------------------------------------------
// The writer.
// ---------------------------------------------------------------------------

export interface UpsertOptions {
  /**
   * The ingest path, recorded as a provenance tag: `research`, `add`,
   * `plan-research:§2`, `byo`, `zotero`, … A candidate carrying an adapter name
   * (`source`) is tagged `<provenance>:<source>`.
   */
  provenance: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

export type UpsertStatus = 'added' | 'merged' | 'unchanged';

export interface UpsertOutcome {
  /** Index of the candidate in the input array. */
  index: number;
  /** The entry's citekey — for a known work, the EXISTING key. */
  citekey: string;
  status: UpsertStatus;
  /** How an existing entry was matched (absent for `added`). */
  matchedBy?: MatchKind;
}

export interface UpsertResult {
  library: Library;
  outcomes: UpsertOutcome[];
  /** Keys imported from a CITATIONS.bib that LIBRARY.json lacked. */
  imported: string[];
  paths: LibraryPaths;
}

/**
 * Ingest `candidates` into the paper's library (dedup + merge + version
 * collapse, see the header) and re-render CITATIONS.bib / CITATIONS.ris from
 * the result — all inside one lock, so concurrent upserts never lose an update.
 * Creates the library (and both citation files, empty) when absent.
 */
export async function upsertSources(
  root: string,
  candidates: readonly LibraryCandidate[],
  opts: UpsertOptions,
): Promise<UpsertResult> {
  if (!opts.provenance || !opts.provenance.trim()) throw new Error('upsertSources: a provenance tag is required');
  const paths = libraryPaths(root);
  const now = (opts.now?.() ?? new Date()).toISOString();

  const result = await withLock(paths.library, async () => {
    const current = (await readUnlocked(paths.library, false)) ?? { $schemaVersion: CURRENT_LIBRARY_VERSION, entries: [] };
    const entries: LibraryEntry[] = current.entries.map((e) => structuredClone(e));
    const imported = await importOrphanBibEntries(paths, entries, now);
    const taken = new Set(entries.map((e) => e.citekey));

    const outcomes: UpsertOutcome[] = [];
    candidates.forEach((c, index) => {
      const tag = typeof c.source === 'string' && c.source ? `${opts.provenance}:${c.source}` : opts.provenance;
      const draft = candidateToEntry(c, [tag], now);
      const match = findMatch(entries, draft);
      if (match) {
        const changed = mergeInto(match.entry, draft, now);
        outcomes.push({ index, citekey: match.entry.citekey, status: changed ? 'merged' : 'unchanged', matchedBy: match.by });
        return;
      }
      draft.citekey = uniqueCitekey(draft, taken);
      taken.add(draft.citekey);
      entries.push(draft);
      outcomes.push({ index, citekey: draft.citekey, status: 'added' });
    });

    const library: Library = LibrarySchema.parse({ $schemaVersion: CURRENT_LIBRARY_VERSION, entries });
    await persist(paths, library);
    return { library, outcomes, imported, paths };
  });

  log().event({
    event: 'library.upsert',
    provenance: opts.provenance,
    candidates: candidates.length,
    added: result.outcomes.filter((o) => o.status === 'added').length,
    merged: result.outcomes.filter((o) => o.status === 'merged').length,
    unchanged: result.outcomes.filter((o) => o.status === 'unchanged').length,
    imported: result.imported.length,
    entryCount: result.library.entries.length,
  });
  return result;
}

/**
 * Record verification times per citekey (VRFY-28 seam): `last_verified`
 * becomes the later of the stored and the given time. Unknown keys are
 * ignored and returned. Same lock and render path as upsertSources.
 */
export async function recordLastVerified(
  root: string,
  stamps: Readonly<Record<string, string>>,
): Promise<{ updated: string[]; unknown: string[] }> {
  const paths = libraryPaths(root);
  return withLock(paths.library, async () => {
    const current = await readUnlocked(paths.library, false);
    if (!current) throw new LibraryNotFoundError(`LIBRARY.json not found at ${paths.library}`);
    const byKey = new Map(current.entries.map((e) => [e.citekey, e]));
    const updated: string[] = [];
    const unknown: string[] = [];
    for (const [key, at] of Object.entries(stamps)) {
      const e = byKey.get(key);
      if (!e) {
        unknown.push(key);
        continue;
      }
      const iso = new Date(at).toISOString();
      const next = later(e.last_verified, iso);
      if (next !== e.last_verified) {
        e.last_verified = next;
        e.updatedAt = new Date().toISOString();
        updated.push(key);
      }
    }
    if (updated.length > 0) await persist(paths, current);
    return { updated, unknown };
  });
}

/**
 * Re-render CITATIONS.bib and CITATIONS.ris from LIBRARY.json (e.g. after a
 * user edited the rendered files). Imports bib-only keys first, like
 * upsertSources, so nothing a draft cites is lost.
 */
export async function renderCitationFiles(root: string): Promise<LibraryPaths> {
  const r = await upsertSources(root, [], { provenance: 'render' });
  return r.paths;
}
