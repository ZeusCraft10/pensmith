// bin/lib/http-mock.ts — PR-time offline cassette loader + cron recorder (D-23, RSCH-11).
//
// =====================================================================
//   Two-tier API surface (executor deviation note — see below)
// =====================================================================
// The originally-specified API in Plan 04 wires `nock` interceptors so that
// subsequent `http.get(url)` calls return the cassette body. In practice
// `pensmith`'s HTTP chokepoint (bin/lib/http.ts) routes through `undici`,
// and nock@14 hooks node:http/https only — it does NOT intercept undici
// requests. Rather than burn an entire wave on a port to undici MockAgent
// (which would need its own per-file eslint exemption since undici imports
// are forbidden outside bin/lib/http.ts), this module ships TWO surfaces:
//
//   1. loadCassettes(adapter)/clearCassettes() — nock-based, preserved
//      for forward compatibility AND for the cron-refresh recorder which
//      uses nock.recorder.rec() to capture live traffic from the same
//      adapter code via a dedicated tsx entry-point (Plan 09).
//   2. loadCassetteFile(adapter, basename) — synchronous reader that
//      returns the parsed cassette JSON. Each adapter checks
//      isOfflineMode() at the top of search/fetchById and short-circuits
//      through loadCassetteFile, bypassing http.ts entirely in offline
//      mode. This is the path the PR-time test suite actually uses.
//
// The two-surface design keeps the plan's API contract intact while
// making the offline tests actually function against undici-backed
// adapters. Documented as Rule 3 (auto-fix blocking issue) in
// .planning/phases/03-vertical-slice-one-section/03-04-SUMMARY.md.
//
// =====================================================================
//   Cassette schema (mirror nockBack output shape — recorder compat)
// =====================================================================
// Each cassette JSON is an array of:
//   {
//     scope: 'https://api.crossref.org',
//     method: 'GET',
//     path: '/works?query=...',
//     status: 200,
//     response: <body — object for JSON APIs, string for XML APIs>,
//     responseHeaders?: { 'content-type': 'application/json' }
//   }
//
// =====================================================================
//   Sensitive-header scrubbing (T-3-02 / T-01-07 / CYCLE-3 LOW)
// =====================================================================
// recordCassettes() opens nock.recorder.rec() with
// enable_reqheaders_recording: false — request headers (which would
// carry Authorization / x-api-key) never reach the recorder buffer.
// finalizeRecording() additionally scrubs RESPONSE headers via the
// SENSITIVE_HEADERS deny-list before writing each cassette. The
// tests/cassette-no-leak.test.ts sentinel scans both `responseHeaders`
// AND any stray `reqheaders`/`requestHeaders` keys in committed JSON.

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

// ---------------------------------------------------------------------
//   Cassette root resolution (mirrors http.ts findPkgRoot pattern)
// ---------------------------------------------------------------------
// This file ships at two depths: bin/lib/http-mock.ts under tsx, and
// dist/bin/lib/http-mock.js after build. Fixed-depth `..` × N would
// land in the wrong dir post-build (same defect class as IN-03). Walk
// up from HERE until we find package.json, then resolve cassette dir
// relative to that.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue
    }
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

const PKG_ROOT = findPkgRoot(__dirname);
const CASSETTES_ROOT = join(PKG_ROOT, 'tests', 'fixtures', 'cassettes');

// ---------------------------------------------------------------------
//   Public types
// ---------------------------------------------------------------------

export interface Cassette {
  scope: string;
  method: 'GET' | 'POST';
  path: string;
  status: number;
  response: unknown;
  responseHeaders?: Record<string, string>;
  /** CYCLE-3 substantive LOW REVIEWS CONVERGENCE — request-header bucket. */
  requestHeaders?: Record<string, string>;
  /** Alternate spelling some recorders use. */
  reqheaders?: Record<string, string>;
}

/**
 * Sensitive-header deny-list (T-3-02 / T-01-07).
 *
 * Used by finalizeRecording() to scrub response headers and by
 * tests/cassette-no-leak.test.ts to assert no committed cassette
 * carries any of these keys (case-insensitive). EXPORTED so the
 * sentinel test imports the exact same set the writer applies —
 * single source of truth.
 */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-amz-security-token',
  'x-csrf-token',
  'proxy-authorization',
]);

