// bin/lib/http.ts — HTTP client chokepoint per ARCH-12 / ARCH-13.
//
// SOLE call site for undici / node:http / node:https in the repo (D-06).
// The eslint chokepoint at eslint.config.js bans `import 'undici'` everywhere
// EXCEPT this file (per-file `no-restricted-imports: 'off'` exemption).
//
// =================================================================
//   Polite scholarly client (D-23, D-24)
// =================================================================
// User-Agent: pensmith/{version} ({PENSMITH_CONTACT_EMAIL || 'no-contact'})
// On missing PENSMITH_CONTACT_EMAIL, WARN-once stderr banner from
// references/http-warnings.md (locked string — Phase 2 doctor reuses it
// verbatim, so drift is a lint failure).
//
// =================================================================
//   Per-source TTL disk cache (D-30)
// =================================================================
// crossref / openalex / arxiv / pubmed: 7d
// unpaywall: 1d  (OA status flips faster than DOI metadata)
// generic:   24h
// Cache key:    sha256(method + ':' + url + ':' + sortedHeaders).slice(0,16)
// Cache file:   pensmithHttpCacheDir() + '/' + key + '.json'
// Cache write:  atomicWriteFile (W2 dependency) — never direct fs.writeFile.
// Cache short-circuits BEFORE network and BEFORE the per-source rate bucket
// (cache hits are free).
//
// =================================================================
//   Retry (D-31, D-32)
// =================================================================
// Retryable status codes: 429, 500, 502, 503, 504
// Retryable error codes:  ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN
// Backoff:                full-jitter via bin/lib/retry.ts (NOT p-retry's
//                         bounded multiplicative jitter — see retry.ts header)
// 4xx OTHER than 429 are NOT retried (they are application errors).
// The retry's `fn` includes the bucket acquire, so a 429 retry re-acquires
// politely — per ARCH-13.
//
// =================================================================
//   Per-source TokenBucket (ARCH-13)
// =================================================================
// Polite-pool RPS table (RESEARCH §RQ-1):
//   crossref: 50  (polite pool)
//   openalex: 10  (anonymous; up to 100 with key — defensive default)
//   unpaywall: 10 (per-key budget)
//   arxiv:    1   (relaxed from 1/3s — single bucket sufficient)
//   pubmed:   3   (E-utilities anonymous)
//   generic:  5   (untyped fallback)
// Bucket acquire happens AFTER the cache short-circuit and INSIDE the
// retry's `fn` so 429-retry re-pays the rate cost.

import { request, getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pensmithHttpCacheDir } from './paths.js';
import { atomicWriteFile } from './atomic-write.js';
import { retry, parseRetryAfter } from './retry.js';

// Touch the optional Agent reference so verbatimModuleSyntax does not strip
// it; we may use it in Phase 2 when wiring connection pooling.
void getGlobalDispatcher;
void setGlobalDispatcher;
void Agent;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
//   WARN-once for missing contact email
// ============================================================
const WARN_FILE = path.resolve(__dirname, '..', '..', 'references', 'http-warnings.md');

let warnString: string | null = null;
let warnedNoEmail = false;

function loadWarnString(): string {
  if (warnString !== null) return warnString;
  let md: string;
  try {
    md = readFileSync(WARN_FILE, 'utf8');
  } catch {
    // Defensive fallback if the references file is missing — should never
    // happen in shipped builds because references/ is in package.json files[].
    warnString = 'pensmith: PENSMITH_CONTACT_EMAIL is not set.';
    return warnString;
  }
  const lines = md.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('## PENSMITH_CONTACT_EMAIL not set')) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('> ')) {
      warnString = line.slice(2).trim();
      return warnString;
    }
  }
  warnString = 'pensmith: PENSMITH_CONTACT_EMAIL is not set.';
  return warnString;
}

function warnNoEmailOnce(): void {
  if (warnedNoEmail) return;
  warnedNoEmail = true;
  process.stderr.write(loadWarnString() + '\n');
}

