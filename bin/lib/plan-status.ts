// bin/lib/plan-status.ts — round-trip-safe section PLAN.md frontmatter writer.
//
// The router's per-section walk (router.ts:188-211) advances the pipeline by
// reading each section PLAN.md's `status` frontmatter. The write verb
// (status 'writing' -> 'written') and the verify verb (status
// 'verified' | 'failed' | 'unverifiable' + verified_against_draft_hash) persist
// those transitions HERE so a freshly-drafted/verified section actually moves
// forward instead of the router looping on the same verb (audit #8/#9). Before
// this, neither verb touched PLAN.md, so the router never saw the transition.
//
// CONF-04 (D-17-38): every write goes through the versioned frontmatter
// loader first — a v0 PLAN.md is migrated (schema_version: 1 inserted) before
// the mutation, so every PLAN.md this writer touches carries the current
// schema_version, and a PLAN.md written by a NEWER pensmith is refused with
// "upgrade pensmith" instead of being silently rewritten.

import { existsSync, readFileSync } from 'node:fs';
import { updateFrontmatter, migrateFrontmatterText, FrontmatterVersionError } from './frontmatter.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { CURRENT_PLAN_FRONTMATTER_VERSION } from './schemas/plan-frontmatter.js';

/**
 * Best-effort, round-trip-safe mutation of a section PLAN.md's frontmatter via
 * updateFrontmatter (preserves comments + key order; D-07 chokepoint write),
 * under the PLAN.md's per-file lock.
 *
 * Returns false when the PLAN.md is absent or unwritable. The calling verb MUST
 * NOT crash because a status write failed — e.g. Tier-2 placeholder mode where
 * no PLAN.md was authored, or a hand-assembled workspace. A false return is the
 * caller's cue to WARN, not to fail the verb. A PLAN.md whose schema_version is
 * newer than this build is NOT best-effort: FrontmatterVersionError propagates
 * ("upgrade pensmith").
 */
export async function updatePlanFrontmatter(
  planPath: string,
  mutate: (fm: Record<string, unknown>) => void,
): Promise<boolean> {
  if (!existsSync(planPath)) return false;
  try {
    await withLock(planPath, async () => {
      const doc = migrateFrontmatterText('plan', readFileSync(planPath, 'utf8'), planPath);
      const updated = updateFrontmatter(doc.text, (fm) => {
        mutate(fm);
        fm['schema_version'] = CURRENT_PLAN_FRONTMATTER_VERSION;
      });
      await atomicWriteFile(planPath, updated);
    });
    return true;
  } catch (e) {
    if (e instanceof FrontmatterVersionError) throw e;
    return false;
  }
}
