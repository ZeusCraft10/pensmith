// bin/lib/outline-read.ts — read the paper's section list.
//
// The outline is the roadmap: every verb that walks the sections (the router,
// status, add, the estimator, write, compile, the export gate) reads the list
// here and nowhere else.
//   - .paper/OUTLINE.json is the list. `pensmith outline` writes it
//     (outline-store.ts) and renders OUTLINE.md from it, keeping the hash of
//     that OUTLINE.md: a different OUTLINE.md means the user edited it, and
//     the list is not used until `pensmith outline` has checked the edit.
//   - A paper with only a hand-written OUTLINE.md table (or one an older
//     pensmith wrote) is read from that table.
// This module is light on purpose: the SessionStart hook reads the list
// through the router.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { findCitations, findRawCitations, findUnparseableCitations } from './citation-grammar.js';
import { parseOutline, type ParsedOutline, type ParsedOutlineSection } from './outline-parse.js';
import { paperDir, paperOutlineFile, SLUG_RE } from './paths.js';
import { isPlaceholderText } from './placeholder.js';
import { kahnOrder } from './scheduler.js';

const StoredSectionSchema = z.object({
  n: z.number().int().min(1).max(99),
  slug: z.string().regex(SLUG_RE).max(64),
  title: z.string().min(1).max(200),
  purpose: z.string(),
  depends_on: z.array(z.string()),
  word_target: z.number().int().min(0),
  assigned_sources: z.array(z.string()),
  counterargument: z.boolean(),
}).strict();

/** .paper/OUTLINE.json. */
export const StoredOutlineSchema = z.object({
  $schemaVersion: z.literal(1),
  title: z.string().min(1),
  thesis: z.string(),
  sections: z.array(StoredSectionSchema).min(1),
  /** The outlineMdHash of the OUTLINE.md rendered from this list. */
  outline_md_sha256: z.string(),
}).strict();
export type StoredOutline = z.infer<typeof StoredOutlineSchema>;
export type OutlineSection = z.infer<typeof StoredSectionSchema>;

function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The hash that binds OUTLINE.md to OUTLINE.json. Line endings and trailing
 * whitespace are not part of it, so a checkout that turns \n into \r\n, or
 * an editor that adds a final newline, is not taken for a hand edit.
 */
export function outlineMdHash(md: string): string {
  return sha256(md.replace(/\r\n?/g, '\n').trimEnd());
}

/** A section as the structure checks see it. */
export interface CheckedSection {
  n: number;
  slug: string;
  title: string;
  depends_on: readonly string[];
  assigned_sources?: readonly string[];
  counterargument?: boolean;
}

/** Why `sections` cannot be walked: bad or repeated slugs and numbers, dependencies that do not resolve or form a cycle. */
export function structureProblems(sections: readonly CheckedSection[]): string[] {
  const problems: string[] = [];
  const at = (s: { n: number; slug: string }): string => `section ${s.n} (${s.slug})`;
  const slugs = new Set<string>();
  const numbers = new Set<number>();
  for (const s of sections) {
    if (!SLUG_RE.test(s.slug)) problems.push(`${at(s)}: the slug must be lowercase letters, digits and hyphens`);
    if (slugs.has(s.slug)) problems.push(`${at(s)}: the slug ${s.slug} is used twice`);
    if (numbers.has(s.n)) problems.push(`${at(s)}: the number ${s.n} is used twice`);
    if (!Number.isInteger(s.n) || s.n < 1 || s.n > 99) problems.push(`${at(s)}: the number must be 1 to 99`);
    slugs.add(s.slug);
    numbers.add(s.n);
  }
  for (const s of sections) {
    for (const d of s.depends_on) {
      if (d === s.slug) problems.push(`${at(s)} depends on itself`);
      else if (!slugs.has(d)) problems.push(`${at(s)} depends on ${d}, which is not a section of this outline`);
    }
  }
  const cycle = kahnOrder(sections).residual;
  if (cycle.length > 0) problems.push(`the sections ${cycle.join(', ')} depend on each other in a cycle`);
  return problems;
}

/** Why `text` cannot be a heading: it holds a citation, which no heading's check ever verifies. */
export function citationIn(text: string): string | null {
  const cites = findCitations(text);
  if (cites.length > 0) return `holds the citation ${cites[0]!.raw}`;
  const raw = findRawCitations(text, cites)[0];
  if (raw) return `reads as a citation (${raw.kind}: ${raw.raw})`;
  const broken = findUnparseableCitations(text, cites)[0];
  if (broken) return `holds a citation bracket (${broken.raw})`;
  return null;
}

/** Why the paper's title or a section title cannot be a heading. */
export function headingProblems(title: string, sections: readonly CheckedSection[]): string[] {
  const problems: string[] = [];
  const titleProblem = citationIn(title);
  if (titleProblem) problems.push(`the paper's title "${title}" ${titleProblem}; a title may not hold a citation`);
  for (const s of sections) {
    if (/[|\r\n]/.test(s.title)) problems.push(`section ${s.n} (${s.slug}): the title may not contain "|" or a line break`);
    const tp = citationIn(s.title);
    if (tp) problems.push(`section ${s.n} (${s.slug}): the title "${s.title}" ${tp}; a heading is never verified, so it may not hold a citation`);
  }
  return problems;
}

