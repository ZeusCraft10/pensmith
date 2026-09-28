// bin/lib/migrations/plan/v1_to_v2.ts — section PLAN.md frontmatter v1 → v2
// (GRND-09, CONF-04, S-20; D-18-06).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// v2 adds the section's outline entry — `suffix`, `purpose`, `role`,
// `word_target`, `voice` — the `stub` flag and `failure_reason`. Every new field is optional
// (a v1 PLAN.md has none of them, and a reader takes the missing outline
// fields from OUTLINE.md), so the migration only rewrites the version line and
// leaves every other byte of the document untouched.

import { setFrontmatterVersionText } from '../loader.js';

export function migrate(text: string): string {
  return setFrontmatterVersionText(text, 2);
}

export default migrate;
