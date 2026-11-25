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
// Retryable error codes:  ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN, plus the
//                         undici socket/connect codes (see RETRYABLE_ERR_CODES)
// Missed deadline:        retried for GET and HEAD, and for any method whose
//                         proxy never opened the tunnel. A POST that may have
//                         reached the server is not sent again.
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

import { request, getGlobalDispatcher, EnvHttpProxyAgent, Pool, type Dispatcher } from 'undici';
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { packageRoot, pensmithHttpCacheDir } from './paths.js';
import { VERSION } from './version.generated.js';
import { atomicWriteFile } from './atomic-write.js';
import { retry, parseRetryAfter } from './retry.js';
import { isOfflineMode, isCassetteMode, OfflineEgressError } from './network-mode.js';

// ============================================================
//   Proxy-aware dispatcher
// ============================================================
// undici's default dispatcher ignores HTTP_PROXY / HTTPS_PROXY / NO_PROXY, so on
// proxy-only university and corporate networks every registry call failed at
// connect and Pass 1 then called every citation FABRICATED. EnvHttpProxyAgent
// reads those variables (upper- or lower-case). It is rebuilt when they change.
//
// A dispatcher installed globally after this module loaded (a test MockAgent,
// or a host application's own agent) is used as-is instead.
//
// The SSRF guard below still resolves untrusted hostnames locally before the
// request is made. With a proxy in the path the proxy performs the final DNS
// resolution, so the local check is a pre-flight filter, not a guarantee about
// the address the proxy connects to.
const initialGlobalDispatcher: Dispatcher = getGlobalDispatcher();
let proxyAgent: { env: string; agent: Dispatcher } | null = null;

function proxyEnvFingerprint(): string {
  const e = process.env;
  return [
    e['http_proxy'] ?? e['HTTP_PROXY'] ?? '',
    e['https_proxy'] ?? e['HTTPS_PROXY'] ?? '',
    e['no_proxy'] ?? e['NO_PROXY'] ?? '',
  ].join('\n');
}

function dispatcherForRequest(): Dispatcher {
  const installed = getGlobalDispatcher();
  if (installed !== initialGlobalDispatcher) return installed;
  const env = proxyEnvFingerprint();
  if (!proxyAgent || proxyAgent.env !== env) {
    const previous = proxyAgent?.agent;
    proxyAgent = { env, agent: new EnvHttpProxyAgent({ clientFactory: proxyClientFactory }) };
    void previous?.close().catch(() => { /* idle sockets only */ });
  }
  return proxyAgent.agent;
}

