// bin/lib/library.ts — paper library load/save/add/find glue (D-59 foundation slice).
//
// W10 sibling — same architectural shape as bin/lib/state.ts. This is the W10
// chokepoint integration that composes the four lower-level chokepoints into
// a one-import API for paper library operations:
//
//   atomicWriteFile (W2 / D-04)   — crash-safe writes via tmp+rename
//   withLock        (W3 / D-26)   — cross-process advisory lock
//   loadAndMigrate  (W7 / D-37)   — version envelope + zod validation
//   openSessionLog  (W9 / D-49)   — JSONL structured log, kind:'event'
//
// Per D-59 the foundation-slice schema is intentionally minimal: an envelope
// {$schemaVersion, entries: LibraryEntry[]} where LibraryEntry only requires
// {id, addedAt}. Citation metadata, sources[], cite-keys, and fingerprints
// land in Phase 3 (research wave) via forward migrations registered under
// bin/lib/migrations/library/. Adding ANY new field to the LibraryEntry
// schema in this repo MUST come with a v(N)→v(N+1) migration registered in
// the loader or readers will throw SchemaValidationError.
//
// Concurrency contract (T-01-01 mitigation):
//   addEntry performs read → duplicate-check → mutate → save inside a SINGLE
//   withLock critical section. Reading outside the lock would let two
//   concurrent callers each observe the pre-write value and the second writer
//   would silently clobber the first. The 10-concurrent-disjoint-ids test
//   in tests/library.test.ts is the regression gate for this invariant.
//
//   loadLibrary ALSO takes withLock around its loadAndMigrate call because
//   the loader's writeBack:true path issues an atomicWriteFile when a
//   forward migration runs (BLOCKER-02 fix). Without the lock, two
//   concurrent loadLibrary callers each migrating a v(N-1) file to vN
//   would race their tmp+rename writes against each other AND against
//   any concurrent addEntry/saveLibrary. Today the migration registry
//   is empty so the writeBack branch is dormant, but the lock is in
//   place so the race cannot activate the day a real v2 ships.
//
//   initLibrary ALSO takes withLock around the existence check (BLOCKER-01
//   fix) so the access-then-write is atomic. The pre-fix code performed
//   fs.access OUTSIDE the lock, allowing two concurrent inits to both
//   observe ENOENT and both seed — the second silently clobbering the
//   first via atomic rename. The fix is to move the access check inside
//   the same critical section as the write.
//
// Forward-incompat contract (T-01-COMPAT-01 mitigation):
//   ForwardIncompatError from loadAndMigrate propagates UNCHANGED so a
//   newer-on-disk LIBRARY.json never gets silently downgraded by an older
//   pensmith build.
//
// Duplicate-id contract (T-01-DUP-01 mitigation):
//   addEntry rejects an entry whose id already appears in the loaded library
//   with DuplicateLibraryEntryError. The check runs INSIDE the lock so the
//   read-and-check is atomic against concurrent writers. Library state is
//   left unchanged on rejection (no atomicWriteFile call is made).
//
// Defense-in-depth schema validation (T-01-08 mitigation):
//   LibrarySchema.parse runs on:
//     - initLibrary seed construction
//     - saveLibrary input
//     - addEntry mutator output
//   Single-entry validation via LibraryEntrySchema runs on the addEntry
//   argument before the lock is taken (fail-fast on caller-side garbage).
//   PLUS the loader validates on every read. That's three save-side guards
//   plus the loader's read-side guard — no malformed library survives a
//   write/read cycle.
//
// findEntry is intentionally lock-free: it's a pure read against a snapshot.
// Callers that need add-then-find atomicity should use addEntry's return
// value directly rather than re-querying.
//
// Imports limited to: node:fs, node:path, and the four W2/W3/W7/W9
// chokepoint modules above. No third-party deps.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import {
  Schema as LibrarySchema,
  LibraryEntrySchema,
  CURRENT_LIBRARY_VERSION,
  type Library,
  type LibraryEntry,
} from './schemas/library.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

