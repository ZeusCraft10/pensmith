// bin/lib/http-mock.ts — the network-mode seam and the exact-match fixture store
// (RUN-01..RUN-05, D-17-04, D-17-06, D-17-08, D-17-14, D-17-15).
//
// =====================================================================
//   Three orthogonal modes (S-15, D-17-04)
// =====================================================================
// This module is the ONE place that decides the network mode. bin/lib/http.ts
// asks networkMode() at the top of every request (the egress gate, D-17-05) and
// never reads a mode environment variable itself.
//
//   dryRun         PENSMITH_DRY_RUN=1 (set by the --dry-run pre-parse, which
//                  is also the channel into child processes).
//   sourcesOffline PENSMITH_OFFLINE=1, OR dry-run, OR a test context
//                  (NODE_TEST_CONTEXT set by `node --test`, or PENSMITH_TEST=1
//                  set by scripts/run-tests.mjs) WITHOUT PENSMITH_NETWORK_TESTS=1.
//   llmStubbed     PENSMITH_NO_LLM=1 OR dry-run.
//
// A real user with no variables set is LIVE (D-V1-01). PENSMITH_NETWORK_TESTS=1
// turns sources live ONLY inside a test context (the test-lane seam); this file
// is the only bin/, mcp/ or hooks/ code that reads it (chokepoint row
// network-tests-seam).
//
// =====================================================================
//   Exact-match fixture store (D-17-06)
// =====================================================================
// Sources-offline replay answers a request ONLY from a recorded fixture whose
// canonical key (method, origin, pathname, sorted query without the contact /
// secret params, sha256 of a POST body) equals the request's. There is no
// "first search item" or "first cassette entry" fallback anywhere: a miss is
// null here, and bin/lib/http.ts turns it into a typed OfflineEgressError.
//
// Fixtures live in tests/fixtures/cassettes/<adapter>/*.json (real recordings
// made by scripts/refresh-cassettes.mjs), tests/fixtures/cassettes/e2e/
// <adapter>/*.json (the recorded end-to-end corpus, `--corpus e2e`, D-18-31)
// and tests/fixtures/cassettes/synthetic/<adapter>/*.json (hand-written
// negative-test fixtures). The exact-match index reads all three. This is the
// ONLY runtime module that resolves a tests/ path (chokepoint row
// tests-path-at-runtime); an installed package does not ship tests/, so
// fixturesAvailable is false there and offline replay is refused up front
// (announceModes, D-17-15).
//
// =====================================================================
//   Cassette schema
// =====================================================================
//   {
//     scope: 'https://api.crossref.org',
//     method: 'GET',
//     path: '/works?query=...',          (scrubbed params removed by the recorder)
//     status: 200,
//     response: <object for JSON bodies, string otherwise>,
//     responseHeaders?: { 'content-type': 'application/json',
//                         'location': '<url>' },   (a recorded redirect hop)
//     bodyEncoding?: 'base64',           (a non-text body, e.g. a PDF: `response`
//                                         is its base64 — D-19-07)
//     bodySha256?: '<hex>',              (POST fixtures only)
//     provenance?: { recordedAt, recorder, adapter }   (recorded fixtures)
//   }
//
// A redirect is recorded as one entry per hop (a 3xx with its `location`, then
// the next URL's answer); offline replay follows those hops through this same
// exact-match store (bin/lib/http.ts), so a recorded chain replays exactly.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';

