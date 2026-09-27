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
// The v0 PRD §10 template also carried `[runtime] endpoint = ""` and
// `api_key_env = "ANTHROPIC_API_KEY"`. Both keys are global-only in v1 (a
// paper's files cannot choose where prompts and keys go), so the two no-op
// values the template shipped — an empty endpoint and the provider's default
// key variable — are dropped. Any other value is KEPT so validation refuses it
// and names the global runtime.json.
//
// Pure: returns a new object, never mutates the input.

/** The provider default key variables as of v1 (frozen here: migrations never import live tables). */
const V1_DEFAULT_KEY_ENV: Readonly<Record<string, string>> = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
});

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
  const runtime = out['runtime'];
  if (typeof runtime === 'object' && runtime !== null && !Array.isArray(runtime)) {
    const r = { ...(runtime as Record<string, unknown>) };
    if (r['endpoint'] === '') delete r['endpoint'];
    const provider = typeof r['provider'] === 'string' ? r['provider'] : 'anthropic';
    if (r['api_key_env'] !== undefined && r['api_key_env'] === V1_DEFAULT_KEY_ENV[provider]) delete r['api_key_env'];
    out['runtime'] = r;
  }
  return out;
}

export default migrate;
