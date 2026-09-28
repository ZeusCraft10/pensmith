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
//   loadAndMigrate  (D-37)  — version envelope, v1→v2→v3 migrations, zod validation
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
//        b. arXiv id, PMID, PMCID, ISBN(-13) — an ISBN only between two
//           book-level records: a chapter or a proceedings paper carries its
//           book's ISBN, and is never the same work as the book — then
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
import { migrate as migrateLibraryV2toV3 } from './migrations/library/v2_to_v3.js';
import {
  candidateToEntry,
  isPreprintDoi,
  normArxiv,
  normTitle,
  type LibraryCandidate,
} from './migrations/library/shape.js';
import {
  Schema as LibrarySchema,
  ByoRecordSchema,
  CURRENT_LIBRARY_VERSION,
  CITEKEY_GRAMMAR,
  type ByoRecordInput,
  type Library,
  type LibraryEntry,
} from './schemas/library.js';
import { BibRenderError, renderBibtex, suffixForCollision } from './bibtex-write.js';
import { renderRis } from './ris-write.js';
import { parseBib, parseBibFileAt, parseBibSync } from './citations.js';
import { jaroWinkler } from './fuzzy.js';
import { firstAuthorSurname } from './author-normalize.js';
import { generateCitekey } from './citekey.js';
import { paperDir } from './paths.js';
import { openSessionLog, type SessionLogger } from './session-log.js';
import { isReservedDryRunId } from './doi.js';
import { networkMode } from './http-mock.js';

export type { LibraryCandidate } from './migrations/library/shape.js';
export type { Library, LibraryEntry } from './schemas/library.js';

/** The version-matching threshold on normalized titles (D-17-43). */
export const VERSION_TITLE_JW = 0.95;

