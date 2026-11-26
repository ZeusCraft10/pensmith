// bin/lib/failure.ts — a failed model call, in the plain words the CLI prints.
//
// The dispatcher prints an unhandled one this way, and a wave write prints
// each section's the same way, so a refusal reads the same on both paths.

import { EXIT_REFUSED } from './exit-codes.js';
import { GenerationError } from './generator.js';
import { CostCapExceededError } from './budget.js';

/**
 * `e` as a line and an exit code, when it is a model call refused over the
 * cost cap or one that gave no usable answer (cut off, declined, the provider
 * failing); null for anything else.
 */
export function describeModelFailure(e: unknown): { text: string; exitCode: number } | null {
  if (!(e instanceof GenerationError || e instanceof CostCapExceededError)) return null;
  return { text: `${e.exitCode === EXIT_REFUSED ? 'REFUSED' : 'ERROR'} — ${e.message}`, exitCode: e.exitCode };
}
