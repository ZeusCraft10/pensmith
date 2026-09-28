// bin/lib/intake-answers.ts — collecting the §7.1 battery answers (GRND-02,
// D-18-09).
//
// Where an answer comes from, highest first:
//   1. a CLI flag (`--discipline psychology`, `--pii-redact`, …);
//   2. the `--answers <file.toml>` file (read by bin/lib/config.ts, the one
//      smol-toml reader; unknown keys are refused with the valid list);
//   3. the terminal: each unanswered question is asked with the clarifier's
//      (or the preset's) suggestion as its default — or, under --yolo, the
//      suggestion is accepted and printed (the `intake-defaults` gate's yolo
//      choice).
// `.paper/config.toml` is an OUTPUT of intake (the [project]/[style] mirror),
// never an input: re-running `new` asks the battery afresh, and a replayed
// intake (`resume --replay`) builds the identical clarifier request.
// A run that cannot prompt, lacks --yolo and leaves a question unanswered is
// refused through the `intake-defaults` gate (EXIT_APPROVAL) BEFORE any model
// call or write; bin/cli/intake.ts calls refuseUnanswered() first thing.
//
// Asking is injected (`ask`), so this module never imports the prompt layer
// (the gate-registry chokepoint lets only gates.ts and the content-question
// verbs call ask(); bin/cli/intake.ts passes it in).

import { PensmithError, EXIT_USAGE } from './exit-codes.js';
import { GateRefusedError, canPrompt, gateDef, runGate } from './gates.js';
import { PromptAbortedError, PromptTimeoutError, type PromptAnswer, type PromptQuestion } from './prompts.js';
import { EXTRA_ANSWER_KEYS, answersFileKeys, type IntakeAnswerValue, type IntakeQuestion } from './intake-questions.js';

/** Where a battery answer came from (printed with --yolo, recorded in the Q/A section). */
export type AnswerSource = 'flag' | 'answers' | 'asked' | 'default';

export interface ResolvedAnswer {
  readonly value: IntakeAnswerValue;
  readonly source: AnswerSource;
}

/** The answers fixed before any model call: flags and the answers file. */
export interface FixedAnswers {
  readonly values: ReadonlyMap<string, ResolvedAnswer>;
  /** `[follow_ups]` of the answers file: follow-up id → answer. */
  readonly followUps: ReadonlyMap<string, string>;
  /** `thesis` of the answers file ('' when absent). */
  readonly thesis: string;
}

export interface CollectInput {
  readonly questions: readonly IntakeQuestion[];
  /** Flag name (IntakeQuestion.flag) → raw value, for the flags the user gave (undefined = not given). */
  readonly flags: Readonly<Record<string, unknown>>;
  /** The `--answers` file: its path (for messages) and its parsed TOML. */
  readonly answersFile?: { readonly path: string; readonly data: Readonly<Record<string, unknown>> } | null;
}

