// bin/lib/migrations/config/v2_to_v3.ts — `.paper/config.toml` v2 → v3
// (CONF-01, S-20; Phase 20 VRFY-18, D-20-17).
//
// Phase 20 added `[verification] quote_min_words`: the number of words from
// which a direct quote is checked by Pass 3 (default 5; 1–5, a lower value is
// stricter). It is optional with a default, so a v2 file means the same under
// v3: the migration only rewrites the version. The bump exists so a v2-only
// pensmith refuses a v3 file with "newer than this pensmith supports; upgrade
// pensmith" instead of warning the key away as unknown and checking fewer
// quotes than the paper asks for.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { schema_version: 3 };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'schema_version') continue;
    out[k] = v;
  }
  return out;
}

export default migrate;