/**
 * Test-only — reset the WARN-once gate so a second test run can observe
 * the banner again. NEVER call from production code.
 */
export function _resetWarnedForTest(): void {
  warnedNoEmail = false;
}

// ============================================================
//   User-Agent
// ============================================================
let cachedVersion: string | null = null;
function pkgVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function userAgent(): string {
  const email = process.env.PENSMITH_CONTACT_EMAIL?.trim();
  if (!email) {
    warnNoEmailOnce();
    return `pensmith/${pkgVersion()} (no-contact)`;
  }
  return `pensmith/${pkgVersion()} (${email})`;
}

// ============================================================
//   Public types
// ============================================================
export type HttpSource =
  | 'crossref'
  | 'openalex'
  | 'unpaywall'
  | 'arxiv'
  | 'pubmed'
  | 'generic';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  cached: boolean;
  cachedAt?: string; // ISO8601
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | Buffer;
  source?: HttpSource;
  /** Override the auto-derived cache key (sha256-derived). */
  cacheKey?: string;
  /** Override the per-source TTL. */
  cacheTtlMs?: number;
  /** Per-request total timeout (headers + body). Default: 30_000. */
  timeoutMs?: number;
  /** Skip the cache entirely (read AND write). */
  noCache?: boolean;
  /** Skip the retry wrapper (fire-and-fail). */
  noRetry?: boolean;
}

// ============================================================
//   TTL table (D-30)
// ============================================================
const ONE_DAY_MS = 24 * 3_600_000;
const TTL_MS_BY_SOURCE: Record<HttpSource, number> = {
  crossref: 7 * ONE_DAY_MS,
  openalex: 7 * ONE_DAY_MS,
  arxiv: 7 * ONE_DAY_MS,
  pubmed: 7 * ONE_DAY_MS,
  unpaywall: 1 * ONE_DAY_MS,
  generic: 1 * ONE_DAY_MS,
};

// ============================================================
//   Per-source TokenBucket (ARCH-13)
// ============================================================
const RPS_BY_SOURCE: Record<HttpSource, number> = {
  crossref: 50,
  openalex: 10,
  unpaywall: 10,
  arxiv: 1,
  pubmed: 3,
  generic: 5,
};

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }
  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefillMs = now;
  }
  async acquire(): Promise<void> {
    // Loop because setTimeout granularity may leave us slightly short on
    // the first wakeup; we refill again and try once more.
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000);
      await new Promise<void>((r) => {
        setTimeout(r, Math.max(1, waitMs));
      });
    }
  }
}

const BUCKETS: Partial<Record<HttpSource, TokenBucket>> = {};
function bucketFor(src: HttpSource): TokenBucket {
  let b = BUCKETS[src];
  if (!b) {
    const rps = RPS_BY_SOURCE[src];
    b = new TokenBucket(rps, rps);
    BUCKETS[src] = b;
  }
  return b;
}

/**
 * Test-only — reset every per-source bucket so test ordering doesn't
 * leak rate-limit state across files. NEVER call from production code.
 */
export function _resetBucketsForTest(): void {
  for (const k of Object.keys(BUCKETS) as HttpSource[]) {
    delete BUCKETS[k];
  }
}

// ============================================================
//   Cache key + I/O
// ============================================================
function cacheKey(method: string, url: string, headers: Record<string, string>): string {
  // We exclude User-Agent from the cache key on purpose — otherwise version
  // bumps and PENSMITH_CONTACT_EMAIL changes would invalidate every cached
  // body. The body is API-supplied and does not depend on those headers.
  const filtered: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'user-agent') continue;
    filtered.push([lk, v]);
  }
  filtered.sort(([a], [b]) => a.localeCompare(b));
  const headerStr = filtered.map(([k, v]) => `${k}:${v}`).join('|');
  return createHash('sha256').update(`${method}:${url}:${headerStr}`).digest('hex').slice(0, 16);
}

