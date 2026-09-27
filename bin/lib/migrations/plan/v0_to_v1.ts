// bin/lib/migrations/plan/v0_to_v1.ts — section PLAN.md frontmatter v0 → v1
// (CONF-04, D-17-38).
//
// v0 is every PLAN.md written before frontmatter versioning: no
// `schema_version` key. v1 adds `schema_version: 1` and changes nothing else,
// so the migration is a TEXT transform that inserts exactly one line and leaves
// every other byte of the document untouched (comments, key order, quoting and
// the body survive verbatim — a YAML re-serialization could not promise that).
//
// Later requirements that add a PLAN.md field (GRND-09 word_target/purpose/
// voice, REV-01 revision_count, …) add v1_to_v2.ts here, bump
// CURRENT_PLAN_FRONTMATTER_VERSION in schemas/plan-frontmatter.ts, and register
// the step in bin/lib/frontmatter.ts FRONTMATTER_KINDS (S-20).

import { setFrontmatterVersionText } from '../loader.js';

export function migrate(text: string): string {
  return setFrontmatterVersionText(text, 1);
}

export default migrate;
