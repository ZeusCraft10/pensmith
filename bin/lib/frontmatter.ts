// bin/lib/frontmatter.ts — round-trip-safe YAML frontmatter helper.
//
// Phase 3 Plan 03-03 Task 3.4 (CYCLE-2 H-1 REVIEWS CONVERGENCE — moved from
// Plan 08 to Wave 2 so Task 3.2 D-09 migration has a real import target).
//
// Three exports:
//   - parseFrontmatter(text): split a markdown document into { frontmatter, body }
//   - serializeFrontmatter(fm): emit `---\n<yaml>\n---\n` from a plain JS object
//   - updateFrontmatter(text, mutator): in-place mutator on the LIVE yaml@^2
//     Document via a Proxy whose set/deleteProperty traps route through
//     doc.set / doc.delete. This preserves:
//       - comments adjacent to surviving keys
//       - key order
//       - key DELETION (CYCLE-1 REVIEWS CONVERGENCE — the naïve
//         "Object.entries(json) → doc.set" pattern silently keeps deleted keys
//         because they never appear in the JSON projection)
//
// The three helpers above are pure (NO filesystem I/O); callers persist the
// returned string via bin/lib/atomic-write.ts atomicWriteFile (D-07 LOCKED
// chokepoint).
//
// CONF-04 (D-17-38) adds the versioned READ path for markdown documents with
// frontmatter — loadFrontmatterDoc / loadFrontmatterDocSync /
// migrateFrontmatterText — the markdown sibling of migrations/loader.ts
// loadAndMigrate: read `schema_version` (absent = v0), refuse a newer file with
// "upgrade pensmith", run the text migrations under
// bin/lib/migrations/<kind>/vN_to_vN+1.ts, and (optionally) write the migrated
// text back under the file's lock. Every PLAN.md reader goes through it; the
// router reads without write-back so it stays pure.

import * as fs from 'node:fs';
import { parseDocument, type Document } from 'yaml';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import { CURRENT_PLAN_FRONTMATTER_VERSION } from './schemas/plan-frontmatter.js';
import { migrate as planV0ToV1 } from './migrations/plan/v0_to_v1.js';
import { migrate as planV1ToV2 } from './migrations/plan/v1_to_v2.js';
import { migrate as intakeV0ToV1 } from './migrations/intake/v0_to_v1.js';

// Frontmatter delimiter regex — accepts \n or \r\n line endings.
// Group 1: the YAML body between the --- fences. Group 2: the markdown body
// after the trailing fence (including any leading newline, which we keep so
// `---\n` + body round-trips byte-for-byte when no edits occur).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(
  text: string,
): { frontmatter: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const doc = parseDocument(match[1] ?? '');
  const json = doc.toJSON();
  return {
    frontmatter: (json && typeof json === 'object' ? (json as Record<string, unknown>) : {}),
    body: match[2] ?? '',
  };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const doc = parseDocument('');
  for (const [k, v] of Object.entries(frontmatter)) {
    doc.set(k, v);
  }
  return `---\n${doc.toString()}---\n`;
}

/**
 * Round-trip-safe AND deletion-safe frontmatter mutator.
 *
 * The mutator receives a Proxy whose every set / deleteProperty call routes
 * through the LIVE yaml@^2 Document (doc.set / doc.delete) — NOT through a
 * JSON projection. This preserves:
 *   - comments adjacent to surviving keys (yaml@^2 Document API contract)
 *   - key order (yaml@^2 preserves source order on set; new keys are appended)
 *   - key DELETION via `delete fm.key` (CYCLE-1 REVIEWS CONVERGENCE —
 *     Gemini/OpenCode MEDIUM "frontmatter helper key-deletion preservation")
 *
 * Returns the new full markdown string. If the input had no frontmatter,
 * the output begins with a fresh `---\n…\n---\n` followed by the original
 * body unchanged.
 */
export function updateFrontmatter(
  text: string,
  mutator: (fm: Record<string, unknown>) => void,
): string {
  const match = FRONTMATTER_RE.exec(text);
  const doc: Document = match ? parseDocument(match[1] ?? '') : parseDocument('');
  const body = match ? (match[2] ?? '') : text;

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_t, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      return doc.get(prop);
    },
    set(_t, prop, value): boolean {
      if (typeof prop !== 'string') return false;
      doc.set(prop, value);
      return true;
    },
    deleteProperty(_t, prop): boolean {
      if (typeof prop !== 'string') return false;
      doc.delete(prop); // live-Document deletion — adjacent comments survive
      return true;
    },
    has(_t, prop): boolean {
      if (typeof prop !== 'string') return false;
      return doc.has(prop);
    },
    ownKeys(): string[] {
      const json = doc.toJSON();
      if (!json || typeof json !== 'object') return [];
      return Object.keys(json as Record<string, unknown>);
    },
    getOwnPropertyDescriptor(_t, prop): PropertyDescriptor | undefined {
      if (typeof prop !== 'string') return undefined;
      if (!doc.has(prop)) return undefined;
      return { enumerable: true, configurable: true, value: doc.get(prop) };
    },
  });

  mutator(proxy);

  return `---\n${doc.toString()}---\n${body}`;
}

// ---------------------------------------------------------------------------
// Versioned frontmatter documents (CONF-04, D-17-38).
// ---------------------------------------------------------------------------

