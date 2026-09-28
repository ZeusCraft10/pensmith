// bin/lib/intake-questions.ts — the PRD §7.1 intake question battery
// (GRND-02, D-18-09).
//
// ONE ordered list, used by the Tier-2 intake (bin/cli/intake.ts asks it in a
// terminal, reads it from flags and `--answers <file.toml>`, and names the
// unanswered questions when it must refuse) and, from Phase 23, by the Tier-1
// `paper_get_intake_questions` tool (PLUG-07) — so both tiers ask the same
// questions with the same options, flags and answers-file keys.
//
// The third question (what the paper is for) belongs to bin/lib/tutorial.ts:
// it is composed here from TUTORIAL_INTAKE_QUESTION without naming its id,
// key, flag or values (the zero-branch invariant; the lint-tutorial allowlist
// is unchanged). Discipline options come from the preset file through
// bin/lib/disciplines.ts; style names from the alias table in
// bin/lib/schemas/config.ts.
//
// Pure: no I/O, no prompting. Parsing an answer never throws; it returns an
// error string the caller turns into a one-line usage error.

import { disciplineSlugs, presetFor, normalizeDisciplineSlug, FALLBACK_DISCIPLINE, CSL_STYLE_KEYS, type CslStyleKey } from './disciplines.js';
import { citationStyleChoices, citationStyleKey, CITATION_STYLE_NAMES } from './schemas/config.js';
import { COUNTERARGUMENT_ANSWERS, PAPER_MODES, type CounterargumentAnswer, type PaperMode } from './intake-brief.js';
import { TUTORIAL_INTAKE_QUESTION } from './tutorial.js';
import { parseLengthAnswer } from './intake-overrides.js';

/** One answer value: a string, a word count or a yes/no. */
export type IntakeAnswerValue = string | number | boolean;

export type ParsedAnswer = { readonly ok: true; readonly value: IntakeAnswerValue } | { readonly ok: false; readonly error: string };

export interface IntakeOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

/** Stable ids of the questions intake itself defines (the fragment question keeps its own id). */
export const Q = Object.freeze({
  discipline: 'discipline',
  mode: 'mode',
  class: 'class',
  counterargument: 'counterargument',
  styleSamples: 'style_samples',
  pii: 'pii_redaction',
  length: 'length',
  citationStyle: 'citation_style',
});

export interface IntakeQuestion {
  /** Stable id: the Q/A record id, the numbered-prompt id and the `--answers` key. */
  readonly id: string;
  /** The `--answers <file.toml>` key (equal to the id). */
  readonly key: string;
  /** The `pensmith new --<flag>` option ('' when there is none). */
  readonly flag: string;
  /** True for a boolean flag (`--<flag>` / `--no-<flag>`). */
  readonly booleanFlag: boolean;
  readonly label: string;
  /** How the question is asked: a choice, free text, or yes/no. */
  readonly kind: 'select' | 'text' | 'confirm';
  readonly options: readonly IntakeOption[];
  /** A short description of the accepted values (the usage error and `--questions`). */
  readonly accepts: string;
  /**
   * The default when nothing suggests better (mode draft, class Unfiled,
   * counterargument auto, style-match and PII redaction off; the fragment's
   * own default). null: computed from the assignment, the clarifier and the
   * preset (discipline, length, citation style).
   */
  readonly staticDefault: IntakeAnswerValue | null;
  /** Canonical value of a flag, answers-file or prompt answer. */
  parse(raw: unknown): ParsedAnswer;
  /** The answer as the user reads it back (the Q/A section, the --yolo defaults line). */
  display(value: IntakeAnswerValue): string;
}

function ok(value: IntakeAnswerValue): ParsedAnswer {
  return { ok: true, value };
}

function bad(error: string): ParsedAnswer {
  return { ok: false, error };
}

