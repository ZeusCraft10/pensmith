// bin/lib/migrations/compile-inputs/v2_to_v3.ts — `.paper/COMPILE-INPUTS.json`
// v2 → v3 (Phase 21, EXP-05, D-21-13).
//
// v3 adds `headings_sha256`: the sha256 of the paper title and the section
// titles compile wrote as `# <title>` / `## <section title>` (compile-inputs.ts
// headingsSha256). A v2 record was written by a compile that wrote no headings,
// so the value cannot be reconstructed honestly and becomes null — which the
// router and done read as stale ("recompile"): every older paper is compiled
// once more, now with its title and headings (fail closed). Every v2 value is
// kept. Idempotent on v3 input.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return {
    ...src,
    $schemaVersion: 3,
    headings_sha256: typeof src['headings_sha256'] === 'string' ? src['headings_sha256'] : null,
  };
}

export default migrate;
