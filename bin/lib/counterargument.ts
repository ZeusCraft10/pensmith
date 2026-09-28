// bin/lib/counterargument.ts — does this paper's outline need a counterargument
// and rebuttal? (GRND-10, D-18-19, PRD §7.4)
//
// ONE resolver, one precedence, and the source of the decision named so
// `outline` can say why:
//   1. `outline --no-counter`                 → not required        (flag)
//   2. config.toml [project] counterargument_required (true/false)  (config)
//   3. the intake answer `yes` / `no`                               (intake)
//   4. `auto`: the intake paper type — argumentative and persuasive papers
//      need one; lab reports, summaries and primers never do        (paper-type)
//   5. otherwise the discipline preset's default: `on` → required,
//      `off` / `ask` → not required (an `ask` preset is asked at intake,
//      which records yes/no, so it reaches this layer only unanswered) (preset)
//
// The preset default is read here and nowhere else (the preset table itself
// lives in disciplines.ts). PURE: no fs.

import { presetFor, type CounterargumentDefault } from './disciplines.js';
import {
  ARGUMENTATIVE_PAPER_TYPES,
  NON_ARGUMENTATIVE_PAPER_TYPES,
  type CounterargumentAnswer,
  type PaperType,
} from './intake-brief.js';

export type CounterargumentSource = 'flag' | 'config' | 'intake' | 'paper-type' | 'preset';

export interface CounterargumentDecision {
  readonly required: boolean;
  readonly source: CounterargumentSource;
}

export interface CounterargumentInput {
  /** `outline --no-counter`. */
  readonly noCounter?: boolean | undefined;
  /** config.toml `[project] counterargument_required`. */
  readonly configRequired?: boolean | undefined;
  /** The intake answer (INTAKE.md `counterargument`). */
  readonly intakeAnswer?: CounterargumentAnswer | undefined;
  /** The intake paper type (INTAKE.md `paper_type`). */
  readonly paperType?: PaperType | undefined;
  /** The resolved discipline preset slug. */
  readonly discipline: string;
}

/** The preset's counterargument default for a discipline slug. */
export function presetCounterargDefault(discipline: string): CounterargumentDefault {
  return presetFor(discipline).counterargDefault;
}

/** Decide whether the outline must carry a counterargument and a rebuttal. */
export function resolveCounterargument(input: CounterargumentInput): CounterargumentDecision {
  if (input.noCounter === true) return { required: false, source: 'flag' };
  if (typeof input.configRequired === 'boolean') return { required: input.configRequired, source: 'config' };
  if (input.intakeAnswer === 'yes') return { required: true, source: 'intake' };
  if (input.intakeAnswer === 'no') return { required: false, source: 'intake' };
  if (input.paperType !== undefined) {
    if (ARGUMENTATIVE_PAPER_TYPES.includes(input.paperType)) return { required: true, source: 'paper-type' };
    if (NON_ARGUMENTATIVE_PAPER_TYPES.includes(input.paperType)) return { required: false, source: 'paper-type' };
  }
  return { required: presetCounterargDefault(input.discipline) === 'on', source: 'preset' };
}

/** The one refusal line (GRND-10), also quoted to the model in the corrective turn. */
export const COUNTERARGUMENT_REQUIRED_MESSAGE =
  'counterargument + rebuttal section required (§7.4); use --no-counter to disable';

/**
 * Does a list of section roles satisfy the rule: a `counterargument` and a
 * `rebuttal` section, or one combined `counterargument-rebuttal` section?
 */
export function coversCounterargument(roles: ReadonlyArray<string | undefined>): boolean {
  if (roles.includes('counterargument-rebuttal')) return true;
  return roles.includes('counterargument') && roles.includes('rebuttal');
}
