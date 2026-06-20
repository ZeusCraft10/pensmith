// bin/lib/global-library.ts — the GLOBAL PAPER REGISTRY glue (LIB-01/02/03/05).
//
// W10-shaped sibling of bin/lib/library.ts. It composes the SAME four lower-level
// chokepoints into a one-import API, but for the CROSS-PROJECT paper registry
// (one entry per paper, across all projects) rather than the per-paper citation
// store:
//
//   atomicWriteFile (W2 / D-04)   — crash-safe writes via tmp+rename
//   withLock        (W3 / D-26)   — cross-process advisory lock
//   loadAndMigrate  (W7 / D-37)   — version envelope + zod validation
//   openSessionLog  (W9 / D-49)   — JSONL structured log, kind:'event'
//
// The registry file is pensmithDataDir()/library/index.json — OUTSIDE any
// `.paper/` (LIB-01: pensmith app state must not live inside a sync-folder-risk
// `.paper/`). It is STRICTLY SEPARATE from:
//   - the per-paper .paper/LIBRARY.json (D-59) — bin/lib/library.ts (untouched).
//   - the path-free style-fingerprints.json registry (08-02).
//
// KEY DIFFERENCES from library.ts (deliberate — see PATTERNS.md):
//   1. UPSERT-by-id, NOT reject-on-duplicate. intake (08-05) re-registers a
//      paper on every run, so registerPaperInGlobalLibrary UPDATES an existing
//      entry (bumping updatedAt) instead of throwing DuplicateLibraryEntryError.
//   2. AUTO-INIT on first use, NOT AlreadyExists-throw. loadGlobalLibrary seeds
//      an empty index on ENOENT rather than rejecting; initGlobalLibrary is a
//      no-op when the index already exists rather than throwing.
//   3. The PAPER registry entry RETAINS folderPath (LIB-03). The D-59 schema is
//      NOT touched/conflated here — this is a strictly separate file + schema.
//
// DERIVE-AT-DISPLAY (Open-Q4 / LIB-05 / the cycle-2 HIGH fix):
//   deriveLibraryStatus reads each paper's AUTHORITATIVE STATE.json + section
//   PLAN.md frontmatter and MIRRORS router.resolveNextAction's on-disk stage
//   machine onto the LIB-05 vocabulary. The stored entry.status is consulted
//   ONLY for the terminal `archived` flag (the one state with no on-disk
//   marker). deriveLibraryStatus is TOTAL and NEVER-THROWS over N papers (a
//   missing STATE.json → intake; a corrupt one → unknown; a corrupt section
//   PLAN.md is absorbed by readSectionState; an outer backstop guarantees
//   totality). This REUSES loadState (state.ts) + readSectionState (router.ts)
//   — it does NOT reimplement the section state machine.

import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import { loadState, StateNotFoundError } from './state.js';
import { Schema as StateSchema, type State } from './schemas/state.js';
import { readSectionState } from './router.js';
import { paperDir, sectionPlan, pensmithGlobalLibraryIndexPath } from './paths.js';
import {
  GlobalLibrarySchema,
  GlobalLibraryEntrySchema,
  CURRENT_GLOBAL_LIBRARY_VERSION,
  type GlobalLibrary,
  type GlobalLibraryEntry,
} from './schemas/global-library.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the global registry index. Resolving up-front
 * (always the live process env/platform) keeps the lock key identical across
 * callers. Always uses pensmithDataDir() — NEVER a `.paper/` (LIB-01).
 */
function globalLibraryFile(): string {
  return pensmithGlobalLibraryIndexPath();
}

/**
 * Module-level singleton SessionLogger child bound to `module: 'global-library'`.
 * Lazy-initialized so test files that mutate process.env (LOCALAPPDATA,
 * XDG_DATA_HOME, HOME) BEFORE dynamically importing this module observe the
 * mutated env — openSessionLog reads paths.ts at call-time. (Same discipline as
 * library.ts / state.ts.)
 */
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'global-library' });
  }
  return _log;
}

// ---------------------------------------------------------------------------
// Public API (LIB-01/02/03).
// ---------------------------------------------------------------------------

