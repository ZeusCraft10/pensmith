// bin/lib/json-record.ts — one small JSON record, checked by its schema.
//
// The records the router and the gates keep (EXPORT.json,
// COMPILE-REFUSAL.json, REVISE.json, .paper/gates/<id>.json) are each read the
// same way: a file that is missing, unreadable, not JSON or not of the schema
// is no record, and the read never throws (the router's never-throw
// invariant rests on it). Each is written the same way too: checked against
// its schema, then written through atomicWriteFile.

import { existsSync, readFileSync } from 'node:fs';
import type { z } from 'zod';
import { atomicWriteFile } from './atomic-write.js';

/** The record at `file` when it parses and matches `schema`, else null. Never throws. */
export function readJsonRecord<S extends z.ZodTypeAny>(file: string, schema: S): z.infer<S> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? (parsed.data as z.infer<S>) : null;
  } catch {
    return null;
  }
}

/** Check `value` against `schema` and write it to `file` as JSON; the checked record. */
export async function writeJsonRecord<S extends z.ZodTypeAny>(file: string, schema: S, value: z.input<S>): Promise<z.infer<S>> {
  const record = schema.parse(value) as z.infer<S>;
  await atomicWriteFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
