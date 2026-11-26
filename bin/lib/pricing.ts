// bin/lib/pricing.ts — what a model call costs, by provider name and model ID.
//
// This file is the one place per-token rates live. The budget gate prices a
// call before it is made, and the cost ledger prices it again from the usage
// the provider reports. Rates change rarely, so they are kept here rather than
// fetched: git blame on this table is the audit trail. To update a rate, edit
// the entry and cite the provider's pricing page in the commit message.
//
// The table is keyed by the provider's name ('anthropic', 'openai'), never by
// the key a runtime.json gives the provider entry: `providers: { claude: {
// name: 'anthropic' } }` prices as Anthropic.
//
// A model the table does not list is priced at the highest input and output
// rates listed for its provider (the highest anywhere for an unknown
// provider), with a one-time warning. A budget check that undercounts is
// worse than one that overcounts, and an unknown name must never stop a run:
// it may be a model released after this table was written. A provider entry
// in runtime.json can set its own rates (a local model server costs nothing).
//
// Anthropic rates: https://platform.claude.com/docs/en/about-claude/pricing
// OpenAI rates: https://openai.com/api/pricing

export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  /** Cache reads; one tenth of the input rate when not given. */
  cacheReadPerMtok?: number;
  /** Five-minute cache writes; 1.25 times the input rate when not given. */
  cacheWritePerMtok?: number;
  /** Higher rates for a prompt longer than `aboveInputTokens`. */
  longContext?: { aboveInputTokens: number; inputPerMtok: number; outputPerMtok: number };
  currency: 'USD';
}

const usd = (inputPerMtok: number, outputPerMtok: number, extra: Partial<ModelPrice> = {}): ModelPrice => ({
  inputPerMtok,
  outputPerMtok,
  ...extra,
  currency: 'USD',
});

const RAW: Record<string, Record<string, ModelPrice>> = {
  anthropic: {
    'claude-opus-5-5': usd(4, 20, { cacheReadPerMtok: 0.2 }),
    'claude-sonnet-5-5': usd(2, 10, { cacheReadPerMtok: 0.1 }),
    'claude-haiku-5-5': usd(0.1, 0.5, { longContext: { aboveInputTokens: 100_000, inputPerMtok: 0.5, outputPerMtok: 2.5 } }),
    'claude-fable-5-2': usd(8, 40, { cacheReadPerMtok: 0.2 }),
    'claude-mythos-5-2': usd(8, 40, { cacheReadPerMtok: 0.2 }),
    'claude-fable-5-1': usd(10, 50, { cacheReadPerMtok: 0.25 }),
    'claude-mythos-5-1': usd(10, 50, { cacheReadPerMtok: 0.25 }),
    'claude-fable-5': usd(10, 50, { cacheReadPerMtok: 1 }),
    'claude-mythos-5': usd(10, 50, { cacheReadPerMtok: 1 }),
    'claude-opus-5': usd(5, 25),
    'claude-opus-4-8': usd(5, 25),
    'claude-opus-4-7': usd(5, 25),
    'claude-opus-4-6': usd(5, 25),
    'claude-opus-4-5': usd(5, 25),
    'claude-sonnet-5': usd(2, 10),
    'claude-sonnet-4-6': usd(3, 15),
    'claude-haiku-4-5': usd(1, 5),
  },
  openai: {
    'gpt-4o': usd(2.5, 10),
    'gpt-4o-mini': usd(0.15, 0.6),
  },
};

// Deep-frozen: the outer table, each provider's table and each price, so no
// caller can change a rate at run time (an assignment throws in strict mode).
for (const models of Object.values(RAW)) {
  for (const price of Object.values(models)) {
    if (price.longContext) Object.freeze(price.longContext);
    Object.freeze(price);
  }
  Object.freeze(models);
}
Object.freeze(RAW);

/** The frozen price table, by provider name, then model ID. */
export const MODEL_PRICES: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = RAW;

/** The highest input and output rates among `prices`. */
function highest(prices: readonly ModelPrice[]): ModelPrice {
  return usd(
    Math.max(...prices.map((p) => p.longContext?.inputPerMtok ?? p.inputPerMtok)),
    Math.max(...prices.map((p) => p.longContext?.outputPerMtok ?? p.outputPerMtok)),
  );
}

/** Whether the table lists `modelId` for `provider`. */
export function isKnownModel(provider: string, modelId: string): boolean {
  return MODEL_PRICES[provider]?.[modelId] !== undefined;
}

const warnedUnknown = new Set<string>();

/**
 * The rates for `modelId` under `provider`: the table's entry, or for a model
 * it does not list the highest rates it lists for that provider (anywhere, for
 * an unknown provider), with a warning on stderr the first time.
 */
export function priceFor(provider: string, modelId: string): ModelPrice {
  const listed = MODEL_PRICES[provider]?.[modelId];
  if (listed) return listed;
  const pool = Object.values(MODEL_PRICES[provider] ?? {});
  const fallback = highest(pool.length > 0 ? pool : Object.values(MODEL_PRICES).flatMap((m) => Object.values(m)));
  const key = `${provider}/${modelId}`;
  if (!warnedUnknown.has(key)) {
    warnedUnknown.add(key);
    process.stderr.write(
      `pensmith: no price is listed for ${key}; its cost is estimated at $${fallback.inputPerMtok}/$${fallback.outputPerMtok} ` +
      'per million input/output tokens, the highest listed rates. Set pricePerMtok on the provider in runtime.json to use its real rates.\n',
    );
  }
  return fallback;
}

export interface CostArgs {
  /** The provider's name ('anthropic', 'openai'), not its runtime.json key. */
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Rates set for this provider in runtime.json; they replace the table's. */
  override?: { inputPerMtok: number; outputPerMtok: number };
}

/**
 * The USD cost of a call. Token counts must be zero or more (RangeError
 * otherwise). An unlisted model is priced as priceFor describes; this never
 * throws for one.
 */
export function estimateCost(args: CostArgs): number {
  const cacheRead = args.cacheReadTokens ?? 0;
  const cacheWrite = args.cacheWriteTokens ?? 0;
  for (const n of [args.inputTokens, args.outputTokens, cacheRead, cacheWrite]) {
    if (!(n >= 0)) {
      throw new RangeError(
        `token counts must be >= 0 (got input=${args.inputTokens}, output=${args.outputTokens}, cacheRead=${cacheRead}, cacheWrite=${cacheWrite})`,
      );
    }
  }
  const price: ModelPrice = args.override ? usd(args.override.inputPerMtok, args.override.outputPerMtok) : priceFor(args.provider, args.modelId);
  const prompt = args.inputTokens + cacheRead + cacheWrite;
  const long = price.longContext && prompt > price.longContext.aboveInputTokens ? price.longContext : null;
  const inputRate = long?.inputPerMtok ?? price.inputPerMtok;
  const outputRate = long?.outputPerMtok ?? price.outputPerMtok;
  const cacheReadRate = price.cacheReadPerMtok ?? inputRate * 0.1;
  const cacheWriteRate = price.cacheWritePerMtok ?? inputRate * 1.25;
  return (args.inputTokens * inputRate
    + args.outputTokens * outputRate
    + cacheRead * cacheReadRate
    + cacheWrite * cacheWriteRate) / 1_000_000;
}
