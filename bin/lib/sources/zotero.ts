// bin/lib/sources/zotero.ts — the Tier 2 Zotero client (SRC-16, D-19-24).
//
// Reads the user's own Zotero library through bin/lib/http.ts, either
//   - the Zotero Web API (https://api.zotero.org, v3) with ZOTERO_API_KEY (a
//     key from https://www.zotero.org/settings/keys; sent ONLY as the
//     `Zotero-API-Key` header, which is a SENSITIVE_HEADERS entry: never
//     logged, never cached, never recorded, dropped on a cross-origin
//     redirect), the user id from `GET /keys/current`; or
//   - the Zotero 7 local API (http://127.0.0.1:23119/api, no key) when
//     PENSMITH_ZOTERO_LOCAL=1 — "Allow other applications on this computer to
//     communicate with Zotero" in Zotero's Advanced settings. http.ts allows
//     exactly that origin, and only with the variable set (FetchOptions
//     .localService, D-19-24). The local API wins when both are configured: it
//     never leaves the machine.
// ZOTERO_GROUP_ID reads a group library instead of the user's (a public group
// needs no key). `[sources] zotero_collection` (by name) restricts a pull or a
// search to that collection. Everything is read with `noCache` — a Zotero
// library changes under the user's hands.
//
// Adapter contract (19-PLAN §3.2):
//   search(query, opts)  → SourceCandidate[] (Zotero quick search within the
//                          configured collection or library); [] when Zotero
//                          is not configured; [] + opts.onFailure(reason) on
//                          failure; OfflineEgressError thrown.
//   lookupById(key)      → found | not-found (HTTP 404) | failed.
//   fetchById(key)       → unwrapLookup(...).
// And for ingest (bin/lib/zotero-ingest.ts): pullZoteroItems() — every item of
// the configured collection (or library), paginated and bounded.
//
// Items are normalized by bin/lib/sources/zotero-mcp.ts (shared with the Tier 1
// MCP ingest tool).

import {
  fetch as httpFetch,
  isOfflineEgressError,
  offlineLabel,
  isZoteroLocalEnabled,
  localServiceOrigin,
  ZOTERO_LOCAL_ORIGIN,
  MAX_JSON_RESPONSE_BYTES,
  type HttpResponse,
} from '../http.js';
import { tryReadPaperConfigSync } from '../config.js';
import { projectRoot } from '../paths.js';
import { errorFailureReason, type SearchOptions } from './search-failure.js';
import { lookupFound, lookupNotFound, lookupFailed, unwrapLookup, type LookupResult } from './lookup.js';
import {
  validateZoteroItem,
  normalizeZoteroItem,
  toSourceCandidate,
  ZOTERO_KEY,
  type ZoteroItem,
} from './zotero-mcp.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { PensmithError, EXIT_ERROR } from '../exit-codes.js';

/** The Zotero Web API origin. */
export const ZOTERO_WEB_ORIGIN = 'https://api.zotero.org';
/** Where a user creates (or revokes) a Zotero API key. */
export const ZOTERO_KEYS_URL = 'https://www.zotero.org/settings/keys';

/** Items per page (the Zotero API maximum). */
const PAGE = 100;
/** The most items one pull reads (a bound on requests and memory). */
export const MAX_ZOTERO_ITEMS = 1000;
/** Collections read to find one by name. */
const MAX_COLLECTIONS = 1000;

export interface ZoteroConnection {
  readonly mode: 'web' | 'local';
  /** Requests are built on this base: https://api.zotero.org or http://127.0.0.1:23119/api. */
  readonly base: string;
  /** ZOTERO_GROUP_ID when set (digits), else null (the user's own library). */
  readonly groupId: string | null;
  /** Whether a Web API key is sent. */
  readonly keyed: boolean;
}

/** A failure the Zotero client reports as one line (a failed search / pull / lookup). */
export class ZoteroError extends PensmithError {
  readonly status: number | undefined;
  /**
   * The reason without anything it reveals about the user's library (its
   * collection names, its user / group id): what may be written into files
   * that travel with a paper (RESEARCH.md). Defaults to the message.
   */
  readonly publicReason: string;
  constructor(reason: string, status?: number, publicReason?: string) {
    super(reason, EXIT_ERROR);
    this.name = 'ZoteroError';
    this.status = status;
    this.publicReason = publicReason ?? reason;
  }
}

function apiKey(): string | null {
  const k = process.env.ZOTERO_API_KEY?.trim();
  return k ? k : null;
}