/** The proxy closed or broke the connection while a tunnel was being opened. */
export class ProxyTunnelError extends Error {
  readonly code = 'PENSMITH_PROXY_TUNNEL';
  constructor(cause: unknown) {
    super(`proxy connection failed while opening a tunnel: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ProxyTunnelError';
  }
}

// undici treats a socket error during connection setup as recoverable and
// reconnects at once. When a proxy reads the CONNECT and then hangs up, that
// becomes a tight loop: thousands of connections a second to the proxy for as
// long as the request waits. Re-labelling the error makes undici fail the
// request instead, and fetch()'s own retry then applies its backoff.
const LOOPING_TUNNEL_ERROR_CODES: ReadonlySet<string> = new Set(['UND_ERR_SOCKET', 'UND_ERR_INFO']);

function asTunnelError(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && LOOPING_TUNNEL_ERROR_CODES.has(code) ? new ProxyTunnelError(err) : err;
}

// undici's ProxyAgent only calls the promise form of connect().
type ConnectFn = (o: Dispatcher.ConnectOptions) => Promise<Dispatcher.ConnectData>;

// The CONNECT requests the proxy has not answered yet, numbered in the order
// they were sent. A request waiting for its tunnel cannot be aborted on its own
// (undici only aborts a request once it has a connection), so when one misses
// its deadline, the CONNECT it is waiting on is aborted instead. That touches
// nothing else: no other request is queued on a connection that is still being
// opened, and tunnels that are already open are left as they are.
let tunnelSeq = 0;
const openingTunnels = new Map<number, AbortController>();

/** The connection pool to the proxy itself, which carries the CONNECT requests. */
function proxyClientFactory(origin: URL, opts: object): Dispatcher {
  const pool = new Pool(origin, opts as Pool.Options);
  const connect = pool.connect.bind(pool) as ConnectFn;
  // Everything before the first await runs synchronously when undici calls
  // this, so each CONNECT takes its number in dispatch order.
  const guarded: ConnectFn = async (o) => {
    const id = ++tunnelSeq;
    const controller = new AbortController();
    openingTunnels.set(id, controller);
    const signal = o.signal instanceof AbortSignal
      ? AbortSignal.any([o.signal, controller.signal])
      : controller.signal;
    try {
      return await connect({ ...o, signal });
    } catch (err) {
      throw asTunnelError(err);
    } finally {
      openingTunnels.delete(id);
    }
  };
  Object.assign(pool, { connect: guarded });
  return pool;
}

/** The CONNECTs numbered first..last that the proxy has still not answered. */
function tunnelsStillOpening(first: number, last: number): AbortController[] {
  const out: AbortController[] = [];
  for (let id = first; id <= last; id++) {
    const c = openingTunnels.get(id);
    if (c) out.push(c);
  }
  return out;
}

/** No response headers arrived within the request's timeout. */
export class HttpDeadlineError extends Error {
  readonly code = 'PENSMITH_HTTP_DEADLINE';
  /**
   * False only when the request was still waiting for the proxy to open its
   * tunnel, so none of it reached the server and sending it again is safe.
   */
  readonly mayHaveReachedServer: boolean;
  constructor(url: string, timeoutMs: number, mayHaveReachedServer: boolean) {
    const host = new URL(url).host;
    super(mayHaveReachedServer
      ? `http: no response from ${host} within ${timeoutMs} ms (deadline exceeded)`
      : `http: the proxy did not open a tunnel to ${host} within ${timeoutMs} ms (deadline exceeded)`);
    this.name = 'HttpDeadlineError';
    this.mayHaveReachedServer = mayHaveReachedServer;
  }
}

/**
 * Wait for the response head, but never longer than `timeoutMs` in total.
 * undici's headersTimeout starts only once a connection exists, and through a
 * proxy the CONNECT runs on the proxy pool's own 300 s default, so a stalled
 * proxy would otherwise hold the request (and the CLI process) for minutes.
 *
 * `tunnels` are the CONNECTs this request started. On expiry the request is
 * aborted, and so is any of those CONNECTs the proxy has not answered. Other
 * requests are not touched.
 */
async function withDeadline<T>(
  pending: Promise<T>,
  url: string,
  timeoutMs: number,
  abort: AbortController,
  tunnels: { first: number; last: number },
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const stuck = tunnelsStillOpening(tunnels.first, tunnels.last);
      const err = new HttpDeadlineError(url, timeoutMs, stuck.length === 0);
      abort.abort(err);
      for (const t of stuck) t.abort(err);
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

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
 * The SSRF guard refused a URL before any connection was made. Callers tell
 * it apart with instanceof; it keeps Error's name and has no code, so it
 * prints and serialises as the plain Error it always was.
 */
export class SsrfBlockedError extends Error {}

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
    throw new SsrfBlockedError(`SSRF guard: invalid URL "${url}"`);
  }

  if (!SSRF_ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfBlockedError(`SSRF guard: scheme "${parsed.protocol}" not allowed — only http/https permitted`);
  }

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolveFn(parsed.hostname);
  } catch (e) {
    // Fail-CLOSED for untrusted URLs: resolver error → block, not pass.
    throw new SsrfBlockedError(
      `SSRF guard: DNS lookup failed for "${parsed.hostname}" (blocked, fail-closed): ${String(e)}`,
    );
  }

  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(
        `SSRF guard: "${parsed.hostname}" resolves to private/reserved IP ${address} — blocked (RFC1918/loopback/link-local)`,
      );
    }
  }
}

// IN-03: resolve references/ against the install root (paths.ts
// packageRoot), not a fixed-depth `..` × N, which lands in the wrong dir
// after a build and silently degrades the WARN banner to the short fallback.
const PKG_ROOT = packageRoot();

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
function userAgent(): string {
  const email = process.env.PENSMITH_CONTACT_EMAIL?.trim();
  if (!email) {
    warnNoEmailOnce();
    return `pensmith/${VERSION} (no-contact)`;
  }
  return `pensmith/${VERSION} (${email})`;
}

// ============================================================
//   Public types
// ============================================================
export type HttpSource =
  | 'crossref'
  | 'datacite'
  | 'doi'
  | 'openalex'
  | 'unpaywall'
  | 'arxiv'
  | 'pubmed'
  | 'openlibrary'
  | 'semanticscholar'
  | 'generic';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  // Raw response bytes, byte-faithful (audit #29). `body` is the UTF-8 decode of
  // these bytes and is LOSSY for binary content (e.g. a fetched PDF), so binary
  // consumers (add.ts URL-PDF ingestion) MUST use bodyBytes — `Buffer.from(body,
  // 'binary')` cannot recover bytes already mangled by the UTF-8 decode. Present
  // only on a LIVE fetch (callOnce); a cached response is text-only and omits it.
  // A binary response is never written to the cache, and binary fetches pass
  // noCache:true so an old text entry is never read back either.
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
  /**
   * Per-attempt timeout, default 30_000. The response headers must arrive within
   * it, counting connection and proxy tunnel setup, and the body may not go
   * quiet for longer than it.
   */
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
  datacite: 7 * ONE_DAY_MS,
  doi: 7 * ONE_DAY_MS,
  openalex: 7 * ONE_DAY_MS,
  arxiv: 7 * ONE_DAY_MS,
  pubmed: 7 * ONE_DAY_MS,
  openlibrary: 7 * ONE_DAY_MS,
  unpaywall: 1 * ONE_DAY_MS,
  semanticscholar: 7 * ONE_DAY_MS,
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
  // DataCite allows 3000 requests per 5 minutes from one address.
  datacite: 10,
  // doi.org and the agency metadata hosts it redirects to; no published limit.
  doi: 5,
  openalex: 10,
  unpaywall: 10,
  // arXiv's API terms: no more than one request every three seconds.
  arxiv: 1 / 3,
  // E-utilities without an API key: three requests a second.
  pubmed: 3,
  openlibrary: 1,
  // S2 anonymous rate-limit is 100 RPM (~1.7 RPS); keep conservative at 1 RPS.
  // With an API key it bumps to 1 RPS per partner (same effective limit here).
  semanticscholar: 1,
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
    // At least one token of capacity: a source slower than one request a
    // second (arXiv) would otherwise never hold a whole token.
    b = new TokenBucket(Math.max(1, rps), rps);
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

// Audit #22: the Retry-After value is server-controlled, so it MUST be bounded.
// Without a cap a hostile or misconfigured endpoint can send `Retry-After: 86400`
// and stall the CLI for hours on a single attempt. Clamp to the same 30s ceiling
// the fullJitter backoff uses (the retry capMs below) — a server may ask us to
// back off, but never to hang.
export const RETRY_AFTER_CAP_MS = 30_000;

/** Parse a Retry-After header and clamp it to RETRY_AFTER_CAP_MS (audit #22). */
export function cappedRetryAfterMs(rawHeader: string | undefined, nowMs: number): number {
  return Math.min(parseRetryAfter(rawHeader, nowMs), RETRY_AFTER_CAP_MS);
}
const RETRYABLE_ERR_CODES: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  // The proxy hung up before the tunnel opened, so nothing reached the server.
  'PENSMITH_PROXY_TUNNEL',
]);

// Methods that are safe to send twice. A missed deadline on anything else (a
// POST to an LLM provider is a billed generation) is not retried unless the
// request provably never reached the server.
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

function isRetryable(err: unknown, method: string): boolean {
  const e = err as { status?: number; code?: string } | null;
  if (!e) return false;
  if (typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status)) return true;
  if (err instanceof HttpDeadlineError) {
    return !err.mayHaveReachedServer || IDEMPOTENT_METHODS.has(method);
  }
  return typeof e.code === 'string' && RETRYABLE_ERR_CODES.has(e.code);
}

// A body the cache can keep as text: no content type (the registries' plain
// answers), text/*, or a JSON or XML type such as application/vnd.api+json.
const TEXT_CONTENT_TYPE = /^\s*(?:text\/|application\/(?:[\w.-]+\+)?(?:json|xml)\b|application\/(?:javascript|x-bibtex|x-research-info-systems)\b)/i;

function isTextContent(contentType: string | undefined): boolean {
  return !contentType || TEXT_CONTENT_TYPE.test(contentType);
}

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

