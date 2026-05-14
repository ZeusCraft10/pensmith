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
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import { Schema as StateSchema, CURRENT_STATE_VERSION, type State } from './schemas/state.js';
import { openSessionLog, type SessionLogger } from './session-log.js';

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
 * Resolve the absolute path to STATE.json under `paperRoot`. Resolving up-
 * front ensures the lock key (which is the file path) is identical across
 * callers regardless of relative vs. absolute paperRoot input.
 */
function stateFile(paperRoot: string): string {
  return path.join(path.resolve(paperRoot), 'STATE.json');
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
 * Create STATE.json under `paperRoot` with $schemaVersion=CURRENT_STATE_VERSION,
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
  const file = stateFile(paperRoot);

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
 * Read STATE.json under `paperRoot`, run any pending forward migrations,
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
  const file = stateFile(paperRoot);
  let value: State;
  try {
    value = (await loadAndMigrate({
      file,
      schema: StateSchema,
      schemaName: 'state',
      currentVersion: CURRENT_STATE_VERSION,
      writeBack: true,
    })) as State;
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
  const file = stateFile(paperRoot);
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
  const file = stateFile(paperRoot);
  let next!: State;

  await withLock(file, async () => {
    const current = (await loadAndMigrate({
      file,
      schema: StateSchema,
      schemaName: 'state',
      currentVersion: CURRENT_STATE_VERSION,
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
