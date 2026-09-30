// bin/lib/migrations/compile-inputs/v1_to_v2.ts — `.paper/COMPILE-INPUTS.json`
// v1 → v2 (Phase 20, VRFY-27, D-20-23).
//
// v2 adds `compiled_draft_sha256` (the sha256 of the DRAFT.md compile wrote)
// and, per section, `verified_against_draft_hash`. A v1 record never captured
// either, and neither can be reconstructed honestly (the compiled DRAFT.md or
// a section may have changed since), so both become null — which done reads as
// "stale: recompile" (fail closed). Every v1 value is kept; nothing else
// changes. Idempotent on v2 input (the fields a record already has are kept).
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const sections = Array.isArray(src['sections']) ? (src['sections'] as unknown[]) : [];
  return {
    ...src,
    $schemaVersion: 2,
    compiled_draft_sha256: typeof src['compiled_draft_sha256'] === 'string' ? src['compiled_draft_sha256'] : null,
    sections: sections.map((s) => {
      const sec = (typeof s === 'object' && s !== null && !Array.isArray(s) ? s : {}) as Record<string, unknown>;
      return {
        ...sec,
        verified_against_draft_hash: typeof sec['verified_against_draft_hash'] === 'string' ? sec['verified_against_draft_hash'] : null,
      };
    }),
  };
}

export default migrate;
