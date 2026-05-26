// bin/lib/deep-equal.ts — minimal structural deep-equality helper.
//
// Phase 3 Plan 03-03 Task 3.5 (CYCLE-2 M-6 reviews convergence).
//
// Used by the v1→v2 state migration (bin/lib/state.ts migrateState path)
// to short-circuit idempotent re-merges: if PLAN.md frontmatter already
// contains the same keys/values the migration would write, we skip the
// write so a crash mid-migration does not rewrite identical bytes.
//
// Not for circular structures — migration inputs are JSON-shaped so cycles
// are impossible. Zero dependencies (we deliberately do NOT import
// node:util.isDeepStrictEqual to keep the migration module dep-free).

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false; // primitives caught above; NaN !== NaN
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bo)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
