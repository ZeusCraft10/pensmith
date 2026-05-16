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

import { select, multiselect, text, confirm, isCancel } from '@clack/prompts';
import type { PromptQuestion, PromptAnswer } from './schema.js';
import { PromptAbortedError } from '../prompts.js';

type CancelOr<T> = T | symbol;

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
      const textOpts: Parameters<typeof text>[0] = { message: question.label };
      if (question.placeholder !== undefined) textOpts.placeholder = question.placeholder;
      if (question.default !== undefined) textOpts.initialValue = question.default;
      const value = unwrap(await text(textOpts), question.id);
      return { id: question.id, kind: 'text', value: String(value) };
    }

    case 'confirm': {
      const confirmOpts: Parameters<typeof confirm>[0] = { message: question.label };
      if (question.default !== undefined) confirmOpts.initialValue = question.default;
      const value = unwrap(await confirm(confirmOpts), question.id);
      return { id: question.id, kind: 'confirm', value: Boolean(value) };
    }
  }
}
