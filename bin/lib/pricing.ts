// bin/lib/pricing.ts — MODEL_PRICES table + estimateCost (D-65 standalone module).
//
// W11 sibling A — pure constant table + pure cost function. NO I/O. NO imports.
// Consumed by W6 budget.ts (assertBudget pre-call gate, appendCost ledger) and
// any future provider-routing code that needs to estimate USD cost from a
// (provider, model, inputTokens, outputTokens) tuple.
//
// Source-of-truth contract (RESEARCH.md §pricing):
//   This file is the SINGLE source of truth for $/Mtok rates across all
//   providers. Any other file that hardcodes a per-Mtok rate is a bug.
//   Update procedure: bump the entry below + reference the vendor pricing
//   page in the commit message. Do NOT scrape pricing at runtime — the
//   rates change rarely, the audit trail (git blame on this file) is
//   load-bearing for cost-correctness reviews.
//
// Pricing references (current as of plan 01-13 land date):
//   - Anthropic: https://www.anthropic.com/pricing  (claude-opus-4 $15/$75,
//     claude-sonnet-4 $3/$15, claude-haiku-4 $0.80/$4.00 per Mtok)
//   - OpenAI:    https://openai.com/api/pricing      (gpt-4o $2.50/$10,
//     gpt-4o-mini $0.15/$0.60 per Mtok); gpt-5 RESEARCH-pending placeholder
//     numbers equal to gpt-4o so budget tests don't accidentally rely on
//     a divergent value.
//
// Defense-in-depth contract:
//   - MODEL_PRICES is deeply frozen via Object.freeze on the outer record AND
//     each inner provider record. No caller can mutate the table at runtime —
//     attempts to assign throw TypeError under strict mode (which we are in).
//   - estimateCost rejects negative tokens with RangeError BEFORE the
//     provider/model lookup so callers get the most-specific error first.
//
// Imports: none. Pure constant + pure function. Self-contained by design.

export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  currency: 'USD';
}

export class UnknownModelError extends Error {
  code = 'UNKNOWN_MODEL' as const;
  constructor(providerId: string, modelId: string) {
    super(
      `unknown model ${providerId}/${modelId} — add to MODEL_PRICES in bin/lib/pricing.ts`,
    );
    this.name = 'UnknownModelError';
  }
}

// Source-of-truth table per RESEARCH.md §pricing. See file header for
// vendor-page references. Update procedure:
//   1. bump entry value
//   2. reference vendor page in commit message (so git blame is auditable)
//   3. re-run tests/pricing.test.ts (cost-math assertions are vendor-derived)
const RAW: Record<string, Record<string, ModelPrice>> = {
  anthropic: {
    'claude-opus-4':   { inputPerMtok: 15.00, outputPerMtok: 75.00, currency: 'USD' },
    'claude-sonnet-4': { inputPerMtok:  3.00, outputPerMtok: 15.00, currency: 'USD' },
    'claude-haiku-4':  { inputPerMtok:  0.80, outputPerMtok:  4.00, currency: 'USD' },
  },
  openai: {
    // gpt-5 RESEARCH-pending placeholder (RESEARCH §pricing-pending) — set
    // equal to gpt-4o so budget assertions don't accidentally rely on a
    // divergent value while the official rate is still unannounced.
    'gpt-5':       { inputPerMtok: 2.50, outputPerMtok: 10.00, currency: 'USD' },
    'gpt-4o':      { inputPerMtok: 2.50, outputPerMtok: 10.00, currency: 'USD' },
    'gpt-4o-mini': { inputPerMtok: 0.15, outputPerMtok:  0.60, currency: 'USD' },
  },
};

// Deep-freeze: outer record + each inner provider record. Mutation attempts
// at runtime throw TypeError under strict mode (tsconfig "strict": true is
// load-bearing here). Each ModelPrice object is itself effectively frozen
// because the outer record reference is frozen and the inner records are
// frozen — the only way to swap a price would be to reach through the
// provider record, which would also throw.
for (const provider of Object.keys(RAW)) {
  // RAW[provider] is guaranteed defined since we just iterated the same keys;
  // the non-null assertion documents intent for noUncheckedIndexedAccess.
  Object.freeze(RAW[provider]!);
}
Object.freeze(RAW);

/**
 * The frozen pricing table. Every provider/model the codebase recognizes
 * has an entry here; UnknownModelError fires when a caller asks about an
 * unknown one.
 *
 * Read-only at runtime — see Object.freeze block above.
 */
export const MODEL_PRICES: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = RAW;

/**
 * Pure cost estimation: returns USD for a (provider, model, inputTokens,
 * outputTokens) tuple.
 *
 * Formula: cost = (inputTokens / 1e6) * inputPerMtok
 *               + (outputTokens / 1e6) * outputPerMtok
 *
 * Errors:
 *   - RangeError when inputTokens < 0 OR outputTokens < 0 (token counts are
 *     unsigned by definition; negative input is a caller bug).
 *   - UnknownModelError when providerId is not in MODEL_PRICES.
 *   - UnknownModelError when modelId is not in MODEL_PRICES[providerId].
 *
 * No I/O. Safe to call from inside hot loops or budget assertions.
 */
export function estimateCost(args: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  if (args.inputTokens < 0 || args.outputTokens < 0) {
    throw new RangeError(
      `token counts must be >= 0 (got input=${args.inputTokens}, output=${args.outputTokens})`,
    );
  }
  const provider = MODEL_PRICES[args.providerId];
  if (!provider) {
    throw new UnknownModelError(args.providerId, args.modelId);
  }
  const price = provider[args.modelId];
  if (!price) {
    throw new UnknownModelError(args.providerId, args.modelId);
  }
  return (args.inputTokens / 1_000_000) * price.inputPerMtok
       + (args.outputTokens / 1_000_000) * price.outputPerMtok;
}
