// bin/lib/section.ts — chokepoint for reading a single section's payload.
// mcp/ MUST NOT call node:fs directly (D-09); paper://section/{N} delegates here.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadState } from './state.js';

export interface SectionPayload {
  n: number;
  slug: string | undefined;
  state: string;    // section state enum from State.sections[n].state
  plan: string | undefined;    // PLAN.md raw markdown if present
  draft: string | undefined;   // DRAFT.md raw markdown if present
  verification: string | undefined; // VERIFICATION.md raw markdown if present
}

/**
 * Load the payload for section `n` from `paperRoot`.
 * If the section is not tracked in state, returns `{ n, state: 'unknown' }`.
 * Phase 2: section fields (slug, state) land via migration when Phase 3
 * ships real intake — for now the state may not carry sections[] yet.
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

  // sections[] field is added by Phase 2 migration; may be absent on Phase 1 state.
  const sections = (state as Record<string, unknown>).sections;
  const entry = Array.isArray(sections)
    ? (sections as Array<Record<string, unknown>>).find((s) => s.n === n)
    : undefined;

  if (!entry) {
    return unknownPayload;
  }

  const slug = typeof entry.slug === 'string' ? entry.slug : undefined;
  const sectionDir = join(
    paperRoot,
    'sections',
    `${String(n).padStart(2, '0')}-${slug ?? 'section'}`,
  );

  const read = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(join(sectionDir, name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  };

  return {
    n,
    slug,
    state: typeof entry.state === 'string' ? entry.state : 'unknown',
    plan: await read('PLAN.md'),
    draft: await read('DRAFT.md'),
    verification: await read('VERIFICATION.md'),
  };
}
