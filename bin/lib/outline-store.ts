// bin/lib/outline-store.ts — write the paper's section list.
//
// `pensmith outline` gets the outline from the model as JSON to a schema
// (ProposedOutlineSchema), checks it here (outlineProblems), renders
// OUTLINE.md from it and writes OUTLINE.json, the one list of sections
// (read through outline-read.ts). STATE.json's `sections` and the section
// folders, each with a stub PLAN.md, are written from it, replacing what was
// there. Section folders keep their names (NN-slug); a folder no section in
// the list names any more is reported, never deleted.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { atomicWriteFile } from './atomic-write.js';
import { frontmatterProblem, parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import {
  headingProblems,
  outlineMdHash,
  sourceProblems,
  StoredOutlineSchema,
  structureProblems,
  type CheckedSection,
  type OutlineSection,
  type StoredOutline,
} from './outline-read.js';
import { paperDir, paperOutlineFile, parseSectionDirName, sectionDirName, sectionPlan, SLUG_RE } from './paths.js';
import { initState, StateAlreadyExistsError, updateState } from './state.js';

/** A section as the outline author proposes it (structured output). */
export const OutlineSectionSchema = z.object({
  slug: z.string().regex(SLUG_RE).max(64),
  title: z.string().min(1).max(200),
  purpose: z.string(),
  depends_on: z.array(z.string()),
  word_target: z.number().int().min(50).max(50_000),
  assigned_sources: z.array(z.string()),
  counterargument: z.boolean(),
}).strict();

/** What the outline author returns. pensmith numbers the sections in this order. */
export const ProposedOutlineSchema = z.object({
  title: z.string().min(1).max(300),
  thesis: z.string(),
  sections: z.array(OutlineSectionSchema).min(1).max(30),
}).strict();
export type ProposedOutline = z.infer<typeof ProposedOutlineSchema>;

/** An outline ready to be written: the proposal, numbered. */
export type Outline = Omit<StoredOutline, '$schemaVersion' | 'outline_md_sha256'>;

/** The proposal with its sections numbered 1..N in reader order. */
export function numberOutline(p: ProposedOutline): Outline {
  return { title: p.title, thesis: p.thesis, sections: p.sections.map((s, i) => ({ ...s, n: i + 1 })) };
}

export interface OutlineRules {
  /** The citekeys LIBRARY.json holds; every assigned source must be one. Null skips the check. */
  libraryKeys: ReadonlySet<string> | null;
  /** True when the paper must have a counterargument and rebuttal section. */
  counterargumentRequired: boolean;
}

/** Every reason `outline` cannot be the paper's section list; empty when it can. */
export function outlineProblems(outline: { title: string; sections: readonly CheckedSection[] }, rules: OutlineRules): string[] {
  const problems = [...structureProblems(outline.sections), ...headingProblems(outline.title, outline.sections)];
  if (rules.counterargumentRequired && !outline.sections.some((s) => s.counterargument === true)) {
    problems.push('the paper needs a counterargument and rebuttal section, and no section is marked as one');
  }
  if (rules.libraryKeys) problems.push(...sourceProblems(outline.sections, rules.libraryKeys));
  return problems;
}

/** OUTLINE.md for `outline`: the title, the thesis, the section table, and each section's purpose. */
export function renderOutlineMd(outline: Outline): string {
  const lines = [`# ${outline.title}`, ''];
  if (outline.thesis.trim()) lines.push(outline.thesis.trim(), '');
  lines.push('| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |');
  for (const s of outline.sections) {
    lines.push(`| ${s.n} | ${s.slug} | ${s.title} | ${s.depends_on.join(', ')} | ${s.word_target} | ${s.assigned_sources.join(', ')} |`);
  }
  lines.push('', '## Sections', '');
  for (const s of outline.sections) {
    lines.push(`### ${s.n}. ${s.title}`, '');
    if (s.counterargument) lines.push('Counterargument and rebuttal.', '');
    if (s.purpose.trim()) lines.push(s.purpose.trim(), '');
  }
  return lines.join('\n');
}

/**
 * The status a PLAN.md names ('stub' when it names none), or null when it
 * cannot be read, or its frontmatter was broken by hand (then it is the
 * user's to fix, not a stub to replace).
 */
function planStatus(planPath: string): string | null {
  try {
    const text = readFileSync(planPath, 'utf8');
    if (frontmatterProblem(text) !== null) return null;
    const status = parseFrontmatter(text).frontmatter['status'];
    return typeof status === 'string' ? status : 'stub';
  } catch {
    return null;
  }
}

/** The stub PLAN.md of an outline entry: its frontmatter written by code, its purpose as the body. */
export function stubPlan(s: OutlineSection): string {
  const fm = serializeFrontmatter({
    section: s.n,
    slug: s.slug,
    title: s.title,
    depends_on: [...s.depends_on],
    assigned_sources: [...s.assigned_sources],
    status: 'stub',
  });
  return `${fm}\n## Outline entry\n\n${s.purpose.trim() || s.title}\n`;
}

/**
 * Make `outline` the paper's section list: OUTLINE.json, OUTLINE.md (unless
 * `keepMd`, when the user's own OUTLINE.md is the one being adopted),
 * STATE.json's sections (replaced, not added to), and a folder with a stub
 * PLAN.md for each section that has no plan. Returns the warnings to print:
 * folders no section in the list names.
 */
export async function writeOutline(root: string, outline: Outline, opts: { keepMd?: string } = {}): Promise<string[]> {
  const md = opts.keepMd ?? renderOutlineMd(outline);
  const stored: StoredOutline = StoredOutlineSchema.parse({ $schemaVersion: 1, ...outline, outline_md_sha256: outlineMdHash(md) });
  if (opts.keepMd === undefined) await atomicWriteFile(path.join(paperDir(root), 'OUTLINE.md'), md);
  await atomicWriteFile(paperOutlineFile(root), JSON.stringify(stored, null, 2) + '\n');

  try {
    await initState(root);
  } catch (e) {
    if (!(e instanceof StateAlreadyExistsError)) throw e;
  }
  await updateState(root, (s) => ({ ...s, sections: outline.sections.map((x) => ({ n: x.n, slug: x.slug })) }));

  for (const s of outline.sections) {
    const planPath = sectionPlan(s.n, s.slug, root);
    // A section that has a plan keeps it; a stub follows the outline.
    if (!existsSync(planPath) || planStatus(planPath) === 'stub') await atomicWriteFile(planPath, stubPlan(s));
  }

  const named = new Set(outline.sections.map((s) => sectionDirName(s.n, s.slug)));
  const warnings: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(path.join(paperDir(root), 'sections'));
  } catch {
    // no sections folder
  }
  for (const d of dirs.sort()) {
    if (named.has(d) || !parseSectionDirName(d)) continue;
    warnings.push(`.paper/sections/${d}/ is not a section of the outline any more; it was left as it is, and nothing reads it`);
  }
  return warnings;
}
