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

import { providerKeyVariables } from './runtime.js';
import { contactEmail } from './contact-email.js';
import {
  isPandocPresent,
  isZoteroMcpPresent,
  isHumanizerSkillPresent,
  detectSyncFolder,
} from './ecosystem-presence.js';

export interface ProviderCapability {
  readonly name: string;
  readonly api_key_env: string;
  readonly present: boolean;
}

export interface CapabilityFacts {
  readonly mcp_self: true;
  readonly contact_email_set: boolean;
  readonly providers: readonly ProviderCapability[];
  // CR-01 fix: these are now REAL booleans populated via the shared
  // ecosystem-presence module. The previous `boolean | undefined` placeholder
  // caused tier-contract Case D divergence on hosts with pandoc/zotero/
  // humanizer installed (D-21: fix the tiers, not the test).
  readonly pandoc: boolean;
  readonly zotero_mcp: boolean;
  readonly humanizer: boolean;
  readonly onedrive_detected: boolean;
  // WR-02: sync_folder_match is the absolute paper-dir path that matched a
  // known cloud-sync folder, or null when no match. Previous boolean type
  // collapsed information (which folder matched) that consumers want.
  // tests/tier-contract.test.ts McpCapabilities already declared this as
  // `string` (line 100) — the type now matches the contract.
  readonly sync_folder_match: string | null;
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

  // The hosted provider key variables (anthropic, openai) plus the configured
  // provider's variable when it differs (runtime.ts providerKeyVariables returns
  // NAMES only). Presence is computed HERE — the single composition site.
  const providers: readonly ProviderCapability[] = (await providerKeyVariables()).map((p) => ({
    name: p.name,
    api_key_env: p.api_key_env,
    present: envPresent(p.api_key_env),
  }));

  // CR-01: probe the ecosystem facts so the MCP tier reports real booleans.
  // These calls are read-only (spawn `pandoc --version`, statSync, readdirSync,
  // and a path-substring check) so they are safe to invoke from the
  // paper://capabilities handler hot path. Wrapping them in a try/catch
  // keeps the handler robust to unexpected probe-module failure modes
  // (false on error — same semantics as the doctor-probe WARN fallback).
  const syncFolder = (() => {
    try {
      return detectSyncFolder();
    } catch {
      return { detected: false, match: null };
    }
  })();

  return {
    mcp_self: true,
    // D-19-09: the ONE contact-email resolver (the variable `[network]
    // contact_email_env` names, default PENSMITH_CONTACT_EMAIL; a value that
    // is not an email address counts as unset) — the same fact the doctor's
    // contact-email-presence probe reports. A boolean only, never the address.
    contact_email_set: safeBool(() => contactEmail().email !== null),
    providers,
    pandoc: safeBool(isPandocPresent),
    // SRC-16: a Zotero MCP server configured for Claude Code in any scope
    // (user / local .claude.json, the project's .mcp.json, legacy files) —
    // the MCP server line of the doctor's zotero-mcp-presence probe.
    zotero_mcp: safeBool(isZoteroMcpPresent),
    humanizer: safeBool(isHumanizerSkillPresent),
    onedrive_detected: syncFolder.detected,
    // WR-02: emit the matched path (or null) so downstream consumers can show
    // which folder caused the detection (e.g., "OneDrive at /Users/.../OneDrive
    // — Roanoke College"). Boolean collapsed this signal.
    sync_folder_match: syncFolder.match,
  };
}

/**
 * Run a boolean-returning detection helper inside a try/catch. Any thrown
 * error reads as `false` — the capability handler must NOT crash on
 * environmental anomalies (missing `pandoc` on PATH is normal; an unexpected
 * spawn-permission error is rare but should degrade to "not present").
 */
function safeBool(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}
