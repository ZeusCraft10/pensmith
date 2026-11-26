// bin/lib/plan-store.ts — the contract of a section's plan.
//
// `pensmith plan` gets the plan's content from the section planner as JSON to
// a schema (SectionPlanSchema), checks it here (planProblems: every source is
// one LIBRARY.json holds, every claim's sources are among them, the brief is
// not empty) and writes PLAN.md with renderPlan: frontmatter written by code
// (section, slug, title and depends_on from the outline, status 'planned'),
// the planner's content as the body. Its outline counterpart is
// outline-store.ts.

import { z } from 'zod/v4';
import { serializeFrontmatter } from './frontmatter.js';
import type { lastCheckedOutline } from './outline-read.js';
import { PlanFrontmatterSchema } from './schemas/plan-frontmatter.js';

/** What the section planner returns. */
export const SectionPlanSchema = z.object({
  assigned_sources: z.array(z.string()),
  claims: z.array(z.object({ claim: z.string(), sources: z.array(z.string()) }).strict()),
  brief: z.string(),
  voice: z.string(),
}).strict();
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

/** Every reason `plan` cannot be the section's plan; empty when it can. */
export function planProblems(plan: SectionPlan, libraryKeys: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const unknown = plan.assigned_sources.filter((k) => !libraryKeys.has(k));
  if (unknown.length > 0) problems.push(`assigned_sources names ${unknown.join(', ')}, which LIBRARY.json does not hold`);
  const assigned = new Set(plan.assigned_sources);
  for (const c of plan.claims) {
    const outside = c.sources.filter((k) => !assigned.has(k));
    if (outside.length > 0) problems.push(`the claim "${c.claim.slice(0, 60)}" cites ${outside.join(', ')}, which is not in assigned_sources`);
  }
  if (plan.brief.trim().split(/\s+/).filter(Boolean).length < 20) problems.push('the brief is shorter than 20 words');
  return problems;
}

/** A section as the outline has it, for its plan. */
export interface SectionEntry {
  n: number;
  slug: string;
  title: string;
  depends_on: string[];
  purpose: string;
  word_target: number | null;
  assigned_sources: string[];
}

/**
 * Section `n` as the outline has it (as lastCheckedOutline read it, while a
 * hand edit of OUTLINE.md waits), or the bare minimum when there is no
 * outline entry. The planner and the drafter are shown the section from here.
 */
export function sectionEntry(outline: ReturnType<typeof lastCheckedOutline>, n: number, slug: string): SectionEntry {
  const s = outline?.sections.find((x) => x.n === n && x.slug === slug);
  const stored = outline?.stored?.sections.find((x) => x.n === n && x.slug === slug);
  return {
    n,
    slug,
    title: s?.title ?? slug,
    depends_on: s?.depends_on ?? [],
    purpose: stored?.purpose ?? '',
    word_target: s?.estimated_word_count ?? null,
    assigned_sources: s?.assigned_sources ?? [],
  };
}

/** PLAN.md: frontmatter written by code, the planner's content as the body. */
export function renderPlan(entry: SectionEntry, plan: SectionPlan | null, placeholderText?: string): string {
  const fm: Record<string, unknown> = {
    section: entry.n,
    slug: entry.slug,
    title: entry.title,
    depends_on: entry.depends_on,
    assigned_sources: plan ? plan.assigned_sources : entry.assigned_sources,
    status: 'planned',
    verified_against_draft_hash: null,
  };
  if (placeholderText !== undefined) fm['placeholder'] = true;
  PlanFrontmatterSchema.parse(fm);
  if (!plan) return `${serializeFrontmatter(fm)}\n${placeholderText ?? ''}\n`;
  const claims = plan.claims.map((c) => `- ${c.claim} (sources: ${c.sources.join(', ') || 'none'})`);
  return [
    serializeFrontmatter(fm),
    '## Brief',
    '',
    plan.brief.trim(),
    '',
    `Voice: ${plan.voice.trim() || 'formal academic tone'}`,
    '',
    '## Claims',
    '',
    ...(claims.length > 0 ? claims : ['(none)']),
    '',
  ].join('\n');
}
