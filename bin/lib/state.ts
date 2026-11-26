// bin/lib/state.ts — paper state load/save/update glue (D-58 foundation slice).
//
// This is the W10 chokepoint integration: it composes the four lower-level
// chokepoints from earlier waves into a single cohesive API for paper state:
//
//   atomicWriteFile (W2 / D-04)   — crash-safe writes via tmp+rename
//   withLock        (W3 / D-26)   — cross-process advisory lock
//   loadAndMigrate  (W7 / D-37)   — version envelope + zod validation
//   openSessionLog  (W9 / D-49)   — JSONL structured log, kind:'event'
//
// Per D-58 the schema is intentionally tiny: {$schemaVersion, paperId,
// createdAt}. The state machine, wave scheduler bookkeeping, and section
// status fields are added in Phase 2 via forward migrations under
// bin/lib/migrations/state/. Adding ANY new field to the schema in this
// repo MUST come with a v(N)→v(N+1) migration registered in the loader
// or readers will throw SchemaValidationError.
//
// Concurrency contract (T-01-01 mitigation):
//   updateState performs load → mutate → save inside a SINGLE withLock
//   critical section. Reading outside the lock is a correctness bug
//   because two concurrent callers would each read the pre-write value
//   and the second writer would silently clobber the first.
//
//   loadState ALSO takes withLock around its loadAndMigrate call because
//   the loader's writeBack:true path issues an atomicWriteFile when a
//   forward migration runs (BLOCKER-02 fix). Without the lock, two
//   concurrent loadState callers each migrating a v(N-1) file to vN
//   would race their tmp+rename writes against each other AND against
//   any concurrent updateState/saveState. Today the migration registry
//   is empty so the writeBack branch is dormant, but the lock is in
//   place so the race cannot activate the day a real v2 ships.
//
//   initState ALSO takes withLock around the existence check (BLOCKER-01
//   fix) so the access-then-write is atomic. The pre-fix code performed
//   fs.access OUTSIDE the lock, allowing two concurrent inits to both
//   observe ENOENT and both seed — the second silently clobbering the
//   first via atomic rename. The fix is to move the access check inside
//   the same critical section as the write.
//
// Forward-incompat contract (T-01-COMPAT-01 mitigation):
//   ForwardIncompatError from loadAndMigrate propagates UNCHANGED so a
//   newer-on-disk STATE.json never gets silently downgraded by an older
//   pensmith build. Test 6 in tests/state.test.ts is the regression gate.
//
// Defense-in-depth schema validation (T-01-08 mitigation):
//   StateSchema.parse runs on:
//     - initState seed construction
//     - saveState input
//     - updateState mutator output
//   PLUS the loader validates on every read. Three save-side guards +
//   one load-side guard = no malformed state survives a write/read cycle.
//
// Imports limited to: node:fs, node:path, node:crypto, and the four
// chokepoint modules above. No third-party deps.

import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import { hasLegacyLayout, migrateLegacyLayout } from './migrations/layout.js';
import { legacyStateFile, paperStateFile } from './paths.js';
import { atomicWriteFile, isDryRun } from './atomic-write.js';
import v1_to_v2_migration, {
  migrate as migrate_v1_to_v2,
} from './migrations/state/v1_to_v2.js';
import {
  Schema as StateSchema,
  CURRENT_STATE_VERSION,
  type State,
} from './schemas/state.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

// Registry of state forward migrations consumed by loadAndMigrate. Keyed by
// SOURCE disk version: migrations[N] migrates v(N) → v(N+1). Added in Phase 3
// Plan 03-03 Task 3.2 (D-09): the writeBack branch was dormant in Phase 1
// (registry empty) — Wave 2 lights it up.
const STATE_MIGRATIONS: Record<number, (input: unknown) => unknown> = {
  1: v1_to_v2_migration,
};

// ---------------------------------------------------------------------------
// Errors (per <interfaces> in 01-10-PLAN.md).
// ---------------------------------------------------------------------------

export class StateNotFoundError extends Error {
  code = 'STATE_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StateNotFoundError';
  }
}

export class StateAlreadyExistsError extends Error {
  code = 'STATE_ALREADY_EXISTS' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StateAlreadyExistsError';
  }
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * The absolute path of the paper's `.paper/STATE.json`, after moving a
 * STATE.json that an older pensmith left in the project root
 * (migrations/layout.ts). The path is absolute so the lock key (the file
 * path) is the same for every caller.
 */
async function stateFile(paperRoot: string): Promise<string> {
  await migrateLegacyLayout(paperRoot);
  return paperStateFile(paperRoot);
}

/**
 * The file loadState reads. A dry run moves nothing, so it reads a STATE.json
 * an older pensmith left in the project root where it is.
 */
async function stateFileToRead(paperRoot: string): Promise<string> {
  const file = await stateFile(paperRoot);
  return isDryRun() && hasLegacyLayout(paperRoot) ? legacyStateFile(paperRoot) : file;
}