function groupIdFromEnv(): string | null {
  const g = process.env.ZOTERO_GROUP_ID?.trim();
  if (!g) return null;
  if (!/^\d+$/.test(g)) throw new ZoteroError(`ZOTERO_GROUP_ID must be a group's number (the digits in zotero.org/groups/<number>), got "${g.slice(0, 40)}"`);
  return g;
}

/** How pensmith reaches Zotero right now, or null when Zotero is not configured. */
export function zoteroConnection(): ZoteroConnection | null {
  const groupId = groupIdFromEnv();
  if (isZoteroLocalEnabled()) {
    return { mode: 'local', base: `${localServiceOrigin('zotero-local') ?? ZOTERO_LOCAL_ORIGIN}/api`, groupId, keyed: false };
  }
  if (apiKey() !== null) return { mode: 'web', base: ZOTERO_WEB_ORIGIN, groupId, keyed: true };
  // A public group library can be read without a key.
  if (groupId !== null) return { mode: 'web', base: ZOTERO_WEB_ORIGIN, groupId, keyed: false };
  return null;
}

/** True when Zotero is configured (a key, the local API, or a group id). Never throws. */
export function isZoteroConfigured(): boolean {
  try {
    return zoteroConnection() !== null;
  } catch {
    return true; // configured, but wrongly: the pull reports why
  }
}

/** `[sources] zotero_collection` of the paper at `root`, or null. */
export function configuredZoteroCollection(root: string = projectRoot()): string | null {
  const name = tryReadPaperConfigSync(root)?.sources?.zotero_collection?.trim();
  return name ? name : null;
}

function isJsonArray(res: HttpResponse): boolean {
  try {
    return Array.isArray(JSON.parse(res.body));
  } catch {
    return false;
  }
}

/** One GET through the egress gate, with the key header on the Web API only. */
async function zoteroGet(conn: ZoteroConnection, pathAndQuery: string, expect: 'array' | 'object'): Promise<HttpResponse> {
  const headers: Record<string, string> = { accept: 'application/json', 'Zotero-API-Version': '3' };
  const key = conn.mode === 'web' ? apiKey() : null;
  if (key !== null) headers['Zotero-API-Key'] = key;
  return httpFetch(`${conn.base}/${pathAndQuery}`, {
    source: 'zotero',
    headers,
    noCache: true,
    maxBytes: MAX_JSON_RESPONSE_BYTES,
    ...(conn.mode === 'local' ? { localService: 'zotero-local' as const } : {}),
    validate: (r) => {
      if (r.status !== 200) return null;
      if (expect === 'array') return isJsonArray(r) ? null : 'response is not a Zotero item list';
      try {
        const v = JSON.parse(r.body) as unknown;
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? null : 'response is not a Zotero object';
      } catch {
        return 'response is not JSON';
      }
    },
  });
}

/** A user-facing reason for a non-200 Zotero answer. */
function statusReason(conn: ZoteroConnection, status: number, what: string): string {
  if (status === 403) {
    if (conn.mode === 'web' && conn.keyed) return `Zotero rejected ZOTERO_API_KEY (HTTP 403) — check the key at ${ZOTERO_KEYS_URL}`;
    if (conn.mode === 'web') return `Zotero refused ${what} (HTTP 403) — a private library needs ZOTERO_API_KEY (${ZOTERO_KEYS_URL})`;
    return `the Zotero local API refused ${what} (HTTP 403)`;
  }
  if (status === 404) return `Zotero has no ${what} (HTTP 404)`;
  if (status === 429 || status >= 500) return `Zotero answered HTTP ${status} after retries`;
  return `Zotero answered HTTP ${status} for ${what}`;
}

function transportReason(conn: ZoteroConnection, e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (conn.mode === 'local' && (code === 'ECONNREFUSED' || /ECONNREFUSED|connect/i.test(String((e as Error)?.message ?? '')))) {
    return `the Zotero local API is not reachable at ${ZOTERO_LOCAL_ORIGIN} — is Zotero 7 running with "Allow other applications on this computer to communicate with Zotero" enabled?`;
  }
  return errorFailureReason(e);
}

