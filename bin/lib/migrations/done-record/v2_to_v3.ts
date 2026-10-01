// bin/lib/migrations/done-record/v2_to_v3.ts — `.paper/DONE-RECORD.json`
// v2 → v3 (Phase 21 review round 1).
//
// v3 adds `exported` to the draft-mode record: false when `pensmith humanize`
// (`done --only humanize`) wrote FINAL.md without exporting it, true when an
// export rendered the recorded FINAL.md. Every v2 draft record was written by
// a done that exported its FINAL.md (the humanize-only record is new with v3),
// so a draft record lifts with `exported: true`; an outline record keeps its
// fields. Idempotent on v3 input.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const draft = src['mode'] === undefined || src['mode'] === 'draft';
  return { ...src, ...(draft && src['exported'] === undefined ? { exported: true } : {}), $schemaVersion: 3 };
}

export default migrate;
