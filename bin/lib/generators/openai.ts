// bin/lib/generators/openai.ts — OpenAI-compatible Chat Completions (OpenAI,
// or a server you run, such as Ollama or vLLM, at a configured base URL).
//
// The request goes through bin/lib/http.ts like any other. It does not stream,
// so it gets a minutes-long deadline, and http.ts never sends a POST again
// once it may have reached the server. The output limit is sent as
// max_completion_tokens, which OpenAI's reasoning models require (they refuse
// max_tokens), and finish_reason says whether the answer is whole.

import { fetch as httpFetch, missedDeadline } from '../http.js';
import { VERSION } from '../version.generated.js';
import {
  GenerationError,
  ProviderError,
  timeoutError,
  type GenerateRequest,
  type GenerateResult,
  type Generator,
  type StopKind,
} from '../generator.js';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** A non-streamed answer arrives all at once, when the model is done. */
const COMPLETION_TIMEOUT_MS = 600_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface OpenAiGeneratorOptions {
  apiKey: string;
  /** The API root, ending before /chat/completions. OpenAI's when absent. */
  baseUrl?: string;
  /** How long the whole answer may take (10 minutes when absent). */
  timeoutMs?: number;
}

function stopKind(reason: unknown): StopKind {
  switch (reason) {
    case 'stop':
      return 'complete';
    case 'length':
      return 'truncated';
    case 'content_filter':
      return 'refused';
    default:
      return 'incomplete';
  }
}

function statusError(status: number, body: string, host: string): ProviderError {
  const detail = body.slice(0, 300).replace(/[\r\n]+/g, ' ');
  if (status === 401) return new ProviderError('auth', status, `${host} rejected the API key (HTTP 401). Check the apiKeyEnv the provider names in runtime.json.`);
  if (status === 403) return new ProviderError('permission', status, `${host} refused the request (HTTP 403): ${detail}`);
  if (status === 404) return new ProviderError('not_found', status, `${host} does not know this model or path (HTTP 404): ${detail}`);
  if (status === 429) return new ProviderError('rate_limited', status, `${host} kept rate limiting after retries (HTTP 429): ${detail}`);
  if (status >= 500) return new ProviderError('server', status, `${host} failed (HTTP ${status}): ${detail}`);
  return new ProviderError('bad_request', status, `${host} refused the request (HTTP ${status}): ${detail}`);
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function openAiGenerator(opts: OpenAiGeneratorOptions): Generator {
  const base = (opts.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const host = new URL(url).host;
  const timeoutMs = opts.timeoutMs ?? COMPLETION_TIMEOUT_MS;
  return {
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_completion_tokens: req.maxTokens,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      };
      if (req.jsonSchema) {
        body['response_format'] = { type: 'json_schema', json_schema: { name: 'answer', schema: req.jsonSchema, strict: true } };
      }

      let res;
      try {
        res = await httpFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`,
            // The registries' User-Agent carries the contact email; a model provider has no use for it.
            'user-agent': `pensmith/${VERSION}`,
          },
          body: JSON.stringify(body),
          // The base URL is the endpoint the user configured, a local server included.
          source: 'generic',
          noCache: true,
          untrusted: false,
          timeoutMs,
          maxBodyBytes: MAX_RESPONSE_BYTES,
        });
      } catch (err) {
        // http.ts throws a 429 or 5xx it gave up retrying, with the response attached.
        const failed = err as { status?: unknown; response?: { body?: string } };
        if (typeof failed.status === 'number') throw statusError(failed.status, failed.response?.body ?? '', host);
        const missed = missedDeadline(err);
        if (missed) throw timeoutError(missed, req.model, timeoutMs, err);
        const detail = err instanceof Error ? err.message : String(err);
        throw new ProviderError('connection', null, `could not reach ${host}: ${detail}`, { cause: err });
      }
      if (res.status >= 400) throw statusError(res.status, res.body, host);

      let parsed: ChatCompletion;
      try {
        parsed = JSON.parse(res.body) as ChatCompletion;
      } catch {
        throw new GenerationError('LLM_BAD_RESPONSE', `${host} answered with something that is not JSON (${res.body.length} bytes)`);
      }
      const choice = parsed.choices?.[0];
      const model = typeof parsed.model === 'string' && parsed.model ? parsed.model : req.model;
      const stop = choice?.message?.refusal ? 'refused' : stopKind(choice?.finish_reason);
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        model,
        stop,
        stopReason: choice?.finish_reason ?? null,
        ...(stop === 'refused' ? { refusal: { category: choice?.finish_reason ?? null, explanation: choice?.message?.refusal ?? null } } : {}),
        usage: [{
          model,
          inputTokens: parsed.usage?.prompt_tokens ?? 0,
          outputTokens: parsed.usage?.completion_tokens ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
      };
    },
  };
}
