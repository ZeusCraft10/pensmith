// bin/lib/compile-refusal.ts — the verified sections compile's re-check refused.
//
// The router counts a verified section as through while its DRAFT.md is the
// one verify checked; compile then checks it again against the bibliography,
// assigned sources and acknowledgements as they are. When that re-check
// fails, compile refuses, and compile never writes into a section folder, so
// nothing the router reads would change: bare `pensmith` would send the paper
// to the same refused compile every run. compile keeps here which sections
// failed, bound to the DRAFT.md and VERIFICATION.json it checked, and the
// router sends each to `verify N`, which records its verdicts as they are now.

import { z } from 'zod';
import { removePath } from './atomic-write.js';
import { readJsonRecord, writeJsonRecord } from './json-record.js';
import { compileRefusalPath } from './paths.js';
import { HEX64 } from './verify/verification-record.js';

const RefusedSectionSchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().min(1),
  draft_sha256: HEX64,
  verification_sha256: HEX64,
  reasons: z.array(z.string()),
}).strict();

export const CompileRefusalSchema = z.object({
  $schemaVersion: z.literal(1),
  refused_at: z.string().min(1),
  sections: z.array(RefusedSectionSchema),
}).strict();

export type CompileRefusal = z.infer<typeof CompileRefusalSchema>;
export type RefusedSection = z.infer<typeof RefusedSectionSchema>;

/** Keep the sections whose re-check failed; none removes the record. */
export async function writeCompileRefusal(paperRoot: string, sections: RefusedSection[]): Promise<void> {
  if (sections.length === 0) {
    await removePath(compileRefusalPath(paperRoot));
    return;
  }
  await writeJsonRecord(compileRefusalPath(paperRoot), CompileRefusalSchema, { $schemaVersion: 1, refused_at: new Date().toISOString(), sections });
}

/** The sections compile's last re-check refused, or null when there is no record to trust. Never throws. */
export function readCompileRefusal(paperRoot: string): CompileRefusal | null {
  return readJsonRecord(compileRefusalPath(paperRoot), CompileRefusalSchema);
}

/**
 * Why `refusal` says compile refused section `n` (`slug`), whose DRAFT.md and
 * VERIFICATION.json hash to `draftSha256` and `verificationSha256` now, or
 * null when it did not (or either has changed since).
 */
export function refusalFor(
  refusal: CompileRefusal | null,
  n: number,
  slug: string,
  draftSha256: string,
  verificationSha256: string,
): RefusedSection | null {
  const hit = refusal?.sections.find((s) => s.n === n && s.slug === slug);
  return hit && hit.draft_sha256 === draftSha256 && hit.verification_sha256 === verificationSha256 ? hit : null;
}
