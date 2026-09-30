// bin/lib/migrations/config/v1_to_v2.ts — `.paper/config.toml` v1 → v2
// (CONF-01, S-20; Phase 19 review round 3).
//
// Phase 19 added a key and values a v1-only pensmith cannot read:
// `[verification] send_byo_passages` (SRC-15, review round 2) and the `[sources]
// allowed_databases` values `books` and `nber` (SRC-10, SRC-11). Both are
// optional with a default, so a v1 file means the same under v2: the migration
// only rewrites the version. The bump exists so a v1-only pensmith refuses a v2 file
// with "newer than this pensmith supports; upgrade pensmith" instead of failing
// on an enum value it does not know.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { schema_version: 2 };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'schema_version') continue;
    out[k] = v;
  }
  return out;
}

export default migrate;