// ---------------------------------------------------------------------
//   Offline-mode predicate
// ---------------------------------------------------------------------

/**
 * Offline mode is the DEFAULT (PR-time CI never sets PENSMITH_NETWORK_TESTS).
 * The weekly cron-refresh job sets PENSMITH_NETWORK_TESTS=1 to opt into
 * live HTTP and re-record cassettes.
 */
export function isOfflineMode(): boolean {
  return process.env['PENSMITH_NETWORK_TESTS'] !== '1';
}

// ---------------------------------------------------------------------
//   Cassette readers
// ---------------------------------------------------------------------

/**
 * Synchronously read + parse a single cassette JSON file. Used by
 * adapters in offline mode to short-circuit the HTTP path entirely
 * (nock@14 does NOT intercept undici requests — see file header).
 *
 * Returns the parsed cassette array, or null if the file does not
 * exist. Throws on JSON-parse errors so corrupt cassettes surface
 * loudly in CI rather than silently degrading to "no data".
 */
export function loadCassetteFile(adapter: string, basename: string): Cassette[] | null {
  const file = join(CASSETTES_ROOT, adapter, `${basename}.json`);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as Cassette[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Cassette ${file} is not a JSON array (got ${typeof parsed})`);
  }
  return parsed;
}

/**
 * Merge EVERY committed cassette JSON in tests/fixtures/cassettes/<adapter>/
 * into one flat entry array. Used by the offline adapters when a request must
 * resolve against a DOI/query that may live in ANY committed cassette — not
 * just one hard-coded basename (ERGO-06 `add <doi>`: the committed add-doi.json
 * carries 10.1038/nphys1170, distinct from works-attention.json). Returns null
 * when the adapter dir does not exist; throws (loudly) on a corrupt cassette so
 * CI never silently degrades to "no data". Order follows readdirSync (locale-
 * sorted on most platforms) — adapters that need a deterministic first-match
 * should path-match a specific entry rather than rely on dir order.
 */
export function loadCassetteDir(adapter: string): Cassette[] | null {
  const dir = join(CASSETTES_ROOT, adapter);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: Cassette[] = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const parsed = JSON.parse(raw) as Cassette[];
    if (!Array.isArray(parsed)) {
      throw new Error(`Cassette ${join(dir, f)} is not a JSON array (got ${typeof parsed})`);
    }
    out.push(...parsed);
  }
  return out;
}

/**
 * Register nock interceptors for every cassette in
 * tests/fixtures/cassettes/<adapter>/. Used by the cron-refresh tooling
 * (Plan 09) to ensure existing cassettes still apply during re-record
 * runs; also preserved as the documented API even though nock@14 does
 * not intercept undici (the runtime path used by bin/lib/http.ts).
 *
 * In offline mode this also calls nock.disableNetConnect() — request
 * lockdown defense-in-depth at the node:http layer (catches any future
 * dep that bypasses our undici chokepoint).
 */
export async function loadCassettes(adapter: string): Promise<void> {
  if (!isOfflineMode()) return;
  const { default: nock } = await import('nock');
  const dir = join(CASSETTES_ROOT, adapter);
  if (!existsSync(dir)) {
    throw new Error(
      `No cassette directory for adapter "${adapter}" at ${dir} (D-23)`,
    );
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const cassettes = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Cassette[];
    for (const c of cassettes) {
      nock(c.scope)
        .intercept(c.path, c.method)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .reply(c.status, c.response as any, c.responseHeaders ?? {});
    }
  }
  nock.disableNetConnect();
}

/**
 * Tear down every nock interceptor and re-enable network connect. Called
 * between tests (or after a recorder run) to leave the global state clean.
 */
export async function clearCassettes(): Promise<void> {
  const { default: nock } = await import('nock');
  nock.cleanAll();
  nock.enableNetConnect();
}

// ---------------------------------------------------------------------
//   Recorder (cron-refresh — Plan 09)
// ---------------------------------------------------------------------

/**
 * Open the nock.recorder for the given adapter. The caller MUST wrap
 * adapter invocations in try/finally so the recorder is always cleared
 * even if the adapter throws — leaving nock.recorder in 'recording'
 * state across tests poisons all subsequent invocations and may leak
 * sensitive headers from later runs into earlier cassettes.
 *
 * Canonical caller pattern (Plan 09 bin/cli/refresh-cassettes.ts):
 *
 *   await recordCassettes('crossref');
 *   try {
 *     await crossref.search('attention mechanisms');
 *     await crossref.fetchById('10.0000/aaa');
 *   } finally {
 *     finalizeRecording('crossref');
 *   }
 */
export async function recordCassettes(adapter: string): Promise<void> {
  if (
    process.env['PENSMITH_NETWORK_TESTS'] !== '1' ||
    process.env['PENSMITH_RECORD_CASSETTES'] !== '1'
  ) {
    throw new Error(
      `recordCassettes(${adapter}) requires PENSMITH_NETWORK_TESTS=1 AND PENSMITH_RECORD_CASSETTES=1 (D-23, D-24)`,
    );
  }
  // mkdir is done at finalizeRecording time; opening the recorder is
  // synchronous, but the public surface is async so callers don't have
  // to special-case open/teardown — see lifecycle docblock above.
  const { default: nock } = await import('nock');
  nock.recorder.rec({
    output_objects: true,
    dont_print: true,
    // CYCLE-3 substantive LOW: request-header capture disabled by nock;
    // nothing reaches the scrubber for requests. This is the FIRST
    // defense; tests/cassette-no-leak.test.ts is the SECOND defense.
    enable_reqheaders_recording: false,
  });
}

/**
 * Drain the nock recorder buffer, scrub SENSITIVE_HEADERS from each
 * response (and any stray reqheaders), and write one JSON file per
 * unique (method, scope, path) tuple to tests/fixtures/cassettes/
 * <adapter>/<sanitized-path>.json.
 *
 * CRITICAL — nock.recorder.clear() runs in the finally block regardless
 * of write success. Leaving the recorder in 'recording' state across
 * runs poisons subsequent invocations.
 */
export async function finalizeRecording(adapter: string): Promise<void> {
  // nock.recorder.play() returns Array<string | Definition>; with
  // output_objects:true (passed in recordCassettes) every element is a
  // Definition. We cast through unknown so TS accepts the recorder's
  // structural shape (the runtime keys we read are guarded below).
  const { default: nock } = await import('nock');
  const recorded = nock.recorder.play() as unknown as Array<{
    scope: string;
    method: string;
    path: string;
    status: number;
    response: unknown;
    rawHeaders?: string[];
    reqheaders?: Record<string, string>;
  }>;
  try {
    const outDir = join(CASSETTES_ROOT, adapter);
    mkdirSync(outDir, { recursive: true });
    for (const rec of recorded) {
      // Scrub sensitive RESPONSE headers (rawHeaders is interleaved k,v,k,v,...).
      const cleanedHeaders: Record<string, string> = {};
      const raw = rec.rawHeaders ?? [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const rawK = raw[i];
        const rawV = raw[i + 1];
        if (rawK === undefined || rawV === undefined) continue;
        const k = rawK.toLowerCase();
        if (!SENSITIVE_HEADERS.has(k)) cleanedHeaders[k] = rawV;
      }
      // CYCLE-3 substantive LOW REVIEWS CONVERGENCE — defense-in-depth: also
      // scrub any stray REQUEST headers in case enable_reqheaders_recording
      // is flipped to true upstream. Empty {} on disk documents the policy.
      const cleanedReqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec.reqheaders ?? {})) {
        if (!SENSITIVE_HEADERS.has(k.toLowerCase())) cleanedReqHeaders[k] = v;
      }
      const sanitizedPath = rec.path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const outPath = join(outDir, `${sanitizedPath}.json`);
      const cassette: Cassette = {
        scope: rec.scope,
        method: rec.method.toUpperCase() as 'GET' | 'POST',
        path: rec.path,
        status: rec.status,
        response: rec.response,
        responseHeaders: cleanedHeaders,
        requestHeaders: cleanedReqHeaders,
      };
      writeFileSync(outPath, JSON.stringify([cassette], null, 2));
    }
  } finally {
    nock.recorder.clear();
  }
}
