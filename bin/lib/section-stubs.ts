// bin/lib/section-stubs.ts — outline approval's side effects on the section
// folders (GRND-09, D-18-16, D-18-17, D-18-18).
//
//   - numberFreshOutline: a first outline is numbered 1..N in the order the
//     model lists its sections (the model's own `n` is not trusted).
//   - planReoutline: a re-outline matches sections BY SLUG. A kept slug keeps
//     its number, letter and folder — every file in it stays byte- and
//     mtime-identical. A new section gets the previous section's number plus
//     the next free letter when a kept section follows it (after §1 → §1a,
//     folder `01a-<slug>/`); the next integer after every kept section when
//     none follows; the largest free integer below the first kept section
//     when it comes first (an issue when none is free). A dropped section
//     leaves STATE.json and OUTLINE.md and its folder moves to
//     `sections/_archive/`. No folder is ever renamed or renumbered.
//   - registerSections: registers each section in STATE.json (initSection is
//     idempotent by slug) and writes a stub PLAN.md into every section folder
//     that has none (`stub: true`, `status: planned`, the outline entry). An
//     existing PLAN.md is never touched.
//   - archiveSection: moves a dropped section's folder into
//     `sections/_archive/` (a timestamp suffix when that name is taken) and
//     removes it from STATE.json.
//
// The same helpers back the Tier-1 outline registration tool (PLUG-07).

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { findSectionFolder, newSectionFolder, sectionArchiveDir } from './paths.js';
import { initSection, initState, loadState, removeSection, StateAlreadyExistsError, StateNotFoundError } from './state.js';
import { renderStubPlanMd } from './plan-render.js';
import { compareSectionIds, formatSectionId, MAX_SECTION_NUMBER, sectionIdOf, type SectionId } from './section-id.js';
import type { OutlineIssue } from './outline-validate.js';

/** One outline section as the model proposed it (OutlineSchema's section, minus trust in `n`). */
export interface ProposedSection {
  slug: string;
  title: string;
  purpose: string;
  depends_on: string[];
  estimated_word_count: number;
  assigned_sources: string[];
  role: string;
  voice?: string | undefined;
}

/** A numbered section: ready to render into OUTLINE.md and to register. */
export interface OutlineSectionEntry extends ProposedSection {
  n: number;
  suffix?: string | undefined;
}

/** A section the paper already has (STATE.json), with its PLAN.md allocation when known. */
export interface ExistingSection {
  readonly n: number;
  readonly suffix?: string | undefined;
  readonly slug: string;
  /** The kept section's PLAN.md `assigned_sources` (the authoritative map, FEED-04). */
  readonly assignedSources?: readonly string[] | undefined;
}

function entryOf(p: ProposedSection, id: SectionId): OutlineSectionEntry {
  const out: OutlineSectionEntry = { ...p, n: id.n };
  if (id.suffix !== undefined) out.suffix = id.suffix;
  else delete out.suffix;
  return out;
}

/** A first outline: sections numbered 1..N in the order listed. */
export function numberFreshOutline(proposed: readonly ProposedSection[]): OutlineSectionEntry[] {
  return proposed.map((p, i) => entryOf(p, { n: i + 1 }));
}

