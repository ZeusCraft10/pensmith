// bin/lib/migrations/config/v0_to_v1.ts — `.paper/config.toml` v0 → v1 (CONF-01, D-17-31).
//
// v0 is every config.toml written before versioning: no `schema_version` key
// (pensmith new wrote only [project] goal / pii_redaction). v1 adds
// `schema_version = 1` at the top.
//
// One retired key is handled here: `[verification] verify_quotes = true` was
// the only value that ever made sense (Pass 3 is a blocking pass, PRD §14), so
// a `true` is dropped silently. A `false` is KEPT so validation refuses it with
// the §14 explanation instead of silently re-enabling quote checks behind the
// user's back.
//
// Pure: returns a new object, never mutates the input.

export function migrate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { schema_version: 1 };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'schema_version') continue;
    out[k] = v;
  }
  const verification = out['verification'];
  if (typeof verification === 'object' && verification !== null && !Array.isArray(verification)) {
    const v = { ...(verification as Record<string, unknown>) };
    if (v['verify_quotes'] === true) delete v['verify_quotes'];
    out['verification'] = v;
  }
  return out;
}

export default migrate;
