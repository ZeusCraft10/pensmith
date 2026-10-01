// bin/lib/migrations/done-record/v3_to_v4.ts — `.paper/DONE-RECORD.json`
// v3 → v4 (Phase 21 review round 2).
//
// v4 adds the optional `previous_final_sha256` to the draft-mode record:
// `pensmith humanize` writes its record BEFORE FINAL.md and names there the
// FINAL.md text it replaces, so a stop between the two writes leaves done's
// own earlier text — `stale`, never `edited`. No v3 record names one (every
// v3 record was written after its FINAL.md), so the lift is the version
// alone. Idempotent on v4 input.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return { ...src, $schemaVersion: 4 };
}

export default migrate;