// ---------------------------------------------------------------------
//   Package-root resolution (the one package.json walk left, D-23a-03)
// ---------------------------------------------------------------------
// This file ships at two depths: bin/lib/http-mock.ts under tsx, and
// dist/bin/lib/http-mock.js after build. Walk up to package.json: the
// cassettes live in the source checkout's tests/, beside the package root —
// never in plugin/ (shipped assets resolve through paths.ts pluginRoot()).
// In an install or the plugin bundle the walk finds no tests/, and offline
// replay refuses with the "not shipped" message (the tests-path-at-runtime
// row, RUN-05).
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
const SYNTHETIC_DIR = 'synthetic';
/**
 * The recorded end-to-end corpus (GRND-18, D-18-31): tests/fixtures/cassettes/
 * e2e/<adapter>/, written only by `npm run cassettes:refresh -- --corpus e2e`
 * and described by tests/fixtures/e2e-corpus/MANIFEST.json. A separate root, so
 * a per-adapter refresh (which replaces <adapter>/ wholesale) never wipes it.
 */
export const E2E_CASSETTES_DIR = 'e2e';

// ---------------------------------------------------------------------
//   Public types
// ---------------------------------------------------------------------

export interface Cassette {
  scope: string;
  method: 'GET' | 'POST' | 'HEAD';
  path: string;
  status: number;
  response: unknown;
  responseHeaders?: Record<string, string>;
  /** sha256 (hex) of the POST body this fixture answers (D-17-06). */
  bodySha256?: string;
  /**
   * `base64`: `response` is the base64 of a non-text body (a PDF), decoded to
   * exact bytes on replay (D-19-07). Absent: `response` is the text / JSON body.
   */
  bodyEncoding?: 'base64';
  /** Written by scripts/refresh-cassettes.mjs for every real recording (CI-07). */
  provenance?: { recordedAt: string; recorder: string; adapter: string };
  /** CYCLE-3 substantive LOW REVIEWS CONVERGENCE — request-header bucket. */
  requestHeaders?: Record<string, string>;
  /** Alternate spelling some recorders use. */
  reqheaders?: Record<string, string>;
}

/**
 * Sensitive-header deny-list (T-3-02 / T-01-07).
 *
 * The recorder (bin/lib/http.ts record hook + scripts/refresh-cassettes.mjs)
 * never persists these, and tests/cassette-no-leak.test.ts asserts no committed
 * cassette carries any of them. EXPORTED so both sides use the same set.
 */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-amz-security-token',
  'x-csrf-token',
  'proxy-authorization',
  // The Zotero Web API key header (SRC-16, D-19-24): never recorded, never part
  // of an HTTP cache key, dropped on a cross-origin redirect hop.
  'zotero-api-key',
]);

/**
 * Query parameters removed from a fixture key and from recorded cassette paths
 * (D-17-06): contact and secret parameters must never decide a match, and must
 * never be committed.
 */
export const SCRUBBED_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'mailto',
  'email',
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
  'tool',
  '_',
]);

/** `message-type` values public APIs use for an error document. */
const ERROR_MESSAGE_TYPES: ReadonlySet<string> = new Set(['error', 'exception', 'validation-failure', 'not-polite']);

/**
 * Why a response body is an API error document, or null when it is not (CI-07).
 * Some services answer HTTP 200 with an error inside (Crossref Labs'
 * `{"statusCode":"403","message-type":"not-polite"}`): such a body is never a
 * recording — the recorder refuses it and tests/cassette-provenance.test.ts
 * fails on a committed one. `status` is the HTTP status it came with; a
 * deliberate non-200 recording (a real 404) is judged by its status, not here.
 */
