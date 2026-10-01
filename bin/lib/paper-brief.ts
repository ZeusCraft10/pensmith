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
    title: (project?.title ?? '').trim() || titleFromTopic(topic),
    discipline,
    paperType: brief?.paper_type ?? 'other',
    counterargument: brief?.counterargument ?? 'auto',
    configCounterargument: project?.counterargument_required,
    lengthTarget,
    sectioningNotes: brief?.sectioning_notes ?? [],
    assignment,
  };
}

/** Words a title keeps in lower case unless they open or close it (or follow a colon). */
const TITLE_SMALL_WORDS: ReadonlySet<string> = new Set(
  'a an and as at but by down for from in into nor of off on onto or over per so than the till to up upon via vs with yet'.split(' '),
);

/**
 * The paper's title when `[project] title` is unset (review round 3: every
 * export was headed by the intake's lowercase topic phrase): the topic in
 * title case — each word's first letter capitalised (each part of a
 * hyphenated word), the short function words lower case unless they open or
 * close the title or follow a colon, and a word that already holds a capital
 * (an acronym, `iPhone`, a name the user typed) kept as written. Set
 * `[project] title` in config.toml — or edit OUTLINE.md's first line — for
 * any other title. Pure.
 */
export function titleFromTopic(topic: string): string {
  const words = topic.trim().split(/(\s+)/u);
  const real = words.map((w, i) => ({ w, i })).filter((x) => x.w.trim() !== '');
  const firstIndex = real[0]?.i ?? -1;
  const lastIndex = real[real.length - 1]?.i ?? -1;
  let afterColon = false;
  return words
    .map((w, i) => {
      if (w.trim() === '') return w;
      const opens = i === firstIndex || afterColon;
      afterColon = /:$/u.test(w);
      if (/\p{Lu}/u.test(w)) return w;
      const bare = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!opens && i !== lastIndex && TITLE_SMALL_WORDS.has(bare)) return w;
      return w.split('-').map((part) => part.replace(/\p{L}/u, (c) => c.toUpperCase())).join('-');
    })
    .join('');
}
