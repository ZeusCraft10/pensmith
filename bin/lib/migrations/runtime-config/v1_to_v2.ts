// bin/lib/migrations/runtime-config/v1_to_v2.ts — global runtime.json v1 → v2 (D-17-19).
//
// v1 keyed a `providers` map by provider id ({name, apiKeyEnv, defaultModel});
// complete() only ever used the FIRST entry. v2 is flat: one provider, its
// model, and the optional endpoint / api_key_env / price overrides.
//
// Mapping (the first provider entry wins, exactly as v1 resolved it):
//   providers[first].name         → provider
//   providers[first].defaultModel → model (a retired id is aliased at use time)
//   providers[first].apiKeyEnv    → api_key_env, omitted when it equals the
//                                   provider's default variable; a non-conforming
//                                   name is kept so validation names the rule
//                                   (never silently dropped)
//   openalexApiKeyEnv / openalexApiKeyOptional / contactEmailEnv → unchanged
//
// Pure: returns a new object, never mutates the input.

import { DEFAULT_KEY_ENV, isProviderName } from '../../llm-models.js';

export function migrate(input: unknown): unknown {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { $schemaVersion: 2 };

  const providers = src['providers'];
  if (typeof providers === 'object' && providers !== null && !Array.isArray(providers)) {
    const first = Object.values(providers as Record<string, unknown>)[0];
    if (typeof first === 'object' && first !== null) {
      const entry = first as Record<string, unknown>;
      const name = entry['name'];
      if (typeof name === 'string') {
        out['provider'] = name;
        const keyEnv = entry['apiKeyEnv'];
        const defaultEnv = isProviderName(name) ? DEFAULT_KEY_ENV[name] : null;
        if (typeof keyEnv === 'string' && keyEnv !== defaultEnv) out['api_key_env'] = keyEnv;
      }
      const model = entry['defaultModel'];
      if (typeof model === 'string' && model.length > 0) out['model'] = model;
    }
  }

  for (const k of ['openalexApiKeyEnv', 'openalexApiKeyOptional', 'contactEmailEnv'] as const) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

export default migrate;
