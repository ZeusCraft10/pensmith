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
import { migrate as v2ToV3 } from './migrations/compile-inputs/v2_to_v3.js';
import { readOutlineSync } from './outline.js';
import { orderedOutlineSections, outlineSectionId } from './outline-parse.js';
import { readPaperBrief } from './paper-brief.js';

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

/** What compile adds to the record in v2 (and v3). */
export interface CompileInputsV2Fields {
  /** sha256 of the `.paper/DRAFT.md` bytes compile wrote. */
  readonly compiledDraftSha256: string;
  /** Section id → the verified_against_draft_hash the section had when compiled. */
  readonly verifiedHashes: ReadonlyMap<string, string>;
  /**
   * v3: the headingsSha256 of the title and section titles compile wrote.
   * Omitted: computed from the paper's OUTLINE.md as it is now (currentHeadings).
   */
  readonly headingsSha256?: string;
}

// ---------------------------------------------------------------------------
// The compiled paper's headings (EXP-05, D-21-13)
// ---------------------------------------------------------------------------

/** The title and section headings compile writes: `# <title>`, then `## <section title>` in outline order. */
export interface CompileHeadings {
  readonly title: string;
  readonly sections: ReadonlyArray<{ readonly id: string; readonly title: string }>;
}

/** sha256 of the title and the section titles, one per line, in order (the v3 record's headings_sha256). */
export function headingsSha256(h: CompileHeadings): string {
  return createHash('sha256').update([h.title, ...h.sections.map((s) => s.title)].join('\n'), 'utf8').digest('hex');
}

/**
 * The paper title compile writes as `# <title>`: OUTLINE.md's H1, else the
 * brief's title (config.toml [project] title, else the topic). '' when the
 * paper has neither. Never throws.
 */
export function compilePaperTitle(paperRoot: string, outlineTitle: string): string {
  const h1 = outlineTitle.trim();
  if (h1.length > 0) return h1;
  try {
    return readPaperBrief(paperRoot).title.trim();
  } catch {
    return '';
  }
}

/** The headings a compile of the paper's OUTLINE.md as it is now would write, or null without a parseable outline. Never throws. */
export function currentHeadings(paperRoot: string): CompileHeadings | null {
  const outline = readOutlineSync(paperRoot);
  if (outline === null) return null;
  return {
    title: compilePaperTitle(paperRoot, outline.paper_title),
    sections: orderedOutlineSections(outline).map((s) => ({ id: outlineSectionId(s), title: s.title.trim() })),
  };
}

/** Write the record of the sections a compile just used (compile's lock is held). */
export async function writeCompileInputs(
  paperRoot: string,
  sections: readonly SectionRef[],
  compiledAt: string,
  v2: CompileInputsV2Fields,
): Promise<void> {
  const headings = v2.headingsSha256 ?? (() => {
    const h = currentHeadings(paperRoot);
    return h === null ? null : headingsSha256(h);
  })();
  const record: CompileInputs = CompileInputsSchema.parse({
    $schemaVersion: COMPILE_INPUTS_SCHEMA_VERSION,
    compiled_at: compiledAt,
    compiled_draft_sha256: v2.compiledDraftSha256,
    headings_sha256: headings,
    sections: sortBySectionId(sections.map((s) => ({ ...sectionIdOf(s.n, s.suffix), slug: s.slug }))).map((s) => {
      const cur = currentSectionInputs(paperRoot, s);
      return { ...cur, verified_against_draft_hash: v2.verifiedHashes.get(cur.id) ?? null };
    }),
  });
  await atomicWriteFile(compileInputsPath(paperRoot), JSON.stringify(record, null, 2) + '\n');
}

/** The record (a v1 or v2 file migrated in memory), or null when it is absent or does not parse. Never throws. */
export function readCompileInputs(paperRoot: string): CompileInputs | null {
  try {
    let value: unknown = JSON.parse(readFileSync(compileInputsPath(paperRoot), 'utf8'));
    const version = (): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['$schemaVersion'] : undefined);
    if (version() === 1) value = v1ToV2(value);
    if (version() === 2) value = v2ToV3(value);
    const parsed = CompileInputsSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** True when the record's headings are the ones a compile of the paper now would write. */
function headingsCurrent(paperRoot: string, record: CompileInputs): boolean {
  if (record.headings_sha256 === null) return false;
  const now = currentHeadings(paperRoot);
  return now !== null && headingsSha256(now) === record.headings_sha256;
}

/**
 * Is the compiled draft current for `registered` (the sections the paper has
 * now)? true / false from the record; null when there is no usable record.
 * Current means: the same sections (ids and slugs) and, for each, the same
 * DRAFT.md and VERIFICATION.md bytes as when compile ran, and the same title
 * and section titles (v3; a v2 record, compiled without headings, is stale).
 * Never throws.
 */
export function compiledInputsCurrent(paperRoot: string, registered: readonly SectionRef[]): boolean | null {
  const record = readCompileInputs(paperRoot);
  if (record === null) return null;
  if (!headingsCurrent(paperRoot, record)) return false;
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
  if (record.headings_sha256 === null) {
    out.push('stale: .paper/DRAFT.md was compiled before compile wrote the paper title and section headings — recompile with `pensmith compile`');
  } else if (!headingsCurrent(paperRoot, record)) {
    out.push("stale: OUTLINE.md's paper title or section titles changed since compile — recompile with `pensmith compile`");
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
