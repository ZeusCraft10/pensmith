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
import { compileManifestPath, SLUG_RE } from './paths.js';
import { bibEntryHashes, HEX64 } from './verify/verification-record.js';
import type { Bib } from './verify/pass1.js';

// done joins n and slug into the section's paths, so they must name a folder
// under .paper/sections (the rule paths.ts's validateSlug applies).
const ManifestSectionSchema = z.object({
  n: z.number().int().min(1).max(99),
  slug: z.string().regex(SLUG_RE),
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

/** The manifest's `bib_entries`: the entry hash of each of `keys` that CITATIONS.bib holds. */
export function manifestBibEntries(keys: Iterable<string>, bib: Bib): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, hash] of Object.entries(bibEntryHashes(keys, bib))) {
    if (hash !== null) out[key] = hash;
  }
  return out;
}

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
