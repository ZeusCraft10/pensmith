// bin/lib/intake-brief.ts — `.paper/INTAKE.md`, the structured project brief
// (GRND-03, S-08, D-18-07).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// INTAKE.md is the paper's brief: versioned YAML frontmatter (read through the
// CONF-04 loader, bin/lib/frontmatter.ts, kind `intake`) plus a body holding
// the assignment — verbatim, or PII-redacted when the user opted in (the raw
// copy stays in the gitignored `.paper/INTAKE.raw.local`) — and a rendered
// questions-and-answers section. Research seeds its queries from `topic`;
// outline, plan and write read topic, thesis, discipline, paper type, length,
// counterargument answer and sectioning notes from here. PRD §7.1/§7.2/§13
// name it the project brief (no parallel PROJECT.md).
//
// The educator-mode keys come from bin/lib/tutorial.ts's opaque fragment and
// are spread in unnamed (tests/lint-tutorial-no-branch.test.ts).
//
// A v0 INTAKE.md (no frontmatter; written before Phase 18) is migrated by
// bin/lib/migrations/intake/v0_to_v1.ts, which derives topic and discipline
// from its `Topic:` / `Discipline:` lines.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { INTAKE_FRONTMATTER_VERSION, loadFrontmatterDocSync, serializeFrontmatter } from './frontmatter.js';
import { paperDir, projectRoot } from './paths.js';
import { PROJECT_CONFIG_FRAGMENT } from './tutorial.js';
import { CSL_STYLE_KEYS, FALLBACK_DISCIPLINE } from './disciplines.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

/** The INTAKE.md frontmatter version this build writes and reads (CONF-04, S-20; the loader's FRONTMATTER_KINDS.intake). */
export const CURRENT_INTAKE_FRONTMATTER_VERSION = INTAKE_FRONTMATTER_VERSION;

/** Paper types the clarifier suggests and the brief records (GRND-10 reads them). */
export const PAPER_TYPES = [
  'argumentative',
  'persuasive',
  'analytical',
  'expository',
  'literature-review',
  'research-report',
  'lab-report',
  'summary',
  'primer',
  'other',
] as const;
export type PaperType = (typeof PAPER_TYPES)[number];

/** Paper types whose outline must carry a counterargument and rebuttal when auto-detected (PRD §7.4). */
export const ARGUMENTATIVE_PAPER_TYPES: readonly PaperType[] = Object.freeze(['argumentative', 'persuasive']);

/** Paper types that never need one (PRD §7.4: lab reports, summaries, primers). */
export const NON_ARGUMENTATIVE_PAPER_TYPES: readonly PaperType[] = Object.freeze(['lab-report', 'summary', 'primer']);

/** Draft the whole paper, or stop after the approved outline (PRD §7.1 question 2). */
export const PAPER_MODES = ['draft', 'outline'] as const;
export type PaperMode = (typeof PAPER_MODES)[number];

/** The counterargument answer (PRD §7.1 question 5). */
export const COUNTERARGUMENT_ANSWERS = ['yes', 'no', 'auto'] as const;
export type CounterargumentAnswer = (typeof COUNTERARGUMENT_ANSWERS)[number];

/** Where the assignment came from (GRND-01). */
export const ASSIGNMENT_SOURCE_KINDS = ['file', 'at-file', 'stdin', 'cwd', 'paste', 'thesis-seed', 'none'] as const;
export type AssignmentSourceKind = (typeof ASSIGNMENT_SOURCE_KINDS)[number];

export const FollowUpSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    answer: z.string(),
  })
  .strict();
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const AssignmentSourceSchema = z
  .object({
    kind: z.enum(ASSIGNMENT_SOURCE_KINDS),
    /** The file name (never a full path) for file sources; '' otherwise. */
    name: z.string().default(''),
  })
  .strict();

export const IntakeBriefSchema = z.object({
  schema_version: z.literal(CURRENT_INTAKE_FRONTMATTER_VERSION).default(CURRENT_INTAKE_FRONTMATTER_VERSION),
  /** The paper topic in one short phrase (research seeds its queries from it). */
  topic: z.string().default(''),
  /** The working thesis ('' until one is known; the approved outline's thesis wins downstream). */
  thesis: z.string().default(''),
  /** The discipline preset slug (bin/lib/disciplines.ts). */
  discipline: z.string().min(1).default(FALLBACK_DISCIPLINE),
  paper_type: z.enum(PAPER_TYPES).default('other'),
  mode: z.enum(PAPER_MODES).default('draft'),
  ...PROJECT_CONFIG_FRAGMENT,
  class: z.string().min(1).default('Unfiled'),
  counterargument: z.enum(COUNTERARGUMENT_ANSWERS).default('auto'),
  length_target_words: z.number().int().positive().nullable().default(null),
  /** The CSL style key the user asked for ('' = the discipline preset's default). */
  citation_style: z.union([z.literal(''), z.enum(CSL_STYLE_KEYS)]).default(''),
  /** Plain-English sectioning overrides ("a literature review before methods"), passed to the outline. */
  sectioning_notes: z.array(z.string().min(1)).default([]),
  pii_redaction: z.boolean().default(false),
  style_match: z.boolean().default(false),
  assignment_source: AssignmentSourceSchema.default({ kind: 'none', name: '' }),
  /** The clarifier's assignment-specific follow-ups and the user's answers (at most 3, GRND-02). */
  follow_ups: z.array(FollowUpSchema).max(3).default([]),
});
export type IntakeBrief = z.infer<typeof IntakeBriefSchema>;
export type IntakeBriefInput = z.input<typeof IntakeBriefSchema>;

