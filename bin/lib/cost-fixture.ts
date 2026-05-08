// bin/lib/cost-fixture.ts — deterministic synthetic price table for budget
// tests (TEST-08, D-47, D-48).
//
// Why a fixture (not live pricing):
//   Budget tests must NOT drift when real provider pricing changes. The
//   numbers below are rounded approximations of late-2025 Anthropic /
//   OpenAI pricing — close enough to be intuitive, but pinned in code so
//   tests are deterministic. The runtime layer (Phase 2+ W11) reads real
//   prices from a config file at process start; this fixture is only
//   imported by tests/cost-fixture.test.ts and tests/budget.test.ts.
//
// Unknown provider/model returns 0 (per PLAN line 355 — pick "returns 0").
// This is the deliberate choice: tests for unknown models should not crash;
// instead the cost is undercounted to 0, which the budget gate then under-
// estimates. In production the runtime price layer (W11) is the gatekeeper
// and is responsible for surfacing missing-pricing as an error before any
// LLM call lands here.

export const FIXTURE_PRICES = {
  'anthropic:claude-opus-4':   { inputUsdPerMtok: 15.00, outputUsdPerMtok: 75.00 },
  'anthropic:claude-sonnet-4': { inputUsdPerMtok:  3.00, outputUsdPerMtok: 15.00 },
  'anthropic:claude-haiku-4':  { inputUsdPerMtok:  1.00, outputUsdPerMtok:  5.00 },
  'openai:gpt-4-turbo':        { inputUsdPerMtok: 10.00, outputUsdPerMtok: 30.00 },
  'openai:gpt-4o-mini':        { inputUsdPerMtok:  0.15, outputUsdPerMtok:  0.60 },
} as const;

export type FixtureModelKey = keyof typeof FIXTURE_PRICES;

/**
 * Estimate USD cost for a given (provider, model, inputTokens, outputTokens)
 * tuple using the synthetic FIXTURE_PRICES table.
 *
 * Rounded to 6 decimal places (sub-microcent precision is meaningless and
 * causes float-equality flakes in tests).
 *
 * Unknown (provider, model) → 0. See module header for rationale.
 */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = `${provider}:${model}` as FixtureModelKey;
  const row = FIXTURE_PRICES[key];
  if (!row) return 0;
  const inUsd = (inputTokens / 1_000_000) * row.inputUsdPerMtok;
  const outUsd = (outputTokens / 1_000_000) * row.outputUsdPerMtok;
  return Number((inUsd + outUsd).toFixed(6));
}
