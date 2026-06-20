// bin/cli/sketch.ts — `pensmith sketch` verb (ERGO-05).
//
// THIN ORCHESTRATOR (next.ts dispatch shape + status.ts never-crash stance).
// A thinking-partner thesis-discovery mode: a short Socratic loop helps the
// user shape a candidate thesis, then — ONLY after the user confirms — it hands
// that thesis to the existing `new` (intake) verb via dispatchVerb.
//
// LOAD-BEARING no-advance invariant (Pitfall 6 / T-08-04-05): sketch MUST NOT
// call initState, MUST NOT mkdir .paper/, and MUST NOT call initLibrary anywhere
// in the Socratic loop or on decline. State creation lives in ONE place (the
// `new` verb), preserving the section-as-phase isolation contract. A DECLINED
// sketch leaves the working directory byte-unchanged.
//
// sketch is NOT a 17th verb — it is already a member of the locked-16
// UX02_VERBS; this file promotes the Phase-2 stub to a real loader.
//
// stdout-only (no console.* — Pitfall-7 stance shared with the other verbs).
//
// TEST SEAMS (Tier-2): the Socratic loop, the confirm gate, and the downstream
// dispatch are each injectable so tests can observe the delegation without
// running the full `new` pipeline or a live TTY prompt:
//   - args.thesis   pre-supplies the thesis (skips the Socratic loop)
//   - args.confirm  pre-supplies the gate decision (skips the ask() prompt)
//   - args.__dispatch  a spy dispatcher used instead of the real dispatchVerb

import { defineCommand } from 'citty';
import { ask } from '../lib/prompts.js';
import { dispatchVerb, type GlobalFlags } from '../pensmith.js';
import type { Ux02Verb } from '../lib/verbs.js';

/** Dispatcher seam — matches the dispatchVerb signature the tests spy on. */
type Dispatcher = (
  verb: string,
  opts?: { args?: Record<string, unknown>; globalFlags?: Record<string, unknown> },
) => Promise<unknown>;

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
    yolo: { type: 'boolean', description: 'Skip the confirm gate and proceed to intake.', default: false },
    'dry-run': { type: 'boolean', description: 'Zero external API calls.', default: false },
  },
  async run({ args }) {
    // (1) Synthesize a candidate thesis. If a thesis was pre-supplied (test
    //     seam or a one-shot caller) skip the Socratic loop; otherwise run it.
    //     CRITICAL: NOTHING in this block creates .paper/ / STATE.json /
    //     LIBRARY.json — sketch never advances paper state (Pitfall 6).
    let synthesized: string;
    const preThesis = typeof args.thesis === 'string' ? args.thesis.trim() : '';
    if (preThesis) {
      synthesized = preThesis;
    } else {
      const interests = await askText('sketch-interests', 'What interests or questions motivate this paper?');
      const disagreements = await askText('sketch-disagree', 'What conventional view do you disagree with?');
      const audience = await askText('sketch-audience', 'Who is your target audience?');
      const claim = await askText('sketch-claim', 'In one sentence, what is your candidate thesis claim?');
      const parts = [claim || interests, disagreements, audience].filter(Boolean);
      synthesized = parts.length > 0 ? parts.join(' — ') : 'An exploratory thesis to refine during intake.';
    }

    process.stdout.write(`\npensmith sketch:\n  ${synthesized}\n\n`);

    // (2) Confirm gate (approval-gates-default-on). A pre-supplied `confirm`
    //     (test seam) wins; --yolo skips the prompt; otherwise ask(). On
    //     decline: print + return WITHOUT creating ANY state (no-advance).
    let proceed: boolean;
    if (typeof args.confirm === 'boolean') {
      proceed = args.confirm;
    } else if (args.yolo === true) {
      proceed = true;
    } else {
      const answer = await ask({
        id: 'sketch-confirm',
        kind: 'confirm',
        label: 'Proceed to intake with this thesis?',
        default: false,
      });
      proceed = answer.kind === 'confirm' ? answer.value : false;
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
      globalFlags: { yolo: args.yolo === true, dryRun: args['dry-run'] === true },
    });

    return { ok: true, thesis: synthesized };
  },
});

export default sketchCommand;
