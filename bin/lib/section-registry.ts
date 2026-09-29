// bin/lib/section-registry.ts — ONE authority for section identity (review
// round 2 of Phase 18; D-18-16, GRND-08, GRND-18).
//
// STATE.json registers a paper's sections as {n, suffix?, slug}: that is a
// section's identity, and so its folder `sections/NN[a]-<slug>/`. OUTLINE.md is
// the roadmap: its rows carry each section's title, purpose, role, depends_on,
// word target, sources and voice — and the same ids and slugs. A user may edit
// OUTLINE.md (GRND-08 treats a user-edited outline as supported), so the two
// can disagree: a renamed slug, a deleted or added row, a renumbered row. Every
// consumer resolves identity the same way:
//   - the router reports `status (attention)` naming the divergence and
//     `pensmith outline` instead of re-dispatching a step that would only fail
//     or loop (compile compiling a different set than is registered);
//   - compile refuses with the same reason;
//   - plan / write / verify resolve `<n>` against STATE.json and refuse a
//     section whose OUTLINE row disagrees — they never create a second folder
//     for a registered section number;
//   - `pensmith outline` (no --force) applies an edited OUTLINE.md without a
//     model call (bin/cli/outline.ts).
//
// Synchronous and never-throwing: the router (total, never throws) and the
// section-argument resolver (sync) use it.

import { readStateTextSync, migrateStateValue } from './state.js';
import { Schema as StateSchema } from './schemas/state.js';
import { basename } from 'node:path';
import { readOutlineChecked, readOutlineSync } from './outline.js';
import { paperDir } from './paths.js';
import { formatSectionId, sectionIdOf, sortBySectionId } from './section-id.js';

/** A section's identity: its number, its letter (§1a) when it has one, its slug. */
export interface SectionIdentity {
  readonly n: number;
  readonly suffix?: string | undefined;
  readonly slug: string;
}

/** `1`, `1a`. */
export function identityLabel(s: Pick<SectionIdentity, 'n' | 'suffix'>): string {
  return formatSectionId(sectionIdOf(s.n, s.suffix));
}

/**
 * The sections STATE.json registers, in (n, suffix) order; null when STATE.json
 * is absent or unreadable (the async loaders report that case themselves).
 * Read-only: an older STATE.json is migrated in memory, never rewritten.
 */
export function registeredSectionsSync(paperRoot: string): SectionIdentity[] | null {
  try {
    const state = StateSchema.parse(migrateStateValue(JSON.parse(readStateTextSync(paperRoot))));
    return sortBySectionId((state.sections ?? []).map((s) => (s.suffix !== undefined ? { n: s.n, suffix: s.suffix, slug: s.slug } : { n: s.n, slug: s.slug })));
  } catch {
    return null;
  }
}

/** The (id, slug) of every OUTLINE.md row, or null when OUTLINE.md is absent or has no readable table. */
export function outlineIdentitiesSync(paperRoot: string): SectionIdentity[] | null {
  const doc = readOutlineSync(paperRoot);
  if (doc === null) return null;
  return doc.sections.map((s) => (s.suffix !== undefined ? { n: s.n, suffix: s.suffix, slug: s.slug } : { n: s.n, slug: s.slug }));
}

/**
 * How OUTLINE.md's rows and STATE.json's registrations disagree — one line per
 * problem; empty when they list the same sections with the same ids.
 */
export function sectionRegistryDivergence(
  registered: readonly SectionIdentity[],
  outline: readonly SectionIdentity[],
): string[] {
  const out: string[] = [];
  const regBySlug = new Map(registered.map((s) => [s.slug, s]));
  const regById = new Map(registered.map((s) => [identityLabel(s), s]));
  const rowSlugs = new Set(outline.map((s) => s.slug));
  const claimedIds = new Set<string>();
  for (const row of outline) {
    const id = identityLabel(row);
    const reg = regBySlug.get(row.slug);
    if (reg !== undefined) {
      if (identityLabel(reg) !== id) {
        out.push(`OUTLINE.md numbers "${row.slug}" §${id}, but STATE.json registers it as §${identityLabel(reg)}`);
      }
      continue;
    }
    const holder = regById.get(id);
    if (holder !== undefined && !rowSlugs.has(holder.slug)) {
      claimedIds.add(id);
      out.push(`OUTLINE.md lists §${id} as "${row.slug}", but STATE.json registers §${id} as "${holder.slug}"`);
    } else {
      out.push(`OUTLINE.md lists §${id} "${row.slug}", which STATE.json does not register`);
    }
  }
  for (const reg of registered) {
    if (rowSlugs.has(reg.slug) || claimedIds.has(identityLabel(reg))) continue;
    out.push(`STATE.json registers §${identityLabel(reg)} "${reg.slug}", which OUTLINE.md does not list`);
  }
  return out;
}

/** What to run when OUTLINE.md and STATE.json disagree. */
export const RECONCILE_HINT =
  'run `pensmith outline` to apply the edited OUTLINE.md (a registered section it no longer lists moves to sections/_archive/), ' +
  'or restore the row(s) in OUTLINE.md';

/**
 * What is wrong with the paper's OUTLINE.md itself, or null (review round 3 of
 * Phase 18). A section table that cannot be read names parseOutline's line and
 * the fix — whether or not sections are registered, since `pensmith outline`
 * refuses to overwrite it without --force; a missing OUTLINE.md is a problem
 * only when STATE.json registers sections (it is the authority, D-18-38: they
 * exist, and nothing lists them). A file with no section table at all (notes,
 * a legacy placeholder) is left to its own report, as before: compile's "no
 * usable outline". Never throws.
 */
export function outlineProblem(paperRoot: string): string | null {
  const read = readOutlineChecked(paperRoot);
  const file = `${basename(paperDir(paperRoot))}/OUTLINE.md`;
  if (read.kind === 'invalid') {
    return (
      `${file} cannot be read (${read.error}) — fix that row (\`pensmith outline\` then applies the edited outline), ` +
      'or re-outline it with `pensmith outline --force`'
    );
  }
  if (read.kind === 'absent') {
    const registered = registeredSectionsSync(paperRoot);
    if (registered !== null && registered.length > 0) {
      const ids = registered.map((s) => `§${identityLabel(s)}`).join(', ');
      return (
        `${file} is missing, but STATE.json registers ${ids} — restore it (e.g. from your backup or version control), ` +
        'or re-outline with `pensmith outline --force` (kept sections stay untouched)'
      );
    }
  }
  return null;
}

/**
 * The paper's section-registry problem, or null: OUTLINE.md is missing while
 * sections are registered, unreadable (outlineProblem), or its rows and
 * STATE.json's registrations disagree. Null when nothing is registered yet or
 * STATE.json is unreadable (the router's corrupt-STATE attention reports
 * that). Never throws.
 */
export function sectionRegistryProblem(paperRoot: string): string | null {
  const registered = registeredSectionsSync(paperRoot);
  if (registered === null || registered.length === 0) return null;
  const outline = outlineProblem(paperRoot);
  if (outline !== null) return outline;
  const rows = outlineIdentitiesSync(paperRoot);
  if (rows === null) return null;
  const problems = sectionRegistryDivergence(registered, rows);
  if (problems.length === 0) return null;
  return `OUTLINE.md and STATE.json disagree: ${problems.join('; ')} — ${RECONCILE_HINT}`;
}
