// bin/lib/doctor/probes/runtime-config-presence.ts
//
// DOCT-07: Runtime config provider API-key resolvability probe.
// D-12 / T-01-07 / cross-AI cycle-2 HIGH #2:
//   - Delegates to loadCapabilityFacts() (the SINGLE authorised composition site
//     for runtime config + process.env presence checks — shared with mcp/).
//   - Only boolean `present` and env-var NAME escape this probe.
//   - The resolved API key value NEVER appears in any probe output, log line,
//     error message, or detail string.
// D-15 severity: WARN if no provider has its env-var set; PASS if at least one.
// D-19 read-only: no filesystem writes.
//
// Acceptable env-check pattern (the ONLY one the lint permits):
//   const v = process.env[provider.apiKeyEnv];
//   const present = typeof v === 'string' && v.length > 0;
//   // `v` is out of scope. Only `present` (boolean) is used onward.
// This probe does NOT use that pattern directly — it delegates to
// loadCapabilityFacts() which applies the pattern internally, keeping
// both mcp/ and bin/lib/doctor/ in sync from a single source.

import type { Probe, ProbeResult } from '../probes.js';
import { loadCapabilityFacts } from '../../capabilities.js';

export const runtimeConfigPresenceProbe: Probe = {
  id: 'runtime-config-presence',
  async run(): Promise<ProbeResult> {
    // D-12 / T-01-07 / cross-AI cycle-2 HIGH #2: this probe MUST delegate
    // to the SAME helper that mcp/ uses (bin/lib/capabilities.ts::
    // loadCapabilityFacts). Re-implementing env presence here would create
    // a second composition site for runtime config + process.env[...],
    // which 02-07 Case A would have no way to keep in sync with mcp/.
    // The helper returns CapabilityFacts.providers as a readonly array of
    // { name, api_key_env, present } — exactly the shape we serialize here.
    const facts = await loadCapabilityFacts();
    // Re-key from snake_case (capability-fact shape — owned by 02-04's
    // loadCapabilityFacts and consumed unmodified by mcp/) to the doctor's
    // historical detail shape { name, apiKeyEnv, present }. 02-07's
    // extractCliFacts JSON.parses this detail string into an object array
    // and reads p.present per element — no regex parsing.
    const providers = facts.providers.map((p) => ({
      name: p.name,
      apiKeyEnv: p.api_key_env,
      present: p.present,
    }));
    const anyPresent = providers.some((p) => p.present);
    const detail = JSON.stringify(providers); // only {name, apiKeyEnv, present}
    return anyPresent
      ? {
          id: 'runtime-config-presence',
          severity: 'PASS',
          summary: `At least one provider key resolvable (${providers.filter((p) => p.present).length}/${providers.length}).`,
          detail,
        }
      : {
          id: 'runtime-config-presence',
          severity: 'WARN',
          summary: 'No provider keys resolvable — pensmith will run in offline mode for any verb that needs a provider.',
          detail,
          fix: `Set one of: ${providers.map((p) => p.apiKeyEnv).join(', ')}.`,
        };
  },
};
