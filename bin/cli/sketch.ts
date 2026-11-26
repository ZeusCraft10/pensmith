// bin/cli/sketch.ts — `pensmith sketch` verb (ERGO-05).
//
// THIN ORCHESTRATOR (next.ts dispatch shape + status.ts never-crash stance).
// A thinking-partner thesis-discovery mode: a short Socratic loop helps the
// user shape a candidate thesis, then — ONLY after the user confirms — it hands
// that thesis to the existing `new` (intake) verb via dispatchVerb.
//
// LOAD-BEARING no-advance invariant (Pitfall 6 / T-08-04-05): sketch MUST NOT
// call initState, MUST NOT mkdir .paper/, and MUST NOT write the library
// (updateLibrary) anywhere in the Socratic loop or on decline. State creation lives in ONE place (the
// `new` verb), preserving the section-as-phase isolation contract. A DECLINED
// sketch leaves the working directory byte-unchanged.
//
// stdout-only (no console.* — Pitfall-7 stance shared with the other verbs).
//
// Without a terminal (Claude Code's Bash tool, CI, a pipe) nothing is asked on
// stdin: sketch prints what it would ask as one JSON line and exits 3, having
// written nothing. Claude talks the thesis through with the user, and starts
// the paper with `pensmith new --thesis "<their thesis>"` once they agree.
//
// TEST SEAMS (Tier-2): the confirm gate and the downstream dispatch are
// injectable so tests can observe the delegation without running the full
// `new` pipeline or a live TTY prompt:
//   - --thesis      pre-supplies the thesis (skips the Socratic loop)
//   - args.confirm  pre-supplies the gate decision (skips the ask() prompt)
//   - args.__dispatch  a spy dispatcher used instead of the real dispatchVerb

import { defineCommand } from 'citty';
import { ask, canAskInTerminal, confirmOrNo } from '../lib/prompts.js';
import { dispatchVerb, type GlobalFlags } from '../pensmith.js';
import type { Ux02Verb } from '../lib/verbs.js';
import { EXIT_NEEDS_ANSWER } from '../lib/exit-codes.js';

/** Dispatcher seam — matches the dispatchVerb signature the tests spy on. */
type Dispatcher = (
  verb: string,
  opts?: { args?: Record<string, unknown>; globalFlags?: Record<string, unknown> },
) => Promise<unknown>;

/** The Socratic questions, in the order they are asked. */
const QUESTIONS = [
  { id: 'sketch-interests', label: 'What interests or questions motivate this paper?' },
  { id: 'sketch-disagree', label: 'What conventional view do you disagree with?' },
  { id: 'sketch-audience', label: 'Who is your target audience?' },
  { id: 'sketch-claim', label: 'In one sentence, what is your candidate thesis claim?' },
] as const;

/** Print what sketch waits for, as one JSON line, and stop (exit 3). Nothing is written. */
function reportPending(decision: Record<string, unknown>): { ok: false; pending: true } {
  process.stderr.write('pensmith sketch: this needs the user, and there is no terminal to ask in. Nothing was written.\n');
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exitCode = EXIT_NEEDS_ANSWER;
  return { ok: false, pending: true };
}

/** Ask one Socratic text question, returning the trimmed answer (or ''). */
async function askText(id: string, label: string): Promise<string> {
  const answer = await ask({ id, kind: 'text', label });
  return answer.kind === 'text' ? answer.value.trim() : '';
}

export const sketchCommand = defineCommand({
  meta: {
    name: 'sketch',
    description: 'Thinking-partner thesis discovery before intake (no state created until you confirm).',
  },
  args: {
    thesis: { type: 'string', description: 'A thesis you already have: skip the questions and confirm it.' },
    yolo: { type: 'boolean', description: 'Skip the confirm gate and proceed to intake.', default: false },
    'dry-run': { type: 'boolean', description: 'Describe the step only; ask nothing, write nothing, no network.', default: false },
  },
  async run({ args }) {
    // (1) Synthesize a candidate thesis. If a thesis was pre-supplied (test
    //     seam or a one-shot caller) skip the Socratic loop; otherwise run it.
    //     CRITICAL: NOTHING in this block creates .paper/ / STATE.json /
    //     LIBRARY.json — sketch never advances paper state (Pitfall 6).
    let synthesized: string;
    const preThesis = typeof args.thesis === 'string' ? args.thesis.trim() : '';
    const terminal = canAskInTerminal(process.stderr);
    if (preThesis) {
      synthesized = preThesis;
    } else if (!terminal) {
      return reportPending({
        pending: 'sketch-questions',
        gate: 'sketch',
        summary: 'Sketch a thesis with the user before starting the paper.',
        questions: QUESTIONS.map(({ id, label }) => ({ id, question: label })),
        how_to_answer: 'Talk these questions through with the user and help them shape one thesis sentence; when they agree to it, run `pensmith new --thesis "<their thesis>"`.',
      });
    } else {
      const answers: string[] = [];
      for (const q of QUESTIONS) answers.push(await askText(q.id, q.label));
      const [interests, disagreements, audience, claim] = answers;
      const parts = [claim || interests, disagreements, audience].filter(Boolean);
      synthesized = parts.length > 0 ? parts.join(' — ') : 'An exploratory thesis to refine during intake.';
    }

    process.stdout.write(`\npensmith sketch:\n  ${synthesized}\n\n`);

    // (2) Confirm gate (approval-gates-default-on). A pre-supplied `confirm`
    //     (test seam) wins; --yolo skips the prompt; at a terminal ask();
    //     without one report the decision (exit 3). On decline: print +
    //     return WITHOUT creating ANY state (no-advance).
    let proceed: boolean;
    if (typeof args.confirm === 'boolean') {
      proceed = args.confirm;
    } else if (args.yolo === true) {
      proceed = true;
    } else if (!terminal) {
      return reportPending({
        pending: 'sketch-confirm',
        gate: 'sketch',
        summary: 'Start a paper with this thesis?',
        thesis: synthesized,
        options: ['proceed', 'cancel'],
        default: 'cancel',
        how_to_answer: `Ask the user whether to start the paper with this thesis. If they proceed, run \`pensmith new --thesis ${JSON.stringify(synthesized)}\`; if not, nothing was written.`,
      });
    } else {
      proceed = await confirmOrNo({
        id: 'sketch-confirm',
        kind: 'confirm',
        label: 'Proceed to intake with this thesis?',
        default: false,
      });
    }

    if (!proceed) {
      process.stdout.write('pensmith sketch: cancelled — re-run to try again.\n');
      return { ok: false };
    }

    // (3) ONLY after confirm: dispatch the existing `new` verb with the thesis
    //     seed. sketch does NOT call initState itself (single-init-site
    //     contract). The dispatcher is injectable for testability.
    const dispatch: Dispatcher =
      typeof args.__dispatch === 'function'
        ? (args.__dispatch as Dispatcher)
        : (verb, opts) =>
            dispatchVerb(verb as Ux02Verb, (opts ?? {}) as {
              args?: Record<string, unknown>;
              globalFlags?: GlobalFlags;
            });

    await dispatch('new', {
      args: { thesis: synthesized },
      globalFlags: { yolo: args.yolo === true },
    });

    return { ok: true, thesis: synthesized };
  },
});

export default sketchCommand;
