// bin/lib/handoff.ts — HANDOFF assembly + atomic write (D-17, D-18, ARCH-04).
//
// Phase 3 Plan 03-08.
//
// CYCLE-2 H-3 REVIEWS CONVERGENCE: emits the D-17 LOCKED canonical handoff
// shape from `bin/lib/schemas/handoff.ts` — schema_version: 1 (number,
// snake_case), last_updated, current_section, phase, next_action,
// breadcrumbs[] (≤5), section_pointers[] carrying per-section state
// snapshots.
//
// Durable write delegates to bin/lib/atomic-write.ts (D-07 LOCKED chokepoint
// — does NOT reimplement writeFile + fsync + rename). proper-lockfile locks
// a dedicated `.lock` sentinel file (NOT HANDOFF.json itself — HANDOFF.json
// may not exist on first pre-compact run, and lock-on-target races on some
// platforms).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lock } from 'proper-lockfile';
import {
  HandoffSchema,
  HANDOFF_MAX_BYTES,
  type Handoff,
} from './schemas/handoff.js';
import { atomicWriteFile } from './atomic-write.js';

// Re-export the schema so tests + consumers can import a single module.
export { HandoffSchema, HANDOFF_MAX_BYTES };
export type { Handoff };

export const HANDOFF_FILENAME = 'HANDOFF.json';
export const HANDOFF_LOCK_FILENAME = 'HANDOFF.json.lock';
export const HANDOFF_PATH = `.paper/${HANDOFF_FILENAME}`;

export interface AssembleInput {
  phase: Handoff['phase'];
  currentSection: string | null;
  nextAction: string;
  breadcrumbs: Handoff['breadcrumbs'];
  sectionPointers: Handoff['section_pointers'];
}

export function assembleHandoff(input: AssembleInput): Handoff {
  const candidate = {
    schema_version: 1 as const,
    last_updated: new Date().toISOString(),
    current_section: input.currentSection,
    phase: input.phase,
    next_action: input.nextAction.slice(0, 200),
    breadcrumbs: input.breadcrumbs.slice(-5),
    section_pointers: input.sectionPointers,
  };
  return HandoffSchema.parse(candidate);
}

export async function writeHandoff(
  handoff: Handoff,
  paperDir = '.paper',
): Promise<void> {
  HandoffSchema.parse(handoff);
  const content = JSON.stringify(handoff, null, 2);
  const size = Buffer.byteLength(content, 'utf8');
  if (size > HANDOFF_MAX_BYTES) {
    throw new Error(
      `HANDOFF serialized size ${size} exceeds ${HANDOFF_MAX_BYTES} bytes (D-17)`,
    );
  }
  const targetPath = join(paperDir, HANDOFF_FILENAME);
  const lockPath = join(paperDir, HANDOFF_LOCK_FILENAME);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(lockPath, '', { flag: 'a' });

  const release = await lock(lockPath, {
    retries: { retries: 5, minTimeout: 50 },
    stale: 10_000,
    realpath: false,
  });
  try {
    await atomicWriteFile(targetPath, content);
  } finally {
    await release();
  }
}
