// bin/lib/replay.ts — replay from the session log (RUN-17, D-17-30).
//
// `pensmith resume --replay <entryId>` finds the kind:"llm" record with that id
// in .paper/SESSION.log, re-dispatches its verb and section with the argv the
// session logged, and — when sources are offline — activates this module's
// store so complete() serves each logged response matched by
// (slug, sha256 of the request body as sent) and never dials the provider.
// Records spilled to .paper/sessions/<run_id>/<seq>.json (> 256 KiB) are read
// from their spill file. A log written with `[logging] session_bodies =
// "redacted"` keeps only hashes, so its steps are reported as not replayable.
//
// scripts/extract-fixture.mjs turns a SESSION.log into a fixture the RUN-21
// mock LLM serves; buildFixture() here is the shared, unit-tested core.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { paperDir, projectRoot } from './paths.js';
import { EXIT_ERROR, PensmithError } from './exit-codes.js';

export interface LoggedLlmRecord {
  id: string;
  run_id: string;
  verb?: string;
  /** The section the call was for: its number, or `1a` for a lettered section. */
  section?: number | string;
  slug: string;
  provider?: string;
  model?: string;
  served_model?: string;
  request?: unknown;
  request_sha256?: string;
  response?: { text?: string; data?: unknown; sha256?: string };
  stop_reason?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_write_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
  session_bodies?: string;
  truncated?: boolean;
  spilled_to?: string;
}

export class ReplayError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'ReplayError';
  }
}

function sessionLogPath(root: string): string {
  return path.join(paperDir(root), 'SESSION.log');
}

/** Every kind:"llm" record of a paper's SESSION.log, with spilled records expanded. */
export function readLlmRecords(root: string = projectRoot()): LoggedLlmRecord[] {
  const file = sessionLogPath(root);
  if (!existsSync(file)) return [];
  return parseLlmRecords(readFileSync(file, 'utf8'), paperDir(root));
}

/** Parse SESSION.log text; `spillBase` (the log's directory) resolves spilled records. */
export function parseLlmRecords(text: string, spillBase?: string): LoggedLlmRecord[] {
  const out: LoggedLlmRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rec['kind'] !== 'llm' || typeof rec['id'] !== 'string' || typeof rec['slug'] !== 'string') continue;
    if (rec['truncated'] === true && typeof rec['spilled_to'] === 'string' && spillBase) {
      const spill = path.join(spillBase, ...String(rec['spilled_to']).split('/'));
      try {
        rec = JSON.parse(readFileSync(spill, 'utf8')) as Record<string, unknown>;
      } catch {
        /* keep the summary line; it is reported as not replayable below */
      }
    }
    out.push(rec as unknown as LoggedLlmRecord);
  }
  return out;
}

/** The session argv logged for `runId` (the `session.argv` event), or null. */
export function loggedArgv(root: string, runId: string): string[] | null {
  const file = sessionLogPath(root);
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.includes('session.argv')) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec['kind'] === 'event' && rec['event'] === 'session.argv' && rec['run_id'] === runId && Array.isArray(rec['argv'])) {
        return (rec['argv'] as unknown[]).filter((a): a is string => typeof a === 'string');
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Whether a record carries the full bodies replay needs. */
export function isReplayable(rec: LoggedLlmRecord): boolean {
  return rec.session_bodies !== 'redacted'
    && rec.truncated !== true
    && typeof rec.request_sha256 === 'string'
    && typeof rec.response?.text === 'string';
}

// ---------------------------------------------------------------------------
// The in-process replay store consulted by complete()
// ---------------------------------------------------------------------------

let store: Map<string, LoggedLlmRecord[]> | null = null;

function key(slug: string, sha: string): string {
  return `${slug}\u0000${sha}`;
}

/** Activate serving of logged responses (resume --replay under sources-offline). */
export function activateReplay(records: readonly LoggedLlmRecord[]): void {
  store = new Map();
  for (const r of records) {
    if (!isReplayable(r)) continue;
    const k = key(r.slug, r.request_sha256 as string);
    const list = store.get(k) ?? [];
    list.push(r);
    store.set(k, list);
  }
}

export function deactivateReplay(): void {
  store = null;
}

export function isReplayActive(): boolean {
  return store !== null;
}

/**
 * The logged response for (slug, request sha256). Identical requests are
 * served in the order they were logged; the last one repeats once exhausted.
 * Null when replay is inactive or nothing matches.
 */
export function replayLookup(slug: string, requestSha256: string): LoggedLlmRecord | null {
  if (!store) return null;
  const list = store.get(key(slug, requestSha256));
  if (!list || list.length === 0) return null;
  return list.length > 1 ? (list.shift() as LoggedLlmRecord) : (list[0] as LoggedLlmRecord);
}

// ---------------------------------------------------------------------------
// Fixture extraction (scripts/extract-fixture.mjs + the RUN-21 mock)
// ---------------------------------------------------------------------------

export interface MockFixtureEntry {
  request_sha256: string;
  model?: string;
  text: string;
  data?: unknown;
  stop_reason?: string;
  input_tokens?: number;
  output_tokens?: number;
}

/** `{ version: 1, slugs: { <slug>: [entries in log order] } }` */
export interface MockFixture {
  version: 1;
  slugs: Record<string, MockFixtureEntry[]>;
}

export function buildFixture(records: readonly LoggedLlmRecord[]): MockFixture {
  const slugs: Record<string, MockFixtureEntry[]> = {};
  for (const r of records) {
    if (!isReplayable(r)) continue;
    const entry: MockFixtureEntry = { request_sha256: r.request_sha256 as string, text: r.response?.text ?? '' };
    if (r.served_model ?? r.model) entry.model = (r.served_model ?? r.model) as string;
    if (r.response?.data !== undefined) entry.data = r.response.data;
    if (r.stop_reason) entry.stop_reason = r.stop_reason;
    if (typeof r.input_tokens === 'number') entry.input_tokens = r.input_tokens;
    if (typeof r.output_tokens === 'number') entry.output_tokens = r.output_tokens;
    (slugs[r.slug] ??= []).push(entry);
  }
  return { version: 1, slugs };
}
