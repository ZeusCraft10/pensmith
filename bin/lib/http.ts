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
import { lookup as dnsLookup } from 'node:dns/promises';
import { readFileSync, statSync } from 'node:fs';
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

// ============================================================
//   SSRF guard — HARD-02 (T-15-02)
// ============================================================
// Mirrors CACHE_HEADER_ALLOWLIST pattern (http.ts:408) for scheme enforcement.
const SSRF_ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:']);

/**
 * Classify an IP address (v4 or v6) as private/reserved.
 *
 * Covers (per RESEARCH A6 / RFC1918 / IANA reserved ranges):
 *   IPv4 : 10/8, 172.16-31, 192.168/16, 127/8, 169.254/16, 0.x,
 *           100.64.0.0/10 CGNAT (RFC 6598)
 *   IPv6 : ::1 (loopback), :: (unspecified), fe80::/10 (link-local),
 *           fc/fd::/7 (ULA), ff00::/8 (multicast)
 *   IPv4-mapped IPv6 (::ffff:x.x.x.x dotted OR ::ffff:hhhh:hhhh hex-colon) —
 *   extracts the embedded v4 and re-checks.
 */
function isPrivateIp(addr: string): boolean {
  // Handle IPv4-mapped IPv6.
  // Dotted form:     ::ffff:127.0.0.1
  // Hex-colon form:  ::ffff:7f00:0001  (e.g. returned by some DNS resolvers)
  const mapped = addr.match(
    /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}:[0-9a-f]{1,4}))$/i,
  );
  if (mapped) {
    if (mapped[1]) return isPrivateIp(mapped[1]);      // dotted form — recurse
    // Hex-colon form: split on ':', parse two 16-bit halves into a 32-bit int,
    // then decompose into four octets and recurse as a dotted-quad.
    const hexParts = (mapped[2] as string).split(':');
    const hi = parseInt(hexParts[0] as string, 16);
    const lo = parseInt(hexParts[1] as string, 16);
    const n = (hi << 16) | lo;
    const a = (n >>> 24) & 0xff;
    const b = (n >>> 16) & 0xff;
    const c = (n >>> 8) & 0xff;
    const d = n & 0xff;
    return isPrivateIp(`${a}.${b}.${c}.${d}`);
  }

  // IPv4
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
    if (a === 127) return true;                          // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;             // 169.254.0.0/16 link-local
    if (a === 0) return true;                            // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT (RFC 6598)
    return false;
  }

  // IPv6
  const lc = addr.toLowerCase();
  if (lc === '::1') return true;                         // loopback
  if (lc === '::' || lc === '0:0:0:0:0:0:0:0') return true; // unspecified (RFC 4291)
  if (lc.startsWith('ff')) return true;                  // ff00::/8 multicast
  if (lc.startsWith('fe80:') || lc.startsWith('fe8') || lc.startsWith('fe9') ||
      lc.startsWith('fea') || lc.startsWith('feb')) return true; // fe80::/10 link-local
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true;   // fc00::/7 ULA
  return false;
}

/**
 * SSRF pre-flight guard (HARD-02 / T-15-02).
 *
 * Resolves the hostname via DNS and throws if any resolved address is in a
 * private/reserved range. Also rejects non-http(s) schemes. Fail-CLOSED:
 * a DNS resolver error for an untrusted URL is treated as a block, not a pass.
 *
 * @param url       The URL to check (must be valid http/https).
 * @param resolveFn Injectable DNS resolver — defaults to node:dns/promises
 *                  lookup with {all:true}. Override in tests to avoid real DNS.
 */