function str(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/** yes / no answers in their common spellings. */
function yesNo(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  const s = str(raw)?.toLowerCase();
  if (s === undefined || s === null) return null;
  if (['y', 'yes', 'true', 'on', '1'].includes(s)) return true;
  if (['n', 'no', 'false', 'off', '0'].includes(s)) return false;
  return null;
}

/** The fallback preset's own names ("other", "custom", …) — an explicit choice of it. */
function namesFallback(text: string): boolean {
  const p = presetFor(FALLBACK_DISCIPLINE);
  const t = text.trim().toLowerCase();
  return [p.slug, p.name.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase())].some((n) => t === n || t.startsWith(`${n} `) || t.startsWith(`${n} /`));
}

/** A discipline answer → a preset slug; free text is normalised, anything unknown is refused. */
export function parseDisciplineAnswer(raw: unknown): ParsedAnswer {
  const s = str(raw);
  if (s === null || s.length === 0) return bad(`a discipline is required (one of: ${disciplineSlugs().join(', ')})`);
  const slug = normalizeDisciplineSlug(s);
  if (slug === FALLBACK_DISCIPLINE && !namesFallback(s)) {
    return bad(`unknown discipline "${s}" (one of: ${disciplineSlugs().join(', ')})`);
  }
  return ok(slug);
}

/** A citation-style answer → a CSL key; unknown names are refused with the 8 styles (GRND-04). */
export function parseCitationStyleAnswer(raw: unknown): ParsedAnswer {
  const s = str(raw);
  if (s === null || s.length === 0) return bad(`a citation style is required (valid styles: ${citationStyleChoices()})`);
  const key = citationStyleKey(s);
  if (key === null) return bad(`unknown citation style "${s}" (valid styles: ${citationStyleChoices()})`);
  return ok(key);
}

const STYLE_DISPLAY: Readonly<Record<CslStyleKey, string>> = Object.freeze({
  apa: CITATION_STYLE_NAMES[0],
  mla: CITATION_STYLE_NAMES[1],
  'chicago-notes-bib': CITATION_STYLE_NAMES[2],
  'chicago-author-date': CITATION_STYLE_NAMES[3],
  ieee: CITATION_STYLE_NAMES[4],
  ama: CITATION_STYLE_NAMES[5],
  vancouver: CITATION_STYLE_NAMES[6],
  harvard: CITATION_STYLE_NAMES[7],
});

/** The display name of a CSL key ("chicago-notes-bib" → "Chicago (Notes-Bibliography)"). */
export function citationStyleDisplay(key: string): string {
  return (STYLE_DISPLAY as Record<string, string>)[key] ?? key;
}

function disciplineQuestion(): IntakeQuestion {
  const options: IntakeOption[] = disciplineSlugs().map((slug) => {
    const p = presetFor(slug);
    return { value: slug, label: p.name, hint: `${citationStyleDisplay(p.defaultCitationStyle)}; ${p.defaultTone} tone` };
  });
  return {
    id: Q.discipline,
    key: Q.discipline,
    flag: 'discipline',
    booleanFlag: false,
    label: 'Which discipline preset fits this paper?',
    kind: 'select',
    options,
    accepts: `a preset slug, name or common abbreviation (${disciplineSlugs().join(', ')})`,
    staticDefault: null,
    parse: parseDisciplineAnswer,
    display: (v) => {
      const slug = String(v);
      return `${presetFor(slug).name} (${slug})`;
    },
  };
}

function modeQuestion(): IntakeQuestion {
  return {
    id: Q.mode,
    key: Q.mode,
    flag: 'mode',
    booleanFlag: false,
    label: 'Draft the whole paper, or stop after the approved outline?',
    kind: 'select',
    options: [
      { value: 'draft', label: 'Full draft', hint: 'research, outline, every section, compile and export' },
      { value: 'outline', label: 'Outline only', hint: 'stops after outline approval: a sourced outline and annotated bibliography' },
    ],
    accepts: `${PAPER_MODES.join(' or ')}`,
    staticDefault: 'draft' satisfies PaperMode,
    parse: (raw) => {
      const s = str(raw)?.toLowerCase().replace(/[\s_]+/g, '-');
      if (s === 'draft' || s === 'full' || s === 'full-draft') return ok('draft' satisfies PaperMode);
      if (s === 'outline' || s === 'outline-only') return ok('outline' satisfies PaperMode);
      return bad(`mode must be draft or outline (got ${JSON.stringify(raw)})`);
    },
    display: (v) => (v === 'outline' ? 'outline only' : 'full draft'),
  };
}

