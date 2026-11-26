// tests/lib/outline-fixture.ts — an OUTLINE.md table for a test paper.
//
// The outline is the one list of sections every verb walks, so a fixture that
// sets up sections writes them as an OUTLINE.md table.
//
// Not a test file (the runner collects only *.test.ts).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** An OUTLINE.md with a section table of `sections`. */
export function outlineTable(sections: ReadonlyArray<{ n: number; slug: string; title?: string }>, title = 'Test Paper'): string {
  return [
    `# ${title}`,
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '| --- | --- | --- | --- | --- | --- |',
    ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.title ?? s.slug} | | 300 | |`),
    '',
  ].join('\n');
}

/**
 * The OUTLINE.md for the test paper at `root`: a table of the sections its
 * STATE.json fixture lists (in .paper/ or, for an old layout, the root), or a
 * table-less outline when it lists none.
 */
export function outlineForStateFixture(root: string): string {
  for (const file of [join(root, '.paper', 'STATE.json'), join(root, 'STATE.json')]) {
    if (!existsSync(file)) continue;
    try {
      const sections = (JSON.parse(readFileSync(file, 'utf8')) as { sections?: Array<{ n: number; slug: string }> }).sections ?? [];
      if (sections.length > 0) return outlineTable(sections);
    } catch {
      // a deliberately corrupt fixture
    }
  }
  return '# OUTLINE.md\n';
}
