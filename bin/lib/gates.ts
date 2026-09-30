// bin/lib/gates.ts — the ONE approval-gate registry (RUN-28, S-16, PRD §7.20).
//
// Every interactive decision point in Tier 2 goes through runGate(). Each gate
// declares what --yolo does (skip with a fixed choice, or never skip), what a
// run without a terminal does (refuse with a documented exit code, or skip the
// step), and the exit code for an explicit decline. Later requirements add
// their gates to GATES (intake defaults GRND-02, plan --research GRND-17,
// UNSUPPORTED confirmation VRFY-22, quote acceptance VRFY-20, re-outline
// GRND-09, persisted detector consent EXP-17); the Tier-1 context tool
// paper_get_gates (PLUG-07) exposes the same table.
//
// SEAM FILE (Phase 17 plan, V2). The Phase 17 streams created it byte-identically
// from .planning/phases/17-runtime/17-PLAN.md Appendix A; after they merged,
// review round 1 added `sketch-confirm` (sketch's approval question used to be
// a private --yolo policy outside this registry). Later phases extend it.

import { ask } from './prompts.js';
import type { PromptAnswer, PromptQuestion } from './prompts.js';
import {
  PensmithError,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_APPROVAL,
  EXIT_COST_CAP,
  type ExitCode,
} from './exit-codes.js';

export type GateId =
  | 'outline-approval'
  | 'export-confirm'
  | 'research-scope'
  | 'research-prune'
  | 'add-remap'
  | 'revise-swap'
  | 'cost-cap'
  | 'estimate-proceed'
  | 'detector-consent'
  | 'paper-pointer'
  | 'sketch-confirm'
  // Phase 18 (GRND-01, GRND-02, GRND-09): seam S-A, applied byte-identically by every stream.
  | 'assignment-pickup'
  | 'intake-defaults'
  | 'reoutline'
  // Phase 19 (GRND-17): seam S-B, applied byte-identically by every Phase 19 stream.
  | 'plan-research'
  // Phase 19 review round 1 (SRC-13, SRC-15, SRC-16): the user's own sources.
  | 'byo-folder'
  | 'zotero-collection'
  | 'pdf-attach-unmatched';

export interface GateDef {
  readonly id: GateId;
  /** Prompt text shown in a terminal (clack) or on stderr (numbered prompts). */
  readonly label: string;
  /** PRD §7.20 (amended): whether --yolo skips the gate. */
  readonly yolo: 'skip' | 'never';
  /** What --yolo chooses when it skips the gate ('' for never-skipped gates). */
  readonly yoloChoice: string;
  /** A run that cannot prompt (no terminal, no scripted answers): refuse, or skip the step. */
  readonly nonInteractive: 'refuse' | 'skip';
  /** Exit code when the gate refuses because it cannot prompt. */
  readonly nonTtyExit: ExitCode;
  /** Exit code when the user explicitly declines at the prompt. */
  readonly declineExit: ExitCode;
  /** The requirement that owns this decision point. */
  readonly requirement: string;
  /** Short name in the `--yolo` lists of `pensmith --help` and the README (yoloGateSummary). */
  readonly summary: string;
}