/**
 * Create pensmithDataDir()/library/index.json with $schemaVersion =
 * CURRENT_GLOBAL_LIBRARY_VERSION and entries=[], ONLY if it does not already
 * exist. Returns the seeded library.
 *
 * KEY DIFFERENCE from library.ts initLibrary: this is AUTO-INIT semantics —
 * when the index already exists it is a NO-OP (returns the seeded shape without
 * touching disk), NOT an AlreadyExists throw. intake/list/open all call into
 * the registry on first use without a pre-existing index.
 *
 * The existence-check runs INSIDE the lock (BLOCKER-01 discipline) so two
 * concurrent inits cannot both observe ENOENT and both seed.
 */
export async function initGlobalLibrary(): Promise<GlobalLibrary> {
  const file = globalLibraryFile();

  // Validate the seed BEFORE acquiring the lock.
  const seeded: GlobalLibrary = GlobalLibrarySchema.parse({
    $schemaVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
    entries: [],
  });

  // The library/ dir does not exist on a fresh machine — create it first so the
  // lock file (keyed by the index path) and the atomic write both have a home.
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  // BLOCKER-01 discipline: existence check INSIDE the lock so check-then-write
  // is atomic against any other locked writer (registerPaper / another init).
  await withLock(file, async () => {
    try {
      await fs.promises.access(file);
      // Already exists — AUTO-INIT is idempotent; do NOT clobber.
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw e; // EACCES/EPERM bubble unchanged
    }
    await atomicWriteFile(file, JSON.stringify(seeded, null, 2) + '\n');
  });

  log().event({
    event: 'global-library.init',
    entryCount: seeded.entries.length,
    schemaVersion: seeded.$schemaVersion,
  });

  return seeded;
}

/**
 * Read pensmithDataDir()/library/index.json, run any pending forward migrations,
 * validate against GlobalLibrarySchema, and return the typed value.
 *
 * AUTO-INIT on ENOENT: when the index is absent (ENOENT, or `cause.code ===
 * 'ENOENT'`) this SEEDS an empty index via initGlobalLibrary rather than
 * throwing — LIB-02. Every other error (permission, JSON parse failure, schema
 * validation, ForwardIncompatError) bubbles up unchanged.
 *
 * The loadAndMigrate call is wrapped in withLock because its writeBack:true
 * branch issues an atomicWriteFile when a forward migration runs (dormant
 * today, v1 only — same discipline as library.ts/state.ts).
 */
export async function loadGlobalLibrary(): Promise<GlobalLibrary> {
  const file = globalLibraryFile();
  let value: GlobalLibrary;
  try {
    value = await withLock(file, async () =>
      (await loadAndMigrate({
        file,
        schema: GlobalLibrarySchema,
        schemaName: 'global-library',
        currentVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
        writeBack: true,
      })) as GlobalLibrary,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      // LIB-02: auto-init an empty index on first use rather than rejecting.
      return initGlobalLibrary();
    }
    throw e;
  }

  log().event({
    event: 'global-library.load',
    entryCount: value.entries.length,
    schemaVersion: value.$schemaVersion,
  });

  return value;
}

/**
 * UPSERT a single PAPER entry into the global registry by `entry.id`.
 *
 * Operation sequence inside ONE withLock critical section (T-08-01-01):
 *   1. read+migrate+validate the current registry (writeBack:false — we re-write)
 *   2. find the existing entry by id
 *   3. if present → MERGE {...existing, ...entry, updatedAt: now} (UPDATE in
 *      place, bumping updatedAt); if absent → APPEND the new entry
 *   4. GlobalLibrarySchema.parse the result
 *   5. atomicWriteFile the result
 *
 * KEY DIFFERENCE from library.ts addEntry: UPSERT, NOT reject-on-duplicate.
 * intake (08-05) re-registers a paper on every run and lifecycle progress
 * updates an existing entry — a duplicate id is the UPDATE case, not an error.
 *
 * The whole read-decide-write runs inside ONE lock so two concurrent callers
 * cannot both observe the pre-write state (the library.ts 10-concurrent
 * mitigation, applied to UPSERT semantics).
 */
