// bin/lib/intake-record.ts — what intake collects, and how it is stored.
//
// Intake keeps two things:
//   - the assignment, word for word, under `## Assignment` in .paper/PROJECT.md
//     (redacted when PII redaction is on; the raw text is in INTAKE.raw.local);
//   - the user's answers to the clarifying questions, as structured fields in
//     .paper/INTAKE.json. INTAKE.md is a readable copy of them.
// research, outline and done read the fields from INTAKE.json. Each answer is
// checked here when it is given, so a stored intake is always usable.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { disciplinePreset, normalizeStyleName, SUPPORTED_STYLES } from './citations.js';
import { parseIntakeMd } from './intake-parse.js';
import { paperDir, paperIntakeFile } from './paths.js';

/** The questions intake asks, in the order it asks them. */
export const QUESTION_IDS = ['topic', 'discipline', 'length_words', 'citation_style', 'audience', 'counterargument'] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

/** The disciplines with a preset in templates/presets/disciplines.json, and `other`. */
export const DISCIPLINES = [
  'computer-science', 'biology', 'history', 'literature', 'psychology', 'economics', 'philosophy', 'sociology', 'other',
] as const;

export const COUNTERARGUMENT = ['required', 'optional', 'none'] as const;
export type Counterargument = (typeof COUNTERARGUMENT)[number];

export const IntakeSchema = z.object({
  $schemaVersion: z.literal(1),
  topic: z.string().min(1).max(300),
  discipline: z.enum(DISCIPLINES),
  length_words: z.number().int().min(100).max(100_000),
  citation_style: z.string().refine((s) => SUPPORTED_STYLES.includes(s), 'not a supported citation style'),
  audience: z.string().min(1).max(300),
  counterargument: z.enum(COUNTERARGUMENT),
}).strict();
export type Intake = z.infer<typeof IntakeSchema>;

/** What the intake clarifier model returns: its reading of the topic, and the questions to ask. */
export const ClarifierSchema = z.object({
  topic: z.string(),
  questions: z.array(z.object({
    id: z.enum(QUESTION_IDS),
    question: z.string(),
    suggested: z.string(),
  }).strict()),
}).strict();
export type ClarifierAnswer = z.infer<typeof ClarifierSchema>;

export interface Question {
  /** A question id, or 'assignment' when the assignment itself is asked for. */
  id: QuestionId | 'assignment';
  question: string;
  /** A suggested answer the user can accept; empty when there is none. */
  suggested: string;
  /** The answers that are accepted, when the answer is a choice. */
  options?: readonly string[];
}

const DISCIPLINE_WORDS: ReadonlyArray<[RegExp, (typeof DISCIPLINES)[number]]> = [
  [/\b(cs|computer[-\s]?science|computing|ai|ml|software)\b/, 'computer-science'],
  [/\b(bio|biology|biological|life sciences?)\b/, 'biology'],
  [/\b(hist|history|historical)\b/, 'history'],
  [/\b(lit|literature|literary|english)\b/, 'literature'],
  [/\b(psych|psychology|psychological)\b/, 'psychology'],
  [/\b(econ|economics|economic)\b/, 'economics'],
  [/\b(phil|philosophy|philosophical|ethics)\b/, 'philosophy'],
  [/\b(soc|sociology|sociological)\b/, 'sociology'],
  [/\bother\b/, 'other'],
];

/** The discipline preset an answer names; `other` for one pensmith has no preset for. */
export function disciplineFromAnswer(answer: string): (typeof DISCIPLINES)[number] {
  const a = answer.trim().toLowerCase();
  if ((DISCIPLINES as readonly string[]).includes(a)) return a as (typeof DISCIPLINES)[number];
  for (const [re, key] of DISCIPLINE_WORDS) if (re.test(a)) return key;
  return 'other';
}

/** Words a page holds, double-spaced, for a length given in pages. */
const WORDS_PER_PAGE = 275;

/** The length an answer gives, in words, or null. */
export function lengthFromAnswer(answer: string): number | null {
  const m = /^\s*(?:about|around|~)?\s*([\d][\d,.]*)\s*(k)?\s*(words?|pages?|pp\.?)?\s*$/i.exec(answer);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(n) || n <= 0) return null;
  const words = /^p/i.test(m[3] ?? '') ? n * WORDS_PER_PAGE : n;
  return Math.round(words);
}

/** The counterargument expectation an answer gives, or null. */
export function counterargumentFromAnswer(answer: string): Counterargument | null {
  const a = answer.trim().toLowerCase();
  if (/^(required|yes|y|must|needed|true)\b/.test(a)) return 'required';
  if (/^(optional|maybe|if useful|either)\b/.test(a)) return 'optional';
  if (/^(none|no|n|not applicable|n\/a|false)\b/.test(a)) return 'none';
  return null;
}

