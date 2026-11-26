// bin/lib/generator.ts — what a model provider must do for pensmith, and the
// typed errors a generation can end in.
//
// complete() in anthropic.ts owns the rules every call follows (no-LLM stub,
// offline refusal, model choice, the paper's cost cap, the cost ledger). A
// Generator only turns one request into one answer from one provider:
// generators/anthropic.ts on the official SDK, generators/openai.ts for
// OpenAI-compatible servers. Tests can put a fake one in their place.

/** The step a call is made for. Each has its own default effort and token limits. */
export type LlmRole =
  | 'intake'
  | 'research'
  | 'evaluate'
  | 'outline'
  | 'plan'
  | 'write'
  | 'revise'
  | 'verify'
  | 'task';

export const LLM_ROLES: readonly LlmRole[] = ['intake', 'research', 'evaluate', 'outline', 'plan', 'write', 'revise', 'verify', 'task'];

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface GenerateRequest {
  model: string;
  /** Empty for none. */
  system: string;
  /** Non-empty; the last turn is the user's (no prefill). */
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /** The output limit, thinking included. */
  maxTokens: number;
  /** How hard the model works; a provider that has no such setting ignores it. */
  effort?: Effort;
  /** A JSON Schema the answer must follow (structured output). */
  jsonSchema?: Record<string, unknown>;
}

/** Tokens one model used. A call that fell back to another model has one row per model. */
export interface UsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** How the answer ended: in full, at the token limit, declined, or some other way. */
export type StopKind = 'complete' | 'truncated' | 'refused' | 'incomplete';

export interface GenerateResult {
  /** The answer's text blocks, joined; thinking and other blocks are left out. */
  text: string;
  /** The model that produced the answer. */
  model: string;
  stop: StopKind;
  /** The provider's own name for how it stopped (stop_reason, finish_reason). */
  stopReason: string | null;
  refusal?: { category: string | null; explanation: string | null };
  usage: UsageRow[];
}

export interface Generator {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

// ============================================================
//   Errors
// ============================================================

/**
 * A model call that did not give a usable answer. `exitCode` is what the CLI
 * exits with when nothing handles it; `usage` is what the attempt used, so its
 * cost is recorded even though it failed.
 */
export class GenerationError extends Error {
  readonly code: string;
  readonly exitCode: number;
  usage: UsageRow[] = [];
  constructor(code: string, message: string, exitCode = 1, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GenerationError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** The answer hit its token limit, so it is cut off. It is never saved. */
export class TruncatedError extends GenerationError {
  readonly maxTokens: number;
  constructor(model: string, maxTokens: number) {
    super(
      'LLM_TRUNCATED',
      `${model} stopped at the ${maxTokens}-token output limit, so its answer is cut off; nothing was saved. ` +
      'Run the step again, or raise maxTokens for this role in runtime.json.',
    );
    this.name = 'TruncatedError';
    this.maxTokens = maxTokens;
  }
}

/** The model, or the provider's safety system, declined the request. */
export class RefusalError extends GenerationError {
  readonly category: string | null;
  readonly explanation: string | null;
  constructor(model: string, category: string | null, explanation: string | null) {
    super(
      'LLM_REFUSED',
      `${model} declined this request${category ? ` (category: ${category})` : ''}${explanation ? `: ${explanation}` : ''}. Nothing was saved.`,
      2,
    );
    this.name = 'RefusalError';
    this.category = category;
    this.explanation = explanation;
  }
}

export type ProviderErrorKind =
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'connection';

/** The provider answered with an error, or could not be reached. */
export class ProviderError extends GenerationError {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  constructor(kind: ProviderErrorKind, status: number | null, message: string, options?: { cause?: unknown }) {
    super('LLM_PROVIDER', message, 1, options);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}
