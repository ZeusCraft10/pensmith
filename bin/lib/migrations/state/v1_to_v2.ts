// bin/lib/migrations/state/v1_to_v2.ts — v1 → v2 state migration body (D-09).
//
// Phase 3 Plan 03-03 Task 3.2.
//
// CONTRACT (D-09):
//   v1 STATE.json carries embedded per-section state on each `sections[]`
//   entry: `state`, `status`, `lastVerification`. It also carries top-level
//   pointer-style fields: `currentPhaseId`, `currentSection`,
//   `currentSectionSlug`. v2 slims STATE.json down to a pointer table — the
//   per-section state machine lives in PLAN.md frontmatter from v2 onward
//   (D-08), and the "what am I doing right now" cursor lives in HANDOFF.json
//   (D-17). This migration:
//     1. Drops `currentPhaseId` / `currentSection` / `currentSectionSlug` at top level.
//     2. Drops `state` / `status` / `lastVerification` per section entry.
//     3. Preserves every other top-level field (property-test gate — D-09).
//     4. Bumps the schema-version field to 2.
//
// VERSION-FIELD NAMING:
//   The Phase 1 versioning envelope is `$schemaVersion` (camelCase) — that
//   is what bin/lib/migrations/loader.ts reads via readVersion(). However,
//   the Wave 0 test fixtures (tests/migration.test.ts / migration.property.test.ts)
//   use `schema_version` (snake_case) because that's the historical pre-Phase-1
//   shape. The migrate() function below detects EITHER naming convention on
//   input and preserves whichever was present on output. This is intentional:
//   migrate() is a SHAPE TRANSFORM, not a versioning-envelope rename.
//
// IDEMPOTENCY (D-09 Step 2d / CYCLE-2 M-6):
//   migrate() on a v2 input returns a deep-clone with v2 unchanged. The
//   deep-clone (via JSON round-trip) ensures the test
//   `assert.deepEqual(once, twice)` succeeds without shared-reference
//   surprises. deepEqual from bin/lib/deep-equal.ts is consumed by
//   downstream callers that need to short-circuit identical re-merges.
//
// REFUSE-FORWARD (D-09 / D-39 / ARCH-07):
//   migrate() on a v3+ input throws an Error whose message contains the
//   strings 'refuse-forward' AND 'version' so the test's
//   `/forward|version|schema|v3/i` regex matches.
//
// MigrationLockTimeoutError is exported for Phase-3 callers that wrap a
// real-disk migration in withLock(planPath) (per the plan's 5-step dance);
// nothing in this skeleton consumes it today, but the class is exported
// here as the canonical type-name so downstream loadState wiring can throw
// it without re-defining.

import { deepEqual } from '../../deep-equal.js';

const DROPPED_TOP_LEVEL = new Set([
  'currentPhaseId',
  'currentSection',
  'currentSectionSlug',
]);
const DROPPED_SECTION_FIELDS = new Set([
  'state',
  'status',
  'lastVerification',
]);

/**
 * Normalize a v1 section slug to v2's strict `/^[a-z0-9-]+$/` contract (audit
 * #28): lowercase, non-conforming runs → '-', collapse repeats, trim edges. v1
 * allowed a slug to be missing OR non-conforming (uppercase, spaces,
 * punctuation); v2's SectionEntrySchema rejects those, so a valid v1 state would
 * fail v2 validation. A conforming slug is returned UNCHANGED; a missing / empty
 * / all-invalid slug falls back to `section-<n>`.
 */
function normalizeSectionSlug(raw: unknown, n: number): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : `section-${n}`;
}

/**
 * Error thrown when a PLAN.md per-section lock cannot be acquired during the
 * full-fidelity v1→v2 migration (the 5-step dance described in Plan 03-03
 * Task 3.2). The current skeleton does NOT take per-PLAN.md locks because
 * `tests/migration.test.ts` does not exercise the on-disk path; but the type
 * is exported so the wiring in bin/lib/state.ts can throw it when the full
 * migration dance is wired up later.
 */
export class MigrationLockTimeoutError extends Error {
  code = 'MIGRATION_LOCK_TIMEOUT' as const;
  planPath: string;
  constructor(planPath: string, message?: string) {
    super(
      message ??
        `pensmith: migration could not acquire lock on PLAN.md at ${planPath} ` +
          `(an editor or another pensmith run may be holding it)`,
    );
    this.name = 'MigrationLockTimeoutError';
    this.planPath = planPath;
  }
}

/**
 * Detect the schema-version on a state-shaped object. Returns the integer
 * version if either `schema_version` (snake_case — test fixture convention)
 * or `$schemaVersion` (camelCase — loader envelope convention) is present
 * and an integer ≥ 1. Returns 1 (pre-versioning fallback) otherwise.
 */
