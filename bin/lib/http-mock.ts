// bin/lib/http-mock.ts — test-only cassette replay and recording.
//
// Nothing in production imports this module. bin/lib/http.ts loads it lazily,
// and only when PENSMITH_TEST_CASSETTES=1 (set by scripts/run-tests.mjs), so a
// real install never reads tests/fixtures. An ESLint rule keeps every other
// production module from importing it.
//
// Replay is keyed by the request itself: method, origin, decoded path and the
// query parameters that select records. A request with no recording fails with
// CassetteMissError; it never borrows "the first record" of some other cassette.
// That keeps a test honest: an unknown DOI stays unknown.
//
// Cassette file shape (nock recorder output):
//   [{ scope: 'https://api.crossref.org', method: 'GET', path: '/works?query=...',
//      status: 200, response: <object for JSON APIs, string for HTML/XML>,
//      responseHeaders?: { 'content-type': 'application/json' } }]
//
// Recording strips sensitive headers (SENSITIVE_HEADERS) and identifying query
// parameters (contact emails, keys) before anything is written, because the
// cassettes are committed and ship with every git clone.

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './paths.js';

const PKG_ROOT = packageRoot();
const CASSETTES_ROOT = join(PKG_ROOT, 'tests', 'fixtures', 'cassettes');

// ---------------------------------------------------------------------
//   Types
// ---------------------------------------------------------------------

export interface Cassette {
  scope: string;
  method: 'GET' | 'POST' | 'HEAD';
  path: string;
  status: number;
  response: unknown;
  responseHeaders?: Record<string, string>;
  requestHeaders?: Record<string, string>;
  /** Alternate spelling some recorders use. */
  reqheaders?: Record<string, string>;
}

