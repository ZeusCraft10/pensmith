// bin/lib/verb-outcome.ts — map a verb's outcome to the documented exit code
// (RUN-09, RUN-12, D-17-34). ONE classification shared by the Tier-2
// dispatcher (bin/pensmith.ts dispatch()) and the Tier-1 MCP tools
// (mcp/tools.ts), so a refusal is EXIT_BLOCKED in the CLI and an `isError`
// result carrying `exit_code: 4` over MCP (tests/tier-contract/exit-parity).
//
// Verbs report in one of three ways, in priority order:
//   1. throw a PensmithError (or a subclass: GateRefusedError, SessionLockedError,
//      provider errors, …) — its exitCode, printed as one line;
//   2. set process.exitCode explicitly (a verb that already knows its code);
//   3. return `{ ok, blocked?, refused?, exitCode? }` — mapped below.

import {
  EXIT_OK,
  EXIT_ERROR,
  EXIT_USAGE,
  EXIT_APPROVAL,
  EXIT_BLOCKED,
  EXIT_CODES,
  isPensmithError,
  type ExitCode,
} from './exit-codes.js';
import { PromptAbortedError, PromptTimeoutError } from './prompts.js';

const VALID: ReadonlySet<number> = new Set(EXIT_CODES.map((c) => c.code));

export function isExitCode(v: unknown): v is ExitCode {
  return typeof v === 'number' && VALID.has(v);
}

/** The EXIT_* name of a code ("EXIT_BLOCKED"), for MCP payloads and messages. */
export function exitCodeName(code: ExitCode): string {
  return EXIT_CODES.find((c) => c.code === code)?.name ?? 'EXIT_ERROR';
}

/**
 * The exit code a verb's RETURN VALUE implies:
 *   - an explicit `exitCode` field wins;
 *   - `blocked: true` or `refused: true` → EXIT_BLOCKED (verifier / gate refusal);
 *   - `ok: false` → EXIT_ERROR;
 *   - anything else → EXIT_OK.
 */
export function exitCodeForResult(result: unknown): ExitCode {
  if (!result || typeof result !== 'object') return EXIT_OK;
  const r = result as Record<string, unknown>;
  if (isExitCode(r['exitCode'])) return r['exitCode'];
  if (r['ok'] !== false) return EXIT_OK;
  if (r['blocked'] === true || r['refused'] === true) return EXIT_BLOCKED;
  return EXIT_ERROR;
}

/**
 * The final code for a verb that returned normally: an explicit non-zero
 * `process.exitCode` set by the verb wins over the result mapping.
 */
export function finalExitCode(result: unknown, presetExitCode: unknown): ExitCode {
  const preset = typeof presetExitCode === 'string' ? Number(presetExitCode) : presetExitCode;
  if (isExitCode(preset) && preset !== EXIT_OK) return preset;
  if (typeof preset === 'number' && preset !== 0) return EXIT_ERROR;
  return exitCodeForResult(result);
}

/** citty's own usage errors (unknown sub-command, missing positional, bad enum). */
export function isCittyUsageError(e: unknown): boolean {
  return e instanceof Error && e.name === 'CLIError';
}

export interface ClassifiedFailure {
  readonly code: ExitCode;
  /** One line, no stack trace. */
  readonly message: string;
  /** True for an unexpected error (print the PENSMITH_DEBUG hint). */
  readonly unexpected: boolean;
}

function oneLine(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** Classify a thrown value (see the module header). Never throws. */
export function classifyFailure(e: unknown): ClassifiedFailure {
  if (isPensmithError(e)) return { code: e.exitCode, message: oneLine(e.message), unexpected: false };
  if (e instanceof PromptAbortedError) {
    return { code: EXIT_APPROVAL, message: `no answer for "${e.id}" (input ended) — nothing was changed`, unexpected: false };
  }
  if (e instanceof PromptTimeoutError) {
    return { code: EXIT_APPROVAL, message: `no answer for "${e.id}" within ${e.timeoutMs} ms — nothing was changed`, unexpected: false };
  }
  if (isCittyUsageError(e)) {
    // citty colours option names in messages; strip ANSI for a plain line.
    return { code: EXIT_USAGE, message: oneLine(stripAnsi((e as Error).message)), unexpected: false };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: EXIT_ERROR, message: oneLine(msg) || 'unexpected error', unexpected: true };
}

/**
 * The one stderr line for a classified failure. Messages that already name
 * their origin (`pensmith research: …`, `pensmith add: …`) are printed as they
 * are; every other message gets the `pensmith: ` prefix — never both.
 */
export function failureLine(message: string): string {
  return /^pensmith[\s:]/.test(message) ? message : `pensmith: ${message}`;
}

/** A verb or tool call's classified outcome (the MCP `isError` payload source). */
export interface ClassifiedOutcome {
  /** The return value (null when it threw). */
  readonly result: unknown;
  readonly exitCode: ExitCode;
  /** The EXIT_* name of exitCode. */
  readonly classification: string;
  /** The one-line failure message when it threw, else null. */
  readonly message: string | null;
  readonly isError: boolean;
}

/**
 * Run `fn` and classify its outcome exactly as the CLI dispatcher would: a
 * thrown failure by classifyFailure, a returned value by exitCodeForResult.
 * Used by the MCP tools (RUN-09: "MCP tools return isError with the same
 * classification"). A verb that sets process.exitCode must not leak it into a
 * long-lived server process, so the previous value is restored.
 */
export async function runClassified(fn: () => Promise<unknown>): Promise<ClassifiedOutcome> {
  const saved = process.exitCode;
  try {
    const result = await fn();
    const exitCode = exitCodeForResult(result);
    return { result, exitCode, classification: exitCodeName(exitCode), message: null, isError: exitCode !== EXIT_OK };
  } catch (e) {
    const failure = classifyFailure(e);
    return {
      result: null,
      exitCode: failure.code,
      classification: exitCodeName(failure.code),
      message: failure.message,
      isError: true,
    };
  } finally {
    process.exitCode = saved;
  }
}

const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

/** Remove ANSI colour codes (citty colours usage text and some messages). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}
