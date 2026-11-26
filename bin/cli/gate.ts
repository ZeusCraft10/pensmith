// bin/cli/gate.ts — `pensmith gate`: answer a decision a verb is waiting for.
//
// With no terminal to ask in, outline, research, `plan N --revise` and done
// stop with exit 3 and one line of JSON naming the decision (bin/lib/gates.ts).
// The caller shows it to the person, and passes the person's choice back:
//
//   pensmith gate answer <ref> <option>    record the answer and finish the step
//   pensmith gate list                     every decision still waiting, as JSON lines
//
// `gate answer` runs the step that asked again, which applies exactly what
// it proposed (checked again against the files as they are now), so the
// answer and the step it completes are one command. An answer only ever
// comes from the person: Claude asks them (AskUserQuestion) and never picks.

import { defineCommand } from 'citty';
import { answerGate, GATE_VERBS, listGates, parseAnswer, pendingDecision, readGateByRef } from '../lib/gates.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { dispatchVerb } from '../pensmith.js';

export const gateCommand = defineCommand({
  meta: {
    name: 'gate',
    description: 'Answer a decision a step is waiting for (`gate answer <ref> <option>`), or list them (`gate list`).',
  },
  args: {
    action: {
      type: 'positional',
      description: '`answer` or `list` (default: list).',
      required: false,
      valueHint: 'answer',
    },
    ref: {
      type: 'positional',
      description: 'The `ref` of the decision, from its JSON line.',
      required: false,
    },
    option: {
      type: 'positional',
      description: 'The option the person chose (several, comma-separated, where the decision allows it).',
      required: false,
    },
  },
  async run({ args }) {
    const root = process.cwd();
    const action = typeof args.action === 'string' && args.action.length > 0 ? args.action : 'list';

    if (action === 'list') {
      const gates = listGates(root);
      // The same line the step printed when it stopped, and the answer once given.
      for (const g of gates) {
        process.stdout.write(`${JSON.stringify(pendingDecision(g, g.answer ? { answered: g.answer.options } : {}))}\n`);
      }
      if (gates.length === 0) process.stderr.write('pensmith gate: no decision is waiting.\n');
      return { ok: true, gates: gates.map((g) => g.ref) };
    }
    if (action !== 'answer') {
      process.stderr.write(`pensmith gate: unknown action '${action}' — use \`pensmith gate answer <ref> <option>\` or \`pensmith gate list\`.\n`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }

    const ref = typeof args.ref === 'string' ? args.ref : '';
    const typed = typeof args.option === 'string' ? args.option : '';
    const record = readGateByRef(root, ref);
    if (!record) {
      process.stderr.write(
        `pensmith gate: no decision with ref '${ref}' is waiting (it was answered, or the files it was about changed and it was dropped). ` +
          'Run `pensmith gate list` to see what is waiting, or run the step again.\n',
      );
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }
    const answer = parseAnswer(record, typed);
    if ('error' in answer) {
      process.stderr.write(`pensmith gate: ${answer.error}. The options are: ${record.options.join(', ')}${record.multiple ? ' (or all / none)' : ''}.\n`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }
    await answerGate(root, record, answer.options);
    process.stderr.write(`pensmith gate: recorded ${answer.options.length > 0 ? answer.options.join(', ') : 'none'} for ${record.ref}; finishing \`pensmith ${GATE_VERBS[record.gate]}\`.\n`);
    return dispatchVerb(GATE_VERBS[record.gate], { args: record.args });
  },
});

export default gateCommand;