/**
 * Module-level singleton SessionLogger child bound to `module: 'state'`.
 * Lazy-initialized so test files that mutate process.env (LOCALAPPDATA,
 * XDG_DATA_HOME, HOME) BEFORE dynamically importing this module observe
 * the mutated env. openSessionLog reads paths.ts at call-time, so this
 * singleton resolves the log destination at first use, not at import.
 */
let _log: SessionLogger | null = null;
function log(): SessionLogger {
  if (!_log) {
    _log = openSessionLog({ scope: 'auto' }).child({ module: 'state' });
  }
  return _log;
}

// ---------------------------------------------------------------------------
// Public API (D-58 foundation slice).
// ---------------------------------------------------------------------------

/**
 * Create `.paper/STATE.json` under `paperRoot` with $schemaVersion=CURRENT_STATE_VERSION,
 * a fresh paperId (UUID v4 unless caller provides one via `seed.paperId`),
 * and createdAt = ISO-now.
 *
 * Refuses to overwrite an existing STATE.json — throws StateAlreadyExistsError
 * (code: STATE_ALREADY_EXISTS). Use updateState for in-place mutation.
 *
 * Permission errors (EACCES, EPERM, ...) bubble up unchanged. Only the
 * existence-check is translated; everything else is opaque to the caller.
 */
export async function initState(
  paperRoot: string,
  seed?: { paperId?: string },
): Promise<State> {
  const file = await stateFile(paperRoot);

  // Validate the seed against the schema BEFORE acquiring the lock. This
  // guards against a caller passing a paperId that fails .min(1) and
  // fails fast without contending the per-file critical section.
  const seeded: State = StateSchema.parse({
    $schemaVersion: CURRENT_STATE_VERSION,
    paperId: seed?.paperId ?? randomUUID(),
    createdAt: new Date().toISOString(),
  });

  // BLOCKER-01 fix: the existence check MUST run INSIDE the lock. The
  // pre-fix code performed fs.access OUTSIDE the lock, which left a
  // window where two concurrent inits could both observe ENOENT, both
  // pass the access-then-throw gate, and both enter withLock sequentially
  // — the second writer silently clobbering the first via atomic rename.
  // Moving the access call inside the critical section makes
  // "check-then-write" atomic against any other locked writer
  // (saveState, updateState, or another initState).
  await withLock(file, async () => {
    // Refuse to clobber. fs.access throws ENOENT when the file is absent —
    // which is exactly the case where init is allowed to proceed. Any
    // other error code (EACCES, EPERM, etc.) bubbles up unchanged.
    try {
      await fs.promises.access(file);
      throw new StateAlreadyExistsError(`STATE.json already exists at ${file}`);
    } catch (e) {
      if (e instanceof StateAlreadyExistsError) throw e;
      const code = (e as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw e;
    }
    await atomicWriteFile(file, JSON.stringify(seeded, null, 2) + '\n');
  });

  log().event({
    event: 'state.init',
    paperId: seeded.paperId,
    schemaVersion: seeded.$schemaVersion,
  });

  return seeded;
}

/**
 * Read `.paper/STATE.json` under `paperRoot`, run any pending forward migrations,
 * validate against StateSchema, and return the typed value.
 *
 * Translates ENOENT (or `cause.code === 'ENOENT'`) into StateNotFoundError
 * (code: STATE_NOT_FOUND). Every other error — permission errors, JSON
 * parse failures, schema validation failures, ForwardIncompatError —
 * bubbles up unchanged.
 *
 * Pass-through ForwardIncompatError is the T-01-COMPAT-01 mitigation:
 * a newer-on-disk STATE.json must never be silently downgraded.
 *
 * `writeBack: true` so a future v1→v2 migration persists the upgraded
 * shape on disk. Today the migration registry is empty (we're at v1)
 * so no actual write occurs.
 */
export async function loadState(paperRoot: string): Promise<State> {
  const file = await stateFileToRead(paperRoot);
  let value: State;
  try {
    // BLOCKER-02 fix: wrap the loadAndMigrate call inside withLock. The
    // loader's writeBack:true branch issues an atomicWriteFile when a
    // forward migration runs — without the lock, two concurrent loadState
    // callers each migrating a v(N-1) file to vN would race tmp+rename
    // writes against each other and against any concurrent saveState/
    // updateState. The race is dormant today (no v2 schema yet) but the
    // lock must be in place so the race cannot activate the day a real
    // forward migration ships. The lock cost when no migration runs is
    // bounded by W3's per-process advisory-lock fast path.
    value = await withLock(file, async () =>
      (await loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: CURRENT_STATE_VERSION,
        migrations: STATE_MIGRATIONS,
        writeBack: true,
      })) as State,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      throw new StateNotFoundError(`STATE.json not found at ${file}`);
    }
    throw e;
  }

  log().event({
    event: 'state.load',
    paperId: value.paperId,
    schemaVersion: value.$schemaVersion,
  });

  return value;
}

/**
 * Validate `state` against StateSchema and atomically write it to
 * STATE.json under `paperRoot`. Acquires the per-file lock for the
 * duration of the write so it cannot interleave with updateState.
 *
 * StateSchema.parse runs BEFORE the disk write — refuses to write
 * malformed state regardless of caller discipline (T-01-08 mitigation).
 */