export type ZoteroKeyCheck =
  | { readonly status: 'no-key' }
  | { readonly status: 'authenticated'; readonly userId: number; readonly libraryAccess: boolean }
  | { readonly status: 'rejected'; readonly httpStatus: number }
  | { readonly status: 'offline'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Authenticate ZOTERO_API_KEY: `GET https://api.zotero.org/keys/current`. The
 * answer echoes the key, so it is never cached, recorded or logged (the body
 * never leaves this function; the recorder scrubs sensitive values anyway).
 */
export async function checkZoteroKey(
  opts: { timeoutMs?: number; retry?: boolean; rethrowOffline?: boolean } = {},
): Promise<ZoteroKeyCheck> {
  const key = apiKey();
  if (key === null) return { status: 'no-key' };
  let res: HttpResponse;
  try {
    res = await httpFetch(`${ZOTERO_WEB_ORIGIN}/keys/current`, {
      source: 'zotero',
      headers: { accept: 'application/json', 'Zotero-API-Version': '3', 'Zotero-API-Key': key },
      noCache: true,
      noRetry: opts.retry !== true,
      timeoutMs: opts.timeoutMs ?? 10_000,
      maxBytes: MAX_JSON_RESPONSE_BYTES,
    });
  } catch (e) {
    if (isOfflineEgressError(e)) {
      if (opts.rethrowOffline === true) throw e;
      return { status: 'offline', reason: offlineLabel(e) };
    }
    return { status: 'failed', reason: errorFailureReason(e) };
  }
  if (res.status === 403 || res.status === 401) return { status: 'rejected', httpStatus: res.status };
  if (res.status !== 200) return { status: 'failed', reason: `HTTP ${res.status}` };
  try {
    const body = JSON.parse(res.body) as { userID?: unknown; access?: { user?: { library?: unknown } } };
    if (typeof body.userID !== 'number' || !Number.isInteger(body.userID)) return { status: 'failed', reason: 'the answer has no userID' };
    return { status: 'authenticated', userId: body.userID, libraryAccess: body.access?.user?.library === true };
  } catch {
    return { status: 'failed', reason: 'the answer is not JSON' };
  }
}

export type ZoteroLibraryCheck =
  | { readonly status: 'readable'; readonly library: string }
  | { readonly status: 'offline'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string; readonly httpStatus?: number };

/**
 * Whether the library `conn` points at can be read without a key (the Zotero
 * 7 local API, or a public group): one `items/top?limit=1` request, no retry.
 */
export async function checkZoteroLibrary(conn: ZoteroConnection, timeoutMs = 10_000): Promise<ZoteroLibraryCheck> {
  const lib = conn.groupId !== null ? { path: `groups/${conn.groupId}`, ref: `groups/${conn.groupId}` } : { path: 'users/0', ref: 'local' };
  let res: HttpResponse;
  try {
    res = await httpFetch(`${conn.base}/${lib.path}/items/top?limit=1&format=json`, {
      source: 'zotero',
      headers: { accept: 'application/json', 'Zotero-API-Version': '3' },
      noCache: true,
      noRetry: true,
      timeoutMs,
      maxBytes: MAX_JSON_RESPONSE_BYTES,
      ...(conn.mode === 'local' ? { localService: 'zotero-local' as const } : {}),
    });
  } catch (e) {
    if (isOfflineEgressError(e)) return { status: 'offline', reason: offlineLabel(e) };
    return { status: 'failed', reason: transportReason(conn, e) };
  }
  if (res.status === 200 && isJsonArray(res)) return { status: 'readable', library: lib.ref };
  return { status: 'failed', reason: statusReason(conn, res.status, `${lib.ref} items`), httpStatus: res.status };
}

/** The library to read: its API path and its ref (`users/<id>`, `groups/<id>` or `local`). */
export interface ZoteroLibrary {
  readonly path: string;
  readonly ref: string;
}

/** Resolve the library for `conn` (the Web API user id comes from /keys/current). */
export async function resolveZoteroLibrary(conn: ZoteroConnection): Promise<ZoteroLibrary> {
  if (conn.groupId !== null) return { path: `groups/${conn.groupId}`, ref: `groups/${conn.groupId}` };
  if (conn.mode === 'local') return { path: 'users/0', ref: 'local' };
  const check = await checkZoteroKey({ timeoutMs: 30_000, retry: true, rethrowOffline: true });
  switch (check.status) {
    case 'authenticated':
      return { path: `users/${check.userId}`, ref: `users/${check.userId}` };
    case 'rejected':
      throw new ZoteroError(`Zotero rejected ZOTERO_API_KEY (HTTP ${check.httpStatus}) — check the key at ${ZOTERO_KEYS_URL}`, check.httpStatus);
    case 'offline':
      throw new ZoteroError(`Zotero not reached (${check.reason})`);
    case 'no-key':
      throw new ZoteroError(`Zotero is not configured — set ZOTERO_API_KEY (${ZOTERO_KEYS_URL}), PENSMITH_ZOTERO_LOCAL=1 or ZOTERO_GROUP_ID`);
    default:
      throw new ZoteroError(`Zotero key check failed: ${check.reason}`);
  }
}

/** Every page of a list endpoint (start/limit), up to `max` rows. */
async function paginate(conn: ZoteroConnection, path: string, query: Record<string, string>, max: number, what: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let start = 0; rows.length < max; start += PAGE) {
    const params = new URLSearchParams({ ...query, format: 'json', limit: String(Math.min(PAGE, max - rows.length)), start: String(start) });
    let res: HttpResponse;
    try {
      res = await zoteroGet(conn, `${path}?${params.toString()}`, 'array');
    } catch (e) {
      if (isOfflineEgressError(e)) throw e;
      throw new ZoteroError(transportReason(conn, e));
    }
    if (res.status !== 200) throw new ZoteroError(statusReason(conn, res.status, what), res.status);
    let page: unknown;
    try {
      page = JSON.parse(res.body);
    } catch {
      throw new ZoteroError(`Zotero answered with something that is not JSON for ${what}`);
    }
    if (!Array.isArray(page)) throw new ZoteroError(`Zotero answered with something that is not a list for ${what}`);
    rows.push(...page);
    const total = Number(res.headers['total-results']);
    if (page.length < PAGE || (Number.isFinite(total) && start + page.length >= total)) break;
  }
  return rows.slice(0, max);
}

