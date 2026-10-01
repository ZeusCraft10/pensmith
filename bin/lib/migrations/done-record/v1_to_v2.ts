// bin/lib/migrations/done-record/v1_to_v2.ts — `.paper/DONE-RECORD.json`
// v1 → v2 (Phase 21, GRND-11, D-21-25).
//
// v2 adds the outline-mode record (`mode: 'outline'` and the outline export's
// hashes). Every v1 record was written by a draft-mode done, and v2 reads a
// record with no `mode` as draft, so the lift is the version alone: every v1
// value is kept, nothing is added or guessed. Idempotent on v2 input.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return { ...src, $schemaVersion: 2 };
}

export default migrate;