// ---------------------------------------------------------------------------
// Errors (per <interfaces> in 01-11-PLAN.md).
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

export class DuplicateLibraryEntryError extends Error {
  code = 'LIBRARY_DUP_ID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateLibraryEntryError';
  }
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to LIBRARY.json under `paperRoot`. Resolving up-
 * front ensures the lock key (which is the file path) is identical across
 * callers regardless of relative vs. absolute paperRoot input.
 */
function libraryFile(paperRoot: string): string {
  return path.join(path.resolve(paperRoot), 'LIBRARY.json');
}

/**
 * Module-level singleton SessionLogger child bound to `module: 'library'`.
 * Lazy-initialized so test files that mutate process.env (LOCALAPPDATA,
 * XDG_DATA_HOME, HOME) BEFORE dynamically importing this module observe
 * the mutated env. openSessionLog reads paths.ts at call-time, so this
 * singleton resolves the log destination at first use, not at import.
 */
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'library' });
  }
  return _log;
}

// ---------------------------------------------------------------------------
// Public API (D-59 foundation slice).
// ---------------------------------------------------------------------------

/**
 * Create LIBRARY.json under `paperRoot` with $schemaVersion =
 * CURRENT_LIBRARY_VERSION and entries=[].
 *
 * Refuses to overwrite an existing LIBRARY.json — throws
 * LibraryAlreadyExistsError (code: LIBRARY_ALREADY_EXISTS). Use addEntry /
 * saveLibrary for in-place mutation.
 *
 * Permission errors (EACCES, EPERM, ...) bubble up unchanged. Only the
 * existence-check is translated; everything else is opaque to the caller.
 */
export async function initLibrary(paperRoot: string): Promise<Library> {
  const file = libraryFile(paperRoot);

  // Validate the seed against the schema BEFORE acquiring the lock.
  const seeded: Library = LibrarySchema.parse({
    $schemaVersion: CURRENT_LIBRARY_VERSION,
    entries: [],
  });

  // BLOCKER-01 fix: the existence check MUST run INSIDE the lock. The
  // pre-fix code performed fs.access OUTSIDE the lock, which left a
  // window where two concurrent inits could both observe ENOENT, both
  // pass the access-then-throw gate, and both enter withLock sequentially
  // — the second writer silently clobbering the first via atomic rename.
  // Moving the access call inside the critical section makes
  // "check-then-write" atomic against any other locked writer
  // (saveLibrary, addEntry, or another initLibrary).
  await withLock(file, async () => {
    // Refuse to clobber. fs.access throws ENOENT when the file is absent —
    // which is exactly the case where init is allowed to proceed. Any
    // other error code (EACCES, EPERM, etc.) bubbles up unchanged.
    try {
      await fs.promises.access(file);
      throw new LibraryAlreadyExistsError(`LIBRARY.json already exists at ${file}`);
    } catch (e) {
      if (e instanceof LibraryAlreadyExistsError) throw e;
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw e;
    }
    await atomicWriteFile(file, JSON.stringify(seeded, null, 2) + '\n');
  });

  log().event({
    event: 'library.init',
    entryCount: seeded.entries.length,
    schemaVersion: seeded.$schemaVersion,
  });

  return seeded;
}

/**
 * Read LIBRARY.json under `paperRoot`, run any pending forward migrations,
 * validate against LibrarySchema, and return the typed value.
 *
 * Translates ENOENT (or `cause.code === 'ENOENT'`) into LibraryNotFoundError
 * (code: LIBRARY_NOT_FOUND). Every other error — permission errors, JSON
 * parse failures, schema validation failures, ForwardIncompatError —
 * bubbles up unchanged.
 *
 * Pass-through ForwardIncompatError is the T-01-COMPAT-01 mitigation:
 * a newer-on-disk LIBRARY.json must never be silently downgraded.
 *
 * `writeBack: true` so a future v1→v2 migration persists the upgraded
 * shape on disk. Today the migration registry is empty (we're at v1)
 * so no actual write occurs.
 */