/** The key of the collection named `name` (exact, then case-insensitive), or a ZoteroError naming the choices. */
export async function findZoteroCollection(conn: ZoteroConnection, lib: ZoteroLibrary, name: string): Promise<string> {
  const rows = await paginate(conn, `${lib.path}/collections`, {}, MAX_COLLECTIONS, 'collections');
  const all = rows
    .map((r) => (r as { key?: unknown; data?: { name?: unknown } }))
    .filter((r): r is { key: string; data: { name: string } } => typeof r.key === 'string' && ZOTERO_KEY.test(r.key) && typeof r.data?.name === 'string');
  const exact = all.filter((c) => c.data.name === name);
  const loose = exact.length > 0 ? exact : all.filter((c) => c.data.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (loose.length === 1) return loose[0]!.key;
  if (loose.length > 1) {
    throw new ZoteroError(
      `Zotero has ${loose.length} collections named "${name}" in ${lib.ref} — rename one so [sources] zotero_collection names exactly one`,
      undefined,
      `the Zotero library has ${loose.length} collections named "${name}" — rename one so [sources] zotero_collection names exactly one`,
    );
  }
  const names = all.map((c) => c.data.name).slice(0, 12);
  throw new ZoteroError(
    `Zotero collection "${name}" not found in ${lib.ref}` + (names.length > 0 ? ` (collections: ${names.join(', ')}${all.length > names.length ? ', …' : ''})` : ' (the library has no collections)'),
    undefined,
    `Zotero collection "${name}" not found in the Zotero library`,
  );
}

export interface ZoteroPull {
  /** The library the items came from (`users/<id>`, `groups/<id>` or `local`). */
  readonly library: string;
  /** The collection pulled, or null for the whole library. */
  readonly collection: string | null;
  /** The validated items (notes, attachments and annotations excluded by the API's /top). */
  readonly items: ZoteroItem[];
  /** Raw rows that failed validation, with the reason (reported, never ingested). */
  readonly invalid: string[];
}

function validRows(rows: unknown[]): { items: ZoteroItem[]; invalid: string[] } {
  const items: ZoteroItem[] = [];
  const invalid: string[] = [];
  rows.forEach((row, i) => {
    const v = validateZoteroItem(row, `items[${i}]`);
    if (v.ok) items.push(v.item);
    else invalid.push(v.error);
  });
  return { items, invalid };
}

export interface PullOptions {
  /** A collection name; default `[sources] zotero_collection` of the paper at `root`; null = the whole library. */
  readonly collection?: string | null;
  /** A Zotero quick-search query (titles, creators, years; `qmode=everything` adds all fields). */
  readonly query?: string;
  readonly limit?: number;
  readonly root?: string;
}

/**
 * Read the top-level items of the configured collection (or library) through
 * the Web or local API. Throws ZoteroError (one line) on any failure, and
 * OfflineEgressError as-is; a ZoteroError for "not configured" too.
 */
export async function pullZoteroItems(opts: PullOptions = {}): Promise<ZoteroPull> {
  const conn = zoteroConnection();
  if (conn === null) {
    throw new ZoteroError(`Zotero is not configured — set ZOTERO_API_KEY (${ZOTERO_KEYS_URL}), PENSMITH_ZOTERO_LOCAL=1 (Zotero 7 local API) or ZOTERO_GROUP_ID`);
  }
  const lib = await resolveZoteroLibrary(conn);
  const collection = opts.collection === undefined ? configuredZoteroCollection(opts.root) : opts.collection;
  const base = collection !== null ? `${lib.path}/collections/${await findZoteroCollection(conn, lib, collection)}/items/top` : `${lib.path}/items/top`;
  const query: Record<string, string> = opts.query ? { q: opts.query, qmode: 'titleCreatorYear' } : {};
  const rows = await paginate(conn, base, query, Math.min(opts.limit ?? MAX_ZOTERO_ITEMS, MAX_ZOTERO_ITEMS), collection !== null ? `the "${collection}" collection's items` : 'items');
  const { items, invalid } = validRows(rows);
  return { library: lib.ref, collection, items, invalid };
}

/** The ref an item gets: its own library when it names a real one, else the pull's library. */
export function itemLibrary(item: ZoteroItem, pulled: string): string {
  if (item.library === null || item.library === 'users/0') return pulled;
  return item.library;
}

/**
 * Research adapter: Zotero quick search (title, creator, year) within the
 * configured collection or library. Not configured → [] (no request). Any
 * failure → [] and opts.onFailure(reason); OfflineEgressError is thrown.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SourceCandidate[]> {
  if (!isZoteroConfigured()) return [];
  try {
    const pull = await pullZoteroItems({ query, limit: Math.max(1, Math.min(opts.limit ?? 10, PAGE)) });
    const out: SourceCandidate[] = [];
    for (const item of pull.items) {
      const c = normalizeZoteroItem(item, itemLibrary(item, pull.library));
      const sc = c ? toSourceCandidate(c) : null;
      if (sc !== null && (opts.fromYear === undefined || sc.year === undefined || sc.year >= opts.fromYear)) out.push(sc);
    }
    return out;
  } catch (e) {
    if (isOfflineEgressError(e)) throw e;
    opts.onFailure?.(e instanceof ZoteroError ? e.message : errorFailureReason(e));
    return [];
  }
}

/** The 8-character item key in `id` (`ABCD2345`, `zotero:users/1/ABCD2345`, `users/1/items/ABCD2345`). */
function itemKeyOf(id: string): string | null {
  const m = /([A-Z0-9]{8})$/.exec(id.trim());
  return m?.[1] ?? null;
}

/** Three-way lookup of one item by its key (D-19-05). */
export async function lookupById(id: string): Promise<LookupResult> {
  const key = itemKeyOf(id);
  if (key === null) return lookupNotFound(`"${id}" is not a Zotero item key`);
  let conn: ZoteroConnection | null;
  try {
    conn = zoteroConnection();
  } catch (e) {
    return lookupFailed((e as Error).message);
  }
  if (conn === null) return lookupFailed(`Zotero is not configured — set ZOTERO_API_KEY (${ZOTERO_KEYS_URL}) or PENSMITH_ZOTERO_LOCAL=1`);
  try {
    const lib = await resolveZoteroLibrary(conn);
    const res = await zoteroGet(conn, `${lib.path}/items/${key}?format=json`, 'object');
    if (res.status === 404) return lookupNotFound('HTTP 404');
    if (res.status !== 200) return lookupFailed(statusReason(conn, res.status, `item ${key}`), { status: res.status });
    const v = validateZoteroItem(JSON.parse(res.body) as unknown, `item ${key}`);
    if (!v.ok) return lookupFailed(`response is not a Zotero item (${v.error})`);
    const c = normalizeZoteroItem(v.item, itemLibrary(v.item, lib.ref));
    const sc = c ? toSourceCandidate(c) : null;
    return sc ? lookupFound(sc) : lookupNotFound(`item ${key} is not a citable work (a note, an attachment, or no title / creator)`);
  } catch (e) {
    if (isOfflineEgressError(e)) throw e;
    return lookupFailed(e instanceof ZoteroError ? e.message : transportReason(conn, e));
  }
}

export async function fetchById(id: string): Promise<SourceCandidate | null> {
  return unwrapLookup(await lookupById(id), 'zotero', id);
}
