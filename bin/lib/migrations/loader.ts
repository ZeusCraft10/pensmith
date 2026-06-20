// bin/lib/migrations/loader.ts — versioned schema loader (ARCH-07, D-37/38/39).
//
// Public contract (revision-locked single-options-object):
//
//   const value = await loadAndMigrate({
//     file:           '/path/to/file.json',
//     schema:         StateSchema,                    // zod
//     schemaName:     'state',                        // for error messages
//     currentVersion: CURRENT_STATE_VERSION,          // code's max version
//     migrations:     { 1: v1_to_v2, 2: v2_to_v3 },   // optional registry
//     writeBack:      true,                           // optional, default false
//   });
//
// Why a single options object (DIVERGENCE FROM D-37 DRAFT):
//   D-37's example signature was `loadAndMigrate(raw: unknown, ...)` — caller
//   reads from disk, loader migrates a value in-memory. We changed this so
//   the loader OWNS the read: consumer plans 10–13 (state.ts, library.ts,
//   checkpoint.ts, runtime.ts) wire one-liners against this exact shape, and
//   the file→version→migrate→validate→writeBack cycle is encapsulated in one
//   function. Call sites stay tight. The trade-off: the loader now hardcodes
//   `fs.readFile + utf8 + JSON.parse` (no streaming JSON, no alternate
//   parser) — fine for v0.1 because every persisted file is small.
//
// Algorithm:
//   1. read file (UTF-8) → JSON.parse → in-memory unknown
//   2. peek `$schemaVersion` — missing/non-int defaults to 1
//   3. if disk-version > currentVersion → ForwardIncompatError (D-39)
//   4. while v < currentVersion: look up `migrations[v]`; throw if missing
//   5. zod safeParse → SchemaValidationError on failure (rich issue array)
//   6. if writeBack && a migration ran → atomicWriteFile through W2 chokepoint
//
// Default writeBack:false (the read path stays read-only by default; consumers
// that want disk to track latest schema-version pass writeBack:true). This
// matches W10/W11 plans: state.ts/runtime.ts will pass writeBack:true; the
// session-log replay path (Phase 7) will pass writeBack:false.

import * as fsp from 'node:fs/promises';
import { z } from 'zod';
import { atomicWriteFile } from '../atomic-write.js';

export type Migration = (input: unknown) => unknown;

export interface LoadOptions<TSchema extends z.ZodTypeAny> {
  file: string;
  schema: TSchema;
  schemaName:
    | 'state'
    | 'library'
    | 'global-library'
    | 'checkpoint'
    | 'session-log'
    | 'runtime-config';
  currentVersion: number;
  migrations?: Record<number, Migration>;
  writeBack?: boolean; // default false
}

export class ForwardIncompatError extends Error {
  diskVersion: number;
  codeVersion: number;
  constructor(schemaName: string, diskVersion: number, codeVersion: number) {
    super(
      `pensmith: refusing to load ${schemaName} v${diskVersion} (this build supports v${codeVersion}). ` +
        `Upgrade pensmith, or restore from a v${codeVersion}-or-older snapshot.`,
    );
    this.name = 'ForwardIncompatError';
    this.diskVersion = diskVersion;
    this.codeVersion = codeVersion;
  }
}

export class SchemaValidationError extends Error {
  zodIssue: z.ZodIssue[];
  constructor(schemaName: string, issues: z.ZodIssue[]) {
    super(
      `pensmith: ${schemaName} failed schema validation: ` +
        issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
    this.name = 'SchemaValidationError';
    this.zodIssue = issues;
  }
}

/**
 * Peek the `$schemaVersion` field on an arbitrary parsed-JSON value.
 *
 * Per D-37, missing or non-integer `$schemaVersion` is treated as v1 (the
 * pre-versioning era). This gives day-one tolerance for files written before
 * the versioning header was introduced. Negative or zero versions also fall
 * back to v1 (corruption-tolerant — the schema validator will reject the
 * value's actual shape if it's truly broken).
 */
function readVersion(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 1;
  const v = (raw as Record<string, unknown>).$schemaVersion;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) return v;
  return 1;
}

export async function loadAndMigrate<TSchema extends z.ZodTypeAny>(
  opts: LoadOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const raw = await fsp.readFile(opts.file, 'utf8');
  let value: unknown = JSON.parse(raw);
  const diskVersion = readVersion(value);

  if (diskVersion > opts.currentVersion) {
    throw new ForwardIncompatError(opts.schemaName, diskVersion, opts.currentVersion);
  }

  let v = diskVersion;
  while (v < opts.currentVersion) {
    const mig = opts.migrations?.[v];
    if (!mig) {
      throw new Error(
        `pensmith: missing migration ${opts.schemaName} v${v} -> v${v + 1}`,
      );
    }
    value = mig(value);
    v += 1;
  }

  const parsed = opts.schema.safeParse(value);
  if (!parsed.success) {
    throw new SchemaValidationError(opts.schemaName, parsed.error.issues);
  }

  // Write-back gate: only if a migration actually ran (v advanced beyond
  // diskVersion) AND the caller opted in. Default writeBack:false leaves
  // disk untouched even if migrations ran — useful for read-only replay
  // tools and dry-run validators.
  if (v !== diskVersion && opts.writeBack === true) {
    await atomicWriteFile(opts.file, JSON.stringify(parsed.data, null, 2));
  }

  return parsed.data as z.infer<TSchema>;
}