/** Registered forward migrations for LIBRARY.json, keyed by FROM version. */
export const LIBRARY_MIGRATIONS: Record<number, (input: unknown) => unknown> = {
  1: (input) => migrateLibraryV1toV2(input),
  // Phase 19 seam S-B: the v3 bibliographic, evaluation, BYO, retraction and Zotero fields.
  2: (input) => migrateLibraryV2toV3(input),
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
    // A newer file keeps its "upgrade pensmith" error; anything else that stops
    // the file from loading (bad JSON, a schema mismatch) is the one-line,
    // user-fixable LibraryInvalidError for EVERY reader (research, add, plan,
    // outline, MCP) — never a raw parse error (RUN-12).
    if (e instanceof ForwardIncompatError || e instanceof PensmithError) throw e;
    const detail = (e instanceof Error ? e.message : String(e)).replace(/^pensmith: /, '').split('\n')[0] ?? '';
    throw new LibraryInvalidError(file, detail.length > 200 ? `${detail.slice(0, 200)}…` : detail);
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

/**
 * Render CITATIONS.bib for `entries` and prove it reads back: every rendered
 * entry round-trips on its own (renderBibtex), and the whole file parses to
 * exactly the rendered citekeys. A library that cannot be rendered is refused
 * with one line (nothing is written) — verify, compile and done parse this
 * file, so an unreadable bib would stop every section.
 */
function renderCheckedBib(file: string, entries: LibraryEntry[]): string {
  let text: string;
  try {
    text = renderBibtex(entries);
  } catch (e) {
    if (e instanceof BibRenderError) {
      throw new PensmithError(
        `refusing to write ${file}: ${e.message} — fix that entry's title or authors in LIBRARY.json and re-run`,
        EXIT_ERROR,
      );
    }
    throw e;
  }
  if (!text.trim()) return text;
  const want = [...text.matchAll(BIB_KEY_RE)].map((m) => m[1]!).sort();
  let got: string[];
  try {
    got = parseBibSync(text)
      .map((c) => String(c['id']))
      .sort();
  } catch (e) {
    throw new PensmithError(`refusing to write ${file}: the rendered BibTeX does not parse (${(e as Error).message.split('\n')[0]})`, EXIT_ERROR);
  }
  if (got.join('\n') !== want.join('\n')) {
    throw new PensmithError(`refusing to write ${file}: the rendered BibTeX reads back with different citekeys`, EXIT_ERROR);
  }
  return text;
}

/** Persist a validated library and its two rendered citation files (lock held). */
async function persist(paths: LibraryPaths, library: Library): Promise<void> {
  const validated = LibrarySchema.parse(library);
  // Render (and check) before anything is written: a refused render leaves
  // LIBRARY.json and both citation files exactly as they were.
  const bib = renderCheckedBib(paths.bib, validated.entries);
  const ris = renderRis(validated.entries);
  await writeIfChanged(paths.library, JSON.stringify(validated, null, 2) + '\n');
  await writeIfChanged(paths.bib, bib);
  await writeIfChanged(paths.ris, ris);
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
    if (e instanceof ForwardIncompatError || e instanceof LibraryInvalidError) throw e;
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

export type MatchKind = 'doi' | 'arxiv' | 'pmid' | 'pmcid' | 'isbn' | 'zotero' | 'version';

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

/** A work that is part of a book (its ISBN is the container's): a chapter or a proceedings paper. */
function isPartOfBook(e: Pick<LibraryEntry, 'type'>): boolean {
  return e.type === 'chapter' || e.type === 'paper-conference';
}

function findMatch(entries: LibraryEntry[], d: LibraryEntry): { entry: LibraryEntry; by: MatchKind } | null {
  if (d.doi || d.alternate_dois.length > 0) {
    const mine = new Set([d.doi, ...d.alternate_dois].filter((x): x is string => x !== null));
    const hit = entries.find((e) => [e.doi, ...e.alternate_dois].some((x) => x !== null && mine.has(x)));
    if (hit) return { entry: hit, by: 'doi' };
  }
  const byField = (k: 'arxiv' | 'pmid' | 'pmcid' | 'isbn'): LibraryEntry | undefined => {
    if (!d[k]) return undefined;
    // A part (chapter, proceedings paper) shares its container's ISBN.
    if (k === 'isbn') return isPartOfBook(d) ? undefined : entries.find((e) => e.isbn === d.isbn && !isPartOfBook(e));
    return entries.find((e) => e[k] === d[k]);
  };
  for (const k of ['arxiv', 'pmid', 'pmcid', 'isbn'] as const) {
    const hit = byField(k);
    if (hit) return { entry: hit, by: k };
  }
  // Phase 19 seam S-B (SRC-16): the same Zotero item re-pulled.
  if (d.zotero) {
    const z = d.zotero;
    const hit = entries.find((e) => e.zotero !== null && e.zotero.library === z.library && e.zotero.key === z.key);
    if (hit) return { entry: hit, by: 'zotero' };
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

  // Phase 19 seam S-B (SRC-15): a registrar-hydrated record replaces the
  // local metadata of an unhydrated bring-your-own entry.
  if (!e.hydrated && d.hydrated) incomingIsRecord = true;

  if (incomingIsRecord) {
    e.title = d.title ?? e.title;
    e.year = d.year ?? e.year;
    e.venue = d.venue ?? e.venue;
    if (d.authors.length > 0) e.authors = d.authors;
    e.type = d.type ?? e.type;
    e.publisher = d.publisher ?? e.publisher;
    e.volume = d.volume ?? e.volume;
    e.issue = d.issue ?? e.issue;
    e.pages = d.pages ?? e.pages;
    if (d.editors.length > 0) e.editors = d.editors;
  } else {
    e.title = e.title ?? d.title;
    e.year = e.year ?? d.year;
    e.venue = e.venue ?? d.venue;
    if (d.authors.length > e.authors.length) e.authors = d.authors;
    e.type = e.type ?? d.type;
    e.publisher = e.publisher ?? d.publisher;
    e.volume = e.volume ?? d.volume;
    e.issue = e.issue ?? d.issue;
    e.pages = e.pages ?? d.pages;
    if (d.editors.length > e.editors.length) e.editors = d.editors;
  }
  e.hydrated = e.hydrated || d.hydrated;
  // The latest evaluation wins (SRC-09); an ingest path that did not evaluate
  // (null) never erases an earlier judgement.
  e.tier = d.tier ?? e.tier;
  e.relevance = d.relevance ?? e.relevance;
  e.why_relevant = d.why_relevant ?? e.why_relevant;
  e.zotero = e.zotero ?? d.zotero;
  e.abstract = longer(e.abstract, d.abstract);
  e.oa_url = e.oa_url ?? d.oa_url;
  e.provenance = union(e.provenance, d.provenance);
  e.retracted = e.retracted || d.retracted;
  e.retraction_details = e.retraction_details ?? d.retraction_details;
  // SRC-04: `retracted` is sticky; otherwise the newer lookup outcome wins
  // (an `unchecked` incoming record never overrides a real outcome).
  if (e.retracted) e.retraction_status = 'retracted';
  else if (d.retraction_status !== 'unchecked') e.retraction_status = d.retraction_status;
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

type CslName = { family?: unknown; given?: unknown; suffix?: unknown; literal?: unknown; 'non-dropping-particle'?: unknown; 'dropping-particle'?: unknown };

/** A parsed CSL name as a LIBRARY author string ("Family, Given[, Suffix]" or "{Corporate}"). */
function cslNameToString(a: CslName | undefined): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const family = [str(a?.['dropping-particle']), str(a?.['non-dropping-particle']), str(a?.family)].filter(Boolean).join(' ');
  if (!family) {
    const literal = str(a?.literal);
    return literal ? `{${literal}}` : '';
  }
  const given = str(a?.given);
  const suffix = str(a?.suffix);
  if (suffix) return `${family}, ${given}, ${suffix}`;
  return given ? `${family}, ${given}` : family;
}

function cslToCandidate(csl: Record<string, unknown>): LibraryCandidate {
  const x = csl as {
    id?: unknown;
    type?: unknown;
    title?: unknown;
    author?: CslName[];
    editor?: CslName[];
    DOI?: unknown;
    ISBN?: unknown;
    PMID?: unknown;
    PMCID?: unknown;
    number?: unknown;
    eprint?: unknown;
    archivePrefix?: unknown;
    note?: unknown;
    abstract?: unknown;
    URL?: unknown;
    issued?: { 'date-parts'?: unknown[][] };
    'container-title'?: unknown;
    volume?: unknown;
    issue?: unknown;
    page?: unknown;
    publisher?: unknown;
  };
  const title = Array.isArray(x.title) ? x.title[0] : x.title;
  const names = (list: CslName[] | undefined): string[] =>
    (Array.isArray(list) ? list : []).map(cslNameToString).filter((a) => a.length > 0);
  const yearRaw = x.issued?.['date-parts']?.[0]?.[0];
  const year = typeof yearRaw === 'number' ? yearRaw : typeof yearRaw === 'string' && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  // SRC-12: an arXiv eprint (archivePrefix = {arXiv}, preserved by parseBib);
  // else CSL `number`, which is also a report / issue number — only an
  // arXiv-SHAPED value is an id.
  const eprintArxiv =
    typeof x.eprint === 'string' && (typeof x.archivePrefix !== 'string' || /^arxiv$/i.test(x.archivePrefix))
      ? normArxiv(x.eprint)
      : null;
  const arxiv = eprintArxiv ?? (typeof x.number === 'string' ? normArxiv(x.number) : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
  return {
    citekey: typeof x.id === 'string' ? x.id : undefined,
    doi: typeof x.DOI === 'string' ? x.DOI : null,
    isbn: typeof x.ISBN === 'string' ? x.ISBN : null,
    pmid: str(x.PMID),
    pmcid: typeof x.PMCID === 'string' ? x.PMCID : null,
    arxiv,
    title: typeof title === 'string' ? title : null,
    authors: names(x.author),
    editors: names(x.editor),
    year,
    venue: typeof x['container-title'] === 'string' ? x['container-title'] : null,
    abstract: typeof x.abstract === 'string' ? x.abstract : null,
    // A CSL type the library does not know (citation-js reads @misc as
    // `document`) is dropped by candidateToEntry.
    type: typeof x.type === 'string' ? x.type : null,
    volume: str(x.volume),
    issue: str(x.issue),
    pages: typeof x.page === 'string' ? x.page : null,
    publisher: typeof x.publisher === 'string' ? x.publisher : null,
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

  const dryRun = networkMode().dryRun;
  const result = await withLock(paths.library, async () => {
    const current = (await readUnlocked(paths.library, false)) ?? { $schemaVersion: CURRENT_LIBRARY_VERSION, entries: [] };
    let entries: LibraryEntry[] = current.entries.map((e) => structuredClone(e));
    const imported = await importOrphanBibEntries(paths, entries, now);
    // RUN-27: outside --dry-run the library never (re)writes a synthetic
    // dry-run source — one a dry run left behind is dropped here, so it can
    // never reach LIBRARY.json, CITATIONS.bib or an outline again.
    const purged = dryRun ? [] : entries.filter(isSyntheticEntry).map((e) => e.citekey);
    if (purged.length > 0) {
      entries = entries.filter((e) => !isSyntheticEntry(e));
      process.stderr.write(
        `pensmith: dropped ${purged.length} synthetic --dry-run source(s) from LIBRARY.json (${purged.join(', ')}) — they are never real citations.\n`,
      );
    }
    const taken = new Set(entries.map((e) => e.citekey));

    const outcomes: UpsertOutcome[] = [];
    candidates.forEach((c, index) => {
      const tag = typeof c.source === 'string' && c.source ? `${opts.provenance}:${c.source}` : opts.provenance;
      const draft = candidateToEntry(c, [tag], now);
      if (!dryRun && isSyntheticEntry(draft)) {
        throw new PensmithError(
          `refusing to add ${draft.doi ?? draft.citekey}: a synthetic --dry-run source is never a real citation (RUN-27)`,
          EXIT_ERROR,
        );
      }
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

/** A synthetic --dry-run source (flagged, or carrying a reserved-namespace id). */
export function isSyntheticEntry(e: Pick<LibraryEntry, 'synthetic' | 'doi' | 'arxiv' | 'isbn'>): boolean {
  return e.synthetic === true || isReservedDryRunId(e.doi) || isReservedDryRunId(e.arxiv) || isReservedDryRunId(e.isbn);
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

export interface RerenderResult {
  readonly paths: LibraryPaths;
  /** Where the previous CITATIONS.bib was kept, when it did not parse; else null. */
  readonly backup: string | null;
  /** The parse error of the previous CITATIONS.bib (one line), when it did not parse. */
  readonly previousProblem: string | null;
}

/**
 * Re-render CITATIONS.bib and CITATIONS.ris from LIBRARY.json (SRC-12,
 * D-19-19). verify calls it when the paper's CITATIONS.bib does not parse —
 * e.g. one an older pensmith wrote with `{\u …}` name escapes (E2E-12) — so
 * the paper is repaired from its source of truth instead of stopping every
 * section. A bib that does not parse is kept next to the new one as
 * `CITATIONS.bib.unparsed-<time>.bak` (never silently clobbered). Same lock
 * and render path as upsertSources. LibraryNotFoundError when the paper has
 * no LIBRARY.json.
 */
export async function rerenderCitations(root: string, opts: { now?: () => Date } = {}): Promise<RerenderResult> {
  const paths = libraryPaths(root);
  const now = (opts.now?.() ?? new Date()).toISOString();
  return withLock(paths.library, async () => {
    const current = await readUnlocked(paths.library, false);
    if (!current) throw new LibraryNotFoundError(`LIBRARY.json not found at ${paths.library}`);
    let backup: string | null = null;
    let previousProblem: string | null = null;
    let existing: string | null = null;
    try {
      existing = await fsp.readFile(paths.bib, 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== null && existing.trim().length > 0) {
      try {
        parseBibSync(existing);
      } catch (e) {
        previousProblem = ((e as Error).message.split('\n')[0] ?? '').replace(/^parseBib: invalid BibTeX — /, '');
        backup = `${paths.bib}.unparsed-${now.replace(/[:.]/g, '-')}.bak`;
        await atomicWriteFile(backup, existing);
      }
    }
    await persist(paths, current);
    log().event({ event: 'library.rerender', entryCount: current.entries.length, backup: backup !== null });
    return { paths, backup, previousProblem };
  });
}

export type HydrateStatus = 'merged' | 'unchanged' | 'conflict';

/**
 * Merge a registrar record into the entry `citekey` names (SRC-15): a
 * bring-your-own PDF first kept unhydrated (no confident match, or no network)
 * is identified later — by re-ingesting its folder, or by `add <id> --pdf
 * <file>` naming the same PDF. The entry keeps its citekey (drafts may cite
 * it) and takes the record's bibliographic fields through the library's own
 * merge rules (a hydrated record replaces an unhydrated entry's local
 * metadata). When the record's identifiers already belong to ANOTHER entry
 * the library is left unchanged and the result is `conflict` with that
 * entry's key — two entries never claim one work.
 */
export async function hydrateEntry(
  root: string,
  citekey: string,
  candidate: LibraryCandidate,
  opts: UpsertOptions,
): Promise<{ status: HydrateStatus; citekey: string }> {
  const paths = libraryPaths(root);
  const now = (opts.now?.() ?? new Date()).toISOString();
  return withLock(paths.library, async () => {
    const current = await readUnlocked(paths.library, false);
    if (!current) throw new LibraryNotFoundError(`LIBRARY.json not found at ${paths.library}`);
    const entry = current.entries.find((e) => e.citekey === citekey);
    if (!entry) throw new PensmithError(`cannot update ${citekey}: it is not in ${paths.library}`, EXIT_ERROR);
    const tag = typeof candidate.source === 'string' && candidate.source ? `${opts.provenance}:${candidate.source}` : opts.provenance;
    const draft = candidateToEntry(candidate, [tag], now);
    const other = findMatch(
      current.entries.filter((e) => e !== entry),
      draft,
    );
    if (other !== null && other.by !== 'version') return { status: 'conflict', citekey: other.entry.citekey };
    const changed = mergeInto(entry, draft, now);
    if (changed) await persist(paths, current);
    log().event({ event: 'library.hydrate', citekey, changed });
    return { status: changed ? 'merged' : 'unchanged', citekey };
  });
}

export type AttachByoStatus = 'attached' | 'unchanged' | 'kept-existing';

/**
 * Record a bring-your-own PDF on an existing entry (SRC-15, D-19-21): the
 * `.paper/`-relative file and the PDF and text sha256s. The ingest path first
 * upserts the work (which fixes its citekey), copies the PDF to
 * `.paper/sources/<citekey>.pdf`, then attaches it here — under the same lock
 * and render path as upsertSources. An entry that already carries a
 * DIFFERENT PDF keeps it unless `replace` is set (`add <id> --pdf <file>`
 * names the PDF explicitly); the result says which.
 */
export async function attachByoRecord(
  root: string,
  citekey: string,
  byo: ByoRecordInput,
  opts: { replace?: boolean; now?: () => Date } = {},
): Promise<{ status: AttachByoStatus; entry: LibraryEntry }> {
  const paths = libraryPaths(root);
  const now = (opts.now?.() ?? new Date()).toISOString();
  const record = ByoRecordSchema.parse(byo);
  return withLock(paths.library, async () => {
    const current = await readUnlocked(paths.library, false);
    if (!current) throw new LibraryNotFoundError(`LIBRARY.json not found at ${paths.library}`);
    const entry = current.entries.find((e) => e.citekey === citekey);
    if (!entry) throw new PensmithError(`cannot attach a PDF to ${citekey}: it is not in ${paths.library}`, EXIT_ERROR);
    if (entry.byo !== null && JSON.stringify(entry.byo) === JSON.stringify(record)) return { status: 'unchanged', entry };
    if (entry.byo !== null && entry.byo.sha256 !== record.sha256 && opts.replace !== true) {
      return { status: 'kept-existing', entry };
    }
    entry.byo = record;
    entry.updatedAt = now;
    await persist(paths, current);
    log().event({ event: 'library.attach-byo', citekey });
    return { status: 'attached', entry };
  });
}


// ---------------------------------------------------------------------------
// Export: the cited-only bibliography.
// ---------------------------------------------------------------------------

/** One top-level `@…` block of a BibTeX file (`key` is null for @string/@preamble/@comment). */
export interface BibBlock {
  kind: string;
  key: string | null;
  text: string;
}

const BIB_BLOCK_HEAD = /@([A-Za-z]+)\s*([{(])/y;
const BIB_NON_ENTRY = new Set(['string', 'preamble', 'comment']);

/**
 * Split BibTeX text into its top-level `@type{…}` / `@type(…)` blocks, brace
 * matched, each block's text byte-exact (with its line ending). Text between
 * blocks (BibTeX comments) is dropped. Throws on an unterminated block.
 */
export function splitBibBlocks(text: string): BibBlock[] {
  const blocks: BibBlock[] = [];
  let i = 0;
  for (;;) {
    const at = text.indexOf('@', i);
    if (at === -1) break;
    BIB_BLOCK_HEAD.lastIndex = at;
    const head = BIB_BLOCK_HEAD.exec(text);
    if (!head) {
      i = at + 1;
      continue;
    }
    const byParen = head[2] === '(';
    let depth = 0;
    let j = BIB_BLOCK_HEAD.lastIndex;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0 && !byParen) break;
        depth--;
      } else if (ch === ')' && byParen && depth === 0) break;
    }
    if (j >= text.length) throw new Error(`unterminated @${head[1]} block at offset ${at}`);
    let end = j + 1;
    if (text[end] === '\r') end++;
    if (text[end] === '\n') end++;
    const kind = head[1]!.toLowerCase();
    const body = text.slice(BIB_BLOCK_HEAD.lastIndex, j);
    const key = BIB_NON_ENTRY.has(kind) ? null : (body.split(',')[0] ?? '').trim() || null;
    blocks.push({ kind, key, text: text.slice(at, end) });
    i = end;
  }
  return blocks;
}

/** Split RIS text into records (TY … ER), each with its `ID` citekey. */
function splitRisRecords(text: string): Array<{ key: string | null; text: string }> {
  const out: Array<{ key: string | null; text: string }> = [];
  let cur: string[] = [];
  for (const line of text.split(/(?<=\n)/)) {
    if (cur.length === 0 && !/^TY {2}- /.test(line)) continue;
    cur.push(line);
    if (/^ER {2}-/.test(line)) {
      const rec = cur.join('');
      const id = /^ID {2}- (.*?)\s*$/m.exec(rec);
      out.push({ key: id ? id[1]! : null, text: rec.endsWith('\n') ? rec : `${rec}\n` });
      cur = [];
    }
  }
  return out;
}

export interface CitedExportResult {
  /** The written export/CITATIONS.bib, or null when no cited source is in the bib. */
  bibPath: string | null;
  /** The written export/CITATIONS.ris, or null when no cited source is in the RIS. */
  risPath: string | null;
  /** Cited keys written to the exported bib (in bib order). */
  exported: string[];
  /** Cited keys the paper's bib does not hold. */
  missing: string[];
}

/**
 * Write the bibliography of an exported document into `exportDir`: ONLY the
 * sources `citekeys` names (the keys the compiled draft cites), never the
 * whole research library — uncited candidates, unverified and retracted-flagged
 * entries and synthetic --dry-run records stay in `.paper/`. Each kept entry
 * is the paper's `.paper/CITATIONS.bib` / `.ris` entry byte for byte (a hand
 * edit survives); the result is re-parsed and must hold exactly the kept keys.
 * A file with no cited source is not written (a stale one from an earlier
 * export is removed). `.paper/CITATIONS.bib` that does not parse is a one-line
 * BibParseError — the export never guesses.
 */
export async function exportCitedCitations(
  root: string,
  citekeys: readonly string[],
  exportDir: string,
): Promise<CitedExportResult> {
  const paths = libraryPaths(root);
  if (path.resolve(exportDir) === path.resolve(paths.dir)) {
    throw new Error('exportCitedCitations: the export dir must not be the .paper folder (it would overwrite the library files)');
  }
  const wanted = new Set(citekeys);
  const readText = async (file: string): Promise<string> => {
    try {
      return await fsp.readFile(file, 'utf8');
    } catch (e) {
      if (isEnoent(e)) return '';
      throw e;
    }
  };

  const { bibText, risText } = await withLock(paths.library, async () => ({
    bibText: await readText(paths.bib),
    risText: await readText(paths.ris),
  }));

  // Fail closed on a bib that does not parse (verify, compile and done read
  // it the same way), then keep the cited entries verbatim.
  await parseBibFileAt(bibText, paths.bib);
  const blocks = bibText.trim() ? splitBibBlocks(bibText) : [];
  const keptEntries = blocks.filter((b) => b.key !== null && wanted.has(b.key));
  const exported = [...new Set(keptEntries.map((b) => b.key!))];
  const keptBib =
    keptEntries.length === 0
      ? ''
      : blocks
          .filter((b) => b.kind === 'string' || b.kind === 'preamble' || (b.key !== null && wanted.has(b.key)))
          .map((b) => b.text)
          .join('');
  if (keptBib) {
    const readBack = parseBibSync(keptBib).map((c) => String(c['id']));
    if ([...new Set(readBack)].sort().join('\n') !== [...exported].sort().join('\n')) {
      throw new PensmithError(
        `could not export the cited bibliography: ${paths.bib} reads back with different keys once filtered — check its entries`,
        EXIT_ERROR,
      );
    }
  }

  const keptRis = splitRisRecords(risText)
    .filter((r) => r.key !== null && wanted.has(r.key))
    .map((r) => r.text)
    .join('');

  const bibDst = path.join(exportDir, 'CITATIONS.bib');
  const risDst = path.join(exportDir, 'CITATIONS.ris');
  await fsp.mkdir(exportDir, { recursive: true });
  if (keptBib) await atomicWriteFile(bibDst, keptBib);
  else await fsp.rm(bibDst, { force: true });
  if (keptRis) await atomicWriteFile(risDst, keptRis);
  else await fsp.rm(risDst, { force: true });

  const present = new Set(blocks.map((b) => b.key).filter((k): k is string => k !== null));
  return {
    bibPath: keptBib ? bibDst : null,
    risPath: keptRis ? risDst : null,
    exported,
    missing: [...wanted].filter((k) => !present.has(k)),
  };
}