/** One rendered question and its answer (the body's Q/A section). */
export interface IntakeQa {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

/** A parsed INTAKE.md. */
export interface IntakeDocument {
  readonly file: string;
  readonly brief: IntakeBrief;
  /** The assignment as stored (redacted when PII redaction is on). */
  readonly assignment: string;
  /** The version found on disk (0 = a pre-Phase-18 document, migrated in memory). */
  readonly diskVersion: number;
}

/** An INTAKE.md this build cannot use (one line, EXIT_ERROR). */
export class IntakeBriefError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'IntakeBriefError';
  }
}

/** `<root>/.paper/INTAKE.md`. */
export function intakePath(root: string = projectRoot()): string {
  return path.join(paperDir(root), 'INTAKE.md');
}

// ---------------------------------------------------------------------------
// Body: the assignment block and the Q/A section
// ---------------------------------------------------------------------------

export const ASSIGNMENT_START = '<!-- pensmith:assignment:start -->';
export const ASSIGNMENT_END = '<!-- pensmith:assignment:end -->';

/** Keep the assignment from closing its own block. */
function neutraliseAssignmentMarkers(text: string): string {
  return text.split(ASSIGNMENT_START).join('<!-- pensmith:assignment-start -->').split(ASSIGNMENT_END).join('<!-- pensmith:assignment-end -->');
}

/**
 * The assignment text of an INTAKE.md body: the text between the assignment
 * markers; for a migrated v0 document, the text under `## Assignment` up to
 * the next `## ` heading; '' when neither is present.
 */
export function assignmentFromBody(body: string): string {
  const text = body.replace(/\r\n/g, '\n');
  const start = text.indexOf(ASSIGNMENT_START);
  const end = text.indexOf(ASSIGNMENT_END);
  if (start >= 0 && end > start) {
    return text.slice(start + ASSIGNMENT_START.length, end).replace(/^\n+|\n+$/g, '');
  }
  const m = /(?:^|\n)## Assignment[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(text);
  return m ? (m[1] ?? '').replace(/^\n+|\n+$/g, '') : '';
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The INTAKE.md body: the assignment block, then the Q/A section. */
export function renderIntakeBody(assignment: string, qa: readonly IntakeQa[]): string {
  const lines: string[] = [
    '# Intake',
    '',
    '## Assignment',
    '',
    ASSIGNMENT_START,
    neutraliseAssignmentMarkers(assignment.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')) || '(no assignment text)',
    ASSIGNMENT_END,
    '',
    '## Questions and answers',
    '',
  ];
  if (qa.length === 0) lines.push('(none)');
  for (const q of qa) {
    lines.push(`- **${oneLine(q.id)}**: ${oneLine(q.question)}`);
    lines.push(`  - ${oneLine(q.answer) || '(no answer)'}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** The frontmatter object in its canonical key order (the schema's order). */
function orderedFrontmatter(brief: IntakeBrief): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(IntakeBriefSchema.shape)) {
    const v = (brief as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Render a complete INTAKE.md: validated frontmatter (throws on an invalid
 * brief) and the body. The result round-trips through parseIntakeDocument.
 */
export function renderIntakeDocument(brief: IntakeBriefInput, assignment: string, qa: readonly IntakeQa[]): string {
  const parsed = IntakeBriefSchema.parse(brief);
  return `${serializeFrontmatter(orderedFrontmatter(parsed))}\n${renderIntakeBody(assignment, qa)}`;
}

/** Validate a migrated frontmatter object and body as an IntakeDocument. */
export function parseIntakeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  file: string,
  diskVersion: number,
): IntakeDocument {
  const r = IntakeBriefSchema.safeParse(frontmatter);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join('.') : 'frontmatter';
    throw new IntakeBriefError(`${file}: invalid intake field "${where}": ${issue?.message ?? 'invalid'} — fix it or re-run pensmith new`);
  }
  return { file, brief: r.data, assignment: assignmentFromBody(body), diskVersion };
}

/**
 * Read `<root>/.paper/INTAKE.md` through the CONF-04 loader (a v0 document is
 * migrated in memory, never written back here). Returns null when the file is
 * absent; throws IntakeBriefError (or the loader's FrontmatterVersionError)
 * for a document this build cannot use.
 */
export function readIntakeBrief(root: string = projectRoot()): IntakeDocument | null {
  const file = intakePath(root);
  if (!existsSync(file)) return null;
  const doc = loadFrontmatterDocSync('intake', file);
  return parseIntakeFrontmatter(doc.frontmatter, doc.body, file, doc.diskVersion);
}

/** The brief's defaults (what a missing INTAKE.md means to a reader). */
export function defaultIntakeBrief(): IntakeBrief {
  return IntakeBriefSchema.parse({});
}