/** What http.ts needs to build an HttpResponse from a recording. */
export interface CassetteReplay {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Thrown when a request has no recording (or more than one conflicting one). */
export class CassetteMissError extends Error {
  readonly code = 'PENSMITH_CASSETTE_MISS';
  constructor(detail: string) {
    super(`no cassette recorded for ${detail}`);
    this.name = 'CassetteMissError';
  }
}

/**
 * Headers never written to a cassette. tests/cassette-no-leak.test.ts imports
 * this same set to scan the committed files.
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

// Query parameters that identify the caller rather than the records asked for.
// They are stripped when recording and ignored when matching.
// tests/cassette-no-leak.test.ts imports this same set to scan the committed files.
export const IDENTIFYING_PARAMS: ReadonlySet<string> = new Set([
  'mailto', 'email', 'api_key', 'apikey', 'key', 'token',
]);

// Page-size parameters change how many records come back, not which ones, so a
// search recorded with rows=20 also answers the same search asked with rows=10.
const PAGE_SIZE_PARAMS: ReadonlySet<string> = new Set([
  'rows', 'per-page', 'per_page', 'limit', 'max_results', 'retmax',
]);

// ---------------------------------------------------------------------
//   Request matching
// ---------------------------------------------------------------------

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Canonical key for a request. Registries treat DOIs and search terms
 * case-insensitively, so the key is lowercased; `+` and `%20` both decode to a
 * space so recorded and generated query strings compare equal.
 */
function requestKey(method: string, origin: string, pathAndQuery: string): string {
  const q = pathAndQuery.indexOf('?');
  const rawPath = q < 0 ? pathAndQuery : pathAndQuery.slice(0, q);
  const rawQuery = q < 0 ? '' : pathAndQuery.slice(q + 1);
  const params: string[] = [];
  for (const [k, v] of new URLSearchParams(rawQuery)) {
    const name = k.toLowerCase();
    if (IDENTIFYING_PARAMS.has(name) || PAGE_SIZE_PARAMS.has(name)) continue;
    params.push(`${name}=${v.replace(/\s+/g, ' ').trim()}`);
  }
  params.sort();
  return `${method} ${origin}${safeDecode(rawPath)}?${params.join('&')}`.toLowerCase();
}

interface CassetteIndex {
  byKey: Map<string, CassetteReplay>;
  /** Keys recorded more than once with different responses. */
  ambiguous: Set<string>;
}

let index: CassetteIndex | null = null;

/** Read a cassette file; throws on corrupt JSON so a broken fixture fails loudly. */
function readCassetteArray(file: string): Cassette[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Cassette ${file} is not a JSON array (got ${typeof parsed})`);
  }
  return parsed as Cassette[];
}

/** The response a recording replays: lower-cased headers and a string body. */
function toReplay(c: Cassette): CassetteReplay {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.responseHeaders ?? {})) headers[k.toLowerCase()] = v;
  let body: string;
  if (typeof c.response === 'string') {
    body = c.response;
  } else if (c.response === undefined || c.response === null) {
    body = '';
  } else {
    body = JSON.stringify(c.response);
    headers['content-type'] ??= 'application/json';
  }
  return { status: c.status, headers, body };
}

function buildIndex(): CassetteIndex {
  const byKey = new Map<string, CassetteReplay>();
  const ambiguous = new Set<string>();
  if (!existsSync(CASSETTES_ROOT)) return { byKey, ambiguous };
  const dirs = readdirSync(CASSETTES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    const files = readdirSync(join(CASSETTES_ROOT, dir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const file = join(CASSETTES_ROOT, dir, f);
      for (const c of readCassetteArray(file)) {
        let origin: string;
        try {
          origin = new URL(c.scope).origin;
        } catch {
          throw new Error(`Cassette ${file} has an invalid scope ${JSON.stringify(c.scope)}`);
        }
        const key = requestKey(c.method, origin, c.path);
        const replay = toReplay(c);
        const prior = byKey.get(key);
        if (prior && prior.body !== replay.body) {
          ambiguous.add(key);
        } else if (!prior) {
          byKey.set(key, replay);
        }
      }
    }
  }
  return { byKey, ambiguous };
}

/**
 * Answer a request from the committed cassettes. Throws CassetteMissError when
 * there is no recording for exactly this request, or when two recordings for
 * the same request disagree (a POST whose body we do not key on, for example).
 */
export function replayCassette(method: string, url: string): CassetteReplay {
  index ??= buildIndex();
  const u = new URL(url);
  const key = requestKey(method, u.origin, u.pathname + u.search);
  const shown = (): string => `${method.toUpperCase()} ${u.origin}${scrubRecordedPath(u.pathname + u.search)}`;
  if (index.ambiguous.has(key)) {
    throw new CassetteMissError(`${shown()} (several different recordings match; refusing to pick one)`);
  }
  const hit = index.byKey.get(key);
  if (!hit) throw new CassetteMissError(shown());
  return { ...hit, headers: { ...hit.headers } };
}

/**
 * Read one cassette file as recorded. Tests use this to inspect fixtures; the
 * request path goes through replayCassette. Returns null when the file is
 * absent and throws on corrupt JSON so a broken fixture fails loudly.
 */
export function loadCassetteFile(adapter: string, basename: string): Cassette[] | null {
  const file = join(CASSETTES_ROOT, adapter, `${basename}.json`);
  return existsSync(file) ? readCassetteArray(file) : null;
}

// ---------------------------------------------------------------------
//   Recording
// ---------------------------------------------------------------------

/**
 * Drop identifying query parameters (contact email, API keys) from a request
 * path. Works on the raw string so the remaining parameters keep their exact
 * recorded encoding and order.
 */
export function scrubRecordedPath(pathAndQuery: string): string {
  const q = pathAndQuery.indexOf('?');
  if (q < 0) return pathAndQuery;
  const kept = pathAndQuery
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      if (pair === '') return false;
      const name = safeDecode(pair.split('=')[0] ?? '').toLowerCase();
      return !IDENTIFYING_PARAMS.has(name);
    });
  const base = pathAndQuery.slice(0, q);
  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

/**
 * Open the nock recorder for an adapter. Requires PENSMITH_NETWORK_TESTS=1 and
 * PENSMITH_RECORD_CASSETTES=1. Callers must pair it with finalizeRecording in a
 * finally block, or a recorder left running poisons later requests.
 */
export async function recordCassettes(adapter: string): Promise<void> {
  if (
    process.env['PENSMITH_NETWORK_TESTS'] !== '1' ||
    process.env['PENSMITH_RECORD_CASSETTES'] !== '1'
  ) {
    throw new Error(
      `recordCassettes(${adapter}) requires PENSMITH_NETWORK_TESTS=1 AND PENSMITH_RECORD_CASSETTES=1`,
    );
  }
  // nock is a dev dependency; import it only here so a production install never needs it.
  const { default: nock } = await import('nock');
  nock.recorder.rec({
    output_objects: true,
    dont_print: true,
    // Request headers (Authorization, x-api-key) never reach the recorder.
    enable_reqheaders_recording: false,
  });
}

/**
 * Drain the recorder, scrub sensitive headers and identifying query parameters,
 * and write one cassette file per recorded request under
 * tests/fixtures/cassettes/<adapter>/. Always clears the recorder.
 */
export async function finalizeRecording(adapter: string): Promise<void> {
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
      // rawHeaders is interleaved k,v,k,v,...
      const cleanedHeaders: Record<string, string> = {};
      const raw = rec.rawHeaders ?? [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const rawK = raw[i];
        const rawV = raw[i + 1];
        if (rawK === undefined || rawV === undefined) continue;
        const k = rawK.toLowerCase();
        if (!SENSITIVE_HEADERS.has(k)) cleanedHeaders[k] = rawV;
      }
      const cleanedReqHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec.reqheaders ?? {})) {
        if (!SENSITIVE_HEADERS.has(k.toLowerCase())) cleanedReqHeaders[k] = v;
      }
      const path = scrubRecordedPath(rec.path);
      const fileName = `${path.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}.json`;
      const cassette: Cassette = {
        scope: rec.scope,
        method: rec.method.toUpperCase() as Cassette['method'],
        path,
        status: rec.status,
        response: rec.response,
        responseHeaders: cleanedHeaders,
        requestHeaders: cleanedReqHeaders,
      };
      writeFileSync(join(outDir, fileName), JSON.stringify([cassette], null, 2));
    }
  } finally {
    nock.recorder.clear();
  }
}