/** One answer, checked: the stored value, or why it cannot be used. */
export function checkAnswer(id: QuestionId, raw: unknown): { ok: true; value: string | number } | { ok: false; why: string } {
  const answer = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (answer === '') return { ok: false, why: 'it is empty' };
  switch (id) {
    case 'topic':
    case 'audience':
      return answer.length <= 300 ? { ok: true, value: answer } : { ok: false, why: 'it is longer than 300 characters' };
    case 'discipline':
      return { ok: true, value: disciplineFromAnswer(answer) };
    case 'length_words': {
      const n = lengthFromAnswer(answer);
      if (n === null) return { ok: false, why: 'give a number of words, such as 2500, or of pages, such as 10 pages' };
      if (n < 100 || n > 100_000) return { ok: false, why: `${n} words is outside 100 to 100000` };
      return { ok: true, value: n };
    }
    case 'citation_style': {
      const style = normalizeStyleName(answer);
      return style ? { ok: true, value: style } : { ok: false, why: `pensmith has no '${answer}' style; supported: ${SUPPORTED_STYLES.join(', ')}` };
    }
    case 'counterargument': {
      const c = counterargumentFromAnswer(answer);
      return c ? { ok: true, value: c } : { ok: false, why: 'answer required, optional or none' };
    }
  }
}

const DEFAULT_QUESTIONS: Record<QuestionId, string> = {
  topic: 'In a short phrase, what is the paper about?',
  discipline: `Which discipline is it for? (${DISCIPLINES.join(', ')})`,
  length_words: 'How long should it be? (words, or pages)',
  citation_style: `Which citation style? (${SUPPORTED_STYLES.join(', ')})`,
  audience: 'Who is it for? (for example: an undergraduate course, a graduate seminar, a journal)',
  counterargument: 'Should it include a counterargument and rebuttal section? (required, optional, none)',
};

/**
 * The questions to ask about `assignment`: the clarifier's wording and
 * suggestions where it gave them (null when no model ran), else pensmith's own.
 * Every question is asked; a suggestion is only a default the user can accept.
 */
export function buildQuestions(assignment: string, clarifier: ClarifierAnswer | null): Question[] {
  const fromModel = new Map((clarifier?.questions ?? []).map((q) => [q.id, q]));
  const fallbackTopic = clarifier?.topic.trim() || parseIntakeMd(assignment).topic;
  return QUESTION_IDS.map((id) => {
    const q = fromModel.get(id);
    let suggested = q?.suggested.trim() ?? '';
    if (id === 'topic' && !suggested) suggested = fallbackTopic;
    // A suggestion pensmith could not use is not offered.
    if (suggested && !checkAnswer(id, suggested).ok) suggested = '';
    const options =
      id === 'discipline' ? DISCIPLINES : id === 'citation_style' ? SUPPORTED_STYLES : id === 'counterargument' ? COUNTERARGUMENT : undefined;
    return { id, question: q?.question.trim() || DEFAULT_QUESTIONS[id], suggested, ...(options ? { options } : {}) };
  });
}

/** The counterargument default of a discipline's preset. */
export function presetCounterargument(discipline: string): Counterargument {
  return disciplinePreset(discipline)?.['counterargDefault'] === 'required' ? 'required' : 'optional';
}

/** The stored intake built from a full set of checked answers. */
export function intakeFromAnswers(answers: Record<QuestionId, string | number>): Intake {
  return IntakeSchema.parse({ $schemaVersion: 1, ...answers });
}

/** INTAKE.md: the answers, readable. */
export function renderIntakeMd(intake: Intake): string {
  return [
    '# Intake',
    '',
    `Topic: ${intake.topic}`,
    `Discipline: ${intake.discipline}`,
    `Length: ${intake.length_words} words`,
    `Citation style: ${intake.citation_style}`,
    `Audience: ${intake.audience}`,
    `Counterargument: ${intake.counterargument}`,
    '',
  ].join('\n');
}

/** PROJECT.md: the assignment word for word, last in the file. */
export function renderProjectMd(title: string, assignment: string): string {
  return `# ${title}\n\n## Assignment\n\n${assignment.trim()}\n`;
}

/**
 * The assignment kept in .paper/PROJECT.md, or null. It is everything after
 * the `## Assignment` heading, since renderProjectMd writes nothing after it:
 * a rubric's own `## Requirements` heading is part of the assignment.
 */
export function readAssignment(root: string): string | null {
  try {
    const text = readFileSync(path.join(paperDir(root), 'PROJECT.md'), 'utf8');
    const m = /^## Assignment[ \t]*\r?\n/m.exec(text);
    if (!m) return null;
    const body = text.slice(m.index + m[0].length).trim();
    return body ? body : null;
  } catch {
    return null;
  }
}

/**
 * The paper's intake: INTAKE.json when it is there and valid, else (for a
 * paper intake wrote before INTAKE.json existed) what INTAKE.md says, else null.
 */
export function readIntake(root: string): { topic: string; discipline: string; assignment: string; intake: Intake | null } | null {
  const assignment = readAssignment(root) ?? '';
  const file = paperIntakeFile(root);
  if (existsSync(file)) {
    try {
      const intake = IntakeSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      return { topic: intake.topic, discipline: intake.discipline, assignment, intake };
    } catch {
      // fall through to INTAKE.md
    }
  }
  try {
    const md = readFileSync(path.join(paperDir(root), 'INTAKE.md'), 'utf8');
    const parsed = parseIntakeMd(md);
    return { topic: parsed.topic, discipline: parsed.discipline, assignment: assignment || parsed.assignment, intake: null };
  } catch {
    return assignment ? { topic: parseIntakeMd(assignment).topic, discipline: 'other', assignment, intake: null } : null;
  }
}