interface CacheEnvelope {
  savedAt: string;
  response: Omit<HttpResponse, 'cached' | 'cachedAt'>;
}

/**
 * Structural validator for a cache envelope. Returns true iff the parsed
 * JSON has the full expected shape; corrupt-but-parseable JSON (wrong
 * type, missing fields, null nested objects) reads as false and the
 * caller treats it as a cache miss.
 *
 * Defense-in-depth alongside state/library/checkpoint/runtime — those
 * schema-validate via zod; the cache is small + on the hot path, so we
 * keep it to a hand-rolled type-guard instead of paying for a zod parse
 * on every readCache. The fields validated below are exactly those that
 * downstream callers (and writeCache) treat as load-bearing.
 */
function isValidCacheEnvelope(parsed: unknown): parsed is CacheEnvelope {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  if (typeof p.savedAt !== 'string') return false;
  const r = p.response;
  if (!r || typeof r !== 'object') return false;
  const resp = r as Record<string, unknown>;
  if (typeof resp.status !== 'number') return false;
  if (typeof resp.body !== 'string') return false;
  if (!resp.headers || typeof resp.headers !== 'object') return false;
  return true;
}

async function readCache(key: string, ttlMs: number): Promise<HttpResponse | null> {
  const file = path.join(pensmithHttpCacheDir(), `${key}.json`);
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // FLAG-01 fix: structurally validate the cache envelope BEFORE treating
  // it as a CacheEnvelope. A type assertion is not a runtime check; a file
  // that parses as JSON but has the wrong shape (e.g. {savedAt:'x',
  // response:null}, or an old envelope format from a previous build)
  // would otherwise return an HttpResponse with status:undefined / body:
  // undefined / headers:undefined — crashing downstream JSON.parse(r.body)
  // calls. Corrupt cache is transparently a cache MISS, never an exception.
  if (!isValidCacheEnvelope(parsed)) return null;
  const envelope: CacheEnvelope = parsed;
  const ageMs = Date.now() - new Date(envelope.savedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) return null;
  const out: HttpResponse = {
    status: envelope.response.status,
    headers: envelope.response.headers,
    body: envelope.response.body,
    cached: true,
    cachedAt: envelope.savedAt,
  };
  return out;
}

async function writeCache(key: string, response: HttpResponse): Promise<void> {
  const file = path.join(pensmithHttpCacheDir(), `${key}.json`);
  const envelope: CacheEnvelope = {
    savedAt: new Date().toISOString(),
    response: {
      status: response.status,
      headers: response.headers,
      body: response.body,
    },
  };
  await atomicWriteFile(file, JSON.stringify(envelope));
}

// ============================================================
//   Constants
// ============================================================
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERR_CODES: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

// ============================================================
//   Public: fetch
// ============================================================
/**
 * Issue an HTTP request through the chokepoint. Handles polite UA,
 * per-source rate gating, full-jitter retry, and per-source TTL caching.
 *
 * Cache semantics:
 *   - GET requests: read cache → return on hit; on miss, dispatch network
 *     and write cache for 200 OR 404 (404 caches a "definitely-not-found"
 *     verdict so the verifier doesn't retry every section)
 *   - POST / HEAD: cache is skipped entirely (no read, no write)
 *   - opts.noCache = true: skip read AND write; force network dispatch
 *
 * Retry semantics:
 *   - 429 / 5xx → throw to trigger retry
 *   - 4xx (other) → return as-is (application error, not transport)
 *   - network errors with retryable codes → throw to trigger retry
 *   - opts.noRetry = true: single dispatch, no wrap
 */