  // --- 0. Network mode ---
  // Offline refuses before the cache, DNS or a socket: nothing leaves the
  // machine, and nothing cached is served as if it had just been checked.
  if (isOfflineMode()) throw new OfflineEgressError(url);
  // Test runs answer from committed cassettes and never touch the network.
  if (isCassetteMode()) return replayFromCassette(method, url);

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
  // arxiv/pubmed/s2/unpaywall/gptzero/ddg) skip the DNS
  // pre-flight because their URLs are built from constants, not user input.
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
    const abort = new AbortController();
    const reqInit: Parameters<typeof request>[1] = {
      method,
      headers,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      dispatcher: dispatcherForRequest(),
      signal: abort.signal,
    };
    if (opts.body !== undefined) {
      reqInit.body = opts.body;
    }
    // undici dispatches a request with no body or a string body synchronously,
    // so a CONNECT sent while request() runs is the tunnel this request waits on.
    const firstTunnel = tunnelSeq + 1;
    const pending = request(url, reqInit);
    const tunnels = { first: firstTunnel, last: tunnelSeq };
    const { statusCode, headers: rh, body } = await withDeadline(
      pending, url, timeoutMs, abort, tunnels,
    );
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
      // Server asked us to wait — honor it (already capped, audit #22) before the
      // next attempt.
      const delay = serverRetryDelay;
      serverRetryDelay = 0;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
    const r = await dispatch();
    if (RETRYABLE_STATUSES.has(r.status)) {
      const ra = r.headers['retry-after'];
      serverRetryDelay = cappedRetryAfterMs(typeof ra === 'string' ? ra : undefined, Date.now());
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
        retryOn: (err) => isRetryable(err, method),
      });

  // --- 5. Cache write (GET, success or definite 404, text only) ---
  // The cache keeps the UTF-8 text body, which loses the bytes of a binary
  // response such as a PDF, so a binary response is never written.
  if (method === 'GET' && !opts.noCache && (response.status === 200 || response.status === 404)
    && isTextContent(response.headers['content-type'])) {
    await writeCache(key, response).catch(() => {
      // Cache write failures are non-fatal — the response is still returned
      // to the caller. Disk full / read-only FS would otherwise break every
      // request, which is unacceptable.
    });
  }
  return response;
}

/**
 * Answer a request from the committed test cassettes (PENSMITH_TEST_CASSETTES=1
 * only). The module is loaded lazily so a production run never reads
 * tests/fixtures. A request with no recording rejects with CassetteMissError,
 * which adapters treat like any transport failure (null / no results).
 */
async function replayFromCassette(method: string, url: string): Promise<HttpResponse> {
  const { replayCassette } = await import('./http-mock.js');
  const r = replayCassette(method, url);
  const body = method === 'HEAD' ? '' : r.body;
  return {
    status: r.status,
    headers: r.headers,
    body,
    bodyBytes: method === 'HEAD' ? Buffer.alloc(0) : (r.bytes ?? Buffer.from(body, 'utf8')),
    cached: false,
  };
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