export async function saveState(paperRoot: string, state: State): Promise<void> {
  const file = await stateFile(paperRoot);
  const validated = StateSchema.parse(state);

  await withLock(file, async () => {
    await atomicWriteFile(file, JSON.stringify(validated, null, 2) + '\n');
  });

  log().event({
    event: 'state.save',
    paperId: validated.paperId,
    schemaVersion: validated.$schemaVersion,
  });
}

/**
 * Read STATE.json, run `mutator` on the current value, validate the
 * result, and atomically write it back — all inside a SINGLE withLock
 * critical section.
 *
 * The lock-scope is load-INSIDE-the-lock for a reason: if we read
 * outside the lock, two concurrent updateState calls would each see
 * the same pre-write value and the second writer would clobber the
 * first. Test 5 in tests/state.test.ts is the regression gate.
 *
 * `writeBack: false` on the inner loadAndMigrate because we're about
 * to atomicWriteFile a fresh copy moments later — there's no point
 * persisting the migrated shape twice in one critical section.
 */
export async function updateState(
  paperRoot: string,
  mutator: (s: State) => State | Promise<State>,
): Promise<State> {
  const file = await stateFile(paperRoot);
  let next!: State;

  await withLock(file, async () => {
    const current = (await loadAndMigrate({
      file,
      schema: StateSchema,
      schemaName: 'state',
      currentVersion: CURRENT_STATE_VERSION,
      migrations: STATE_MIGRATIONS,
      writeBack: false,
    })) as State;
    const candidate = await mutator(current);
    next = StateSchema.parse(candidate);
    await atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n');
  });

  log().event({
    event: 'state.update',
    paperId: next.paperId,
    schemaVersion: next.$schemaVersion,
  });

  return next;
}

// ---------------------------------------------------------------------------
// State-mutation helpers (D-13 / TIER-02), typed wrappers over updateState.
//
// STATE.json's per-section schema is { n, slug } strict; per-section status
// and verdicts live in PLAN.md frontmatter (PlanFrontmatterSchema) and
// VERIFICATION.json. initSection writes {n, slug}.
// ---------------------------------------------------------------------------

/**
 * Initialise a new section row in state.sections. Idempotent per D-08:
 * re-init on an existing section number returns the prior state unchanged.
 *
 * v2 shape: writes ONLY `{n, slug}` — no embedded state/status fields.
 * Per-section state lives in PLAN.md frontmatter from v2 onward (D-08).
 */
export async function initSection(
  paperRoot: string,
  n: number,
  slug: string,
): Promise<State> {
  return updateState(paperRoot, (prev) => {
    const sections = prev.sections ?? [];
    if (sections.some((s) => s.n === n)) return prev; // idempotent (D-08)
    return { ...prev, sections: [...sections, { n, slug }] };
  });
}

// ---------------------------------------------------------------------------
// migrateState — public v1→v2 wrapper (Phase 3 Plan 03-03 Task 3.2 / D-09).
//
// Distinct from the migrations-loader path (which works on $schemaVersion'd
// JSON envelopes during disk reads): migrateState is a SHAPE TRANSFORM on
// already-parsed JS objects. It accepts the snake_case test-fixture shape
// (`schema_version: 1, sections: [{n, slug, state, status, lastVerification}]`)
// and returns the slimmed v2 shape per D-09.
//
// Idempotent on v2 inputs, throws refuse-forward on v3+. See
// bin/lib/migrations/state/v1_to_v2.ts for the body — this wrapper exists
// so consumers can `import { migrateState } from '@pensmith/state'` without
// reaching into the migrations subdirectory and so we can later wire the
// 5-step full-fidelity disk migration (PLAN.md merges + withLock) behind
// the same export name.
// ---------------------------------------------------------------------------

/**
 * Shape-transform v1 → v2 (D-09). Accepts an already-parsed state object
 * (either the snake_case test fixture or the camelCase production
 * envelope) and returns a v2-shaped object with the enumerated v1 fields
 * dropped. Idempotent on v2; throws refuse-forward on v3+.
 *
 * Return type is `unknown` (not `State`) because the test-fixture shape
 * uses snake_case `schema_version` (alongside top-level `name`/`slug` which
 * are NOT in the production StateSchema). The production read path goes
 * through loadAndMigrate / StateSchema.parse, which DOES enforce the
 * camelCase $schemaVersion envelope. migrateState's contract is the
 * SHAPE TRANSFORM only — schema validation is the caller's responsibility.
 *
 * Async signature is for forward-compatibility with the full-fidelity disk
 * migration (5-step withLock dance described in Plan 03-03 Task 3.2 — wired
 * by later plans). Today the body is sync but exposed as a Promise so the
 * `await migrateState(v1)` callsite in tests/migration.property.test.ts
 * never has to change when the disk dance lands.
 */
export async function migrateState(input: unknown): Promise<unknown> {
  return Promise.resolve(migrate_v1_to_v2(input));
}
