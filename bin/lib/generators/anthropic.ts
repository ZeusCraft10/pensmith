// bin/lib/generators/anthropic.ts — the Anthropic Messages API through the
// official SDK, with the SDK's fetch routed through bin/lib/http.ts.
//
// This is the only file that imports @anthropic-ai/sdk as a value. The client
// is built per request with chokepointFetch, so a model call gets the same
// proxy handling, rate bucket, deadline, offline refusal and response size
// limit as every registry request, and the API key reaches only the request
// header.
//
// Every request streams and waits for finalMessage(): a long draft on a
// thinking model takes minutes, and a non-streaming request sends nothing
// until it is done. Current models put thinking blocks before the text, so
// the answer is the text blocks, read by type. The SDK retries 429, 529 and
// 5xx answers, honouring retry-after.
//
// No temperature, top_p or top_k is sent (current models refuse them), and the
// last turn is always the user's (no prefill). Thinking is left at the
// model's default where that is adaptive (the 5.x models); Opus 4.6 to 4.8
// and Sonnet 4.6 run without thinking unless asked, so they are sent
// `thinking: adaptive`. Where the model supports it, a request opts into
// server-side fallbacks, so a safety decline is retried on the model
// Anthropic recommends for it.

import Anthropic from '@anthropic-ai/sdk';
import { chokepointFetch, missedDeadline } from '../http.js';
import {
  EFFORTS,
  GenerationError,
  ProviderError,
  timeoutError,
  type Effort,
  type GenerateRequest,
  type GenerateResult,
  type Generator,
  type StopKind,
  type UsageRow,
} from '../generator.js';

/** The beta that turns on server-side fallbacks with `fallbacks: "default"`. */
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** What a model takes beyond the basic request. */
interface ModelCaps {
  /** The `output_config.effort` levels it takes; absent, no effort is sent. */
  effort?: readonly Effort[];
  /** It runs without thinking unless `thinking: adaptive` is sent. */
  adaptiveOnRequest?: true;
  /** It accepts `fallbacks: "default"`. */
  fallbacks?: true;
}

/**
 * Each model's capabilities, by model ID. A model not listed (Claude Haiku
 * 4.5, which refuses effort, or one released after this table) gets none of
 * them. Claude Haiku 5.5 has no fallback, and the others without `fallbacks`
 * refuse the field.
 */
const MODELS: ReadonlyMap<string, ModelCaps> = new Map<string, ModelCaps>([
  ['claude-opus-5-5', { effort: EFFORTS, fallbacks: true }],
  ['claude-opus-5', { effort: EFFORTS, fallbacks: true }],
  ['claude-sonnet-5-5', { effort: EFFORTS, fallbacks: true }],
  ['claude-fable-5-2', { effort: EFFORTS, fallbacks: true }],
  ['claude-fable-5-1', { effort: EFFORTS, fallbacks: true }],
  ['claude-fable-5', { effort: EFFORTS, fallbacks: true }],
  ['claude-mythos-5-2', { effort: EFFORTS, fallbacks: true }],
  ['claude-mythos-5-1', { effort: EFFORTS, fallbacks: true }],
  ['claude-mythos-5', { effort: EFFORTS }],
  ['claude-haiku-5-5', { effort: EFFORTS }],
  ['claude-sonnet-5', { effort: EFFORTS }],
  ['claude-opus-4-8', { effort: EFFORTS, adaptiveOnRequest: true }],
  ['claude-opus-4-7', { effort: EFFORTS, adaptiveOnRequest: true }],
  ['claude-opus-4-6', { effort: ['low', 'medium', 'high', 'max'], adaptiveOnRequest: true }],
  ['claude-sonnet-4-6', { effort: ['low', 'medium', 'high', 'max'], adaptiveOnRequest: true }],
  ['claude-opus-4-5', { effort: ['low', 'medium', 'high'] }],
]);

/** `effort`, or the highest level below it in `levels` (another is a 400). */
function effortFor(levels: readonly Effort[], effort: Effort): Effort {
  for (let i = EFFORTS.indexOf(effort); i >= 0; i -= 1) {
    if (levels.includes(EFFORTS[i]!)) return EFFORTS[i]!;
  }
  return levels[0]!;
}

/** How long the response head may take, and how long the stream may then go quiet. */
const STREAM_TIMEOUT_MS = 300_000;
/** The SDK's own limit on one attempt. */
const SDK_TIMEOUT_MS = 600_000;
/** A streamed answer of the largest output is a few MB of events; this is far past it. */
const MAX_STREAM_BYTES = 32 * 1024 * 1024;

export interface AnthropicGeneratorOptions {
  apiKey: string;
  /** Another endpoint for the Messages API; the SDK's default (or ANTHROPIC_BASE_URL) when absent. */
  baseUrl?: string;
  /** How long the response head may take, and the stream may then go quiet (5 minutes when absent). */
  timeoutMs?: number;
}

type Params = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

