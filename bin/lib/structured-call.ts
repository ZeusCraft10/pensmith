// bin/lib/structured-call.ts — ask a model for JSON to a schema, and check it.
//
// The answer is checked in code: against the schema (checkModelJson), then
// against the caller's own rules. An answer that fails is sent back once with
// its problems; the caller refuses when the second answer fails too.

import type { z } from 'zod/v4';
import { complete, type CompleteOptions, type CompleteResult } from './anthropic.js';
import { checkModelJson, modelJsonSchema } from './schemas/model-json.js';

export type CheckedAnswer<T> =
  /** No model ran (PENSMITH_NO_LLM): the placeholder result. */
  | { placeholder: CompleteResult }
  | { value: T }
  /** The second answer failed too: its problems. */
  | { problems: string[] };

/**
 * `complete()` with `schema` as the answer's JSON Schema. `problemsOf` gives
 * every reason a schema-valid answer cannot be used; `noun` names the answer
 * in the turn that sends it back ("This <noun> cannot be used: ...").
 */
export async function completeChecked<T>(
  opts: Omit<CompleteOptions, 'jsonSchema'> & { schema: z.ZodType<T>; problemsOf: (value: T) => string[]; noun: string },
): Promise<CheckedAnswer<T>> {
  const { schema, problemsOf, noun, ...call } = opts;
  const jsonSchema = modelJsonSchema(schema);
  const messages = [...call.messages];
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await complete({ ...call, messages, jsonSchema });
    if (result.placeholder) return { placeholder: result };
    const checked = checkModelJson(schema, result.json);
    problems = checked.ok ? problemsOf(checked.value) : checked.problems;
    if (checked.ok && problems.length === 0) return { value: checked.value };
    messages.push(
      { role: 'assistant', content: result.text },
      { role: 'user', content: `This ${noun} cannot be used:\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn the corrected ${noun}.` },
    );
  }
  return { problems };
}
