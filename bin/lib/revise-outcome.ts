// bin/lib/revise-outcome.ts — why the last revise of a section changed nothing.
//
// The router sends a section that failed on a repairable citation to `plan N
// --revise`. When that revise ends with DRAFT.md unchanged (the patch was
// refused, the model's proposal could not be used, or the user rejected the
// change), running it again from bare `pensmith` would only pay for another
// proposal, often refused the same way. runRevise records the outcome here,
// bound to the DRAFT.md and VERIFICATION.json it was about; while both are
// unchanged the router stops at attention with the reason instead. An applied
// change, or a new proposal waiting for approval, removes the record.

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile, removePath } from './atomic-write.js';
import { sectionDraft, sectionReviseOutcome, sectionVerificationRecord } from './paths.js';
import { HEX64, sha256 } from './verify/verification-record.js';

export const ReviseOutcomeSchema = z.object({
  $schemaVersion: z.literal(1),
  recorded_at: z.string().min(1),
  /** The DRAFT.md the revise left as it was. */
  draft_sha256: HEX64,
  /** The VERIFICATION.json it read the failing citation from (null: none). */
  verification_sha256: HEX64.nullable(),
  /** The citation it tried to repair. */
  citekey: z.string().min(1),
  /** refused: the change could not be applied or used; rejected: the user said no. */
  outcome: z.enum(['refused', 'rejected']),
  reason: z.string().min(1),
}).strict();

export type ReviseOutcome = z.infer<typeof ReviseOutcomeSchema>;

/** The hash of the bytes at `file`, or null when it cannot be read. */
function hashOf(file: string): string | null {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

/** One line of at most `max` characters: a reason may quote a model's answer. */
function short(text: string, max = 240): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Record that revising section `n` left DRAFT.md as it is now. */
export async function recordReviseOutcome(
  paperRoot: string,
  n: number,
  slug: string,
  outcome: { citekey: string; outcome: ReviseOutcome['outcome']; reason: string },
): Promise<void> {
  const draft = hashOf(sectionDraft(n, slug, paperRoot));
  if (draft === null) return;
  const record: ReviseOutcome = {
    $schemaVersion: 1,
    recorded_at: new Date().toISOString(),
    draft_sha256: draft,
    verification_sha256: hashOf(sectionVerificationRecord(n, slug, paperRoot)),
    citekey: outcome.citekey,
    outcome: outcome.outcome,
    reason: short(outcome.reason) || 'no reason was given',
  };
  await atomicWriteFile(sectionReviseOutcome(n, slug, paperRoot), `${JSON.stringify(ReviseOutcomeSchema.parse(record), null, 2)}\n`);
}

/** Remove the record: the draft changed, or a new proposal is waiting. */
export async function clearReviseOutcome(paperRoot: string, n: number, slug: string): Promise<void> {
  await removePath(sectionReviseOutcome(n, slug, paperRoot));
}

/**
 * The recorded outcome when it is still about `draft` and `verification`
 * (the bytes of DRAFT.md and VERIFICATION.json now), else null. Never throws.
 */
export function currentReviseOutcome(
  paperRoot: string,
  n: number,
  slug: string,
  draft: Buffer,
  verification: Buffer | null,
): ReviseOutcome | null {
  try {
    const file = sectionReviseOutcome(n, slug, paperRoot);
    if (!existsSync(file)) return null;
    const parsed = ReviseOutcomeSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return null;
    const r = parsed.data;
    if (r.draft_sha256 !== sha256(draft)) return null;
    if (r.verification_sha256 !== (verification === null ? null : sha256(verification))) return null;
    return r;
  } catch {
    return null;
  }
}