export function recordedErrorBody(status: number, response: unknown): string | null {
  if (status !== 200) return null;
  let body: unknown = response;
  if (typeof body === 'string') {
    const t = body.trim();
    if (!t.startsWith('{')) return null; // XML / HTML / plain text answers
    try {
      body = JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const code = Number(o['statusCode'] ?? o['status_code']);
  if (Number.isFinite(code) && code >= 400) return `an inner statusCode ${code}`;
  const mt = o['message-type'];
  if (typeof mt === 'string' && ERROR_MESSAGE_TYPES.has(mt.toLowerCase())) return `message-type "${mt}"`;
  const st = o['status'];
  if (typeof st === 'string' && /^(failed|error)$/i.test(st)) return `status "${st}"`;
  const err = o['error'];
  if ((typeof err === 'string' && err.length > 0) || (typeof err === 'object' && err !== null)) return 'an "error" member';
  return null;
}

// ---------------------------------------------------------------------
//   Network mode (D-17-04)
// ---------------------------------------------------------------------

export type OfflineReason = '--dry-run' | 'PENSMITH_OFFLINE=1' | 'test runner';

export interface NetworkMode {
  /** Source and registrar requests are answered from fixtures (or refused); the detector and plagiarism checks send nothing (RUN-03). */
  readonly sourcesOffline: boolean;
  /** Every model call returns a deterministic stub; no provider is contacted. */
  readonly llmStubbed: boolean;
  /** --dry-run: zero sockets; sources come from the synthetic dry-run provider. */
  readonly dryRun: boolean;
  /** Why sources are offline, or null when live. */
  readonly reason: OfflineReason | null;
  /** tests/fixtures/cassettes exists (a source checkout, not an installed package). */
  readonly fixturesAvailable: boolean;
}

/** True under `node --test` (NODE_TEST_CONTEXT) or scripts/run-tests.mjs (PENSMITH_TEST=1). */
export function isTestContext(): boolean {
  const ctx = process.env['NODE_TEST_CONTEXT'];
  return (typeof ctx === 'string' && ctx.length > 0) || process.env['PENSMITH_TEST'] === '1';
}

/** Compute the effective network mode for this process right now. */
export function networkMode(): NetworkMode {
  const dryRun = process.env['PENSMITH_DRY_RUN'] === '1';
  const offlineEnv = process.env['PENSMITH_OFFLINE'] === '1';
  const test = isTestContext();
  // The ONE read of PENSMITH_NETWORK_TESTS in bin/ (chokepoint network-tests-seam):
  // it turns sources live only inside a test context. Outside a test context it
  // means nothing — a real user is live by default anyway.
  const testLaneLive = test && process.env['PENSMITH_NETWORK_TESTS'] === '1';

  let reason: OfflineReason | null = null;
  if (dryRun) reason = '--dry-run';
  else if (offlineEnv) reason = 'PENSMITH_OFFLINE=1';
  else if (test && !testLaneLive) reason = 'test runner';

  return {
    sourcesOffline: reason !== null,
    llmStubbed: dryRun || process.env['PENSMITH_NO_LLM'] === '1',
    dryRun,
    reason,
    fixturesAvailable: existsSync(CASSETTES_ROOT),
  };
}

/**
 * Sources-offline predicate (kept for existing callers; D-17-04). True under
 * PENSMITH_OFFLINE=1, --dry-run, or the test runner without
 * PENSMITH_NETWORK_TESTS=1. False for a real user with no variables set.
 */
export function isOfflineMode(): boolean {
  return networkMode().sourcesOffline;
}

/**
 * The cassette recorder hook (D-17-14) is active only when LIVE, outside a test
 * context, and with PENSMITH_RECORD_CASSETTES=1 (scripts/refresh-cassettes.mjs).
 */
export function isRecordingEnabled(): boolean {
  if (process.env['PENSMITH_RECORD_CASSETTES'] !== '1') return false;
  if (isTestContext()) return false;
  return !networkMode().sourcesOffline;
}

// ---------------------------------------------------------------------
//   Disclosure strings (D-17-08 — fixed copy)
// ---------------------------------------------------------------------

/**
 * The stderr banner for an offline run, or null when live. A dry run names its
 * workspace (GRND-19, D-18-30) when the caller passes it — the folder every
 * file of the dry run is written to (`<root>/.paper-dry-run`).
 */
export function offlineBanner(mode: NetworkMode = networkMode(), workspace?: string): string | null {
  if (!mode.sourcesOffline || mode.reason === null) return null;
  if (mode.dryRun) {
    const base = 'OFFLINE MODE (reason: --dry-run): sources are labelled synthetic dry-run sources; no network or model call is made';
    return workspace !== undefined && workspace.length > 0
      ? `${base}; working in ${workspace} (the real .paper/ is never written)`
      : base;
  }
  return `OFFLINE MODE (reason: ${mode.reason}): sources and verification are recorded fixtures, not live; the detector score and the plagiarism check are skipped`;
}

/** The reason label of a stubbed-LLM run (--dry-run sets PENSMITH_NO_LLM=1 too). */
export const LLM_STUBBED_REASON = 'PENSMITH_NO_LLM=1';

/**
 * The stderr banner for a stubbed-LLM run, or null. Independent of the network
 * mode. It names the reason the user actually gave (RUN-02): `--dry-run` sets
 * PENSMITH_NO_LLM=1 internally, so a dry run is labelled as a dry run, not with
 * a variable the user never set.
 */
export function llmStubbedBanner(mode: NetworkMode = networkMode()): string | null {
  if (!mode.llmStubbed) return null;
  const reason = mode.dryRun ? 'reason: --dry-run' : LLM_STUBBED_REASON;
  return `LLM STUBBED (${reason}): every model call returns a deterministic stub; no provider is contacted`;
}

/**
 * The marker line written as the FIRST line of every artifact produced offline
 * (.paper/RESEARCH.md, each section VERIFICATION.md, COMPILE-REPORT.md body,
 * .paper/VERIFICATION.md). null when live. Exports never carry it: exporters
 * read DRAFT.md / FINAL.md, which never do (zero trace).
 */
export function offlineMarkerLine(mode: NetworkMode = networkMode()): string | null {
  if (!mode.sourcesOffline || mode.reason === null) return null;
  if (mode.dryRun) {
    return '> OFFLINE MODE (--dry-run) — synthetic dry-run sources, not live results.';
  }
  return `> OFFLINE MODE (${mode.reason}) — recorded fixtures, not live results.`;
}

/** The exact prefix every offline marker line starts with (for readers and tests). */
export const OFFLINE_MARKER_PREFIX = '> OFFLINE MODE (';

/** Verbs that never need fixtures: exempt from the installed-package refusal (D-17-15). */
export const OFFLINE_READ_ONLY_VERBS: ReadonlySet<string> = new Set(['status', 'list', 'doctor', 'open']);

export const OFFLINE_FIXTURES_NOT_SHIPPED =
  'offline fixtures are not shipped in the installed package; offline replay needs a source checkout';

/**
 * The installed-package refusal (RUN-05, D-17-15): sources-offline replay
 * without --dry-run needs the recorded fixtures, which only a source checkout
 * has. Thrown before any work so a user never gets 0-result research or
 * all-FABRICATED verdicts from a missing fixture tree.
 */
export class OfflineFixturesNotShippedError extends PensmithError {
  constructor() {
    super(OFFLINE_FIXTURES_NOT_SHIPPED, EXIT_ERROR);
    this.name = 'OfflineFixturesNotShippedError';
  }
}

let announced = false;

export interface AnnounceOptions {
  /** The explicit verb (bin/pensmith.ts firstVerb), or null for a bare/routed run. */
  readonly verb: string | null;
  /** The raw argv, when available: --version / --help / --estimate are exempt. */
  readonly argv?: readonly string[];
  /** A dry run's workspace folder, named in the OFFLINE MODE banner (GRND-19). */
  readonly workspace?: string;
}

/**
 * Print the RUN-02 banners once per process (stderr, before any other output),
 * then apply the installed-package refusal (D-17-15). Read-only verbs, the
 * citty meta flags and the --estimate preview are exempt from the refusal, and
 * so is `resume --replay` (RUN-17): replaying a SESSION.log step serves the
 * LOGGED model responses and needs no recorded source fixture. A source or
 * registrar request made during a replay still fails closed on its own
 * (http.ts: "no recorded fixture … re-run online"), so nothing is ever faked.
 */
export function announceModes(opts: AnnounceOptions): void {
  const argv = opts.argv ?? [];
  const meta = argv.includes('--version') || argv.includes('--help') || argv.includes('-h');
  const mode = networkMode();
  if (!announced && !meta) {
    announced = true;
    const lines = [offlineBanner(mode, opts.workspace), llmStubbedBanner(mode)].filter(
      (l): l is string => l !== null,
    );
    if (lines.length > 0) process.stderr.write(lines.join('\n') + '\n');
  }
  if (meta || argv.includes('--estimate')) return;
  if (opts.verb !== null && OFFLINE_READ_ONLY_VERBS.has(opts.verb)) return;
  if (opts.verb === 'resume' && argv.some((a) => a === '--replay' || a.startsWith('--replay='))) return;
  if (mode.sourcesOffline && !mode.dryRun && !mode.fixturesAvailable) {
    throw new OfflineFixturesNotShippedError();
  }
}

/** Test-only: let a second announceModes() call print again. */
export function _resetAnnouncedForTest(): void {
  announced = false;
}

// ---------------------------------------------------------------------
//   Canonical fixture key (D-17-06)
// ---------------------------------------------------------------------

function sha256Hex(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/**
 * The canonical key a request and a fixture must share exactly: METHOD,
 * origin, percent-decoded pathname, and the query sorted by key then value
 * with SCRUBBED_QUERY_PARAMS removed; a request body (POST) adds its sha256.
 */
export function canonicalFixtureKey(method: string, url: string, body?: string | Buffer): string {
  const u = new URL(url);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !SCRUBBED_QUERY_PARAMS.has(k.toLowerCase()))
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  let key = `${method.toUpperCase()} ${u.origin}${decodePath(u.pathname)}${query ? `?${query}` : ''}`;
  if (body !== undefined && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    key += ` sha256:${sha256Hex(body)}`;
  }
  return key;
}

/** The path+query a recorded cassette stores (scrubbed params removed, order kept). */
export function scrubbedPathAndQuery(url: string): string {
  const u = new URL(url);
  const kept = [...u.searchParams.entries()].filter(([k]) => !SCRUBBED_QUERY_PARAMS.has(k.toLowerCase()));
  const sp = new URLSearchParams(kept);
  const q = sp.toString();
  return `${u.pathname}${q ? `?${q}` : ''}`;
}

/** The canonical key of a committed cassette entry. */
export function cassetteKey(c: Cassette): string {
  const url = `${c.scope}${c.path}`;
  const method = String(c.method).toUpperCase();
  let key = canonicalFixtureKey(method, url);
  if (method !== 'GET' && method !== 'HEAD' && typeof c.bodySha256 === 'string') {
    key += ` sha256:${c.bodySha256.toLowerCase()}`;
  }
  return key;
}

// ---------------------------------------------------------------------
//   Cassette readers
// ---------------------------------------------------------------------

function parseCassetteFile(file: string): Cassette[] {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as Cassette[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Cassette ${file} is not a JSON array (got ${typeof parsed})`);
  }
  return parsed;
}

/** The directories searched for an adapter: <adapter>/, then e2e/<adapter>/, then synthetic/<adapter>/. */
function adapterDirs(adapter: string): string[] {
  return [
    join(CASSETTES_ROOT, adapter),
    join(CASSETTES_ROOT, E2E_CASSETTES_DIR, adapter),
    join(CASSETTES_ROOT, SYNTHETIC_DIR, adapter),
  ];
}

/**
 * Synchronously read + parse a single cassette JSON file from
 * tests/fixtures/cassettes/<adapter>/ or tests/fixtures/cassettes/synthetic/
 * <adapter>/. Used by tests that need a fixture body (parser tests, the LLM
 * fixture tests). Returns null when the file does not exist; throws on a
 * corrupt cassette so CI never silently degrades to "no data".
 */
export function loadCassetteFile(adapter: string, basename: string): Cassette[] | null {
  for (const dir of adapterDirs(adapter)) {
    const file = join(dir, `${basename}.json`);
    if (existsSync(file)) return parseCassetteFile(file);
  }
  return null;
}

/**
 * Merge every committed cassette for an adapter (recorded and synthetic) into
 * one flat entry array. Returns null when neither directory exists.
 */
export function loadCassetteDir(adapter: string): Cassette[] | null {
  const dirs = adapterDirs(adapter).filter((d) => existsSync(d));
  if (dirs.length === 0) return null;
  const out: Cassette[] = [];
  for (const dir of dirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) out.push(...parseCassetteFile(join(dir, f)));
  }
  return out;
}

/** Every cassette file under tests/fixtures/cassettes (recorded + synthetic). */
export function listCassetteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
    }
  };
  walk(CASSETTES_ROOT);
  return out;
}

// ---------------------------------------------------------------------
//   The exact-match fixture store (D-17-06)
// ---------------------------------------------------------------------

export interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  /** The body as text (the UTF-8 decode of `bodyBytes` for a base64 fixture — lossy for binary). */
  body: string;
  /** The exact body bytes (a base64 fixture decodes to them; a text fixture is its UTF-8). */
  bodyBytes: Buffer;
  /** Which committed file answered (for diagnostics and the http session record). */
  file: string;
}

/** The exact bytes a fixture entry answers with (D-19-07: a base64 body decodes to its bytes). */
export function fixtureBodyBytes(entry: Pick<Cassette, 'response' | 'bodyEncoding'>): Buffer {
  const r = entry.response;
  if (entry.bodyEncoding === 'base64') {
    return Buffer.from(typeof r === 'string' ? r : '', 'base64');
  }
  const text = typeof r === 'string' ? r : r === undefined || r === null ? '' : JSON.stringify(r);
  return Buffer.from(text, 'utf8');
}

interface IndexedFixture {
  entry: Cassette;
  file: string;
}

let fixtureIndex: Map<string, IndexedFixture> | null = null;

function buildIndex(): Map<string, IndexedFixture> {
  const index = new Map<string, IndexedFixture>();
  for (const file of listCassetteFiles()) {
    for (const entry of parseCassetteFile(file)) {
      if (typeof entry?.scope !== 'string' || typeof entry?.path !== 'string') continue;
      const method = String(entry.method).toUpperCase();
      // A POST fixture without a body hash can never match exactly (D-17-06):
      // it answers nothing (the hand-written LLM fixtures are read by their
      // tests through loadCassetteFile, never through replay).
      if (method !== 'GET' && method !== 'HEAD' && typeof entry.bodySha256 !== 'string') continue;
      let key: string;
      try {
        key = cassetteKey(entry);
      } catch {
        continue;
      }
      // First file (sorted walk) wins; tests/cassette-provenance.test.ts asserts
      // there are no duplicate keys, so the order never decides a match.
      if (!index.has(key)) index.set(key, { entry, file });
    }
  }
  return index;
}

/**
 * Answer a request from the exact-match store, or null on a miss. Never
 * falls back to another record (D-17-06). Only bin/lib/http.ts calls this, and
 * only in sources-offline mode.
 */
export function lookupFixture(method: string, url: string, body?: string | Buffer): FixtureResponse | null {
  if (fixtureIndex === null) fixtureIndex = buildIndex();
  const hit = fixtureIndex.get(canonicalFixtureKey(method, url, body));
  if (!hit) return null;
  const bytes = fixtureBodyBytes(hit.entry);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(hit.entry.responseHeaders ?? {})) {
    headers[k.toLowerCase()] = String(v);
  }
  return { status: hit.entry.status, headers, body: bytes.toString('utf8'), bodyBytes: bytes, file: hit.file };
}
