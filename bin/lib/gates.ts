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
  | 'sketch-confirm';

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
}

export const GATES: readonly GateDef[] = Object.freeze([
  { id: 'outline-approval', label: 'Approve this outline and register its sections?', yolo: 'skip', yoloChoice: 'approve the outline', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.20' },
  { id: 'export-confirm', label: 'Export the paper now?', yolo: 'skip', yoloChoice: 'export', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.20' },
  { id: 'research-scope', label: 'Which research scope should I use?', yolo: 'skip', yoloChoice: 'use the first proposed scope', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'SRC-08' },
  { id: 'research-prune', label: 'Select the candidate sources to keep', yolo: 'skip', yoloChoice: 'keep every candidate', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'SRC-09' },
  { id: 'add-remap', label: 'Map this source to a section now?', yolo: 'skip', yoloChoice: 'skip the remap', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'SRC-14' },
  { id: 'revise-swap', label: 'Apply this citation swap to the section?', yolo: 'skip', yoloChoice: 'apply the proposed swap', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'PRD §7.5' },
  { id: 'cost-cap', label: 'This call would exceed your cost cap. Continue?', yolo: 'never', yoloChoice: '', nonInteractive: 'refuse', nonTtyExit: EXIT_COST_CAP, declineExit: EXIT_COST_CAP, requirement: 'RUN-18' },
  { id: 'estimate-proceed', label: 'Proceed?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'RUN-20' },
  { id: 'detector-consent', label: 'Send the full paper text to GPTZero for an AI-detection score?', yolo: 'never', yoloChoice: '', nonInteractive: 'skip', nonTtyExit: EXIT_OK, declineExit: EXIT_OK, requirement: 'EXP-17' },
  { id: 'paper-pointer', label: 'Continue the active paper, or start a new paper here?', yolo: 'never', yoloChoice: '', nonInteractive: 'refuse', nonTtyExit: EXIT_USAGE, declineExit: EXIT_USAGE, requirement: 'RUN-14' },
  { id: 'sketch-confirm', label: 'Proceed to intake with this thesis?', yolo: 'skip', yoloChoice: 'proceed to intake', nonInteractive: 'refuse', nonTtyExit: EXIT_APPROVAL, declineExit: EXIT_APPROVAL, requirement: 'ERGO-05' },
] satisfies GateDef[]);

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
