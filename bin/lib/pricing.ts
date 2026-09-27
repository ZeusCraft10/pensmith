// bin/lib/pricing.ts — MODEL_PRICES table + cost functions (RUN-06, D-17-18).
//
// SINGLE source of truth for $/MTok rates. Any other file that hard-codes a
// per-MTok rate is a bug. Rates change rarely and git blame on this file is the
// audit trail, so pricing is never scraped at runtime.
//
// Sources (per MTok, input / output):
//   - Anthropic: the claude-api skill model table, cached 2026-06-24.
//       claude-fable-5-1, claude-fable-5          $10 / $50
//       claude-opus-5-5                            $4 / $20  (priced; never a default)
//       claude-opus-5, claude-opus-4-8/4-7/4-6     $5 / $25
//       claude-sonnet-5                            $2 / $10
//       claude-sonnet-4-6                          $3 / $15
//       claude-haiku-4-5                           $1 / $5
//     Prompt caching: a cache write costs 1.25x input and a cache read 0.1x
//     input, except where the model table publishes its own read price
//     (claude-fable-5-1 $0.25, claude-opus-5-5 $0.20).
//   - OpenAI: https://developers.openai.com/api/docs/pricing (the page that
//     https://openai.com/api/pricing and platform.openai.com/docs/pricing now
//     redirect to), verified 2026-09-27, standard tier, with the cached-input
//     price. OpenAI caching has no write premium.
//
// Unknown models never crash (UnknownModelError no longer exists): a model the
// table does not know uses the `[runtime] price_in_per_mtok` /
// `price_out_per_mtok` override when configured, else the most expensive known
// price for its provider, with exactly one warning per (provider, model).
// Local providers (ollama, vllm, openai-compatible) price at $0 unless a price
// override is configured.
//
// MODEL_PRICES is deeply frozen (outer record, provider records and each leaf,
// FLAG-03). estimateCost rejects negative token counts with RangeError.

import { LOCAL_PROVIDERS, isProviderName } from './llm-models.js';

export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  /** Cache-read price when the vendor publishes one that differs from 0.1x input. */
  cacheReadPerMtok?: number;
  currency: 'USD';
}

function p(inputPerMtok: number, outputPerMtok: number, cacheReadPerMtok?: number): ModelPrice {
  return cacheReadPerMtok === undefined
    ? { inputPerMtok, outputPerMtok, currency: 'USD' }
    : { inputPerMtok, outputPerMtok, cacheReadPerMtok, currency: 'USD' };
}

const RAW: Record<string, Record<string, ModelPrice>> = {
  anthropic: {
    'claude-fable-5-1': p(10, 50, 0.25),
    'claude-fable-5': p(10, 50),
    'claude-opus-5-5': p(4, 20, 0.2),
    'claude-opus-5': p(5, 25),
    'claude-opus-4-8': p(5, 25),
    'claude-opus-4-7': p(5, 25),
    'claude-opus-4-6': p(5, 25),
    'claude-sonnet-5': p(2, 10),
    'claude-sonnet-4-6': p(3, 15),
    'claude-haiku-4-5': p(1, 5),
  },
  openai: {
    'gpt-6-astra': p(10, 50, 1.0),
    'gpt-6-sol': p(2, 10, 0.2),
    'gpt-6-luna': p(0.1, 0.5, 0.01),
    'gpt-5.6-sol': p(4, 20, 0.4),
    'gpt-5.6-terra': p(2, 12, 0.2),
    'gpt-5.6-luna': p(0.2, 1.2, 0.02),
    'gpt-5.5': p(5, 30, 0.5),
    'gpt-5.4': p(2.5, 15, 0.25),
    'gpt-5.4-mini': p(0.75, 4.5, 0.075),
    'gpt-5.4-nano': p(0.2, 1.25, 0.02),
    'gpt-5': p(1.25, 10, 0.125),
    'gpt-5-mini': p(0.25, 2, 0.025),
    'gpt-5-nano': p(0.05, 0.4, 0.005),
    'gpt-4.1': p(2, 8, 0.5),
    'gpt-4.1-mini': p(0.4, 1.6, 0.1),
    'gpt-4o': p(2.5, 10, 1.25),
    'gpt-4o-mini': p(0.15, 0.6, 0.075),
  },
};

for (const provider of Object.keys(RAW)) {
  const providerRecord = RAW[provider]!;
  for (const model of Object.keys(providerRecord)) Object.freeze(providerRecord[model]!);
  Object.freeze(providerRecord);
}
Object.freeze(RAW);

/** The frozen pricing table (read-only at runtime). */
export const MODEL_PRICES: Readonly<Record<string, Readonly<Record<string, ModelPrice>>>> = RAW;

/** Anthropic cache pricing multipliers (D-17-18). */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export type PriceSource = 'table' | 'config' | 'fallback' | 'local';

export interface ResolvedPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
  source: PriceSource;
}

export interface PriceOverride {
  inputPerMtok?: number | undefined;
  outputPerMtok?: number | undefined;
}

const warnedFallback = new Set<string>();

