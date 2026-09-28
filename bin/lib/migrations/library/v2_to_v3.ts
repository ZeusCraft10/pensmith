// bin/lib/migrations/library/v2_to_v3.ts — LIBRARY.json v2 → v3 (Phase 19 seam
// S-B; SRC-04, SRC-05, SRC-09, SRC-11, SRC-15, SRC-16).
//
// SEAM FILE (Phase 19 plan, S-B). Applied byte-identically by every Phase 19
// stream; no stream edits it during Phase 19.
//
// v3 adds, per entry: type, publisher, volume, issue, pages, editors, tier,
// relevance, why_relevant, hydrated, retraction_status and zotero (see
// bin/lib/schemas/library.ts). Every v2 entry keeps every v2 value; the new
// fields take their "unknown" defaults, except:
//   - retraction_status: `retracted` when the v2 entry was flagged retracted
//     (and `retracted` becomes true whenever either field says so — fail
//     closed), else `unchecked` (a v2 library never recorded a clean lookup,
//     so nothing is claimed `clear` by the migration);
//   - hydrated: true (v2 had no unhydrated entries: BYO ingest lands in v3).
// Idempotent on v3 input. Values a v3 field already carries (a file written by
// a newer writer and then stamped v2 by hand) are kept when they have the v3
// type, so the migration never discards data it can represent.

const NEW_NULLABLE_FIELDS = [
  'type',
  'publisher',
  'volume',
  'issue',
  'pages',
  'tier',
  'relevance',
  'why_relevant',
  'zotero',
] as const;

export function migrate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const src = input as Record<string, unknown>;
  if (src['$schemaVersion'] === 3) return JSON.parse(JSON.stringify(src)) as unknown;
  const rawEntries = Array.isArray(src['entries']) ? (src['entries'] as unknown[]) : [];
  const entries = rawEntries.map((raw) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const e = { ...(raw as Record<string, unknown>) };
    for (const k of NEW_NULLABLE_FIELDS) {
      if (!(k in e) || e[k] === undefined) e[k] = null;
    }
    if (!Array.isArray(e['editors'])) e['editors'] = [];
    if (typeof e['hydrated'] !== 'boolean') e['hydrated'] = true;
    // Fail closed: a retraction recorded either way stays recorded both ways.
    const status = e['retraction_status'];
    const retracted = e['retracted'] === true || status === 'retracted';
    e['retracted'] = retracted;
    if (retracted) e['retraction_status'] = 'retracted';
    else if (status !== 'clear' && status !== 'unknown' && status !== 'unchecked') e['retraction_status'] = 'unchecked';
    return e;
  });
  return { ...src, $schemaVersion: 3, entries };
}

export default migrate;