/** The fragment-owned question (bin/lib/tutorial.ts), composed without naming it. */
function fragmentQuestion(): IntakeQuestion {
  const f = TUTORIAL_INTAKE_QUESTION;
  return {
    id: f.id,
    key: f.key,
    flag: f.flag,
    booleanFlag: false,
    label: f.label,
    kind: 'select',
    options: f.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
    accepts: f.options.map((o) => o.value).join(', '),
    staticDefault: f.defaultValue,
    parse: (raw) => {
      const v = f.parse(raw);
      return v === null ? bad(`${f.flag} must be one of: ${f.options.map((o) => o.value).join(', ')} (got ${JSON.stringify(raw)})`) : ok(v);
    },
    display: (v) => f.options.find((o) => o.value === v)?.label ?? String(v),
  };
}

function classQuestion(): IntakeQuestion {
  return {
    id: Q.class,
    key: Q.class,
    flag: 'class',
    booleanFlag: false,
    label: 'Which class is this paper for? (groups your papers in `pensmith list`)',
    kind: 'text',
    options: [],
    accepts: 'a short class name, e.g. "PHIL 101" (default Unfiled)',
    staticDefault: 'Unfiled',
    parse: (raw) => {
      const s = str(raw);
      if (s === null || s.length === 0) return ok('Unfiled');
      if (s.length > 80) return bad('the class name is longer than 80 characters');
      return ok(s.replace(/\s+/g, ' '));
    },
    display: (v) => String(v),
  };
}

function counterargumentQuestion(): IntakeQuestion {
  return {
    id: Q.counterargument,
    key: Q.counterargument,
    flag: 'counterargument',
    booleanFlag: false,
    label: 'Include a counterargument and rebuttal section?',
    kind: 'select',
    options: [
      { value: 'auto', label: 'Auto', hint: 'decided by the paper type and the discipline preset (§7.4)' },
      { value: 'yes', label: 'Yes', hint: 'the outline must hold a counterargument and a rebuttal' },
      { value: 'no', label: 'No' },
    ],
    accepts: COUNTERARGUMENT_ANSWERS.join(', '),
    staticDefault: 'auto' satisfies CounterargumentAnswer,
    parse: (raw) => {
      const s = str(raw)?.toLowerCase();
      if (s === 'auto' || s === 'automatic' || s === 'default') return ok('auto' satisfies CounterargumentAnswer);
      const yn = yesNo(raw);
      if (yn === true) return ok('yes' satisfies CounterargumentAnswer);
      if (yn === false) return ok('no' satisfies CounterargumentAnswer);
      return bad(`counterargument must be yes, no or auto (got ${JSON.stringify(raw)})`);
    },
    display: (v) => String(v),
  };
}

function styleSamplesQuestion(): IntakeQuestion {
  return {
    id: Q.styleSamples,
    key: Q.styleSamples,
    flag: 'style-samples',
    booleanFlag: false,
    label: 'Match your past writing? Enter a folder of your writing samples (.md, .txt, .docx), or leave blank to skip',
    kind: 'text',
    options: [],
    accepts: 'a folder of your writing samples, or "no" to skip (opt-in; PRD §7.18)',
    staticDefault: '',
    parse: (raw) => {
      if (raw === false) return ok('');
      const s = str(raw);
      if (s === null) return bad('style samples must be a folder path or "no"');
      if (s.length === 0 || ['no', 'n', 'none', 'off', 'skip', 'false'].includes(s.toLowerCase())) return ok('');
      return ok(s);
    },
    display: (v) => (v === '' ? 'off' : `on (samples in ${String(v)})`),
  };
}