export async function checkSsrf(
  url: string,
  resolveFn: (hostname: string) => Promise<Array<{ address: string; family: number }>> = (h) =>
    dnsLookup(h, { all: true }),
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF guard: invalid URL "${url}"`);
  }

  if (!SSRF_ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`SSRF guard: scheme "${parsed.protocol}" not allowed — only http/https permitted`);
  }

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolveFn(parsed.hostname);
  } catch (e) {
    // Fail-CLOSED for untrusted URLs: resolver error → block, not pass.
    throw new Error(
      `SSRF guard: DNS lookup failed for "${parsed.hostname}" (blocked, fail-closed): ${String(e)}`,
    );
  }

  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(
        `SSRF guard: "${parsed.hostname}" resolves to private/reserved IP ${address} — blocked (RFC1918/loopback/link-local)`,
      );
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// IN-03 fix: this file ships at two different depths — bin/lib/http.ts under
// tsx, dist/bin/lib/http.js after build. Fixed-depth `..` × N produced
// `dist/references/http-warnings.md` (nonexistent) post-build, silently
// degrading the WARN banner to the short fallback. Same defect-class as CR-02
// for the doctor probes; same shape of fix — walk up from HERE until we hit
// the directory that owns package.json. See bin/lib/doctor/probes/
// build-artifact-resolves.ts for the original rationale.
function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    try {
      if (statSync(path.join(cur, 'package.json')).isFile()) return cur;
    } catch {
      // continue
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}
const PKG_ROOT = findPkgRoot(__dirname);

// ============================================================
//   WARN-once for missing contact email
// ============================================================
const WARN_FILE = path.join(PKG_ROOT, 'references', 'http-warnings.md');

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
    // IN-03: same off-by-one as WARN_FILE — `..` × 2 from __dirname lands at
    // dist/ post-build, producing a path that doesn't exist and silently
    // returning '0.0.0' in the User-Agent header. Reuse PKG_ROOT.
    const pkgPath = path.join(PKG_ROOT, 'package.json');
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
  | 'semanticscholar'
  | 'retraction-watch'
  | 'generic';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  // Raw response bytes, byte-faithful (audit #29). `body` is the UTF-8 decode of
  // these bytes and is LOSSY for binary content (e.g. a fetched PDF), so binary
  // consumers (add.ts URL-PDF ingestion) MUST use bodyBytes — `Buffer.from(body,
  // 'binary')` cannot recover bytes already mangled by the UTF-8 decode. Present
  // only on a LIVE fetch (callOnce); a cached response is text-only and omits it,
  // so binary fetches should pass noCache:true to guarantee bodyBytes is set.
  bodyBytes?: Buffer;
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
  /**
   * Override the SSRF pre-flight trust decision.
   *   - undefined (default): trust inferred from `source` (generic → untrusted).
   *   - true:  force SSRF guard ON even for non-generic sources.
   *   - false: bypass SSRF guard for hardcoded trusted URLs (IN-02).
   *            NEVER set to false for user-supplied URLs.
   */
  untrusted?: boolean;
}

// ============================================================
//   TTL table (D-30)
// ============================================================
const ONE_DAY_MS = 24 * 3_600_000;
const ONE_HOUR_MS = 3_600_000;
const TTL_MS_BY_SOURCE: Record<HttpSource, number> = {
  crossref: 7 * ONE_DAY_MS,
  openalex: 7 * ONE_DAY_MS,
  arxiv: 7 * ONE_DAY_MS,
  pubmed: 7 * ONE_DAY_MS,
  unpaywall: 1 * ONE_DAY_MS,
  semanticscholar: 7 * ONE_DAY_MS,
  'retraction-watch': 1 * ONE_DAY_MS,
  generic: 1 * ONE_DAY_MS,
};
// WR-07 (cross-AI review): 404 responses are cached so the verifier doesn't
// re-fetch obvious negatives on every pass. But a "not found" verdict at
// crossref/openalex can flip to "found" as soon as the publisher's
// metadata pipeline indexes the record — a 7-day TTL would cause the
// verifier to keep emitting FABRICATED on a DOI that just landed.
// 1 hour is short enough to recover from publisher-side indexing latency
// (typically minutes) but long enough that a stuck verifier pass doesn't
// re-hit the origin every second.
const NEGATIVE_RESPONSE_TTL_MS = ONE_HOUR_MS;

// ============================================================
//   Per-source TokenBucket (ARCH-13)
// ============================================================
const RPS_BY_SOURCE: Record<HttpSource, number> = {
  crossref: 50,
  openalex: 10,
  unpaywall: 10,
  arxiv: 1,
  pubmed: 3,
  // S2 anonymous rate-limit is 100 RPM (~1.7 RPS); keep conservative at 1 RPS.
  // With an API key it bumps to 1 RPS per partner (same effective limit here).
  semanticscholar: 1,
  // Retraction Watch (Crossref Labs) — used only as a side-channel filter,
  // call volume is minimal; mirror unpaywall budget.
  'retraction-watch': 10,
  generic: 5,
};

// HARD-06 (T-15-06): FIFO-fair TokenBucket.
//
// Design: single grant timer + explicit waiter queue (Array<()=>void>).
// Fast-path: if tokens>=1 AND no waiters, consume immediately (no queuing).
// Slow-path: push resolver onto waiters, kick _scheduleGrant() if no timer
//   is already pending. _scheduleGrant() fires once, shifts the oldest waiter
//   (FIFO), grants it one token, then reschedules if more waiters remain.
//   This eliminates the per-waiter-setTimeout race (Pitfall 7 from RESEARCH).
//
// Semantic note: tokens are consumed permanently and refill over time (rate
// bucket, not semaphore). There is NO release()/return-token path — that is
// intentional. Token return-on-exception is the Semaphore's concern (budget.ts),
// not the rate bucket's. See RESEARCH A5.
class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  // FIFO waiter queue — each entry is the resolve() of a queued acquire() Promise.
  private waiters: Array<() => void> = [];
  // Guard: only one _scheduleGrant timer runs at a time (no timer storm).
  private timerPending = false;

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
    this.refill();
    // Fast-path: tokens available AND no one waiting ahead of us.
    if (this.tokens >= 1 && this.waiters.length === 0) {
      this.tokens -= 1;
      return;
    }
    // Slow-path: enqueue and wait for the single grant timer to fire.
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      if (!this.timerPending) this._scheduleGrant();
    });
  }

  private _scheduleGrant(): void {
    this.timerPending = true;
    const deficit = Math.max(0, 1 - this.tokens);
    const waitMs = Math.max(1, Math.ceil((deficit / this.refillPerSec) * 1000));
    setTimeout(() => {
      this.timerPending = false;
      this.refill();
      const next = this.waiters.shift(); // FIFO: oldest waiter first
      if (next) {
        this.tokens -= 1;
        next(); // resolve the waiting Promise
        if (this.waiters.length > 0) this._scheduleGrant(); // chain for remaining waiters
      }
    }, waitMs);
  }
}

