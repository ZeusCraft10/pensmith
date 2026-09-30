// bin/lib/compile-inputs.ts — what a compile was made from (review round 2 of
// Phase 18; GRND-18; v2 Phase 20, VRFY-27).
//
// compile writes `.paper/COMPILE-INPUTS.json` next to `.paper/DRAFT.md`: the
// sections it compiled ((n, suffix) order, id and slug), the sha256 of each
// section's DRAFT.md and VERIFICATION.md at that moment and each section's
// `verified_against_draft_hash`, and the sha256 of the DRAFT.md it wrote. The
// router's "is the compiled draft current?" check compares those hashes and
// that section list with the paper as it is now (the registered sections,
// their files' bytes), so the decision follows the CONTENT: a git checkout, a
// sync client or the --dry-run workspace seed that rewrites mtimes no longer
// sends a finished paper back to compile, and a section added, dropped,
// re-drafted or re-verified since the compile always does. done refuses a
// compiled DRAFT.md whose bytes differ from the recorded hash (a hand edit)
// and a section whose verified hash changed since the compile (VRFY-27).
//
// Never throws on read (the router is total); a missing or unreadable record
// (a paper compiled by an older pensmith) makes the router fall back to its
// mtime comparison. A v1 record is migrated in memory
// (migrations/compile-inputs/v1_to_v2.ts): its unknown hashes are null, which
// done reads as stale.

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
import { migrate as v1ToV2 } from './migrations/compile-inputs/v1_to_v2.js';

/** The record's file name in the paper folder. */
export const COMPILE_INPUTS_FILE = 'COMPILE-INPUTS.json';

/** `<root>/.paper/COMPILE-INPUTS.json`. */
export function compileInputsPath(paperRoot: string): string {
  return join(paperDir(paperRoot), COMPILE_INPUTS_FILE);
}

/** sha256 of a file's bytes, '' when it is absent or unreadable. Never throws. */
export function fileSha256(file: string): string {
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

/** A section's current file hashes (its id, slug, DRAFT.md and VERIFICATION.md sha256). Never throws. */
export function currentSectionInputs(paperRoot: string, s: SectionRef): Omit<CompileInputsSection, 'verified_against_draft_hash'> {
  return {
    id: formatSectionId(sectionIdOf(s.n, s.suffix)),
    slug: s.slug,
    draft_sha256: fileSha256(sectionDraft(s.n, s.slug, paperRoot)),
    verification_sha256: fileSha256(sectionVerification(s.n, s.slug, paperRoot)),
  };
}

/** What compile adds to the record in v2. */
export interface CompileInputsV2Fields {
  /** sha256 of the `.paper/DRAFT.md` bytes compile wrote. */
  readonly compiledDraftSha256: string;
  /** Section id → the verified_against_draft_hash the section had when compiled. */
  readonly verifiedHashes: ReadonlyMap<string, string>;
}

/** Write the record of the sections a compile just used (compile's lock is held). */
export async function writeCompileInputs(
  paperRoot: string,
  sections: readonly SectionRef[],
  compiledAt: string,
  v2: CompileInputsV2Fields,
): Promise<void> {
  const record: CompileInputs = CompileInputsSchema.parse({
    $schemaVersion: COMPILE_INPUTS_SCHEMA_VERSION,
    compiled_at: compiledAt,
    compiled_draft_sha256: v2.compiledDraftSha256,
    sections: sortBySectionId(sections.map((s) => ({ ...sectionIdOf(s.n, s.suffix), slug: s.slug }))).map((s) => {
      const cur = currentSectionInputs(paperRoot, s);
      return { ...cur, verified_against_draft_hash: v2.verifiedHashes.get(cur.id) ?? null };
    }),
  });
  await atomicWriteFile(compileInputsPath(paperRoot), JSON.stringify(record, null, 2) + '\n');
}

/** The record (a v1 file migrated in memory), or null when it is absent or does not parse. Never throws. */
export function readCompileInputs(paperRoot: string): CompileInputs | null {
  try {
    let value: unknown = JSON.parse(readFileSync(compileInputsPath(paperRoot), 'utf8'));
    const version = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['$schemaVersion'] : undefined;
    if (version === 1) value = v1ToV2(value);
    const parsed = CompileInputsSchema.safeParse(value);
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

/**
 * Why the compiled DRAFT.md cannot be exported as it is (VRFY-27), one line
 * each — empty when it is exactly what compile wrote from the sections as they
 * are now. `current` maps each registered section's id to its PLAN.md
 * verified_against_draft_hash now (null when it has none). Never throws.
 */
export function compileRecordProblems(
  paperRoot: string,
  registered: readonly SectionRef[],
  current: ReadonlyMap<string, string | null>,
): string[] {
  const record = readCompileInputs(paperRoot);
  if (record === null) {
    return ['stale: .paper/DRAFT.md has no compile record (COMPILE-INPUTS.json) — recompile with `pensmith compile`'];
  }
  const out: string[] = [];
  if (record.compiled_draft_sha256 === null) {
    out.push('stale: .paper/DRAFT.md was compiled by an older pensmith that recorded no hash of it — recompile with `pensmith compile`');
  } else if (fileSha256(join(paperDir(paperRoot), 'DRAFT.md')) !== record.compiled_draft_sha256) {
    out.push(
      'stale: .paper/DRAFT.md changed since compile — make the edit in the section drafts (then `pensmith verify <N>`) and recompile with `pensmith compile`; ' +
        'a recompile replaces the edited file',
    );
  }
  const now = sortBySectionId(registered.map((s) => ({ ...sectionIdOf(s.n, s.suffix), slug: s.slug })));
  const ids = (xs: ReadonlyArray<{ id: string; slug: string }>): string => xs.map((x) => `§${x.id} ${x.slug}`).join(', ');
  const nowIds = now.map((s) => ({ id: formatSectionId(sectionIdOf(s.n, s.suffix)), slug: s.slug }));
  if (ids(nowIds) !== ids(record.sections)) {
    out.push(`stale: the compiled draft holds ${ids(record.sections) || 'no sections'}, the paper has ${ids(nowIds) || 'no sections'} — recompile with \`pensmith compile\``);
    return out;
  }
  for (const s of record.sections) {
    const verified = current.get(s.id) ?? null;
    if (s.verified_against_draft_hash === null || verified === null || verified !== s.verified_against_draft_hash) {
      out.push(`stale: §${s.id} was verified again or changed since compile — recompile with \`pensmith compile\``);
    }
  }
  return out;
}