function piiQuestion(): IntakeQuestion {
  return {
    id: Q.pii,
    key: Q.pii,
    flag: 'pii-redact',
    booleanFlag: true,
    label: 'Redact personal information (names, IDs, emails, phone numbers, dates) before any model call?',
    kind: 'confirm',
    options: [],
    accepts: 'yes or no (opt-in; default no)',
    staticDefault: false,
    parse: (raw) => {
      const yn = yesNo(raw);
      return yn === null ? bad(`pii_redaction must be yes or no (got ${JSON.stringify(raw)})`) : ok(yn);
    },
    display: (v) => (v === true ? 'on' : 'off'),
  };
}

function lengthQuestion(): IntakeQuestion {
  return {
    id: Q.length,
    key: Q.length,
    flag: 'length',
    booleanFlag: false,
    label: 'Target length in words?',
    kind: 'text',
    options: [],
    accepts: 'a word count (100–50000), or a page count such as "6 pages" (300 words a page)',
    staticDefault: null,
    parse: (raw) => {
      if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw >= 100 && raw <= 50_000 ? ok(raw) : bad(`length must be a word count from 100 to 50000 (got ${raw})`);
      }
      const s = str(raw);
      const n = s === null ? null : parseLengthAnswer(s);
      return n === null ? bad(`length must be a word count from 100 to 50000, or "N pages" (got ${JSON.stringify(raw)})`) : ok(n);
    },
    display: (v) => `${String(v)} words`,
  };
}

function citationStyleQuestion(): IntakeQuestion {
  return {
    id: Q.citationStyle,
    key: Q.citationStyle,
    flag: 'citation-style',
    booleanFlag: false,
    label: 'Which citation style?',
    kind: 'select',
    options: CSL_STYLE_KEYS.map((k) => ({ value: k, label: citationStyleDisplay(k) })),
    accepts: citationStyleChoices(),
    staticDefault: null,
    parse: parseCitationStyleAnswer,
    display: (v) => citationStyleDisplay(String(v)),
  };
}

/**
 * The PRD §7.1 battery in asking order. PII redaction comes FIRST: it must be
 * settled before the assignment reaches any model (GRND-05), so it is asked
 * before the clarifier call; the rest are asked after it, with the
 * clarifier's suggestions as defaults — discipline, mode, the fragment
 * question, class, counterargument, style-match, length, citation style.
 */
export function intakeQuestions(): IntakeQuestion[] {
  return [
    piiQuestion(),
    disciplineQuestion(),
    modeQuestion(),
    fragmentQuestion(),
    classQuestion(),
    counterargumentQuestion(),
    styleSamplesQuestion(),
    lengthQuestion(),
    citationStyleQuestion(),
  ];
}

/** Keys an `--answers` file may hold besides the questions' (the thesis seed and the follow-up table). */
export const EXTRA_ANSWER_KEYS: readonly string[] = Object.freeze(['thesis', 'follow_ups']);

/** Every key an `--answers` file may hold, in battery order. */
export function answersFileKeys(): string[] {
  return [...intakeQuestions().map((q) => q.key), ...EXTRA_ANSWER_KEYS];
}

/** A JSON-able description of the battery (`pensmith new --questions`; the Tier-1 workflow body reads it). */
export function describeIntakeQuestions(): Array<Record<string, unknown>> {
  return intakeQuestions().map((q) => ({
    id: q.id,
    label: q.label,
    kind: q.kind,
    ...(q.options.length > 0 ? { options: q.options.map((o) => ({ value: o.value, label: o.label, ...(o.hint ? { hint: o.hint } : {}) })) } : {}),
    flag: q.booleanFlag ? `--${q.flag} / --no-${q.flag}` : `--${q.flag}`,
    answers_key: q.key,
    accepts: q.accepts,
  }));
}