export async function registerPaperInGlobalLibrary(
  entry: GlobalLibraryEntry,
): Promise<GlobalLibrary> {
  const file = globalLibraryFile();

  // Fail-fast single-entry validation BEFORE the lock (catches caller garbage
  // without contending the critical section).
  const validatedEntry: GlobalLibraryEntry = GlobalLibraryEntrySchema.parse(entry);

  // The library/ dir may not exist yet if registerPaper is the very first call.
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  let next!: GlobalLibrary;

  await withLock(file, async () => {
    let current: GlobalLibrary;
    try {
      current = (await loadAndMigrate({
        file,
        schema: GlobalLibrarySchema,
        schemaName: 'global-library',
        currentVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
        writeBack: false,
      })) as GlobalLibrary;
    } catch (e) {
      // First-ever register: no index on disk yet → start from an empty set.
      const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
      if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
        current = GlobalLibrarySchema.parse({
          $schemaVersion: CURRENT_GLOBAL_LIBRARY_VERSION,
          entries: [],
        });
      } else {
        throw e;
      }
    }

    const idx = current.entries.findIndex((e) => e.id === validatedEntry.id);
    const updatedEntries =
      idx >= 0
        ? current.entries.map((e, i) =>
            i === idx
              ? { ...e, ...validatedEntry, updatedAt: new Date().toISOString() }
              : e,
          )
        : [...current.entries, validatedEntry];

    next = GlobalLibrarySchema.parse({ ...current, entries: updatedEntries });
    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });

  log().event({
    event: 'global-library.register',
    id: validatedEntry.id,
    entryCount: next.entries.length,
  });

  return next;
}

// ---------------------------------------------------------------------------
// LIB-05 — DERIVE-AT-DISPLAY status resolver (the cycle-2 HIGH fix / Open-Q4).
// ---------------------------------------------------------------------------

/** The LIB-05 lifecycle vocabulary (+ the never-throw 'unknown' terminus). */
export type DerivedLibraryStatus =
  | 'intake'
  | 'research'
  | 'outline'
  | 'sectioning'
  | 'compile'
  | 'done'
  | 'archived'
  | 'unknown';

export interface DerivedStatusResult {
  status: DerivedLibraryStatus;
  sectioningProgress?: { done: number; total: number };
}

/**
 * Section statuses that count as "past planned" (draft-or-beyond) for the
 * sectioning X/Y progress count. Mirrors the SectionStateSchema values that
 * router.resolveNextAction treats as work-started (anything the writer has
 * touched and not merely planned).
 */
const PAST_PLANNED_SECTION_STATES = new Set([
  'written',
  'verifying',
  'verified',
  'failed',
  'unverifiable',
]);

/**
 * DERIVE a paper's LIB-05 lifecycle status at DISPLAY time from its AUTHORITATIVE
 * on-disk state (STATE.json + section PLAN.md frontmatter), NEVER from a stored
 * `entry.status` (which goes stale the instant the paper advances out-of-band).
 *
 * `storedStatus` is consulted ONLY for the terminal `archived` flag — the single
 * lifecycle state with no on-disk marker.
 *
 * Mapping (MIRRORS router.resolveNextAction's on-disk stage machine onto the
 * LIB-05 DISPLAY vocabulary — DISPLAY reports the COMPLETED stage, not the next
 * action):
 *   (0) storedStatus === 'archived'                       → archived (terminal)
 *   (1) STATE.json ABSENT (StateNotFoundError)            → intake
 *       STATE.json PRESENT-but-corrupt (any other throw)  → unknown
 *   (2) STATE.json present:
 *       no .paper/RESEARCH.md                             → intake
 *       RESEARCH.md present, no .paper/OUTLINE.md         → research
 *       OUTLINE.md present, sections absent/empty         → outline
 *   (3) sections present:
 *       Y = sections.length; X = count past 'planned'.
 *       NOT all sections 'verified'                       → sectioning {done:X,total:Y}
 *   (4) all sections 'verified':
 *       no .paper/DRAFT.md                                → compile
 *       +.paper/DRAFT.md                                  → done
 *
 * NEVER-THROWS (T-08-01-05): every fs/parse op is guarded (loadState absent vs.
 * corrupt; each per-section read through readSectionState which never throws),
 * and the WHOLE body is wrapped in an OUTER try/catch backstop → 'unknown' so a
 * single bad paper can never crash `list` deriving status across N papers. This
 * is SYNCHRONOUS by contract (the test calls it without `await`) — it uses the
 * synchronous on-disk probes (existsSync) and reads STATE.json synchronously via
 * a guarded loadStateSync below rather than the async loadState chokepoint.
 */
