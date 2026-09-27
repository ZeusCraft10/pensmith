// bin/lib/prompts.ts — Public entry point for TIER-05 prompt system.
//
// TIER-05: Tier 2 fallback for AskUserQuestion.
//   - TTY (auto-detected: stdin, stdout AND stderr are all terminals — RUN-12):
//     delegate to @clack/prompts via bin/lib/prompts/clack.ts.
//   - non-TTY (piped, CI, captured): stdin numbered-prompt mode via
//     bin/lib/prompts/numbered.ts. Question protocol matches gsd-plugin's
//     `--text` JSON schema (see ./prompts/schema.ts).
//
// Pitfall 11 (02-RESEARCH): clack version drift would break tier-contract
// tests if both paths went through clack — the numbered path stays
// dependency-free for exactly this reason.
//
// ARCH-11 boundary: ask() itself never short-circuits on --yolo. Approval
// decisions go through the ONE gate registry, bin/lib/gates.ts runGate (RUN-28,
// PRD §7.20), which owns the --yolo and no-terminal policy of every gate. Only
// gates.ts and content-question verbs (sketch; intake from GRND-02) may import
// ask() — the gate-registry chokepoint (scripts/chokepoints/gate-registry.json).
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

export function resolveMode(opts?: AskOptions): 'clack' | 'numbered' {
  const explicit = opts?.mode ?? (process.env['PENSMITH_PROMPT_MODE'] as AskOptions['mode'] | undefined);
  if (explicit === 'clack' || explicit === 'numbered') return explicit;
  // auto (RUN-12): clack only when stdin, stdout AND stderr are all terminals.
  // Answers piped into a terminal session (`printf 'y\n' | pensmith …`) use the
  // numbered prompts, which read one line per question from stdin.
  const isTty = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
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
