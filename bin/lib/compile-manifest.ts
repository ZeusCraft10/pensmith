// bin/lib/compile-manifest.ts — what the last compile was built from.
//
// compile writes .paper/COMPILE-MANIFEST.json beside the manuscript it
// writes: the SHA-256 of .paper/DRAFT.md, of each section's DRAFT.md and
// VERIFICATION.json, and of each CITATIONS.bib entry the manuscript cites.
// done checks every one of them against the files before it exports, so a
// manuscript edited after compile, a section redone without a recompile, or a
// bibliography entry pointed at another work is refused, not exported.

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';
import { compileManifestPath } from './paths.js';

const HEX64 = z.string().regex(/^[0-9a-f]{64}$/);

const ManifestSectionSchema = z.object({
  n: z.number().int().min(1),
  slug: z.string().min(1),
  draft_sha256: HEX64,
  verification_sha256: HEX64,
  /** compile re-checked the section because it changed after verify. */
  re_verified: z.boolean(),
}).strict();

export const CompileManifestSchema = z.object({
  $schemaVersion: z.literal(1),
  compiled_at: z.string().min(1),
  /** .paper/DRAFT.md, as compile wrote it. */
  draft_sha256: HEX64,
  sections: z.array(ManifestSectionSchema),
  /** Each key the manuscript cites → the hash of its CITATIONS.bib entry (bibEntryHashes). */
  bib_entries: z.record(z.string(), HEX64),
}).strict();

export type CompileManifest = z.infer<typeof CompileManifestSchema>;
export type ManifestSection = z.infer<typeof ManifestSectionSchema>;

export async function writeCompileManifest(paperRoot: string, manifest: CompileManifest): Promise<void> {
  await atomicWriteFile(compileManifestPath(paperRoot), `${JSON.stringify(CompileManifestSchema.parse(manifest), null, 2)}\n`);
}

/** The manifest of the last compile, or why there is none to trust. Never throws. */
export function readCompileManifest(paperRoot: string): { ok: true; manifest: CompileManifest } | { ok: false; why: string } {
  const file = compileManifestPath(paperRoot);
  if (!existsSync(file)) return { ok: false, why: 'no .paper/COMPILE-MANIFEST.json' };
  try {
    const parsed = CompileManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? { ok: true, manifest: parsed.data } : { ok: false, why: '.paper/COMPILE-MANIFEST.json does not match its schema' };
  } catch {
    return { ok: false, why: '.paper/COMPILE-MANIFEST.json could not be read' };
  }
}