export async function loadLibrary(paperRoot: string): Promise<Library> {
  const file = libraryFile(paperRoot);
  let value: Library;
  try {
    value = (await loadAndMigrate({
      file,
      schema: LibrarySchema,
      schemaName: 'library',
      currentVersion: CURRENT_LIBRARY_VERSION,
      writeBack: true,
    })) as Library;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      throw new LibraryNotFoundError(`LIBRARY.json not found at ${file}`);
    }
    throw e;
  }

  log().event({
    event: 'library.load',
    entryCount: value.entries.length,
    schemaVersion: value.$schemaVersion,
  });

  return value;
}

/**
 * Validate `library` against LibrarySchema and atomically write it to
 * LIBRARY.json under `paperRoot`. Acquires the per-file lock for the
 * duration of the write so it cannot interleave with addEntry.
 *
 * LibrarySchema.parse runs BEFORE the disk write — refuses to write
 * malformed library regardless of caller discipline (T-01-08 mitigation).
 */
export async function saveLibrary(paperRoot: string, library: Library): Promise<void> {
  const file = libraryFile(paperRoot);
  const validated = LibrarySchema.parse(library);

  await withLock(file, async () => {
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });

  log().event({
    event: 'library.save',
    entryCount: validated.entries.length,
    schemaVersion: validated.$schemaVersion,
  });
}

/**
 * Append a single entry to LIBRARY.json atomically.
 *
 * Operation sequence inside ONE withLock critical section:
 *   1. read+migrate+validate the current library
 *   2. duplicate-id check (refuse if entry.id already present)
 *   3. construct next library = current ∪ {entry}
 *   4. LibrarySchema.parse the result
 *   5. atomicWriteFile the result
 *
 * The single-lock-holds-everything design is the T-01-01 mitigation: two
 * concurrent addEntry callers cannot both observe the pre-write state. Test
 * "10 concurrent addEntry calls with disjoint ids all visible" in
 * tests/library.test.ts is the regression gate.
 *
 * Duplicate-id rejection (T-01-DUP-01 mitigation): throws
 * DuplicateLibraryEntryError if `entry.id` already appears in the loaded
 * library. The check runs INSIDE the lock; library state is left untouched
 * on rejection (atomicWriteFile is not called).
 *
 * `writeBack: false` on the inner loadAndMigrate because we're about to
 * atomicWriteFile a fresh copy moments later — there's no point persisting
 * the migrated shape twice in one critical section.
 */
export async function addEntry(paperRoot: string, entry: LibraryEntry): Promise<Library> {
  const file = libraryFile(paperRoot);

  // Single-entry fail-fast validation BEFORE acquiring the lock. Catches
  // caller-side garbage (missing id, malformed addedAt, etc.) without
  // contending the per-file critical section.
  const validatedEntry: LibraryEntry = LibraryEntrySchema.parse(entry);

  let next!: Library;

  await withLock(file, async () => {
    const current = (await loadAndMigrate({
      file,
      schema: LibrarySchema,
      schemaName: 'library',
      currentVersion: CURRENT_LIBRARY_VERSION,
      writeBack: false,
    })) as Library;

    if (current.entries.some((e) => e.id === validatedEntry.id)) {
      throw new DuplicateLibraryEntryError(
        `entry id "${validatedEntry.id}" already in library`,
      );
    }

    next = LibrarySchema.parse({
      ...current,
      entries: [...current.entries, validatedEntry],
    });

    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });

  log().event({
    event: 'library.addEntry',
    id: validatedEntry.id,
    entryCount: next.entries.length,
  });

  return next;
}

/**
 * Pure read against the loaded library snapshot. Returns the first entry
 * matching `predicate`, or undefined.
 *
 * Lock-free by design: the predicate runs against a value that's already
 * been loaded into memory, so concurrent writers cannot tear it. Callers
 * that need add-then-find atomicity should use addEntry's return value
 * directly rather than re-querying.
 */
export async function findEntry(
  paperRoot: string,
  predicate: (e: LibraryEntry) => boolean,
): Promise<LibraryEntry | undefined> {
  const lib = await loadLibrary(paperRoot);
  return lib.entries.find(predicate);
}
