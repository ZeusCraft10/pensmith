// bin/lib/schemas/model-json.ts — a zod schema as the JSON Schema a model is
// asked to follow (structured outputs), and the check of what came back.
//
// The model-facing schemas are written with zod's v4 API (`zod/v4`, part of
// the installed zod package), because only it converts a schema to JSON
// Schema. Structured outputs accept a subset of JSON Schema: no length,
// numeric or pattern limits, and no array size limits beyond 0 or 1. Those
// keywords are removed from what is sent and enforced here, in code, on the
// answer, so a limit is never lost.

import { z } from 'zod/v4';

const UNSUPPORTED = new Set([
  '$schema', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'maxItems', 'format',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    out[k] = strip(v);
  }
  return out;
}

/** The JSON Schema to send for `schema`, with the keywords structured outputs refuse removed. */
export function modelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/** `value` checked against `schema`: the parsed value, or one line per problem. */
export function checkModelJson<T>(schema: z.ZodType<T>, value: unknown): { ok: true; value: T } | { ok: false; problems: string[] } {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, problems: r.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(answer)'}: ${i.message}`) };
}
