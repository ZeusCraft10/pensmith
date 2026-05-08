// bin/lib/schemas/session-log.ts — JSONL entry schema (D-49).
//
// Wire shape (D-49): each line is `{at, kind, run_id, ...payload}`. The
// `kind` field is one of 8 enum values (prompt, response, tool_call,
// tool_result, cost, event, warn, error). The remaining payload is
// kind-specific and validated downstream (the schema here uses
// `.passthrough()` so unknown payload keys are preserved by safeParse).
//
// IMPORTANT: session-log records do NOT carry a top-level `$schemaVersion`
// field. They are append-only JSONL written by W9's atomicAppendFile path
// (bypasses the loader). The loader (loadAndMigrate, this wave) is NOT
// involved on the session-log read path. The schema lives here so future
// replay tools (Phase 7 D-53) can validate records they parse off disk
// without re-implementing the contract.
//
// CURRENT_SESSION_LOG_VERSION exists for symmetry with the other 4 schemas
// — it is the wire-format version, bumped when the kind enum or required
// fields change. Replay tools key on this constant to refuse forward-incompat
// log files (same protection as D-39 for the other schemas, just applied
// at parse-time per record rather than file-load time).

import { z } from 'zod';

export const CURRENT_SESSION_LOG_VERSION = 1;

export const KindSchema = z.enum([
  'prompt',
  'response',
  'tool_call',
  'tool_result',
  'cost',
  'event',
  'warn',
  'error',
]);

export const Schema = z
  .object({
    at: z.string().datetime(),
    kind: KindSchema,
    run_id: z.string().min(1),
  })
  .passthrough(); // kind-specific payload spread inline; unknown keys allowed

export type SessionLogEntry = z.infer<typeof Schema>;
export type SessionLogKind = z.infer<typeof KindSchema>;
