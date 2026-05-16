// bin/lib/capabilities.ts
//
// D-12 architectural fix (cross-AI review HIGH consensus): SINGLE source of
// capability facts. mcp/ MUST NOT call loadRuntimeConfig and MUST NOT access
// process.env[...] directly — D-12 lint (02-03) catches both. This file is
// the only authorised composition site.
//
// Invariant: returned shape contains presence-flag BOOLEANS only. NEVER a
// resolved env value. tests/capabilities.test.ts uses sentinel values
// (PROCESS-ENV-SENTINEL-DO-NOT-LEAK-...) to prove no leak path exists.
// Symmetric to mcp/ T-01-07 / T-02-04-02 mitigation.

import { loadRuntimeConfig } from './runtime.js';

export interface ProviderCapability {
  readonly name: string;
  readonly api_key_env: string;
  readonly present: boolean;
}

export interface CapabilityFacts {
  readonly mcp_self: true;
  readonly contact_email_set: boolean;
  readonly providers: readonly ProviderCapability[];
  // Phase 2: placeholders so the shape is stable for 02-05 to populate.
  // undefined = "not yet probed"; 02-05 doctor probes will populate these.
  readonly pandoc: boolean | undefined;
  readonly zotero_mcp: boolean | undefined;
  readonly humanizer: boolean | undefined;
  readonly onedrive_detected: boolean | undefined;
  readonly sync_folder_match: boolean | undefined;
}

/**
 * Check whether an environment variable is present (non-empty string).
 * Returns a boolean — NEVER the resolved value.
 */
function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

/**
 * Build the capability facts record from runtime config + env presence checks.
 *
 * This is the SINGLE authorised site to combine loadRuntimeConfig() with
 * process.env[...] presence flags. Both mcp/resources.ts (paper://capabilities)
 * and mcp/tools.ts (paper_capability_probe) import this function and
 * JSON.stringify the return — neither does composition of its own.
 *
 * The returned record contains only booleans, env-var NAMES, and provider names.
 * No resolved api-key values ever appear in the return shape.
 */
export async function loadCapabilityFacts(): Promise<CapabilityFacts> {
  const cfg = await loadRuntimeConfig();

  // cfg.providers is a Record<string, Provider> (z.record in runtime-config schema).
  const providerEntries = Object.values(cfg.providers ?? {});

  const providers: readonly ProviderCapability[] = providerEntries.map((p) => ({
    name: p.name,
    api_key_env: p.apiKeyEnv,
    present: envPresent(p.apiKeyEnv),
  }));

  return {
    mcp_self: true,
    contact_email_set: envPresent(cfg.contactEmailEnv ?? 'PENSMITH_CONTACT_EMAIL'),
    providers,
    // Phase 2: undefined → "not yet probed". 02-05 doctor probes populate these.
    pandoc: undefined,
    zotero_mcp: undefined,
    humanizer: undefined,
    onedrive_detected: undefined,
    sync_folder_match: undefined,
  };
}
