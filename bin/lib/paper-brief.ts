// bin/lib/paper-brief.ts — the paper brief as outline, plan and write read it
// (D-18-20, GRND-12, FEED-02, FEED-03).
//
// One reader composes the inputs every generative section step shares:
//   - INTAKE.md through readIntakeBrief (the versioned brief; a v0 file is
//     migrated in memory): topic, thesis, discipline, paper type, the
//     counterargument answer, the length target and the sectioning notes;
//   - config.toml [project] (config.ts): title, length_target_words,
//     discipline_preset and counterargument_required;
//   - the discipline preset through resolveDiscipline (preset < intake answer <
//     config.toml): tone and sectioning convention (GRND-06);
//   - the approved outline's thesis, which wins over the brief's once one
//     exists (the effective thesis).
// Length target: config.toml > the brief > the assignment's stated length >
// 1500 words. Never writes.

import { readIntakeBrief, type CounterargumentAnswer, type IntakeDocument, type PaperType } from './intake-brief.js';
import { tryReadPaperConfigSync } from './config.js';
import { resolveDiscipline, type ResolvedDiscipline } from './disciplines.js';
import { parseLengthWords } from './estimator.js';
import { readOutlineSync } from './outline.js';

/** The fallback length target (PRD §7.1). */
export const DEFAULT_LENGTH_TARGET_WORDS = 1500;

export interface PaperBrief {
  /** The parsed INTAKE.md, or null when the paper has none. */
  readonly doc: IntakeDocument | null;
  readonly topic: string;
  /** The brief's own thesis ('' until one is known). */
  readonly briefThesis: string;
  /** The effective thesis: the approved outline's, else the brief's. */
  readonly thesis: string;
  /** The paper title: config.toml [project] title, else the topic. */
  readonly title: string;
  readonly discipline: ResolvedDiscipline;
  readonly paperType: PaperType;
  readonly counterargument: CounterargumentAnswer;
  /** config.toml [project] counterargument_required, when set. */
  readonly configCounterargument: boolean | undefined;
  readonly lengthTarget: number;
  readonly sectioningNotes: readonly string[];
  /** The assignment as INTAKE.md stores it (redacted when PII redaction is on). */
  readonly assignment: string;
}

/**
 * Read the brief of the paper at `root`. Throws the intake loader's one-line
 * error for an INTAKE.md this build cannot use; a missing INTAKE.md reads as
 * the brief's defaults.
 */
export function readPaperBrief(root: string): PaperBrief {
  const doc = readIntakeBrief(root);
  const config = tryReadPaperConfigSync(root);
  const project = config?.project;
  const brief = doc?.brief;
  const assignment = doc?.assignment ?? '';
  const topic = (brief?.topic ?? '').trim() || (project?.title ?? '').trim();
  const briefThesis = (brief?.thesis ?? '').trim();
  const outlineThesis = readOutlineSync(root)?.thesis.trim() ?? '';
  const discipline = resolveDiscipline({
    discipline: { intake: brief?.discipline, config: project?.discipline_preset },
  });
  const lengthTarget =
    project?.length_target_words ??
    brief?.length_target_words ??
    (assignment ? parseLengthWords(assignment) : null) ??
    DEFAULT_LENGTH_TARGET_WORDS;
  return {
    doc,
    topic,
    briefThesis,
    thesis: outlineThesis || briefThesis,
    title: (project?.title ?? '').trim() || topic,
    discipline,
    paperType: brief?.paper_type ?? 'other',
    counterargument: brief?.counterargument ?? 'auto',
    configCounterargument: project?.counterargument_required,
    lengthTarget,
    sectioningNotes: brief?.sectioning_notes ?? [],
    assignment,
  };
}
