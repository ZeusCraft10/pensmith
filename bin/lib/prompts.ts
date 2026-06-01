// bin/lib/prompts.ts — Public entry point for TIER-05 prompt system.
//
// TIER-05: Tier 2 fallback for AskUserQuestion.
//   - TTY (auto-detected via process.stdout.isTTY && process.stderr.isTTY):
//     delegate to @clack/prompts via bin/lib/prompts/clack.ts.
//   - non-TTY (piped, CI, captured): stdin numbered-prompt mode via
//     bin/lib/prompts/numbered.ts. Question protocol matches gsd-plugin's
//     `--text` JSON schema (see ./prompts/schema.ts).
//
// Pitfall 11 (02-RESEARCH): clack version drift would break tier-contract
// tests if both paths went through clack — the numbered path stays
// dependency-free for exactly this reason.
//
// ARCH-11 boundary: when --yolo flag lands in Phase 7, it MUST be checked by
// the calling verb before invoking ask() — ask() itself never short-circuits.
// The approval-skip discipline is a verb-level policy (UX-02 / ERGO-03 / PRD §14).
//
// Security: ask() never calls any logging function. PromptAnswer.value redaction
// is the CALLER's responsibility (per bin/lib/pii.ts from Phase 1, per PRD §16).

import { askNumbered } from './prompts/numbered.js';
export type { PromptQuestion, PromptAnswer } from './prompts/schema.js';
export { PromptQuestionSchema } from './prompts/schema.js';
import type { PromptQuestion, PromptAnswer } from './prompts/schema.js';

// ── Error classes ─────────────────────────────────────────────────────────────

export class PromptAbortedError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`prompt aborted: ${id}`);
    this.id = id;
    this.name = 'PromptAbortedError';
    Object.setPrototypeOf(this, PromptAbortedError.prototype);
  }
}

export class PromptTimeoutError extends Error {
  readonly id: string;
  readonly timeoutMs: number;
  constructor(id: string, timeoutMs: number) {
    super(`prompt timed out after ${timeoutMs}ms: ${id}`);
    this.id = id;
    this.timeoutMs = timeoutMs;
    this.name = 'PromptTimeoutError';
    Object.setPrototypeOf(this, PromptTimeoutError.prototype);
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface AskOptions {
  /** Override the mode detection. Defaults to env PENSMITH_PROMPT_MODE or 'auto'. */
  mode?: 'auto' | 'clack' | 'numbered';
  /** Per-question timeout in ms. Defaults to env PENSMITH_PROMPT_TIMEOUT_MS or 5 min. */
  timeoutMs?: number;
  /** Streams (test-injection). Defaults to process.stdin / process.stderr. */
  stdin?: NodeJS.ReadableStream;
  stderr?: NodeJS.WritableStream;
}

// ── Mode resolution ───────────────────────────────────────────────────────────

function resolveMode(opts?: AskOptions): 'clack' | 'numbered' {
  const explicit = opts?.mode ?? (process.env['PENSMITH_PROMPT_MODE'] as AskOptions['mode'] | undefined);
  if (explicit === 'clack' || explicit === 'numbered') return explicit;
  // auto: both stdout AND stderr must be TTY for clack to render correctly
  const isTty = Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
  return isTty ? 'clack' : 'numbered';
}

// ── Public ask() ──────────────────────────────────────────────────────────────

export async function ask(question: PromptQuestion, opts: AskOptions = {}): Promise<PromptAnswer> {
  const mode = resolveMode(opts);
  if (mode === 'clack') {
    // Dynamic import so the numbered path never pays the clack startup cost
    // on non-TTY pipelines. This is the key Pitfall 11 mitigation.
    const { askClack } = await import('./prompts/clack.js');
    return askClack(question, opts);
  }
  return askNumbered(question, opts);
}