export async function fetch(url: string, opts: FetchOptions = {}): Promise<HttpResponse> {
  const method: 'GET' | 'POST' | 'HEAD' = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    'user-agent': userAgent(),
    accept: 'application/json',
    ...opts.headers,
  };
  const source: HttpSource = opts.source ?? 'generic';
  const ttlMs = opts.cacheTtlMs ?? TTL_MS_BY_SOURCE[source];
  const key = opts.cacheKey ?? cacheKey(method, url, headers);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // --- 1. Cache short-circuit (GET only, opt-in) ---
  if (method === 'GET' && !opts.noCache) {
    const cached = await readCache(key, ttlMs);
    if (cached) return cached;
  }

  // --- 2. Single dispatch helper (excluding bucket / retry) ---
  const callOnce = async (): Promise<HttpResponse> => {
    const reqInit: Parameters<typeof request>[1] = {
      method,
      headers,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    };
    if (opts.body !== undefined) {
      reqInit.body = opts.body;
    }
    const { statusCode, headers: rh, body } = await request(url, reqInit);
    const text = await body.text();
    const flatHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(rh)) {
      const lk = k.toLowerCase();
      if (Array.isArray(v)) flatHeaders[lk] = v.join(', ');
      else if (typeof v === 'string') flatHeaders[lk] = v;
      else if (v == null) flatHeaders[lk] = '';
      else flatHeaders[lk] = String(v);
    }
    return { status: statusCode, headers: flatHeaders, body: text, cached: false };
  };

  // --- 3. Bucket-acquired single attempt ---
  const dispatch = async (): Promise<HttpResponse> => {
    await bucketFor(source).acquire();
    return callOnce();
  };

  // --- 4. Optional retry wrap ---
  // serverRetryDelay captures the parsed Retry-After header from the most-recent
  // retryable response. On the next attempt, we sleep for this duration BEFORE
  // re-acquiring the rate bucket + dispatching — honoring the server's request
  // on top of the existing fullJitter backoff (per ARCH-13 / D-01).
  let serverRetryDelay = 0;
  const wrapped = async (): Promise<HttpResponse> => {
    if (serverRetryDelay > 0) {
      // Server asked us to wait — honor it before the next attempt.
      const delay = serverRetryDelay;
      serverRetryDelay = 0;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
    const r = await dispatch();
    if (RETRYABLE_STATUSES.has(r.status)) {
      const ra = r.headers['retry-after'];
      serverRetryDelay = parseRetryAfter(typeof ra === 'string' ? ra : undefined, Date.now());
      const err = new Error(`HTTP ${r.status}`) as Error & {
        status?: number;
        response?: HttpResponse;
      };
      err.status = r.status;
      err.response = r;
      throw err;
    }
    return r;
  };
  const response: HttpResponse = opts.noRetry
    ? await dispatch()
    : await retry(wrapped, {
        maxAttempts: 5,
        baseMs: 200,
        capMs: 30_000,
        retryOn: (err) => {
          const e = err as { status?: number; code?: string } | null;
          if (!e) return false;
          if (typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status)) return true;
          if (typeof e.code === 'string' && RETRYABLE_ERR_CODES.has(e.code)) return true;
          return false;
        },
      });

  // --- 5. Cache write (GET, success or definite 404) ---
  if (method === 'GET' && !opts.noCache && (response.status === 200 || response.status === 404)) {
    await writeCache(key, response).catch(() => {
      // Cache write failures are non-fatal — the response is still returned
      // to the caller. Disk full / read-only FS would otherwise break every
      // request, which is unacceptable.
    });
  }
  return response;
}

// ============================================================
//   Public: clearCache
// ============================================================
/**
 * Remove every cache file under `pensmithHttpCacheDir()`. Called by Phase 2's
 * `/pensmith doctor --clear-cache` and by tests that need a known empty state.
 *
 * Best-effort: missing dir, missing files, and permission errors are
 * swallowed — the post-condition is "no readable cache files remain", not
 * "every disk operation succeeded".
 */
export async function clearCache(): Promise<void> {
  const dir = pensmithHttpCacheDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries.map((f) =>
      fsp.unlink(path.join(dir, f)).catch(() => {
        /* best-effort */
      }),
    ),
  );
}
