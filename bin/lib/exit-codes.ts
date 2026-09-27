// bin/lib/exit-codes.ts — the documented pensmith process exit codes (RUN-09,
// S-01) and PensmithError, the base class every expected failure extends so the
// dispatcher can print one actionable line and exit with the right code (RUN-12).
//
// SEAM FILE (Phase 17 plan, verbatim V1). Every Phase 17 stream that needs it
// creates it byte-identically from .planning/phases/17-runtime/17-PLAN.md
// Appendix A. Do not edit it during Phase 17; later phases may extend it.

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_APPROVAL = 3;
export const EXIT_BLOCKED = 4;
export const EXIT_COST_CAP = 5;

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface ExitCodeDoc {
  readonly code: ExitCode;
  readonly name: string;
  readonly meaning: string;
}

/** The documented table (pensmith --help, README, the BRDTH-05 reference card). */
export const EXIT_CODES: readonly ExitCodeDoc[] = Object.freeze([
  { code: EXIT_OK, name: 'EXIT_OK', meaning: 'success' },
  { code: EXIT_ERROR, name: 'EXIT_ERROR', meaning: 'error: a provider failure or refusal, invalid configuration, or an internal error' },
  { code: EXIT_USAGE, name: 'EXIT_USAGE', meaning: 'usage: an unknown verb or flag, invalid arguments, or a missing required input' },
  { code: EXIT_APPROVAL, name: 'EXIT_APPROVAL', meaning: 'approval: a gate needs an answer and there is no terminal and no --yolo, or the user declined' },
  { code: EXIT_BLOCKED, name: 'EXIT_BLOCKED', meaning: 'blocked: the verifier or a gate refused (verify failed, compile REFUSED, done BLOCKED, stale output)' },
  { code: EXIT_COST_CAP, name: 'EXIT_COST_CAP', meaning: 'cost cap: the next model call would exceed the session cost cap' },
] satisfies ExitCodeDoc[]);

/**
 * An expected failure. The dispatcher prints `pensmith: <message>` (one line,
 * never a stack trace) and exits with `exitCode`.
 */
export class PensmithError extends Error {
  readonly exitCode: ExitCode;
  constructor(message: string, exitCode: ExitCode = EXIT_ERROR) {
    super(message);
    this.name = 'PensmithError';
    this.exitCode = exitCode;
  }
}

export function isPensmithError(e: unknown): e is PensmithError {
  return e instanceof PensmithError;
}