export interface ReoutlinePlan {
  /** Every section of the new outline with its id, in the model's order. */
  readonly sections: OutlineSectionEntry[];
  /** Slugs kept from the paper (their folders are untouched). */
  readonly kept: string[];
  /** Slugs new to the paper (they get new folders and stub PLAN.md files). */
  readonly added: string[];
  /** Sections the new outline drops (their folders move to `sections/_archive/`). */
  readonly dropped: ExistingSection[];
  /** True when the kept sections are not listed in their numbers' order. */
  readonly reordered: boolean;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The next free letter for §n after `after` ('' = none) and before `before` (exclusive; null = no bound). */
function freeLetter(n: number, after: string, before: string | null, used: ReadonlySet<string>): string | null {
  for (const letter of LETTERS) {
    if (letter <= after) continue;
    if (before !== null && letter >= before) break;
    if (!used.has(`${n}${letter}`)) return letter;
  }
  return null;
}

/** Number a re-outline by slug (D-18-18). Issues instead of a plan when a new section cannot be numbered. */
export function planReoutline(
  existing: readonly ExistingSection[],
  proposed: readonly ProposedSection[],
): { plan: ReoutlinePlan | null; issues: OutlineIssue[] } {
  const bySlug = new Map(existing.map((e) => [e.slug, e]));
  const proposedSlugs = new Set(proposed.map((p) => p.slug));
  const used = new Set<string>();
  for (const e of existing) if (proposedSlugs.has(e.slug)) used.add(formatSectionId(sectionIdOf(e.n, e.suffix)));

  const sections: OutlineSectionEntry[] = [];
  const issues: OutlineIssue[] = [];
  const kept: string[] = [];
  const added: string[] = [];
  for (let i = 0; i < proposed.length; i += 1) {
    const p = proposed[i] as ProposedSection;
    const keep = bySlug.get(p.slug);
    if (keep !== undefined) {
      const entry = entryOf(p, sectionIdOf(keep.n, keep.suffix));
      // FEED-04: a kept section's PLAN.md is the authoritative source map.
      if (keep.assignedSources !== undefined) entry.assigned_sources = [...keep.assignedSources];
      sections.push(entry);
      kept.push(p.slug);
      continue;
    }
    const prev = sections[sections.length - 1];
    const nextKept = proposed.slice(i + 1).map((q) => bySlug.get(q.slug)).find((e): e is ExistingSection => e !== undefined);
    let id: SectionId | null = null;
    let why = '';
    if (prev !== undefined && nextKept !== undefined) {
      const before = nextKept.n === prev.n ? (nextKept.suffix ?? '') : null;
      const letter = before === '' ? null : freeLetter(prev.n, prev.suffix ?? '', before, used);
      if (letter !== null) id = { n: prev.n, suffix: letter };
      else why = `there is no free section number between §${formatSectionId(sectionIdOf(prev.n, prev.suffix))} and §${formatSectionId(sectionIdOf(nextKept.n, nextKept.suffix))}`;
    } else if (nextKept === undefined) {
      const maxN = Math.max(0, ...sections.map((s) => s.n), ...existing.filter((e) => proposedSlugs.has(e.slug)).map((e) => e.n));
      let n = maxN + 1;
      while (used.has(String(n))) n += 1;
      if (n <= MAX_SECTION_NUMBER) id = { n };
      else why = `section numbers stop at ${MAX_SECTION_NUMBER}`;
    } else {
      for (let n = nextKept.n - 1; n >= 1; n -= 1) {
        if (!used.has(String(n))) {
          id = { n };
          break;
        }
      }
      if (id === null) why = `it comes before §${formatSectionId(sectionIdOf(nextKept.n, nextKept.suffix))} and no lower section number is free`;
    }
    if (id === null) {
      issues.push({ code: 'unnumberable-section', message: `new section "${p.slug}" cannot be numbered: ${why}; place it after an existing section` });
      continue;
    }
    used.add(formatSectionId(id));
    sections.push(entryOf(p, id));
    added.push(p.slug);
  }
  const keptIds = sections.filter((s) => kept.includes(s.slug)).map((s) => sectionIdOf(s.n, s.suffix));
  const reordered = keptIds.some((id, i) => i > 0 && compareSectionIds(keptIds[i - 1] as SectionId, id) > 0);
  const dropped = existing.filter((e) => !proposedSlugs.has(e.slug));
  if (issues.length > 0) return { plan: null, issues };
  return { plan: { sections, kept, added, dropped, reordered }, issues };
}

/** Make sure STATE.json exists (intake normally seeds it). */
async function ensureState(root: string): Promise<void> {
  try {
    await loadState(root);
  } catch (e) {
    if (!(e instanceof StateNotFoundError)) throw e;
    try {
      await initState(root);
    } catch (e2) {
      if (!(e2 instanceof StateAlreadyExistsError)) throw e2;
    }
  }
}

export interface RegisterResult {
  /** Sections registered (or already registered) in STATE.json. */
  readonly registered: number;
  /** Stub PLAN.md files written (sections that had none). */
  readonly stubsWritten: number;
}

/**
 * Register `sections` in STATE.json and give every section folder without a
 * PLAN.md its stub (D-18-17). Existing PLAN.md files are never touched; a
 * section's folder is created once, with its final name (`NN[a]-<slug>`).
 */
export async function registerSections(
  root: string,
  sections: readonly OutlineSectionEntry[],
  opts: { marker?: string | null } = {},
): Promise<RegisterResult> {
  await ensureState(root);
  let stubsWritten = 0;
  for (const s of sections) {
    await initSection(root, s.n, s.slug, s.suffix);
    const folder = findSectionFolder(s.slug, root, s.n) ?? newSectionFolder(s.n, s.slug, root, s.suffix);
    const planPath = path.join(folder, 'PLAN.md');
    if (existsSync(planPath)) continue;
    mkdirSync(folder, { recursive: true });
    await atomicWriteFile(
      planPath,
      renderStubPlanMd(
        {
          section: s.n,
          suffix: s.suffix,
          slug: s.slug,
          title: s.title,
          purpose: s.purpose,
          role: s.role,
          depends_on: s.depends_on,
          word_target: s.estimated_word_count,
          voice: s.voice,
          assigned_sources: s.assigned_sources,
        },
        opts,
      ),
    );
    stubsWritten += 1;
  }
  return { registered: sections.length, stubsWritten };
}

/** A timestamp safe in a folder name on every platform. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Move the folder of the section `slug` into `sections/_archive/` and remove
 * the section from STATE.json (a re-outline dropped it). Returns the archive
 * path, or null when the section had no folder.
 */
export async function archiveSection(root: string, slug: string, now: Date = new Date()): Promise<string | null> {
  const folder = findSectionFolder(slug, root);
  let target: string | null = null;
  if (folder !== null) {
    const archive = sectionArchiveDir(root);
    mkdirSync(archive, { recursive: true });
    const name = path.basename(folder);
    target = path.join(archive, name);
    if (existsSync(target)) target = path.join(archive, `${name}-${stamp(now)}`);
    renameSync(folder, target);
  }
  await removeSection(root, slug);
  return target;
}
