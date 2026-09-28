// bin/lib/section.ts — chokepoint for reading a single section's payload.
// mcp/ MUST NOT call node:fs directly (D-09); paper://section/{N} delegates here.
//
// RUN-13 (D-17-32): `paperRoot` is the PROJECT root — the folder that contains
// `.paper/` — exactly the root loadState, loadOutline and the CLI verbs take,
// so STATE.json (`.paper/STATE.json`) and `sections/<NN>[a]-<slug>/` resolve
// from the same place and `paper://section/3` on a CLI-created paper returns
// its plan, draft and verification.
//
// Phase 18 (GRND-09, FEED-04, D-18-32): a section id may carry a letter
// (`paper://section/1a`), and the payload exposes the PLAN.md
// `assigned_sources` — the authoritative section→source map the CLI's write
// enforces — so both tiers agree on what a section may cite.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadState } from './state.js';
import { sectionPlan } from './paths.js';
import { migrateFrontmatterText } from './frontmatter.js';
import { formatSectionId, parseSectionId, sectionIdOf, type SectionId } from './section-id.js';

export interface SectionPayload {
  n: number;
  /** The section's letter (§1a), when it has one. */
  suffix?: string;
  /** The section id as requested and printed: `1`, `1a`. */
  id: string;
  slug: string | undefined;
  /** The section lifecycle status from PLAN.md frontmatter (D-08), or 'unknown'. */
  state: string;
  /** PLAN.md `assigned_sources` (FEED-04), or undefined when there is no readable PLAN.md. */
  assigned_sources: string[] | undefined;
  plan: string | undefined;    // PLAN.md raw markdown if present
  draft: string | undefined;   // DRAFT.md raw markdown if present
  verification: string | undefined; // VERIFICATION.md raw markdown if present
}

/**
 * Load the payload for section `id` (`3`, `'1a'` or a SectionId) of the paper
 * at project root `paperRoot`. A section not registered in STATE.json (or an
 * unparseable id) returns `{ state: 'unknown' }`. The section state is the
 * PLAN.md frontmatter `status` (the per-section source of truth since state
 * v2, D-08), read through the versioned frontmatter reader without write-back
 * (a read-only resource).
 */
export async function loadSection(paperRoot: string, id: number | string | SectionId): Promise<SectionPayload> {
  const parsed = typeof id === 'object' ? sectionIdOf(id.n, id.suffix) : parseSectionId(id);
  const n = parsed?.n ?? (typeof id === 'number' ? id : Number.NaN);
  const idText = parsed !== null ? formatSectionId(parsed) : String(typeof id === 'object' ? id.n : id);
  const unknownPayload: SectionPayload = {
    n,
    id: idText,
    state: 'unknown',
    slug: undefined,
    assigned_sources: undefined,
    plan: undefined,
    draft: undefined,
    verification: undefined,
  };
  if (parsed === null) return unknownPayload;

  let state: Awaited<ReturnType<typeof loadState>>;
  try {
    state = await loadState(paperRoot);
  } catch {
    return unknownPayload;
  }

  const entry = (state.sections ?? []).find((s) => s.n === parsed.n && (s.suffix ?? '') === (parsed.suffix ?? ''));
  if (!entry) return unknownPayload;

  const planPath = sectionPlan(entry.n, entry.slug, paperRoot);
  const sectionDir = dirname(planPath);

  const read = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(join(sectionDir, name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  };

  const plan = await read('PLAN.md');
  let status = 'unknown';
  let assigned: string[] | undefined;
  if (plan !== undefined) {
    try {
      const fm = migrateFrontmatterText('plan', plan, planPath).frontmatter;
      status = typeof fm['status'] === 'string' ? fm['status'] : 'planned';
      assigned = Array.isArray(fm['assigned_sources']) ? (fm['assigned_sources'] as unknown[]).map(String) : [];
    } catch {
      status = 'unknown'; // unreadable / newer-version frontmatter — the raw text is still returned
    }
  }

  return {
    n: entry.n,
    ...(entry.suffix !== undefined ? { suffix: entry.suffix } : {}),
    id: idText,
    slug: entry.slug,
    state: status,
    assigned_sources: assigned,
    plan,
    draft: await read('DRAFT.md'),
    verification: await read('VERIFICATION.md'),
  };
}
