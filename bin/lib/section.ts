// bin/lib/section.ts — chokepoint for reading a single section's payload.
// mcp/ MUST NOT call node:fs directly (D-09); paper://section/{N} delegates here.
//
// RUN-13 (D-17-32): `paperRoot` is the PROJECT root — the folder that contains
// `.paper/` — exactly the root loadState, loadOutline and the CLI verbs take,
// so STATE.json (`.paper/STATE.json`) and `sections/<NN>-<slug>/` resolve from
// the same place and `paper://section/3` on a CLI-created paper returns its
// plan, draft and verification.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadState } from './state.js';
import { sectionPlan } from './paths.js';
import { migrateFrontmatterText } from './frontmatter.js';

export interface SectionPayload {
  n: number;
  slug: string | undefined;
  /** The section lifecycle status from PLAN.md frontmatter (D-08), or 'unknown'. */
  state: string;
  plan: string | undefined;    // PLAN.md raw markdown if present
  draft: string | undefined;   // DRAFT.md raw markdown if present
  verification: string | undefined; // VERIFICATION.md raw markdown if present
}

/**
 * Load the payload for section `n` of the paper at project root `paperRoot`.
 * A section not registered in STATE.json returns `{ n, state: 'unknown' }`.
 * The section state is the PLAN.md frontmatter `status` (the per-section
 * source of truth since state v2, D-08), read through the versioned
 * frontmatter reader without write-back (a read-only resource).
 */
export async function loadSection(paperRoot: string, n: number): Promise<SectionPayload> {
  let state: Awaited<ReturnType<typeof loadState>>;
  const unknownPayload: SectionPayload = {
    n,
    state: 'unknown',
    slug: undefined,
    plan: undefined,
    draft: undefined,
    verification: undefined,
  };

  try {
    state = await loadState(paperRoot);
  } catch {
    return unknownPayload;
  }

  const entry = (state.sections ?? []).find((s) => s.n === n);
  if (!entry) return unknownPayload;

  const planPath = sectionPlan(n, entry.slug, paperRoot);
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
  if (plan !== undefined) {
    try {
      const fm = migrateFrontmatterText('plan', plan, planPath).frontmatter;
      status = typeof fm['status'] === 'string' ? fm['status'] : 'planned';
    } catch {
      status = 'unknown'; // unreadable / newer-version frontmatter — the raw text is still returned
    }
  }

  return {
    n,
    slug: entry.slug,
    state: status,
    plan,
    draft: await read('DRAFT.md'),
    verification: await read('VERIFICATION.md'),
  };
}
