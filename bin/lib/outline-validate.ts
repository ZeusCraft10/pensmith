// bin/lib/outline-validate.ts — the semantic outline validator (GRND-08,
// GRND-10, D-18-15, D-18-19).
//
// The outline-author reply is first checked for SHAPE by its zod contract
// (llm-contracts.ts OutlineSchema, the native structured-output schema). This
// module checks what a schema cannot, before the approval gate:
//   - slugs are unique;
//   - every depends_on names another section of the outline, no section
//     depends on itself, and the dependencies have no cycle;
//   - every assigned citekey is in LIBRARY.json;
//   - the word targets sum to within ±20% of the paper's length target;
//   - at most 2 sections other than the introduction and conclusion have no
//     source (when the library has any source at all);
//   - the counterargument rule, when the paper needs it (counterargument.ts).
// Every violation is reported at once, so the one corrective turn can quote
// them all (outline.ts). The same validator backs the Tier-1 outline
// registration tool (PLUG-07). PURE: no fs.

import { COUNTERARGUMENT_REQUIRED_MESSAGE, coversCounterargument } from './counterargument.js';

/** One outline section as the validator sees it (OutlineSchema's section shape). */
export interface ValidatedOutlineSection {
  readonly slug: string;
  readonly title?: string;
  readonly depends_on: readonly string[];
  readonly assigned_sources: readonly string[];
  readonly estimated_word_count: number;
  readonly role?: string | undefined;
}

export interface OutlineValidationInput {
  readonly sections: readonly ValidatedOutlineSection[];
  /** The citekeys LIBRARY.json holds. */
  readonly libraryCitekeys: ReadonlySet<string>;
  /** The paper's length target in words (> 0). */
  readonly lengthTarget: number;
  /** Whether the outline must cover a counterargument and a rebuttal. */
  readonly counterargumentRequired: boolean;
}

export type OutlineIssueCode =
  | 'no-sections'
  | 'duplicate-slug'
  | 'self-dependency'
  | 'unknown-dependency'
  | 'dependency-cycle'
  | 'unknown-citekey'
  | 'word-budget'
  | 'zero-source-sections'
  | 'counterargument-missing'
  | 'unnumberable-section';

export interface OutlineIssue {
  readonly code: OutlineIssueCode;
  readonly message: string;
}

/** Allowed deviation of the word-target sum from the length target. */
export const WORD_BUDGET_SLACK = 0.2;
/** How many body sections may have no source. */
export const MAX_ZERO_SOURCE_BODY_SECTIONS = 2;

const FRAME_ROLES: ReadonlySet<string> = new Set(['intro', 'conclusion']);

/** The slugs of a dependency cycle, or null (Kahn over the declared edges). */
function findCycle(sections: readonly ValidatedOutlineSection[]): string[] | null {
  const slugs = new Set(sections.map((s) => s.slug));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of sections) {
    const deps = [...new Set(s.depends_on)].filter((d) => slugs.has(d) && d !== s.slug);
    indegree.set(s.slug, deps.length);
    for (const d of deps) dependents.set(d, [...(dependents.get(d) ?? []), s.slug]);
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([s]) => s);
  let seen = 0;
  while (queue.length > 0) {
    const slug = queue.shift() as string;
    seen += 1;
    for (const child of dependents.get(slug) ?? []) {
      const left = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  if (seen === indegree.size) return null;
  return [...indegree.entries()].filter(([, n]) => n > 0).map(([s]) => s);
}

/** Every rule the outline breaks (empty when it is valid). */
export function validateOutline(input: OutlineValidationInput): OutlineIssue[] {
  const issues: OutlineIssue[] = [];
  const { sections } = input;
  if (sections.length === 0) {
    return [{ code: 'no-sections', message: 'the outline has no sections' }];
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.slug)) dupes.add(s.slug);
    seen.add(s.slug);
  }
  for (const d of dupes) issues.push({ code: 'duplicate-slug', message: `slug "${d}" is used by more than one section` });

  for (const s of sections) {
    if (s.depends_on.includes(s.slug)) {
      issues.push({ code: 'self-dependency', message: `section "${s.slug}" depends on itself` });
    }
    for (const d of s.depends_on) {
      if (d !== s.slug && !seen.has(d)) {
        issues.push({ code: 'unknown-dependency', message: `section "${s.slug}" depends on "${d}", which is not a section of this outline` });
      }
    }
  }
  const cycle = findCycle(sections);
  if (cycle !== null) {
    issues.push({ code: 'dependency-cycle', message: `the depends_on links form a cycle through ${cycle.map((s) => `"${s}"`).join(', ')}` });
  }

  const unknown = new Map<string, string[]>();
  for (const s of sections) {
    for (const key of s.assigned_sources) {
      if (!input.libraryCitekeys.has(key)) unknown.set(key, [...(unknown.get(key) ?? []), s.slug]);
    }
  }
  for (const [key, where] of unknown) {
    issues.push({ code: 'unknown-citekey', message: `citekey "${key}" (assigned to ${where.map((w) => `"${w}"`).join(', ')}) is not in the sources block / LIBRARY.json` });
  }

  const total = sections.reduce((acc, s) => acc + s.estimated_word_count, 0);
  const target = input.lengthTarget;
  if (target > 0 && Math.abs(total - target) > WORD_BUDGET_SLACK * target) {
    const lo = Math.ceil(target * (1 - WORD_BUDGET_SLACK));
    const hi = Math.floor(target * (1 + WORD_BUDGET_SLACK));
    issues.push({ code: 'word-budget', message: `the word targets sum to ${total}, but the paper's length target is ${target} words (allowed ${lo}-${hi})` });
  }

  if (input.libraryCitekeys.size > 0) {
    const bare = sections.filter((s) => !FRAME_ROLES.has(s.role ?? 'body') && s.assigned_sources.length === 0);
    if (bare.length > MAX_ZERO_SOURCE_BODY_SECTIONS) {
      issues.push({
        code: 'zero-source-sections',
        message: `${bare.length} sections other than the introduction and conclusion have no assigned source (${bare.map((s) => `"${s.slug}"`).join(', ')}); at most ${MAX_ZERO_SOURCE_BODY_SECTIONS} may`,
      });
    }
  }

  if (input.counterargumentRequired && !coversCounterargument(sections.map((s) => s.role))) {
    issues.push({ code: 'counterargument-missing', message: COUNTERARGUMENT_REQUIRED_MESSAGE });
  }
  return issues;
}

/** The issues as one line (the refusal and the corrective instruction quote it). */
export function formatOutlineIssues(issues: readonly OutlineIssue[]): string {
  return issues.map((i) => i.message).join('; ');
}

/** The corrective turn sent after a semantic failure (GRND-08: one, quoting every error). */
export function outlineCorrection(issues: readonly OutlineIssue[]): string {
  return (
    `Your outline breaks these rules: ${issues.map((i, n) => `(${n + 1}) ${i.message}`).join(' ')} ` +
    'Reply again with the complete corrected outline as ONE JSON object in the same format — ' +
    'every section, not only the changed ones. Assign only citekeys from the sources block.'
  );
}
