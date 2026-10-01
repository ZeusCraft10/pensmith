// bin/lib/migrations/config/v3_to_v4.ts — `.paper/config.toml` v3 → v4
// (CONF-01, S-20; Phase 21, D-21-26).
//
// Phase 21 added `[humanizer] honesty_consent` (EXP-17: the recorded answer to
// the detector-consent question), the `[compile]` table (`smooth_transitions`,
// EXP-10; `contradiction_pairs`, EXP-11), `[verification] plagiarism_max_phrases`
// (EXP-19), and a path to a local `.csl` file as a `[project] citation_style`
// value (EXP-03). Every new key is optional with a default, and a v3 value
// means the same under v4, so the migration only rewrites the version. The bump
// exists so a v3-only pensmith refuses a v4 file with "newer than this pensmith
// supports; upgrade pensmith" instead of warning `honesty_consent = false` away
// as unknown and then asking (or, worse, scoring) against the user's answer.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { schema_version: 4 };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'schema_version') continue;
    out[k] = v;
  }
  return out;
}

export default migrate;