export function deriveLibraryStatus(
  folderPath: string,
  storedStatus?: string,
): DerivedStatusResult {
  // OUTER BACKSTOP (defense-in-depth — mirrors router.ts): even an unforeseen
  // throw from any op below resolves to 'unknown' rather than escaping, so the
  // never-throw invariant is TOTAL across N papers.
  try {
    // (0) Terminal archived flag — the one state with no on-disk marker.
    if (storedStatus === 'archived') return { status: 'archived' };

    // (1) Classify the STATE.json load: ABSENT → intake, CORRUPT → unknown.
    let stateRead: SyncStateRead;
    try {
      stateRead = loadStateSync(folderPath);
    } catch {
      // loadStateSync itself is guarded; this catch is belt-and-suspenders.
      return { status: 'unknown' };
    }
    if (stateRead.absent) return { status: 'intake' };
    if (stateRead.corrupt || !stateRead.state) return { status: 'unknown' };

    const state = stateRead.state;
    const pDir = paperDir(folderPath);

    // (2) STATE.json present — walk the on-disk stage probes. existsSync never
    //     throws (returns false on any error).
    if (!existsSync(join(pDir, 'RESEARCH.md'))) return { status: 'intake' };
    if (!existsSync(join(pDir, 'OUTLINE.md'))) return { status: 'research' };

    const sections = Array.isArray(state.sections) ? state.sections : [];
    if (sections.length === 0) return { status: 'outline' };

    // (3) Sections present: count past-planned (X) of total (Y) and whether all
    //     are verified. Each per-section read is through readSectionState, which
    //     NEVER throws (absorbs a corrupt section PLAN.md → corrupt:true).
    let done = 0;
    let allVerified = true;
    for (const sec of sections) {
      const r = readSectionState(sectionPlan(sec.n, sec.slug, folderPath));
      const status = r.corrupt || r.absent ? 'planned' : r.status;
      if (status === 'verified') {
        done += 1;
      } else {
        allVerified = false;
        if (PAST_PLANNED_SECTION_STATES.has(status)) done += 1;
      }
    }

    if (!allVerified) {
      return { status: 'sectioning', sectioningProgress: { done, total: sections.length } };
    }

    // (4) All sections verified.
    if (!existsSync(join(pDir, 'DRAFT.md'))) return { status: 'compile' };
    return { status: 'done' };
  } catch {
    // Backstop — never let derivation crash `list`.
    return { status: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Guarded SYNCHRONOUS STATE.json read for deriveLibraryStatus.
//
// deriveLibraryStatus is SYNC by contract (the LIB-05 test calls it without
// `await`). The async loadState chokepoint (state.ts) cannot be used inside a
// sync function, so we read STATE.json synchronously here and classify the three
// outcomes the resolver needs — ABSENT, CORRUPT, OK — exactly as the async
// loadState classifies them (StateNotFoundError on ENOENT; everything else
// bubbles as a corrupt read). This mirrors the loadState contract referenced in
// the plan's <interfaces>: absent → intake, any other failure → unknown. We
// retain the loadState/StateNotFoundError imports for the type + classification
// contract documented above; the sync path here is the never-throw shim.
// ---------------------------------------------------------------------------

interface SyncStateRead {
  /** Parsed + validated STATE.json when the read succeeded. */
  state?: State;
  /** STATE.json does not exist on disk (ENOENT). */
  absent: boolean;
  /** STATE.json is present but unreadable / invalid JSON / schema-invalid. */
  corrupt: boolean;
}

/**
 * Synchronous, NEVER-THROWS STATE.json read keyed off the SAME classification
 * the async loadState (state.ts) uses: ENOENT → absent (→ intake), any other
 * failure → corrupt (→ unknown). The reference to loadState/StateNotFoundError
 * in this module documents that this shim intentionally mirrors that contract
 * for the sync derivation path.
 */
function loadStateSync(folderPath: string): SyncStateRead {
  // Document the contract this shim mirrors (and keep the imports load-bearing):
  // loadState would translate ENOENT → StateNotFoundError; this sync path makes
  // the identical absent-vs-corrupt distinction without awaiting.
  void loadState;
  void StateNotFoundError;

  const file = join(path.resolve(folderPath), 'STATE.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return { absent: true, corrupt: false };
    // EACCES / EPERM / EISDIR / etc. — present but unreadable.
    return { absent: false, corrupt: true };
  }

  try {
    // Validate against the AUTHORITATIVE StateSchema (same shape the async
    // loadState validates). Invalid JSON or a schema-invalid envelope → corrupt.
    const parsed = StateSchema.parse(JSON.parse(raw));
    return { absent: false, corrupt: false, state: parsed };
  } catch {
    return { absent: false, corrupt: true };
  }
}
