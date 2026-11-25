// bin/lib/plan-status.ts — round-trip-safe section PLAN.md frontmatter writer,
// and the reader of the sources a PLAN.md assigns.
//
// The router's per-section walk (router.ts:188-211) advances the pipeline by
// reading each section PLAN.md's `status` frontmatter. The write verb
// (status 'writing' -> 'written') and the verify verb (status
// 'verified' | 'failed' | 'unverifiable' + verified_against_draft_hash) persist
// those transitions HERE so a freshly-drafted/verified section actually moves
// forward instead of the router looping on the same verb (audit #8/#9). Before
// this, neither verb touched PLAN.md, so the router never saw the transition.

import { existsSync, readFileSync } from 'node:fs';
import { updateFrontmatter } from './frontmatter.js';
import { atomicWriteFile } from './atomic-write.js';

/**
 * The citekeys a section's PLAN.md frontmatter assigns it (`assigned_sources`),
 * as verify, compile and revise read them: none unless the key is a list.
 * Lenient on purpose: a PLAN.md that fails the strict schema still assigns
 * its sources, so a draft that cites none of them still fails verify.
 */
export function assignedSourcesFrom(frontmatter: Record<string, unknown>): string[] {
  const sources = frontmatter['assigned_sources'];
  return Array.isArray(sources) ? sources.map(String) : [];
}

/**
 * Best-effort, round-trip-safe mutation of a section PLAN.md's frontmatter via
 * updateFrontmatter (preserves comments + key order; D-07 chokepoint write).
 *
 * Returns false when the PLAN.md is absent or unwritable. The calling verb MUST
 * NOT crash because a status write failed — e.g. Tier-2 placeholder mode where
 * no PLAN.md was authored, or a hand-assembled workspace. A false return is the
 * caller's cue to WARN, not to fail the verb.
 */
export async function updatePlanFrontmatter(
  planPath: string,
  mutate: (fm: Record<string, unknown>) => void,
): Promise<boolean> {
  if (!existsSync(planPath)) return false;
  try {
    const updated = updateFrontmatter(readFileSync(planPath, 'utf8'), mutate);
    await atomicWriteFile(planPath, updated);
    return true;
  } catch {
    return false;
  }
}
