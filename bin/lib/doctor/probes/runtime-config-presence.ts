// bin/lib/doctor/probes/runtime-config-presence.ts
//
// DOCT-07 + RUN-07 / RUN-08: the LLM runtime in use and the optional keys.
//
// Reports (never a key VALUE — D-12 / T-01-07, sentinel-tested):
//   - the resolved provider, generation model and key variable (with where
//     each came from: flag, config, global runtime.json, env, default);
//   - presence booleans for the key variables and for OPENALEX_API_KEY,
//     PENSMITH_S2_API_KEY, GPTZERO_API_KEY, PENSMITH_CONTACT_EMAIL, ZOTERO_API_KEY;
//   - the endpoint: `GET <endpoint>/models` through anthropic.ts
//     probeLlmEndpoint() — PASS when it answers, WARN when it is down, and WARN
//     naming the key variable when it answers 401/403 (the key was rejected).
//     A hosted default endpoint is not dialed while sources are offline (test
//     runner, PENSMITH_OFFLINE, --dry-run) or when its key is absent; a local
//     or explicitly configured endpoint is;
//   - the refusal-fallbacks setting (off unless opted in; it can change the
//     served model and the cost) and what PENSMITH_NO_LLM does.
// Severity: FAIL for an invalid runtime (e.g. an unknown provider — the valid
// values are listed), WARN for no usable key / a rejected key / a down
// endpoint / a local provider without a model, PASS otherwise.
//
// `detail` stays the JSON array of {name, apiKeyEnv, present} built from
// loadCapabilityFacts() (the single env-presence composition site shared with
// mcp/ — tier-contract Case A/D compare it with paper://capabilities).
//
// Acceptable env-check pattern (the ONLY one the lint permits here):
//   const v = process.env[name];
//   const present = typeof v === 'string' && v.length > 0;
// `v` never leaves the helper; only `present` is used onward.

import type { Probe, ProbeResult } from '../probes.js';
import { loadCapabilityFacts } from '../../capabilities.js';
import { resolveRuntime } from '../../runtime.js';
import { isNoLlmMode, probeLlmEndpoint } from '../../anthropic.js';
import { isOfflineMode } from '../../http-mock.js';
import { LOCAL_PROVIDERS, NO_PROVIDER_CONFIGURED_HINT, PROVIDER_NAMES } from '../../llm-models.js';

/** Optional variables reported as present/absent (RUN-07). */
export const OPTIONAL_KEY_VARS = [
  'OPENALEX_API_KEY',
  'PENSMITH_S2_API_KEY',
  'GPTZERO_API_KEY',
  'PENSMITH_CONTACT_EMAIL',
  'ZOTERO_API_KEY',
] as const;

export const NO_LLM_DESCRIPTION =
  'PENSMITH_NO_LLM replaces every LLM call with a deterministic stub (testing and dry-run)';

function isSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

export const runtimeConfigPresenceProbe: Probe = {
  id: 'runtime-config-presence',
  async run(): Promise<ProbeResult> {
    const facts = await loadCapabilityFacts();
    const providers = facts.providers.map((p) => ({ name: p.name, apiKeyEnv: p.api_key_env, present: p.present }));
    const detail = JSON.stringify(providers); // only {name, apiKeyEnv, present}
    const optional = OPTIONAL_KEY_VARS.map((name) =>
      `${name} ${isSet(name) ? 'present' : 'absent'}`).join(', ');
    const noLlm = `${NO_LLM_DESCRIPTION} — ${isNoLlmMode() ? 'SET' : 'not set'}`;

    let rt;
    try {
      rt = await resolveRuntime();
    } catch (e) {
      return {
        id: 'runtime-config-presence',
        severity: 'FAIL',
        summary: `LLM runtime configuration is invalid: ${(e as Error).message}`,
        detail,
        fix: `Use one of the valid providers: ${PROVIDER_NAMES.join(', ')}.`,
      };
    }

    const local = LOCAL_PROVIDERS.has(rt.provider);
    const keyPresent = rt.apiKeyEnv !== null && isSet(rt.apiKeyEnv);
    const keyPart = rt.apiKeyEnv === null
      ? 'no key variable (local provider)'
      : `key ${rt.apiKeyEnv} (${rt.apiKeyEnvSource}): ${keyPresent ? 'present' : 'absent'}`;
    const model = rt.model ?? '(none: set [runtime] model or pass --model)';

    let endpointPart: string;
    let endpointDown = false;
    let keyRejected = false;
    const dial = rt.endpoint !== null && (local || rt.endpointSource === 'global' || !isOfflineMode());
    if (rt.endpoint === null) {
      endpointPart = 'endpoint: not configured';
      endpointDown = true;
    } else if (!dial) {
      endpointPart = `endpoint ${rt.endpoint}: not probed (sources offline)`;
    } else if (!local && !keyPresent) {
      // A hosted provider answers 401 to a keyless request: probing proves nothing.
      endpointPart = `endpoint ${rt.endpoint}: not probed (no key)`;
    } else {
      const probe = await probeLlmEndpoint(rt);
      if (probe.reachable) {
        endpointPart = `endpoint ${probe.detail}: PASS`;
      } else if (probe.status === 401 || probe.status === 403) {
        // The server answered: it is up, but it rejected the configured key.
        endpointPart = `endpoint ${probe.detail}: WARN (the key in ${rt.apiKeyEnv ?? 'the key variable'} was rejected)`;
        keyRejected = true;
      } else {
        endpointPart = `endpoint ${probe.detail}: WARN (not reachable)`;
        endpointDown = true;
      }
    }

    const summary = [
      `provider ${rt.provider} (${rt.providerSource}), model ${model} (${rt.modelSource}), ${keyPart}`,
      endpointPart,
      `optional keys: ${optional}`,
      `refusal fallbacks: ${rt.refusalFallbacks === 'default' ? 'default (a refused request may be served by another model; disclosed in SESSION.log)' : 'off'}`,
      noLlm,
    ].join('; ');

    if (!local && !keyPresent && !isNoLlmMode()) {
      return {
        id: 'runtime-config-presence',
        severity: 'WARN',
        summary: `No LLM key is set — every generative verb needs one. ${summary}`,
        detail,
        fix: `${NO_PROVIDER_CONFIGURED_HINT}.`,
      };
    }
    if (local && rt.model === null) {
      return {
        id: 'runtime-config-presence',
        severity: 'WARN',
        summary,
        detail,
        fix: `Set [runtime] model in .paper/config.toml or pass --model (provider ${rt.provider} has no default model).`,
      };
    }
    if (keyRejected) {
      return {
        id: 'runtime-config-presence',
        severity: 'WARN',
        summary,
        detail,
        fix: `Check ${rt.apiKeyEnv ?? 'the key variable'}: the ${rt.provider} endpoint rejected it (a revoked, mistyped or wrong-provider key).`,
      };
    }
    if (endpointDown) {
      return {
        id: 'runtime-config-presence',
        severity: 'WARN',
        summary,
        detail,
        fix: rt.endpoint === null
          ? `Set "endpoint" for provider ${rt.provider} in the global runtime.json.`
          : `Start the ${rt.provider} server or fix "endpoint" in the global runtime.json.`,
      };
    }
    return { id: 'runtime-config-presence', severity: 'PASS', summary, detail };
  },
};
