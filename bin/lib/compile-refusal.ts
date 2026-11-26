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

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile, removePath } from './atomic-write.js';
import { compileRefusalPath } from './paths.js';
import { HEX64, sha256 } from './verify/verification-record.js';

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

export type RefusedSection = z.infer<typeof RefusedSectionSchema>;

/** Keep the sections whose re-check failed; none removes the record. */
export async function writeCompileRefusal(paperRoot: string, sections: RefusedSection[]): Promise<void> {
  if (sections.length === 0) {
    await removePath(compileRefusalPath(paperRoot));
    return;
  }
  const record = CompileRefusalSchema.parse({ $schemaVersion: 1, refused_at: new Date().toISOString(), sections });
  await atomicWriteFile(compileRefusalPath(paperRoot), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Why compile refused section `n` (`slug`) whose DRAFT.md and VERIFICATION.json
 * are `draft` and `verification` now, or null when it did not (or either has
 * changed since). Never throws.
 */
export function compileRefusalOf(
  paperRoot: string,
  n: number,
  slug: string,
  draft: Buffer,
  verification: Buffer | null,
): RefusedSection | null {
  if (verification === null) return null;
  try {
    const file = compileRefusalPath(paperRoot);
    if (!existsSync(file)) return null;
    const parsed = CompileRefusalSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return null;
    const hit = parsed.data.sections.find((s) => s.n === n && s.slug === slug);
    if (!hit || hit.draft_sha256 !== sha256(draft) || hit.verification_sha256 !== sha256(verification)) return null;
    return hit;
  } catch {
    return null;
  }
}