export const GATES: readonly GateDef[] = Object.freeze([
  { id: 'outline-approval', label: 'Approve this outline and register its sections?', yolo: 'skip', yoloChoice: 'approve the outline', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.20', summary: 'outline approval' },
  { id: 'export-confirm', label: 'Export the paper now?', yolo: 'skip', yoloChoice: 'export', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.20', summary: 'export confirmation' },
  { id: 'research-scope', label: 'Which research scope should I use?', yolo: 'skip', yoloChoice: 'use the first proposed scope', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'SRC-08', summary: 'research scope' },
  { id: 'research-prune', label: 'Select the candidate sources to keep', yolo: 'skip', yoloChoice: "keep the evaluator's picks", nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'SRC-09', summary: 'research pruning' },
  { id: 'add-remap', label: 'Map this source to a section now?', yolo: 'skip', yoloChoice: 'skip the remap', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'SRC-14', summary: 'the `add` remap' },
  { id: 'revise-swap', label: 'Apply this citation swap to the section?', yolo: 'skip', yoloChoice: 'apply the proposed swap', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.5', summary: 'the revise swap' },
  { id: 'cost-cap', label: 'This call would exceed your cost cap. Continue?', yolo: 'never', yoloChoice: '', nonInteractive: 'refuse', nonTtyExit: EXIT_COST_CAP, declineExit: EXIT_COST_CAP, requirement: 'RUN-18', summary: 'the cost cap' },
  { id: 'estimate-proceed', label: 'Proceed?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'RUN-20', summary: 'the estimate confirmation' },
  { id: 'detector-consent', label: 'Send the full paper text to GPTZero for an AI-detection score?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'EXP-17', summary: 'detector consent' },
  { id: 'paper-pointer', label: 'Continue the active paper, or start a new paper here?', yolo: 'never', yoloChoice: '', nonInteractive: 'refuse', nonTtyExit: EXIT_USAGE, declineExit: EXIT_USAGE, requirement: 'RUN-14', summary: 'the active-paper choice' },
  { id: 'sketch-confirm', label: 'Proceed to intake with this thesis?', yolo: 'skip', yoloChoice: 'proceed to intake', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'ERGO-05', summary: 'the `sketch` confirmation' },
  { id: 'assignment-pickup', label: 'Use the assignment file in this folder?', yolo: 'skip', yoloChoice: 'use the file', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'GRND-01', summary: 'the assignment-file pickup' },
  { id: 'intake-defaults', label: 'Accept the intake defaults?', yolo: 'skip', yoloChoice: 'accept the defaults', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'GRND-02', summary: 'the intake defaults' },
  { id: 'reoutline', label: 'Re-outline a paper that already has drafts?', yolo: 'skip', yoloChoice: 're-outline (a model re-outline also needs --force)', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'GRND-09', summary: 'the re-outline confirmation (a model re-outline also needs `--force`)' },
  { id: 'plan-research', label: 'Add these research hits to the section?', yolo: 'skip', yoloChoice: 'add the hits the evaluator kept to the section', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'GRND-17', summary: 'the `plan N --research` hits' },
  { id: 'byo-folder', label: 'Read the PDFs in this folder outside the paper and copy them into it?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'SRC-15', summary: 'reading a PDF folder outside the paper' },
  { id: 'zotero-collection', label: 'Pull this Zotero collection from your library into the paper?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'SRC-16', summary: 'pulling a Zotero collection a paper\'s config names' },
  { id: 'pdf-attach-unmatched', label: "Attach this PDF although its first page does not show the work's title and first author?", yolo: 'never', yoloChoice: '', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'SRC-13', summary: 'attaching a PDF whose first page does not show the work' },
] satisfies GateDef[]);

/**
 * The `--yolo` flag's description, generated from GATES so `pensmith --help`
 * can never drift from the registry (review round 2): what --yolo answers and
 * what it never answers. tests/gates-registry.test.ts checks the README list
 * against the same summaries.
 */
export function yoloGateSummary(): { skips: string[]; never: string[] } {
  return {
    skips: GATES.filter((g) => g.yolo === 'skip').map((g) => g.summary),
    never: GATES.filter((g) => g.yolo === 'never').map((g) => g.summary),
  };
}

/** A plain-text list (backticks dropped): `a, b and c` / `a, b or c`. */
function plainList(xs: readonly string[], last: 'and' | 'or'): string {
  const ys = xs.map((x) => x.replace(/`/g, ''));
  return ys.length < 2 ? ys.join('') : `${ys.slice(0, -1).join(', ')} ${last} ${ys[ys.length - 1] as string}`;
}

/** The `--yolo` description for `pensmith --help` (plain text: backticks dropped). */
export function yoloFlagDescription(): string {
  const { skips, never } = yoloGateSummary();
  return `Answer the approval gates --yolo may answer (${plainList(skips, 'and')}). Never answers ${plainList(never, 'or')}.`;
}

/** What --yolo never answers, as one plain-text list (the GLOBAL FLAGS footer of `pensmith --help`). */
export function yoloNeverList(): string {
  return plainList(yoloGateSummary().never, 'or');
}

export function gateDef(id: GateId): GateDef {
  const def = GATES.find((g) => g.id === id);
  if (!def) throw new Error(`gates.ts: unknown gate "${id}"`);
  return def;
}

/**
 * A gate may prompt when stdin is a terminal, or when numbered answers are
 * scripted explicitly (PENSMITH_PROMPT_MODE=numbered with answers piped on stdin).
 */
export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY) || process.env['PENSMITH_PROMPT_MODE'] === 'numbered';
}

export class GateRefusedError extends PensmithError {
  readonly gateId: GateId;
  constructor(def: GateDef, message: string, exitCode: ExitCode) {
    super(message, exitCode);
    this.name = 'GateRefusedError';
    this.gateId = def.id;
  }
}

export type GateOutcome =
  | { readonly kind: 'answered'; readonly answer: PromptAnswer }
  | { readonly kind: 'yolo'; readonly choice: string }
  | { readonly kind: 'skipped' };

export interface RunGateOptions {
  /** --yolo for this invocation. */
  readonly yolo: boolean;
  /** Custom question (select, multiselect or text). Defaults to a confirm with the registry label; the id is forced to the gate id. */
  readonly question?: PromptQuestion;
  /** Context appended to the refusal message, e.g. the projected cost. */
  readonly detail?: string;
}

/**
 * Resolve one gate: --yolo skip, non-interactive skip or refusal
 * (GateRefusedError with the gate's exit code), or an answer from the user.
 * The caller acts on the answer and calls declineGate() on an explicit "no".
 */
export async function runGate(id: GateId, opts: RunGateOptions): Promise<GateOutcome> {
  const def = gateDef(id);
  if (opts.yolo && def.yolo === 'skip') return { kind: 'yolo', choice: def.yoloChoice };
  if (!canPrompt()) {
    if (def.nonInteractive === 'skip') return { kind: 'skipped' };
    const how = def.yolo === 'skip'
      ? `re-run in a terminal, or pass --yolo to ${def.yoloChoice}`
      : 're-run in a terminal (--yolo does not skip this gate)';
    const detail = opts.detail ? ` (${opts.detail})` : '';
    throw new GateRefusedError(def, `${def.label}${detail} needs an answer: ${how}.`, def.nonTtyExit);
  }
  const question: PromptQuestion = opts.question
    ? { ...opts.question, id: def.id }
    : { id: def.id, kind: 'confirm', label: def.label, default: false };
  const answer = await ask(question);
  return { kind: 'answered', answer };
}

/** Throw the gate's decline refusal (e.g. "export cancelled by user", exit 3). */
export function declineGate(id: GateId, message: string): never {
  const def = gateDef(id);
  throw new GateRefusedError(def, message, def.declineExit);
}