/** The request body for `req`, as the SDK takes it. */
function anthropicParams(req: GenerateRequest): Params {
  const caps = MODELS.get(req.model);
  const params: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (req.system) params['system'] = req.system;
  if (caps?.adaptiveOnRequest) params['thinking'] = { type: 'adaptive' };
  const outputConfig: Record<string, unknown> = {};
  if (req.effort && caps?.effort) outputConfig['effort'] = effortFor(caps.effort, req.effort);
  if (req.jsonSchema) outputConfig['format'] = { type: 'json_schema', schema: req.jsonSchema };
  if (Object.keys(outputConfig).length > 0) params['output_config'] = outputConfig;
  if (caps?.fallbacks) {
    params['betas'] = [SERVER_FALLBACK_BETA];
    // Newer than this SDK's types; the SDK sends a field it does not know as given.
    params['fallbacks'] = 'default';
  }
  return params as unknown as Params;
}

interface StopDetails {
  category?: string | null;
  explanation?: string | null;
}

function stopKind(reason: string | null | undefined): StopKind {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'complete';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'truncated';
    case 'refusal':
      return 'refused';
    default:
      return 'incomplete';
  }
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: Array<RawUsage & { type?: string; model?: string }> | null;
}

function row(model: string, u: RawUsage): UsageRow {
  return {
    model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * The tokens each model used. With a fallback, `usage.iterations` lists every
 * attempt (the declined ones on the requested model, the one that answered on
 * the fallback model) and the top-level usage covers only the last, so the
 * attempts are counted instead.
 */
function usageRows(
  message: { model?: string; usage?: RawUsage | null } | undefined,
  requestedModel: string,
): UsageRow[] {
  const usage = message?.usage;
  if (!usage) return [];
  const served = message?.model || requestedModel;
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
  if (iterations.length > 0) {
    return iterations.map((it) => row(
      typeof it.model === 'string' && it.model ? it.model : it.type === 'fallback_message' ? served : requestedModel,
      it,
    ));
  }
  return [row(served, usage)];
}

/** A pensmith error for what the SDK threw. */
function providerError(err: unknown, model: string, timeoutMs: number): GenerationError {
  if (err instanceof GenerationError) return err;
  const missed = missedDeadline(err);
  if (missed) return timeoutError(missed, model, timeoutMs, err);
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', null, `the request to the Anthropic API timed out (${model})`, { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    const cause = (err as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : err.message;
    return new ProviderError('connection', null, `could not reach the Anthropic API: ${detail}`, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const apiType = (err.error as { error?: { type?: string } } | undefined)?.error?.type;
    const detail = err.message.replace(/[\r\n]+/g, ' ').slice(0, 300);
    if (status === 401) return new ProviderError('auth', status, 'the Anthropic API rejected the API key (HTTP 401). Check ANTHROPIC_API_KEY, or the apiKeyEnv the provider names in runtime.json.', { cause: err });
    if (status === 403) return new ProviderError('permission', status, `the API key may not use ${model} (HTTP 403): ${detail}`, { cause: err });
    if (status === 404) return new ProviderError('not_found', status, `the Anthropic API does not know the model "${model}" (HTTP 404). Check defaultModel and the role models in runtime.json.`, { cause: err });
    if (status === 429) return new ProviderError('rate_limited', status, `the Anthropic API is rate limiting this key and kept refusing after retries (HTTP 429): ${detail}`, { cause: err });
    if (status === 529 || apiType === 'overloaded_error') return new ProviderError('overloaded', status, 'the Anthropic API is overloaded and kept refusing after retries (HTTP 529). Try again in a few minutes.', { cause: err });
    if (status !== null && status >= 500) return new ProviderError('server', status, `the Anthropic API failed (HTTP ${status}): ${detail}`, { cause: err });
    return new ProviderError('bad_request', status, `the Anthropic API refused the request${status ? ` (HTTP ${status})` : ''}: ${detail}`, { cause: err });
  }
  return new GenerationError('LLM_FAILED', `the Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`, 1, { cause: err });
}

export function anthropicGenerator(opts: AnthropicGeneratorOptions): Generator {
  return {
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const timeoutMs = opts.timeoutMs ?? STREAM_TIMEOUT_MS;
      const client = new Anthropic({
        apiKey: opts.apiKey,
        authToken: null,
        ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
        fetch: chokepointFetch({ source: 'generic', timeoutMs, maxBodyBytes: MAX_STREAM_BYTES, untrusted: false }),
        maxRetries: 2,
        timeout: SDK_TIMEOUT_MS,
        logLevel: 'warn',
      });
      const stream = client.beta.messages.stream(anthropicParams(req));
      // This SDK's stream does not keep stop_details, which says why a refusal happened.
      const seen: { stopDetails: StopDetails | null } = { stopDetails: null };
      stream.on('streamEvent', (event) => {
        const details = (event as { delta?: { stop_details?: StopDetails | null } }).delta?.stop_details;
        if (event.type === 'message_delta' && details) seen.stopDetails = details;
      });

      let message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        const failure = providerError(err, req.model, timeoutMs);
        failure.usage = usageRows(stream.currentMessage, req.model);
        throw failure;
      }

      const text = message.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const details = seen.stopDetails ?? (message as { stop_details?: StopDetails | null }).stop_details ?? null;
      const stop = stopKind(message.stop_reason);
      return {
        text,
        model: message.model || req.model,
        stop,
        stopReason: message.stop_reason ?? null,
        ...(stop === 'refused' ? { refusal: { category: details?.category ?? null, explanation: details?.explanation ?? null } } : {}),
        usage: usageRows(message, req.model),
      };
    },
  };
}