/**
 * Test-only seam — exports the TokenBucket class so FIFO-fairness tests
 * can construct controlled instances. NEVER use in production code.
 * Wave-0 scaffold (token-bucket-fairness.test.ts) probes for this export.
 */
export { TokenBucket as __TokenBucketForTest };

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
  // WR-07: clamp the effective TTL down to NEGATIVE_RESPONSE_TTL_MS for 404s.
  // 404 means "this URL did not resolve at fetch time" — a verdict that
  // can flip when the upstream catalog indexes a freshly-deposited record.
  // Positive responses (200) keep the per-source TTL (7d for crossref, etc.).
  const effectiveTtlMs =
    envelope.response.status === 404 ? Math.min(ttlMs, NEGATIVE_RESPONSE_TTL_MS) : ttlMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > effectiveTtlMs) return null;
  const out: HttpResponse = {
    status: envelope.response.status,
    headers: envelope.response.headers,
    body: envelope.response.body,
    cached: true,
    cachedAt: envelope.savedAt,
  };
  return out;
}

// FLAG-06 / CR-03: cache files persist for up to 7 days and may be tailed
// by debugging tools / log shippers / cloud-sync clients. Raw response
// headers commonly carry sensitive material (Set-Cookie session tokens,
// Authorization echoes for some misconfigured proxies, vendor-specific
// debug headers like x-amz-* / x-aws-* / x-azure-*). We MUST persist only
// the small set of headers needed for cache-replay semantics.
//
// Allowlist sources: HTTP/1.1 caching primitives (etag, last-modified,
// cache-control, date, retry-after) + content negotiation (content-type) +
// rate-limit budget hints the verifier consumes on cache replay
// (x-ratelimit-remaining, x-ratelimit-reset). Anything else gets dropped.
const CACHE_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  'content-type',
  'etag',
  'last-modified',
  'cache-control',
  'date',
  'retry-after',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);

function filterHeadersForCache(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (CACHE_HEADER_ALLOWLIST.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function writeCache(key: string, response: HttpResponse): Promise<void> {
  const file = path.join(pensmithHttpCacheDir(), `${key}.json`);
  const envelope: CacheEnvelope = {
    savedAt: new Date().toISOString(),
    response: {
      status: response.status,
      // CR-03: ONLY allowlisted headers go to disk. Set-Cookie / Authorization /
      // x-amz-* / opaque session tokens are dropped here, not after the fact.
      headers: filterHeadersForCache(response.headers),
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
  // HARD-02: for untrusted (source==='generic') URLs, run the SSRF pre-flight
  // guard before connecting. Trusted hardcoded API hosts (crossref/openalex/
  // arxiv/pubmed/s2/unpaywall/retraction-watch/gptzero/ddg) bypass the guard
  // so offline cassette tests and internal calls are unaffected.
  //
  // IN-02: an explicit `untrusted: false` in opts overrides the source==='generic'
  // default. This lets callers that use source='generic' for rate-bucket purposes
  // but have a hardcoded trusted URL (e.g. honesty.ts → GPTZERO_URL) bypass the
  // unnecessary SSRF DNS pre-flight. NEVER set untrusted:false for user-supplied URLs.
  //
  // Redirect handling: undici request() does NOT auto-follow redirects by default
  // (confirmed: it returns 301/302 as normal responses). Any redirect-following
  // done by callers routes back through fetch() → callOnce, so checkSsrf re-fires
  // on each hop URL automatically. maxRedirections is NOT set here — the existing
  // behavior (callers handle 3xx manually) is the correct approach.
  const untrusted = opts.untrusted === false ? false
    : (source === 'generic' || opts.untrusted === true);
  const callOnce = async (): Promise<HttpResponse> => {
    if (untrusted) {
      // SSRF pre-flight: throws on private IP / bad scheme / resolver error.
      await checkSsrf(url);
    }
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
    // Read the raw bytes ONCE (audit #29). `text` is the UTF-8 decode for text
    // consumers (byte-identical to the prior body.text()); `bodyBytes` preserves
    // the exact bytes for binary content (PDFs fetched by URL).
    const bodyBytes = Buffer.from(await body.arrayBuffer());
    const text = bodyBytes.toString('utf8');
    const flatHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(rh)) {
      const lk = k.toLowerCase();
      if (Array.isArray(v)) flatHeaders[lk] = v.join(', ');
      else if (typeof v === 'string') flatHeaders[lk] = v;
      else if (v == null) flatHeaders[lk] = '';
      else flatHeaders[lk] = String(v);
    }
    return { status: statusCode, headers: flatHeaders, body: text, bodyBytes, cached: false };
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
