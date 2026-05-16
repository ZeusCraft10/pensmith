// tests/fixtures/lint-capabilities-noleak-fixture.ts
//
// RED-TEAM fixture for D-12 (capabilities-no-leak AST chokepoint).
// This file MUST trigger ESLint errors when scoped under `mcp/**/*.ts`.
//
// Each numbered comment marks a violation that the selectors in
// eslint.config.js (D-12 block) are required to flag. Re-use of this file
// happens via tmp-copy into `mcp/_capabilities-noleak-fixture-tmp.ts`
// during the PROJECT-config-loaded test.
//
// DO NOT import this file from production code. It exists only for tests.
//
// @ts-nocheck — this file is never type-checked or executed.

import {
  getProviderApiKey,
  getOpenAlexApiKey,
  loadRuntimeConfig,
} from '../../bin/lib/runtime.js';

interface Provider {
  id: string;
  apiKeyEnv: string;
}

export async function handleCapabilitiesRead(provider: Provider) {
  // Violation 1: computed process.env[<MemberExpression>] (D-12 selector A)
  const directComputed = process.env[provider.apiKeyEnv];

  // Violation 2: computed process.env[<Identifier>] via local var (D-12 selector A)
  const envName = provider.apiKeyEnv;
  const indirectComputed = process.env[envName];

  // Violation 3: inline getProviderApiKey() call (D-12 selector B)
  const providerKey = await getProviderApiKey({ scope: 'paper' });

  // Violation 4: inline getOpenAlexApiKey() call (D-12 selector B)
  const openalexKey = await getOpenAlexApiKey();

  // Violation 5: inline loadRuntimeConfig() call (D-12 selector B)
  const cfg = await loadRuntimeConfig();

  return {
    // The whole point of D-12: even building this object is forbidden in mcp/.
    provider: {
      present: !!directComputed || !!indirectComputed || !!providerKey,
      value: directComputed, // <- THIS is the leak D-12 prevents
    },
    openalex: { present: !!openalexKey },
    cfgProviders: cfg.providers,
  };
}

// Non-violation control: static dot-access. MUST NOT fire.
export function staticEnvAccess() {
  return process.env.HOME;
}