/**
 * The markdown documents whose frontmatter is versioned: PLAN.md (v2 since
 * GRND-09 added the outline entry) and INTAKE.md (v1 since GRND-03 made it the
 * structured brief). DRAFT.md / VERIFICATION.md gain frontmatter only when a
 * later requirement adds a field — each through this registry, with its
 * migration under bin/lib/migrations/<kind>/ and a version bump in the same
 * change (S-20). The intake version constant lives here (not in
 * bin/lib/intake-brief.ts, which imports this module) and intake-brief.ts
 * asserts they agree.
 */
export type FrontmatterKind = 'plan' | 'intake' | 'draft' | 'verification';

type TextMigration = (text: string) => string;

/** The INTAKE.md frontmatter version (GRND-03); intake-brief.ts CURRENT_INTAKE_FRONTMATTER_VERSION equals it. */
export const INTAKE_FRONTMATTER_VERSION = 1;

interface FrontmatterKindDef {
  /** The version this build writes and reads. 0 = no frontmatter yet. */
  readonly current: number;
  /** migrations[N] migrates vN → vN+1. */
  readonly migrations: Readonly<Record<number, TextMigration>>;
}

export const FRONTMATTER_KINDS: Readonly<Record<FrontmatterKind, FrontmatterKindDef>> = Object.freeze({
  plan: { current: CURRENT_PLAN_FRONTMATTER_VERSION, migrations: { 0: planV0ToV1, 1: planV1ToV2 } },
  intake: { current: INTAKE_FRONTMATTER_VERSION, migrations: { 0: intakeV0ToV1 } },
  draft: { current: 0, migrations: {} },
  verification: { current: 0, migrations: {} },
});

/** A frontmatter document that cannot be read by this build (EXIT_ERROR). */
export class FrontmatterVersionError extends PensmithError {
  readonly kind: FrontmatterKind;
  readonly diskVersion: number | null;
  constructor(kind: FrontmatterKind, file: string, message: string, diskVersion: number | null) {
    super(`${file}: ${message}`, EXIT_ERROR);
    this.name = 'FrontmatterVersionError';
    this.kind = kind;
    this.diskVersion = diskVersion;
  }
}

export interface FrontmatterDoc {
  readonly kind: FrontmatterKind;
  /** The frontmatter after migration (what readers should use). */
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  /** The full document text after migration. */
  readonly text: string;
  /** The version found on disk (absent `schema_version` = 0). */
  readonly diskVersion: number;
  /** The version after migration (FRONTMATTER_KINDS[kind].current). */
  readonly version: number;
  /** True when a migration ran (the text differs from the input). */
  readonly migrated: boolean;
}

function readFrontmatterVersion(kind: FrontmatterKind, fm: Record<string, unknown>, file: string): number {
  const v = fm['schema_version'];
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new FrontmatterVersionError(
    kind,
    file,
    `${kind} frontmatter schema_version must be a non-negative integer (got ${JSON.stringify(v)})`,
    null,
  );
}

/**
 * Pure: parse `text` as a `kind` document, refuse a newer version, and run the
 * pending text migrations. `file` only labels error messages.
 */
export function migrateFrontmatterText(
  kind: FrontmatterKind,
  text: string,
  file = `${kind} document`,
): FrontmatterDoc {
  const def = FRONTMATTER_KINDS[kind];
  const diskVersion = readFrontmatterVersion(kind, parseFrontmatter(text).frontmatter, file);
  if (diskVersion > def.current) {
    throw new FrontmatterVersionError(
      kind,
      file,
      `${kind} frontmatter schema_version ${diskVersion} is newer than this pensmith supports ` +
        `(${def.current}) — upgrade pensmith`,
      diskVersion,
    );
  }
  let out = text;
  for (let v = diskVersion; v < def.current; v += 1) {
    const step = def.migrations[v];
    if (!step) {
      throw new FrontmatterVersionError(kind, file, `missing ${kind} frontmatter migration v${v} → v${v + 1}`, diskVersion);
    }
    out = step(out);
  }
  const { frontmatter, body } = parseFrontmatter(out);
  return { kind, frontmatter, body, text: out, diskVersion, version: def.current, migrated: out !== text };
}

export interface LoadFrontmatterOptions {
  /** Persist a migrated document (atomic write under the file's lock). Default false. */
  readonly writeBack?: boolean;
}

/**
 * Read `file` as a versioned `kind` document (see migrateFrontmatterText). With
 * `writeBack: true` a migrated document is written back — under withLock(file),
 * re-read inside the lock so a concurrent writer is never clobbered. ENOENT and
 * other I/O errors propagate unchanged.
 */
export async function loadFrontmatterDoc(
  kind: FrontmatterKind,
  file: string,
  opts: LoadFrontmatterOptions = {},
): Promise<FrontmatterDoc> {
  const doc = migrateFrontmatterText(kind, await fs.promises.readFile(file, 'utf8'), file);
  if (!doc.migrated || opts.writeBack !== true) return doc;
  return withLock(file, async () => {
    const fresh = migrateFrontmatterText(kind, await fs.promises.readFile(file, 'utf8'), file);
    if (fresh.migrated) await atomicWriteFile(file, fresh.text);
    return fresh;
  });
}

/** Synchronous, never-writing read (the pure router uses it). */
export function loadFrontmatterDocSync(kind: FrontmatterKind, file: string): FrontmatterDoc {
  return migrateFrontmatterText(kind, fs.readFileSync(file, 'utf8'), file);
}