/** Why `sections` assign a source `libraryKeys` does not hold. */
export function sourceProblems(sections: readonly CheckedSection[], libraryKeys: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const s of sections) {
    const unknown = (s.assigned_sources ?? []).filter((k) => !libraryKeys.has(k));
    if (unknown.length > 0) problems.push(`section ${s.n} (${s.slug}) assigns ${unknown.join(', ')}, which LIBRARY.json does not hold`);
  }
  return problems;
}

/**
 * The citekeys of .paper/LIBRARY.json in its current shape, read here rather
 * than through library.ts so the SessionStart hook's bundle stays small. Null
 * when there is no such file, or it is in a shape only library.ts reads.
 */
function libraryKeys(root: string): Set<string> | null {
  try {
    const v = JSON.parse(readFileSync(path.join(paperDir(root), 'LIBRARY.json'), 'utf8')) as { $schemaVersion?: unknown; entries?: unknown };
    if (v.$schemaVersion !== 2 || !Array.isArray(v.entries)) return null;
    return new Set(v.entries.map((e: { id?: unknown } | null) => e?.id).filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
}

export type OutlineRead =
  | { ok: true; source: 'json' | 'md'; outline: ParsedOutline & { stored: StoredOutline | null } }
  | { ok: false; problem: 'missing' | 'placeholder' | 'invalid'; detail: string }
  /** OUTLINE.md was edited; `stored` is the list as last checked, still the paper's until the edit is taken in. */
  | { ok: false; problem: 'edited'; detail: string; stored: StoredOutline };

/** A stored outline as the section list every reader walks. */
function asParsed(o: StoredOutline): ParsedOutline & { stored: StoredOutline } {
  return {
    paper_title: o.title,
    sections: o.sections.map((s): ParsedOutlineSection => ({
      n: s.n, slug: s.slug, title: s.title, depends_on: [...s.depends_on], estimated_word_count: s.word_target, assigned_sources: [...s.assigned_sources],
    })),
    stored: o,
  };
}

/**
 * An OUTLINE.md table read as the list (no OUTLINE.json). It gets the checks
 * `pensmith outline` would make that need nothing but the paper's files: the
 * structure, headings that hold no citation, and sources LIBRARY.json holds.
 */
function readMdOutline(root: string, md: string): OutlineRead {
  if (isPlaceholderText(md)) return { ok: false, problem: 'placeholder', detail: 'OUTLINE.md is placeholder text (PENSMITH_NO_LLM), not an outline' };
  let parsed: ParsedOutline;
  try {
    parsed = parseOutline(md);
  } catch (e) {
    return { ok: false, problem: 'invalid', detail: `OUTLINE.md has no usable section table: ${(e as Error).message}` };
  }
  if (parsed.sections.length === 0) return { ok: false, problem: 'invalid', detail: 'OUTLINE.md has no sections in its table' };
  const keys = libraryKeys(root);
  const problems = [
    ...structureProblems(parsed.sections),
    ...headingProblems(parsed.paper_title, parsed.sections),
    ...(keys ? sourceProblems(parsed.sections, keys) : []),
  ];
  if (problems.length > 0) return { ok: false, problem: 'invalid', detail: `OUTLINE.md: ${problems.join('; ')}` };
  return { ok: true, source: 'md', outline: { ...parsed, stored: null } };
}

/**
 * The paper's section list. Never throws: a missing, placeholder, hand-edited
 * or unusable outline is reported, with the reason, instead.
 */
export function readOutline(root: string): OutlineRead {
  const jsonFile = paperOutlineFile(root);
  let md: string | null;
  try {
    md = readFileSync(path.join(paperDir(root), 'OUTLINE.md'), 'utf8');
  } catch {
    md = null;
  }
  if (!existsSync(jsonFile)) {
    if (md === null) return { ok: false, problem: 'missing', detail: "there is no outline yet — run 'pensmith outline'" };
    return readMdOutline(root, md);
  }
  let stored: StoredOutline;
  try {
    stored = StoredOutlineSchema.parse(JSON.parse(readFileSync(jsonFile, 'utf8')));
  } catch (e) {
    return { ok: false, problem: 'invalid', detail: `.paper/OUTLINE.json cannot be read (${(e as Error).message.split('\n')[0]})` };
  }
  if (md !== null && outlineMdHash(md) !== stored.outline_md_sha256) {
    return {
      ok: false,
      problem: 'edited',
      detail: "OUTLINE.md was changed after the outline was written; run 'pensmith outline' to check the change and use it",
      stored,
    };
  }
  return { ok: true, source: 'json', outline: asParsed(stored) };
}

/**
 * The list a verb that works on one section uses (plan, write, verify): the
 * outline, or, while a hand edit of OUTLINE.md waits to be checked, the list
 * as last checked. Null when there is no usable list.
 */
export function lastCheckedOutline(root: string): (ParsedOutline & { stored: StoredOutline | null }) | null {
  const r = readOutline(root);
  if (r.ok) return r.outline;
  return r.problem === 'edited' ? asParsed(r.stored) : null;
}

/** readOutline, for callers that stop on any problem: the list, or an Error naming the reason. */
export function readOutlineOrThrow(root: string): ParsedOutline & { stored: StoredOutline | null } {
  const r = readOutline(root);
  if (!r.ok) throw new Error(r.detail);
  return r.outline;
}
