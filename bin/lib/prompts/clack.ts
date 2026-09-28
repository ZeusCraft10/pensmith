// bin/lib/prompts/clack.ts — TTY delegate for @clack/prompts.
//
// The ONLY file in this repo allowed to import '@clack/prompts'.
// tests/prompts-shape.test.ts asserts the single-source-of-truth invariant.
//
// Pinned at @clack/prompts ^0.7 (D-03 stack pin / Pitfall 11). Do NOT
// bump to 1.x in this plan — the only path that depends on clack is the
// TTY-only one, which is not compared by tier-contract.
//
// Note: clack does not support injected streams (stdin/stderr) — it always
// uses process.stdin / process.stdout. That is acceptable: the clack path
// is only taken when stdout + stderr are TTY (interactive dev), so no test
// fixture needs to pipe different streams. The numbered path handles all
// headless/CI/piped scenarios.

import * as readline from 'node:readline';
import { select, multiselect, text, confirm, isCancel, log } from '@clack/prompts';
import { MULTILINE_TERMINATOR, type PromptQuestion, type PromptAnswer } from './schema.js';
import { PromptAbortedError } from '../prompts.js';

type CancelOr<T> = T | symbol;

/**
 * GRND-01 paste: clack 0.7 has no multi-line input, so the label is shown in
 * clack's style and the lines are read from the terminal (cooked mode — the
 * terminal echoes them) until a line holding only "." — never until EOF, which
 * would end stdin for every later prompt. A temporary line reader is closed
 * afterwards, which pauses stdin for the next clack prompt to resume.
 */
function readMultiline(id: string, label: string, placeholder: string | undefined): Promise<string> {
  log.step(label);
  log.message(`${placeholder ? `(e.g. ${placeholder})\n` : ''}Paste the text, then a line holding only "${MULTILINE_TERMINATOR}" to finish:`);
  return new Promise<string>((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
    const lines: string[] = [];
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      rl.close();
      const value = lines.join('\n').replace(/^\n+|\s+$/g, '');
      if (ok || value.length > 0) resolve(value);
      else reject(new PromptAbortedError(id));
    };
    rl.on('line', (line: string) => {
      if (line.trim() === MULTILINE_TERMINATOR) finish(true);
      else lines.push(line.replace(/\r$/, ''));
    });
    rl.on('close', () => finish(false));
    rl.on('SIGINT', () => finish(false));
  });
}

function unwrap<T>(value: CancelOr<T>, id: string): T {
  if (isCancel(value)) throw new PromptAbortedError(id);
  return value as T;
}

export async function askClack(
  question: PromptQuestion,
  // opts is accepted for interface symmetry with askNumbered but clack manages
  // its own I/O via process.stdin/stdout. Unused intentionally.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts?: { stdin?: NodeJS.ReadableStream; stderr?: NodeJS.WritableStream },
): Promise<PromptAnswer> {
  switch (question.kind) {
    case 'select': {
      const clackOpts = question.options.map((o) =>
        o.hint !== undefined
          ? { value: o.value, label: o.label, hint: o.hint }
          : { value: o.value, label: o.label },
      );
      const selectArgs: Parameters<typeof select<typeof clackOpts, string>>[0] = {
        message: question.label,
        options: clackOpts,
      };
      if (question.default !== undefined) selectArgs.initialValue = question.default;
      const value = unwrap(await select(selectArgs), question.id);
      return { id: question.id, kind: 'select', value: String(value) };
    }

    case 'multiselect': {
      const clackOpts = question.options.map((o) =>
        o.hint !== undefined
          ? { value: o.value, label: o.label, hint: o.hint }
          : { value: o.value, label: o.label },
      );
      const msArgs: Parameters<typeof multiselect<typeof clackOpts, string>>[0] = {
        message: question.label,
        options: clackOpts,
        initialValues: question.default ?? [],
        required: false,
      };
      const value = unwrap(await multiselect(msArgs), question.id);
      return { id: question.id, kind: 'multiselect', value: (value as string[]).map(String) };
    }

    case 'text': {
      // GRND-02: a default is clack's `defaultValue` (what an empty submit
      // returns) shown as the dim placeholder — never `initialValue`, which
      // pre-types it so the user's answer is appended to it ("Unfiled" +
      // "HIST 200" → "UnfiledHIST 200").
      const textOpts: Parameters<typeof text>[0] = { message: question.label };
      const def = question.default !== undefined && question.default !== '' ? question.default : undefined;
      if (def !== undefined) {
        textOpts.defaultValue = def;
        textOpts.placeholder = def;
      } else {
        // clack echoes `value || placeholder` once submitted: without a
        // placeholder a blank answer would be shown as "undefined".
        textOpts.placeholder = question.placeholder ?? '(blank)';
      }
      const value = unwrap(await text(textOpts), question.id);
      // An empty submit with no default comes back as undefined: that is the
      // empty answer ("leave blank to skip"), never the text "undefined".
      return { id: question.id, kind: 'text', value: typeof value === 'string' ? value : (question.default ?? '') };
    }

    case 'multiline': {
      const value = await readMultiline(question.id, question.label, question.placeholder);
      return { id: question.id, kind: 'multiline', value };
    }

    case 'confirm': {
      const confirmOpts: Parameters<typeof confirm>[0] = { message: question.label };
      if (question.default !== undefined) confirmOpts.initialValue = question.default;
      const value = unwrap(await confirm(confirmOpts), question.id);
      return { id: question.id, kind: 'confirm', value: Boolean(value) };
    }
  }
}
