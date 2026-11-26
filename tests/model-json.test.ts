// tests/model-json.test.ts — the JSON Schema a model is asked to follow.
//
// Structured outputs refuse some JSON Schema keywords (length, numeric and
// pattern limits), so modelJsonSchema removes them and checkModelJson
// enforces them in code. It must remove only keywords: a field whose name
// happens to be one of them is part of the schema.

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { checkModelJson, modelJsonSchema } from '../bin/lib/schemas/model-json.js';

test('only keywords are removed, never a property that has a keyword\'s name', () => {
  const schema = z.object({
    format: z.string().min(2),
    pattern: z.string(),
    minimum: z.number().min(1),
    nested: z.object({ maxLength: z.string().max(10) }).strict(),
    mode: z.enum(['format', 'pattern']).default('format'),
  }).strict();
  const sent = modelJsonSchema(schema) as { properties: Record<string, Record<string, unknown>>; required: string[] };
  assert.deepEqual(Object.keys(sent.properties), ['format', 'pattern', 'minimum', 'nested', 'mode']);
  assert.deepEqual(sent.required, ['format', 'pattern', 'minimum', 'nested', 'mode']);
  assert.deepEqual(sent.properties['format'], { type: 'string' }, 'the length limit is not sent');
  assert.deepEqual(sent.properties['minimum'], { type: 'number' });
  assert.deepEqual(Object.keys((sent.properties['nested'] as { properties: object }).properties), ['maxLength']);
  assert.deepEqual(sent.properties['mode']!['enum'], ['format', 'pattern']);
  assert.ok(!('$schema' in sent));

  // The limits that were not sent are still enforced on the answer.
  const bad = checkModelJson(schema, { format: 'x', pattern: 'p', minimum: 0, nested: { maxLength: 'ok' }, mode: 'format' });
  assert.equal(bad.ok, false);
});