function detectVersion(input: Record<string, unknown>): {
  version: number;
  field: 'schema_version' | '$schemaVersion' | null;
} {
  const snake = input['schema_version'];
  if (typeof snake === 'number' && Number.isInteger(snake) && snake >= 1) {
    return { version: snake, field: 'schema_version' };
  }
  const camel = input['$schemaVersion'];
  if (typeof camel === 'number' && Number.isInteger(camel) && camel >= 1) {
    return { version: camel, field: '$schemaVersion' };
  }
  return { version: 1, field: null };
}

/**
 * v1 → v2 shape transform.
 *
 * @throws Error when input is non-object/null.
 * @throws Error (refuse-forward) when detected version > 2.
 */
export function migrate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('v1_to_v2: input must be a non-null, non-array object');
  }
  const obj = input as Record<string, unknown>;
  const { version, field } = detectVersion(obj);

  if (version > 2) {
    throw new Error(
      `pensmith: refuse-forward — state schema_version=${version} is newer than ` +
        `CURRENT_STATE_VERSION=2 (D-09 / ARCH-07). Upgrade pensmith, or restore from a ` +
        `v2-or-older snapshot.`,
    );
  }

  // v2: idempotent deep-clone (JSON round-trip — input is JSON-shaped so cycles
  // are impossible and Date/Map/Set are not in the contract). The clone ensures
  // `assert.deepEqual(once, twice)` succeeds because shared references on
  // nested arrays cannot produce false-negative inequality, and migrate(v2)
  // does NOT mutate caller-supplied objects (defense-in-depth).
  if (version === 2) {
    return JSON.parse(JSON.stringify(obj));
  }

  // v1 → v2: drop the enumerated fields, preserve every other top-level field,
  // and bump the version literal on whichever naming convention was present
  // (default to `schema_version` for test-fixture compatibility — the loader's
  // production path always uses `$schemaVersion` so the camelCase branch is
  // reached on production reads).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DROPPED_TOP_LEVEL.has(k)) continue;
    if (k === 'sections' && Array.isArray(v)) {
      out['sections'] = v.map((entry, idx) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          return entry;
        }
        const e = entry as Record<string, unknown>;
        const slim: Record<string, unknown> = {};
        for (const [ek, ev] of Object.entries(e)) {
          if (DROPPED_SECTION_FIELDS.has(ek)) continue;
          slim[ek] = ev;
        }
        // Normalize the slug ALWAYS (audit #28): v1 allowed it to be missing OR
        // non-conforming, but v2's strict SectionEntrySchema enforces
        // /^[a-z0-9-]+$/. A present-but-invalid slug previously survived verbatim
        // and made the migrated state fail v2 validation. A conforming slug is
        // unchanged; a missing/empty/all-invalid one falls back to `section-<n>`.
        {
          const n = typeof e['n'] === 'number' ? (e['n'] as number) : idx + 1;
          slim['slug'] = normalizeSectionSlug(slim['slug'], n);
        }
        return slim;
      });
      continue;
    }
    out[k] = v;
  }
  // Preserve naming convention of the input. If neither was present (pre-
  // versioning, detected as v1 by the fallback in detectVersion), default
  // to `schema_version` so the migration test's V2_FIXTURE shape is matched.
  const targetField = field ?? 'schema_version';
  out[targetField] = 2;
  // Audit #27: ALSO emit the canonical camelCase envelope. The loader
  // (migrations/loader.ts) and StateSchema both require `$schemaVersion`; a
  // snake-cased or pre-versioning v1 previously migrated to a snake-only output
  // that StateSchema.parse REJECTED (missing $schemaVersion) → the state was
  // permanently unloadable. The top-level Schema is .passthrough(), so keeping
  // the original-naming field alongside the canonical one is safe and preserves
  // the migrate() naming-preservation contract (snake-fixture tests).
  out['$schemaVersion'] = 2;
  return out;
}

/**
 * Default export — the migrations registry signature expects
 * `(input: unknown) => unknown`. Same body as `migrate` above.
 *
 * Idempotency under deepEqual short-circuit: if `migrate(input)` would
 * produce a value structurally equal to `input`, return the input
 * unchanged (no clone). Disabled here because the loader does NOT
 * compare structurally — it compares versions; the deepEqual call below
 * is the documentation of the contract for downstream loadState wiring
 * that might want byte-equality on idempotent re-runs.
 */
const v1_to_v2: (input: unknown) => unknown = (input) => {
  const out = migrate(input);
  // The contract: migrate(migrate(x)) is structurally equal to migrate(x).
  // Asserting it via deepEqual here is documentation-only (no throw); the
  // real gate is tests/migration.test.ts. The unused-var-elimination keeps
  // the deepEqual import live so the build artefact retains the symbol.
  void deepEqual;
  return out;
};
export default v1_to_v2;
