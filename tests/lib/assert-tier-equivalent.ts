// tests/lib/assert-tier-equivalent.ts
//
// TIER-07 helper — Tier 1 (MCP) ↔ Tier 2 (CLI) output equivalence with
// ±20% prose-length tolerance per the REQUIREMENTS.md TIER-07 clause.
//
// The helper is intentionally narrow: extract facts elsewhere, pass them in.
// This file owns ONLY the comparison + tolerance math + error-message shape.

import assert from 'node:assert/strict';

export interface TierEquivalenceInput {
  mcpText: string;
  cliText: string;
  mcpFacts: Record<string, boolean | string | number>;
  cliFacts: Record<string, boolean | string | number>;
}

export interface TierEquivalenceOptions {
  tolerance?: number;       // 0.0–1.0; default 0.20 (TIER-07)
  label?: string;           // free-form context for the error message
}

export function assertEquivalent(
  input: TierEquivalenceInput,
  opts: TierEquivalenceOptions = {},
): void {
  const tolerance = opts.tolerance ?? 0.20;
  const label = opts.label ?? 'tier-equivalence';

  // Set-equality on keys.
  const mcpKeys = Object.keys(input.mcpFacts).sort();
  const cliKeys = Object.keys(input.cliFacts).sort();
  assert.deepEqual(
    mcpKeys,
    cliKeys,
    `[${label}] probe-id key set mismatch — mcp:${JSON.stringify(mcpKeys)} cli:${JSON.stringify(cliKeys)}`,
  );

  // Per-key value equality.
  const divergent: string[] = [];
  for (const k of mcpKeys) {
    if (input.mcpFacts[k] !== input.cliFacts[k]) {
      divergent.push(`${k}: mcp=${JSON.stringify(input.mcpFacts[k])} cli=${JSON.stringify(input.cliFacts[k])}`);
    }
  }
  assert.equal(divergent.length, 0, `[${label}] fact divergence:\n  ${divergent.join('\n  ')}`);

  // Body-length tolerance (TIER-07).
  // why intrinsically variable: JSON framing in MCP vs TTY prose in CLI adds
  // different amounts of overhead for the same logical content.
  const mLen = input.mcpText.length;
  const cLen = input.cliText.length;
  const denom = Math.max(mLen, cLen, 1); // guard zero-length inputs
  const ratio = Math.abs(mLen - cLen) / denom;
  assert.ok(
    ratio <= tolerance,
    `[${label}] prose-length tolerance exceeded — mcpLen=${mLen} cliLen=${cLen} ratio=${ratio.toFixed(3)} tolerance=${tolerance}`,
  );
}
