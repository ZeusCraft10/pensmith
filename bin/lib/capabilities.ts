// bin/lib/capabilities.ts
//
// The single place that combines runtime config with environment presence
// checks. The returned shape holds presence-flag booleans only, never a
// resolved env value: tests/capabilities.test.ts plants sentinel values to
// prove nothing leaks. `pensmith doctor` (runtime-config-presence) reads it.

import { loadRuntimeConfig } from './runtime.js';
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
  readonly contact_email_set: boolean;
  readonly providers: readonly ProviderCapability[];
  // Real booleans from the shared ecosystem-presence module.
  readonly pandoc: boolean;
  readonly zotero_mcp: boolean;
  readonly humanizer: boolean;
  readonly onedrive_detected: boolean;
  // The absolute paper-dir path that matched a known cloud-sync folder, or
  // null, so callers can say which folder triggered the warning.
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

type RuntimeConfig = Awaited<ReturnType<typeof loadRuntimeConfig>>;

/** Each configured provider's name, key env-var NAME and whether that env var is set. */
function providerCapabilities(cfg: RuntimeConfig): readonly ProviderCapability[] {
  // cfg.providers is a Record<string, Provider> (z.record in runtime-config schema).
  return Object.values(cfg.providers ?? {}).map((p) => ({
    name: p.name,
    api_key_env: p.apiKeyEnv,
    present: envPresent(p.apiKeyEnv),
  }));
}

/**
 * Just the provider part of the capability facts, for callers that need
 * nothing else (the doctor's runtime-config probe): it skips the ecosystem
 * probes, which the doctor runs as probes of their own.
 */
export async function loadProviderCapabilities(): Promise<readonly ProviderCapability[]> {
  return providerCapabilities(await loadRuntimeConfig());
}

/**
 * Build the capability facts record from runtime config + env presence checks.
 *
 * This module is the SINGLE authorised site to combine loadRuntimeConfig()
 * with process.env[...] presence flags.
 *
 * The returned record contains only booleans, env-var NAMES, and provider names.
 * No resolved api-key values ever appear in the return shape.
 */
export async function loadCapabilityFacts(): Promise<CapabilityFacts> {
  const cfg = await loadRuntimeConfig();
  const providers = providerCapabilities(cfg);

  // The ecosystem probes are read-only (spawn `pandoc --version`, statSync,
  // readdirSync, a path-substring check). A probe that throws reads as
  // "not present", the same as the doctor's WARN fallback.
  const syncFolder = (() => {
    try {
      return detectSyncFolder();
    } catch {
      return { detected: false, match: null };
    }
  })();

  return {
    contact_email_set: envPresent(cfg.contactEmailEnv ?? 'PENSMITH_CONTACT_EMAIL'),
    providers,
    pandoc: safeBool(isPandocPresent),
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