function usage(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Collect the answers given before intake starts. Throws a one-line
 * EXIT_USAGE PensmithError for an invalid flag value, an unknown answers-file
 * key or an invalid answers-file value — nothing has been sent or written.
 */
export function collectFixedAnswers(input: CollectInput): FixedAnswers {
  const values = new Map<string, ResolvedAnswer>();
  const file = input.answersFile ?? null;
  if (file) {
    const valid = answersFileKeys();
    for (const key of Object.keys(file.data)) {
      if (!valid.includes(key)) {
        throw usage(`--answers ${file.path}: unknown key "${key}" (valid keys: ${valid.join(', ')})`);
      }
    }
  }
  for (const q of input.questions) {
    const flagRaw = input.flags[q.flag];
    if (flagRaw !== undefined) {
      const r = q.parse(flagRaw);
      if (!r.ok) throw usage(`--${q.flag}: ${r.error}`);
      values.set(q.id, { value: r.value, source: 'flag' });
      continue;
    }
    if (file && Object.prototype.hasOwnProperty.call(file.data, q.key)) {
      const r = q.parse(file.data[q.key]);
      if (!r.ok) throw usage(`--answers ${file.path}: ${q.key}: ${r.error}`);
      values.set(q.id, { value: r.value, source: 'answers' });
    }
  }
  const followUps = new Map<string, string>();
  let thesis = '';
  if (file) {
    const fu = file.data[EXTRA_ANSWER_KEYS[1] as string];
    if (fu !== undefined) {
      if (!isPlainObject(fu)) throw usage(`--answers ${file.path}: follow_ups must be a table of <follow-up id> = "answer"`);
      for (const [id, a] of Object.entries(fu)) {
        if (typeof a !== 'string' && typeof a !== 'number' && typeof a !== 'boolean') {
          throw usage(`--answers ${file.path}: follow_ups.${id} must be a string`);
        }
        followUps.set(id, String(a).trim());
      }
    }
    const t = file.data[EXTRA_ANSWER_KEYS[0] as string];
    if (t !== undefined) {
      if (typeof t !== 'string') throw usage(`--answers ${file.path}: thesis must be a string`);
      thesis = t.trim();
    }
  }
  return { values, followUps, thesis };
}

/** The battery questions no flag or answers-file value answered, in order. */
export function unansweredQuestions(questions: readonly IntakeQuestion[], fixed: FixedAnswers): IntakeQuestion[] {
  return questions.filter((q) => !fixed.values.has(q.id));
}

/** "discipline (--discipline), mode (--mode), …" — how to answer each one without a terminal. */
export function unansweredDetail(missing: readonly IntakeQuestion[]): string {
  const names = missing.map((q) => `${q.id} (--${q.flag}${q.booleanFlag ? ` / --no-${q.flag}` : ''})`);
  return `unanswered: ${names.join(', ')} — answer them with those flags or --answers <file.toml>`;
}

/**
 * GRND-02: a run that cannot prompt, without --yolo, with unanswered
 * questions is refused through the `intake-defaults` gate (EXIT_APPROVAL),
 * naming them. Call it before any model call or write.
 */
export async function refuseUnanswered(missing: readonly IntakeQuestion[], yolo: boolean): Promise<void> {
  if (missing.length === 0 || yolo) return;
  // runGate refuses (throws) only when the run cannot prompt; a terminal or
  // scripted numbered answers get the questions asked one by one later.
  if (!canPrompt()) await runGate('intake-defaults', { yolo: false, detail: unansweredDetail(missing) });
}

/** The refusal when scripted answers run out part-way through the battery. */
export function answersRanOut(missing: readonly IntakeQuestion[]): GateRefusedError {
  const def = gateDef('intake-defaults');
  return new GateRefusedError(
    def,
    `${def.label} (${unansweredDetail(missing)}; the piped answers ran out) needs an answer: re-run in a terminal, or pass --yolo to ${def.yoloChoice}.`,
    def.nonTtyExit,
  );
}

/** A battery question as a prompt question, with `suggestion` as its default. */
export function promptFor(q: IntakeQuestion, suggestion: IntakeAnswerValue | undefined): PromptQuestion {
  if (q.kind === 'confirm') {
    return { id: q.id, kind: 'confirm', label: q.label, default: suggestion === true };
  }
  if (q.kind === 'select') {
    const options = q.options.map((o) => (o.hint !== undefined ? { value: o.value, label: o.label, hint: o.hint } : { value: o.value, label: o.label }));
    const def = suggestion !== undefined && options.some((o) => o.value === String(suggestion)) ? String(suggestion) : undefined;
    return def !== undefined ? { id: q.id, kind: 'select', label: q.label, options, default: def } : { id: q.id, kind: 'select', label: q.label, options };
  }
  const def = suggestion === undefined || suggestion === '' ? undefined : String(suggestion);
  return def !== undefined ? { id: q.id, kind: 'text', label: q.label, default: def } : { id: q.id, kind: 'text', label: q.label };
}

function answerValue(a: PromptAnswer): unknown {
  return a.value;
}

export interface ResolveBatteryOptions {
  readonly questions: readonly IntakeQuestion[];
  readonly fixed: FixedAnswers;
  /** The default for `q` given the answers so far (the clarifier's suggestion, else the preset's). */
  suggest(q: IntakeQuestion, sofar: ReadonlyMap<string, ResolvedAnswer>): IntakeAnswerValue;
  readonly yolo: boolean;
  /** The run can prompt (a terminal, or scripted numbered answers). */
  readonly canPrompt: boolean;
  ask(q: PromptQuestion): Promise<PromptAnswer>;
  /** Where a re-ask explanation goes (stderr). */
  note(line: string): void;
}

/**
 * Answer every battery question: fixed answers first; then, per unanswered
 * question in order, the suggestion (under --yolo, or when nothing can be
 * asked — refuseUnanswered() already stopped a run that must not default) or
 * the user's answer (asked with the suggestion as default; an invalid answer
 * is asked again, up to three times). Scripted answers that run out raise the
 * `intake-defaults` refusal naming what is left.
 */
export async function resolveBattery(opts: ResolveBatteryOptions): Promise<Map<string, ResolvedAnswer>> {
  const out = new Map<string, ResolvedAnswer>();
  for (const [i, q] of opts.questions.entries()) {
    const fixed = opts.fixed.values.get(q.id);
    if (fixed) {
      out.set(q.id, fixed);
      continue;
    }
    const suggestion = opts.suggest(q, out);
    if (opts.yolo || !opts.canPrompt) {
      out.set(q.id, { value: suggestion, source: 'default' });
      continue;
    }
    let answered: ResolvedAnswer | null = null;
    for (let attempt = 0; attempt < 3 && answered === null; attempt += 1) {
      let a: PromptAnswer;
      try {
        a = await opts.ask(promptFor(q, suggestion));
      } catch (e) {
        if (e instanceof PromptAbortedError || e instanceof PromptTimeoutError) {
          throw answersRanOut(opts.questions.slice(i).filter((x) => !opts.fixed.values.has(x.id)));
        }
        throw e;
      }
      const raw = answerValue(a);
      const r = q.parse(raw);
      if (r.ok) answered = { value: r.value, source: 'asked' };
      else opts.note(`pensmith new: ${r.error} — try again`);
    }
    if (answered === null) throw usage(`pensmith new: no valid answer for "${q.label}" after three tries`);
    out.set(q.id, answered);
  }
  return out;
}

/** One clarifier follow-up with its suggested answer. */
export interface FollowUpPrompt {
  readonly id: string;
  readonly question: string;
  readonly suggested_answer: string;
}

/** A follow-up with the answer recorded and how it was obtained. */
export interface FollowUpAnswer {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly how: 'answers' | 'asked' | 'suggested';
}

/**
 * The ≤ 3 clarifier follow-ups: an answers-file `[follow_ups]` entry wins;
 * a run that can prompt (and is not --yolo) asks each one with the suggested
 * answer as default; otherwise — and when scripted answers run out — the
 * suggested answer is recorded and marked as such (GRND-02).
 */
export async function resolveFollowUps(opts: {
  readonly followUps: readonly FollowUpPrompt[];
  readonly fixed: ReadonlyMap<string, string>;
  readonly yolo: boolean;
  readonly canPrompt: boolean;
  ask(q: PromptQuestion): Promise<PromptAnswer>;
}): Promise<FollowUpAnswer[]> {
  const out: FollowUpAnswer[] = [];
  let canAsk = opts.canPrompt && !opts.yolo;
  for (const f of opts.followUps.slice(0, 3)) {
    const given = opts.fixed.get(f.id);
    if (given !== undefined) {
      out.push({ id: f.id, question: f.question, answer: given, how: 'answers' });
      continue;
    }
    if (canAsk) {
      try {
        const q: PromptQuestion = f.suggested_answer
          ? { id: `follow-up-${f.id}`, kind: 'text', label: f.question, default: f.suggested_answer }
          : { id: `follow-up-${f.id}`, kind: 'text', label: f.question };
        const a = await opts.ask(q);
        const answer = String(a.value).trim();
        out.push({ id: f.id, question: f.question, answer: answer || f.suggested_answer, how: 'asked' });
        continue;
      } catch (e) {
        if (!(e instanceof PromptAbortedError || e instanceof PromptTimeoutError)) throw e;
        canAsk = false; // the scripted answers ran out: record the suggestions from here on
      }
    }
    out.push({ id: f.id, question: f.question, answer: f.suggested_answer, how: 'suggested' });
  }
  return out;
}