/** Test-only: forget which fallback prices already warned. */
export function _resetPriceWarningsForTest(): void {
  warnedFallback.clear();
}

function maxProviderPrice(provider: string): { inputPerMtok: number; outputPerMtok: number } | null {
  const table = MODEL_PRICES[provider];
  if (!table) return null;
  let inputPerMtok = 0;
  let outputPerMtok = 0;
  for (const price of Object.values(table)) {
    inputPerMtok = Math.max(inputPerMtok, price.inputPerMtok);
    outputPerMtok = Math.max(outputPerMtok, price.outputPerMtok);
  }
  return { inputPerMtok, outputPerMtok };
}

function withCache(provider: string, inputPerMtok: number, outputPerMtok: number, cacheReadPerMtok: number | undefined, source: PriceSource): ResolvedPrice {
  // OpenAI-style caching has no write premium; Anthropic writes cost 1.25x.
  const writeMult = provider === 'anthropic' ? CACHE_WRITE_MULTIPLIER : 1;
  return {
    inputPerMtok,
    outputPerMtok,
    cacheWritePerMtok: inputPerMtok * writeMult,
    cacheReadPerMtok: cacheReadPerMtok ?? inputPerMtok * CACHE_READ_MULTIPLIER,
    source,
  };
}

/**
 * Resolve the price for (provider, model). Never throws:
 *   1. local providers: the configured override, else $0;
 *   2. a model in the table: the table price (an override never re-prices a known model);
 *   3. an unknown model: the configured override (`[runtime] price_in_per_mtok` /
 *      `price_out_per_mtok`);
 *   4. otherwise the most expensive known price for the provider, with one warning.
 */
export function resolvePrice(
  provider: string,
  model: string,
  override: PriceOverride = {},
  warn: (line: string) => void = (line) => process.stderr.write(line + '\n'),
): ResolvedPrice {
  const hasIn = typeof override.inputPerMtok === 'number' && Number.isFinite(override.inputPerMtok);
  const hasOut = typeof override.outputPerMtok === 'number' && Number.isFinite(override.outputPerMtok);
  const fromOverride = (): ResolvedPrice =>
    withCache(provider, hasIn ? (override.inputPerMtok as number) : 0, hasOut ? (override.outputPerMtok as number) : 0, undefined, 'config');
  if (isProviderName(provider) && LOCAL_PROVIDERS.has(provider)) {
    if (hasIn || hasOut) return fromOverride();
    return { inputPerMtok: 0, outputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, source: 'local' };
  }
  const table = MODEL_PRICES[provider]?.[model];
  if (table) return withCache(provider, table.inputPerMtok, table.outputPerMtok, table.cacheReadPerMtok, 'table');
  if (hasIn || hasOut) return fromOverride();

  const fallback = maxProviderPrice(provider) ?? maxProviderPrice('anthropic')!;
  const key = `${provider}/${model}`;
  if (!warnedFallback.has(key)) {
    warnedFallback.add(key);
    warn(
      `pensmith: no price is known for ${key}; using the most expensive ${provider} price ` +
        `($${fallback.inputPerMtok.toFixed(2)} in / $${fallback.outputPerMtok.toFixed(2)} out per MTok). ` +
        `Set [runtime] price_in_per_mtok and price_out_per_mtok to override.`,
    );
  }
  return withCache(provider, fallback.inputPerMtok, fallback.outputPerMtok, undefined, 'fallback');
}

export interface TokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  /** Output tokens (thinking included). */
  outputTokens: number;
  cacheWriteTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
}

/** Price a usage record at a resolved price. RangeError on negative token counts. */
export function costOf(price: ResolvedPrice, usage: TokenUsage): number {
  const cw = usage.cacheWriteTokens ?? 0;
  const cr = usage.cacheReadTokens ?? 0;
  if (usage.inputTokens < 0 || usage.outputTokens < 0 || cw < 0 || cr < 0) {
    throw new RangeError(
      `token counts must be >= 0 (got input=${usage.inputTokens}, output=${usage.outputTokens}, cache_write=${cw}, cache_read=${cr})`,
    );
  }
  return (usage.inputTokens / 1_000_000) * price.inputPerMtok
    + (usage.outputTokens / 1_000_000) * price.outputPerMtok
    + (cw / 1_000_000) * price.cacheWritePerMtok
    + (cr / 1_000_000) * price.cacheReadPerMtok;
}

/**
 * USD cost for a (provider, model, tokens) tuple. Never throws for an unknown
 * provider or model (fallback price + one warning); RangeError on negative
 * token counts (checked before any lookup so callers get the specific error).
 */
export function estimateCost(args: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  override?: PriceOverride;
}): number {
  if (args.inputTokens < 0 || args.outputTokens < 0) {
    throw new RangeError(
      `token counts must be >= 0 (got input=${args.inputTokens}, output=${args.outputTokens})`,
    );
  }
  const price = resolvePrice(args.providerId, args.modelId, args.override ?? {});
  return costOf(price, {
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheWriteTokens: args.cacheWriteTokens,
    cacheReadTokens: args.cacheReadTokens,
  });
}
