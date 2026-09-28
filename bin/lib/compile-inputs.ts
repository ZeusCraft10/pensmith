// bin/lib/compile-inputs.ts — what a compile was made from (review round 2 of
// Phase 18; GRND-18).
//
// compile writes `.paper/COMPILE-INPUTS.json` next to `.paper/DRAFT.md`: the
// sections it compiled ((n, suffix) order, id and slug) and the sha256 of each
// section's DRAFT.md and VERIFICATION.md at that moment. The router's "is the
// compiled draft current?" check compares those hashes and that section list
// with the paper as it is now (the registered sections, their files' bytes), so
// the decision follows the CONTENT: a git checkout, a sync client or the
// --dry-run workspace seed that rewrites mtimes no longer sends a finished paper
// back to compile, and a section added, dropped, re-drafted or re-verified
// since the compile always does.
//
// Never throws on read (the router is total); a missing or unreadable record
// (a paper compiled by an older pensmith) makes the router fall back to its
// mtime comparison.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { paperDir, sectionDraft, sectionVerification } from './paths.js';
import { formatSectionId, sectionIdOf, sortBySectionId } from './section-id.js';
import {
  COMPILE_INPUTS_SCHEMA_VERSION,
  CompileInputsSchema,
  type CompileInputs,
  type CompileInputsSection,
} from './schemas/compile-inputs.js';

/** The record's file name in the paper folder. */
export const COMPILE_INPUTS_FILE = 'COMPILE-INPUTS.json';

/** `<root>/.paper/COMPILE-INPUTS.json`. */
export function compileInputsPath(paperRoot: string): string {
  return join(paperDir(paperRoot), COMPILE_INPUTS_FILE);
}

/** sha256 of a file's bytes, '' when it is absent or unreadable. Never throws. */
function fileSha256(file: string): string {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

interface SectionRef {
  readonly n: number;
  readonly suffix?: string | undefined;
  readonly slug: string;
}

/** A section's current record entry (its id, slug and file hashes). Never throws. */
export function currentSectionInputs(paperRoot: string, s: SectionRef): CompileInputsSection {
  return {
    id: formatSectionId(sectionIdOf(s.n, s.suffix)),
    slug: s.slug,
    draft_sha256: fileSha256(sectionDraft(s.n, s.slug, paperRoot)),
    verification_sha256: fileSha256(sectionVerification(s.n, s.slug, paperRoot)),
  };
}

/** Write the record of the sections a compile just used (compile's lock is held). */
export async function writeCompileInputs(paperRoot: string, sections: readonly SectionRef[], compiledAt: string): Promise<void> {
  const record: CompileInputs = CompileInputsSchema.parse({
    $schemaVersion: COMPILE_INPUTS_SCHEMA_VERSION,
    compiled_at: compiledAt,
    sections: sortBySectionId(sections.map((s) => ({ ...sectionIdOf(s.n, s.suffix), slug: s.slug }))).map((s) =>
      currentSectionInputs(paperRoot, s),
    ),
  });
  await atomicWriteFile(compileInputsPath(paperRoot), JSON.stringify(record, null, 2) + '\n');
}

/** The record, or null when it is absent or does not parse. Never throws. */
export function readCompileInputs(paperRoot: string): CompileInputs | null {
  try {
    const parsed = CompileInputsSchema.safeParse(JSON.parse(readFileSync(compileInputsPath(paperRoot), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Is the compiled draft current for `registered` (the sections the paper has
 * now)? true / false from the record; null when there is no usable record.
 * Current means: the same sections (ids and slugs) and, for each, the same
 * DRAFT.md and VERIFICATION.md bytes as when compile ran. Never throws.
 */
export function compiledInputsCurrent(paperRoot: string, registered: readonly SectionRef[]): boolean | null {
  const record = readCompileInputs(paperRoot);
  if (record === null) return null;
  const now = sortBySectionId(registered.map((s) => ({ ...sectionIdOf(s.n, s.suffix), slug: s.slug })));
  if (now.length !== record.sections.length) return false;
  for (let i = 0; i < now.length; i += 1) {
    const was = record.sections[i] as CompileInputsSection;
    const is = currentSectionInputs(paperRoot, now[i] as SectionRef);
    if (was.id !== is.id || was.slug !== is.slug || was.draft_sha256 !== is.draft_sha256 || was.verification_sha256 !== is.verification_sha256) {
      return false;
    }
  }
  return true;
}
