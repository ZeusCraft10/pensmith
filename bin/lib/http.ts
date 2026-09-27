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
//
// =================================================================
//   The egress gate (RUN-04, SEC-01, SEC-03, D-17-05, D-17-09)
// =================================================================
// Every request leaves through ONE gate, in this order:
//   1. Mode (bin/lib/http-mock.ts networkMode(), never an env read here):
//        --dry-run          → every request refused (OfflineEgressError), 0 sockets;
//        LLM stubbed        → an opts.llm request is refused;
//        sources offline    → a non-LLM request is answered ONLY from the
//                             exact-match fixture store or refused; an opts.llm
//                             request is allowed only to a loopback endpoint.
//   2. DNS resolve + validate for EVERY request (trusted hosts included):
//      private, loopback, link-local and CGNAT addresses are refused, except the
//      configured LLM endpoint rules (D-17-09).
//   3. Pin: a per-request dispatcher whose connect lookup answers ONLY with the
//      validated addresses (no second DNS resolution — closes WR-03 / DNS
//      rebinding), keeping the hostname for TLS SNI and the Host header.
//      maxRedirections stays 0 (SRC-01 adds a re-pinning redirect loop later).
//   4. --show-prompts mirror (D-17-12), before any byte is sent.
//   5. The body streams under maxBytes; ResponseTooLargeError aborts before
//      full buffering (JSON 8 MiB, PDFs MAX_PDF_BYTES, LLM 16 MiB).
//   6. A kind:"http" SESSION.log record for every request (D-17-13), including
//      refused, cached and fixture-served ones.
// In sources-offline and dry-run modes the HTTP cache is neither read nor
// written, so offline never serves a live cache entry and never pollutes it.
//
// Test seams (active ONLY under a test context — http-mock.ts isTestContext):
// an injectable resolver plus local test hosts and their CA (__setHttpTestSeams),
// and an installed global MockAgent (tests/helpers/local-servers/mock-agent.ts).
// The mode check and the policy checks run first either way.

import { request, getGlobalDispatcher, Agent, MockAgent, type Dispatcher } from 'undici';
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFileSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pensmithHttpCacheDir, pensmithDataDir } from './paths.js';
import { atomicWriteFile } from './atomic-write.js';
import { retry, parseRetryAfter } from './retry.js';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import {
  networkMode,
  isTestContext,
  isRecordingEnabled,
  LLM_STUBBED_REASON,
  lookupFixture,
  canonicalFixtureKey,
  scrubbedPathAndQuery,
  SENSITIVE_HEADERS,
  type NetworkMode,
} from './http-mock.js';
import { openSessionLog, isMirrorPromptsEnabled, type SessionLogger } from './session-log.js';

// ============================================================
//   Typed egress errors (D-17-05)
// ============================================================

/** Why a request could not leave the machine. */
export type OfflineEgressMode = 'offline' | 'dry-run' | 'llm-stubbed';

/**
 * A request refused by the network mode (RUN-03, RUN-04): a sources-offline
 * fixture miss, any request under --dry-run, or a model call while the LLM is
 * stubbed. Callers map it to "unavailable (offline)" / "unavailable (dry-run)";
 * adapters never swallow it.
 */
export class OfflineEgressError extends PensmithError {
  readonly mode: OfflineEgressMode;
  /** The mode reason: an http-mock.ts OfflineReason, or LLM_STUBBED_REASON. */
  readonly reason: string;
  /** METHOD and URL (secret params redacted). */
  readonly request: string;
  constructor(mode: OfflineEgressMode, reason: string, request: string, message: string) {
    super(message, EXIT_ERROR);
    this.name = 'OfflineEgressError';
    this.mode = mode;
    this.reason = reason;
    this.request = request;
  }
}

/** True for an OfflineEgressError (including across module-instance boundaries). */
export function isOfflineEgressError(e: unknown): e is OfflineEgressError {
  return e instanceof OfflineEgressError || (e instanceof Error && e.name === 'OfflineEgressError');
}

/** The user-facing label for an offline refusal: 'dry-run' or 'offline'. */
export function offlineLabel(e: OfflineEgressError): 'dry-run' | 'offline' {
  return e.mode === 'dry-run' ? 'dry-run' : 'offline';
}

/** A response body that exceeded the per-call cap (SEC-03). Thrown before full buffering. */
export class ResponseTooLargeError extends PensmithError {
  readonly maxBytes: number;
  readonly request: string;
  constructor(maxBytes: number, request: string) {
    super(`response too large: ${request} exceeded the ${maxBytes}-byte cap (SEC-03)`, EXIT_ERROR);
    this.name = 'ResponseTooLargeError';
    this.maxBytes = maxBytes;
    this.request = request;
  }
}

/** Default response caps (SEC-03). PDF callers pass MAX_PDF_BYTES from pdf-text.ts. */
export const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_LLM_RESPONSE_BYTES = 16 * 1024 * 1024;

// ============================================================
//   SSRF guard — HARD-02 (T-15-02), pinned per SEC-01
// ============================================================
// Mirrors CACHE_HEADER_ALLOWLIST pattern for scheme enforcement.
const SSRF_ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:']);

/** One validated address a request may dial (SEC-01). */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** A DNS resolver: hostname → every address (node:dns/promises lookup {all:true} shape). */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: Resolver = (h) => dnsLookup(h, { all: true });

/** A request refused by the SSRF / egress policy (message always starts "SSRF guard:"). */
export class SsrfBlockedError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_ERROR);
    this.name = 'SsrfBlockedError';
  }
}

/** Extract the embedded IPv4 of an IPv4-mapped IPv6 address, or null. */
function mappedV4(addr: string): string | null {
  // Dotted form:     ::ffff:127.0.0.1
  // Hex-colon form:  ::ffff:7f00:0001  (e.g. returned by some DNS resolvers)
  const mapped = addr.match(
    /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}:[0-9a-f]{1,4}))$/i,
  );
  if (!mapped) return null;
  if (mapped[1]) return mapped[1];
  const hexParts = (mapped[2] as string).split(':');
  const hi = parseInt(hexParts[0] as string, 16);
  const lo = parseInt(hexParts[1] as string, 16);
  const n = ((hi << 16) | lo) >>> 0;
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/** Expand an IPv6 address to its 8 16-bit groups (null when unparseable). */
function ipv6Groups(addr: string): number[] | null {
  let s = addr.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // An embedded dotted IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) becomes two groups.
  const v4tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4tail) {
    const [a, b, c, d] = v4tail.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, v4tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
  return groups.some((g) => Number.isNaN(g)) ? null : groups;
}

function v4Octets(addr: string): [number, number, number, number] | null {
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return null;
  return [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
}

/** Loopback: 127.0.0.0/8, ::1, and their IPv4-mapped forms. */
export function isLoopbackIp(addr: string): boolean {
  const m = mappedV4(addr);
  if (m) return isLoopbackIp(m);
  const o = v4Octets(addr);
  if (o) return o[0] === 127;
  const g = ipv6Groups(addr);
  return g !== null && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

/**
 * Addresses NEVER dialed, even for a configured LLM endpoint (D-17-09):
 * 169.254.0.0/16 (link-local / cloud metadata), fe80::/10, fd00:ec2::254.
 */
export function isNeverAllowedIp(addr: string): boolean {
  const m = mappedV4(addr);
  if (m) return isNeverAllowedIp(m);
  const o = v4Octets(addr);
  if (o) return o[0] === 169 && o[1] === 254;
  const g = ipv6Groups(addr);
  if (!g) return false;
  if (((g[0] as number) & 0xffc0) === 0xfe80) return true;
  const ec2 = [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254];
  return g.every((x, i) => x === ec2[i]);
}

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
export function isPrivateIp(addr: string): boolean {
  const m = mappedV4(addr);
  if (m) return isPrivateIp(m);

  // IPv4
  const o = v4Octets(addr);
  if (o) {
    const [a, b] = o;
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
  const g = ipv6Groups(addr);
  if (g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // expanded ::1
  return false;
}

/** URL hostname without the IPv6 brackets. */
function bareHost(u: URL): string {
  return u.hostname.startsWith('[') && u.hostname.endsWith(']') ? u.hostname.slice(1, -1) : u.hostname;
}

/** Resolve a hostname (an IP literal resolves to itself — no DNS). */
async function resolveHost(host: string, resolveFn: Resolver): Promise<ResolvedAddress[]> {
  const fam = isIP(host);
  if (fam !== 0) return [{ address: host, family: fam }];
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolveFn(host);
  } catch (e) {
    // Fail-CLOSED: a resolver error blocks. The DNS error code is kept so a
    // transient EAI_AGAIN stays retryable in the fetch() retry wrapper.
    const err = new SsrfBlockedError(
      `SSRF guard: DNS lookup failed for "${host}" (blocked, fail-closed): ${String(e)}`,
    ) as SsrfBlockedError & { code?: string };
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === 'string') err.code = code;
    throw err;
  }
  if (!Array.isArray(addrs) || addrs.length === 0) {
    throw new SsrfBlockedError(`SSRF guard: "${host}" resolved to no address (blocked, fail-closed)`);
  }
  return addrs.map((a) => ({ address: a.address, family: a.family }));
}

function parseHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`SSRF guard: invalid URL "${url}"`);
  }
  if (!SSRF_ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfBlockedError(`SSRF guard: scheme "${parsed.protocol}" not allowed — only http/https permitted`);
  }
  return parsed;
}

/**
 * SSRF pre-flight guard (HARD-02 / T-15-02, SEC-01).
 *
 * Resolves the hostname and throws if ANY resolved address is private or
 * reserved; rejects non-http(s) schemes; fails CLOSED on a resolver error.
 * Returns the validated addresses — the ONLY addresses the request may then
 * dial (fetch() pins the connection to them).
 *
 * @param url       The URL to check (must be valid http/https).
 * @param resolveFn Injectable DNS resolver — defaults to node:dns/promises
 *                  lookup with {all:true}. Override in tests to avoid real DNS.
 */
export async function checkSsrf(url: string, resolveFn: Resolver = defaultResolver): Promise<ResolvedAddress[]> {
  const parsed = parseHttpUrl(url);
  const host = bareHost(parsed);
  const addrs = await resolveHost(host, resolveFn);
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(
        `SSRF guard: "${host}" resolves to private/reserved IP ${address} — blocked (RFC1918/loopback/link-local)`,
      );
    }
  }
  return addrs;
}

/**
 * The LLM endpoint policy (D-17-09, RUN-08), enforced ONLY here:
 *   - the request origin must equal the configured endpoint origin;
 *   - http:// only when every resolved address is loopback;
 *   - 169.254.0.0/16, fe80::/10 and fd00:ec2::254 are never dialed;
 *   - other private addresses only over https (to the configured endpoint).
 * Returns the validated addresses (pinned like any other request).
 */
export async function checkLlmEndpoint(
  url: string,
  endpoint: string,
  resolveFn: Resolver = defaultResolver,
): Promise<ResolvedAddress[]> {
  const parsed = parseHttpUrl(url);
  let ep: URL;
  try {
    ep = new URL(endpoint);
  } catch {
    throw new SsrfBlockedError(`SSRF guard: configured LLM endpoint "${endpoint}" is not a valid URL`);
  }
  if (parsed.origin !== ep.origin) {
    throw new SsrfBlockedError(
      `SSRF guard: LLM request origin ${parsed.origin} does not match the configured endpoint origin ${ep.origin}`,
    );
  }
  const host = bareHost(parsed);
  const addrs = await resolveHost(host, resolveFn);
  for (const { address } of addrs) {
    if (isNeverAllowedIp(address)) {
      throw new SsrfBlockedError(
        `SSRF guard: LLM endpoint "${host}" resolves to ${address} (link-local / cloud metadata) — never allowed`,
      );
    }
  }
  const allLoopback = addrs.every((a) => isLoopbackIp(a.address));
  if (parsed.protocol === 'http:' && !allLoopback) {
    throw new SsrfBlockedError(
      `SSRF guard: http:// is allowed only for a loopback LLM endpoint; "${host}" is not loopback — use https://`,
    );
  }
  return addrs;
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
  /** True when a sources-offline request was answered from the exact-match fixture store (D-17-06). */
  fixture?: boolean;
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
  /**
   * Phase 17 seam (verbatim V3): marks a call to the configured LLM endpoint.
   * Only the completion module (bin/lib/anthropic.ts) sets it. `endpoint` is the
   * configured base URL (e.g. https://api.anthropic.com or http://127.0.0.1:11434/v1);
   * http.ts allows exactly its origin for this request (RUN-04, RUN-08, SEC-01).
   */
  llm?: { endpoint: string };
  /** Phase 17 seam (verbatim V3): abort once the response body exceeds this many bytes (SEC-03). */
  maxBytes?: number;
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
]);

// ============================================================
//   Secret-param redaction (RUN-16 mirror, D-17-13 records)
// ============================================================

/** Query parameters whose VALUES are secrets: never printed or logged. */
const SECRET_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'api_key',
  'apikey',
  'key',
  'token',
  'access_token',
]);

/** Contact parameters additionally dropped from SESSION.log records (PII). */
const CONTACT_QUERY_PARAMS: ReadonlySet<string> = new Set(['mailto', 'email']);

/**
 * The URL as shown by --show-prompts and written to SESSION.log: secret query
 * values replaced by REDACTED (so the reader still sees that a key param was
 * sent), and — for logs only — contact params dropped.
 */
export function redactUrl(url: string, opts: { dropContact?: boolean } = {}): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '<invalid url>';
  }
  u.username = '';
  u.password = '';
  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (opts.dropContact === true && CONTACT_QUERY_PARAMS.has(lk)) continue;
    kept.push([k, SECRET_QUERY_PARAMS.has(lk) ? 'REDACTED' : v]);
  }
  const q = new URLSearchParams(kept).toString();
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
}

// ============================================================
//   Test seams (active ONLY under a test context)
// ============================================================

export interface HttpTestSeams {
  /** Injectable resolver (replaces node:dns for every request). */
  readonly resolve?: Resolver;
  /**
   * Hostnames served by a local test server (tests/helpers/local-servers/
   * transport.ts): their LOOPBACK address counts as a pinnable source address.
   */
  readonly localHosts?: readonly string[];
  /** Extra CA (PEM) trusted for TLS to the localHosts only (the SEC-01 SNI server). */
  readonly ca?: string | Buffer;
}

let testSeams: HttpTestSeams | null = null;

/**
 * Install (or clear, with null) the test seams. Refuses outside a test context,
 * and every use re-checks the context, so a real run can never reach them.
 */
export function __setHttpTestSeams(next: HttpTestSeams | null): void {
  if (next !== null && !isTestContext()) {
    throw new Error('http.ts: test seams are available only under the test runner (http-mock.ts isTestContext)');
  }
  testSeams = next;
}

function activeSeams(): HttpTestSeams | null {
  return testSeams !== null && isTestContext() ? testSeams : null;
}

/** The installed global MockAgent (V5), honoured only under a test context. */
function installedMockAgent(): Dispatcher | null {
  if (!isTestContext()) return null;
  const g = getGlobalDispatcher();
  return g instanceof MockAgent ? g : null;
}

/**
 * Under the MockAgent seam no socket is ever opened (V5 disables net connect),
 * so no real DNS query is made either: IP literals resolve to themselves,
 * `localhost` to 127.0.0.1, and any other name to a TEST-NET-1 placeholder so
 * the policy checks still run first.
 */
const mockAgentResolver: Resolver = async (host) => {
  if (host === 'localhost') return [{ address: '127.0.0.1', family: 4 }];
  return [{ address: '192.0.2.1', family: 4 }];
};

// ============================================================
//   Pinned per-request dispatcher (SEC-01)
// ============================================================

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * A dispatcher whose connect lookup answers ONLY with the validated addresses:
 * the socket dials exactly what the SSRF guard approved (no second DNS
 * resolution — DNS rebinding closed), while the URL hostname stays the TLS SNI
 * servername and the Host header.
 */
function pinnedDispatcher(addrs: readonly ResolvedAddress[], ca?: string | Buffer): Agent {
  const lookup = (_host: string, options: unknown, cb: LookupCallback): void => {
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    const first = addrs[0] as ResolvedAddress;
    if (all) cb(null, addrs.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, first.address, first.family);
  };
  return new Agent({
    connect: { lookup, ...(ca !== undefined ? { ca } : {}) } as never,
    keepAliveTimeout: 1_000,
  });
}

// ============================================================
//   Body streaming under the size cap (SEC-03)
// ============================================================

async function readCapped(
  body: AsyncIterable<Buffer | Uint8Array> & { destroy?: (err?: Error) => void },
  maxBytes: number,
  requestLabel: string,
  declaredLength: number | null,
): Promise<Buffer> {
  if (declaredLength !== null && declaredLength > maxBytes) {
    body.destroy?.();
    throw new ResponseTooLargeError(maxBytes, requestLabel);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      body.destroy?.();
      throw new ResponseTooLargeError(maxBytes, requestLabel);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

// ============================================================
//   --show-prompts mirror (RUN-16, D-17-12)
// ============================================================

const MIRROR_PREVIEW_CHARS = 200;

function mirrorRequest(method: string, url: string, body: string | Buffer | undefined, llm: boolean): void {
  if (!isMirrorPromptsEnabled()) return;
  const lines = [`[show-prompts] ${method} ${redactUrl(url)}`];
  if (body !== undefined) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    if (llm) {
      lines.push(`[show-prompts] body: ${text}`);
    } else if (method === 'POST') {
      const n = Buffer.byteLength(text, 'utf8');
      lines.push(`[show-prompts] body: ${n} bytes: ${text.slice(0, MIRROR_PREVIEW_CHARS)}`);
    }
  }
  // Headers are NEVER printed (they carry the API keys).
  process.stderr.write(lines.join('\n') + '\n');
}

// ============================================================
//   kind:"http" session records (D-17-13)
// ============================================================

type CacheOutcome = 'hit' | 'miss' | 'fixture' | 'refused';

const httpLoggers = new Map<string, SessionLogger>();

function httpLogger(): SessionLogger {
  // One handle per (paper cwd, data dir): the 'auto' scope resolves the log file
  // when the handle opens (.paper/SESSION.log, else the global session.log).
  const cwd = process.cwd();
  let hasPaper = false;
  try {
    hasPaper = statSync(path.join(cwd, '.paper')).isDirectory();
  } catch {
    hasPaper = false;
  }
  const key = `${cwd}\u0000${pensmithDataDir()}\u0000${hasPaper ? 'paper' : 'global'}`;
  let log = httpLoggers.get(key);
  if (!log) {
    log = openSessionLog({ scope: 'auto', cwd });
    httpLoggers.set(key, log);
  }
  return log;
}

interface HttpRecord {
  source: HttpSource;
  method: string;
  url: string;
  status: number | null;
  cache: CacheOutcome;
  offline: boolean;
  bytes: number;
  ms: number;
  llm?: boolean;
  error?: string;
}

function recordHttp(r: HttpRecord): void {
  try {
    httpLogger().http({
      ...r,
      url: redactUrl(r.url, { dropContact: true }),
    } as unknown as Record<string, unknown>);
  } catch {
    /* the session log never breaks a request */
  }
}

/** Test-only: forget the per-cwd http loggers (a test changed cwd / data dir). */
export function _resetHttpLoggersForTest(): void {
  httpLoggers.clear();
}

// ============================================================
//   Cassette recorder hook (CI-07, D-17-14)
// ============================================================

/** Response headers a recorded fixture keeps (never Set-Cookie / Authorization …). */
const RECORD_HEADER_ALLOWLIST: ReadonlySet<string> = new Set(['content-type']);

export interface RecordedFixture {
  /** The canonical exact-match key (D-17-06). */
  key: string;
  scope: string;
  method: 'GET' | 'POST' | 'HEAD';
  /** Path + query with SCRUBBED_QUERY_PARAMS removed. */
  path: string;
  status: number;
  response: unknown;
  responseHeaders: Record<string, string>;
  bodySha256?: string;
  source: HttpSource;
}

const recordedFixtures: RecordedFixture[] = [];

function recordFixture(
  method: 'GET' | 'POST' | 'HEAD',
  url: string,
  body: string | Buffer | undefined,
  source: HttpSource,
  res: HttpResponse,
): void {
  const u = new URL(url);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    const lk = k.toLowerCase();
    if (RECORD_HEADER_ALLOWLIST.has(lk) && !SENSITIVE_HEADERS.has(lk)) headers[lk] = v;
  }
  let response: unknown = res.body;
  if ((headers['content-type'] ?? '').includes('json')) {
    try {
      response = JSON.parse(res.body);
    } catch {
      response = res.body;
    }
  }
  const entry: RecordedFixture = {
    key: canonicalFixtureKey(method, url, body),
    scope: u.origin,
    method,
    path: scrubbedPathAndQuery(url),
    status: res.status,
    response,
    responseHeaders: headers,
    source,
  };
  if (body !== undefined && method === 'POST') {
    entry.bodySha256 = createHash('sha256').update(body).digest('hex');
  }
  recordedFixtures.push(entry);
}

/** Drain the fixtures recorded so far (scripts/refresh-cassettes.mjs). */
export function takeRecordedFixtures(): RecordedFixture[] {
  return recordedFixtures.splice(0, recordedFixtures.length);
}

// ============================================================
//   Public: fetch
// ============================================================
/**
 * Issue an HTTP request through the chokepoint — the egress gate (see the file
 * header for the order). Handles polite UA, per-source rate gating, full-jitter
 * retry and per-source TTL caching (live mode only).
 *
 * Cache semantics (live mode only — never in sources-offline or dry-run):
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
 *   - OfflineEgressError / ResponseTooLargeError / SsrfBlockedError never retry
 *
 * `opts.untrusted` no longer changes anything: since SEC-01 every request is
 * resolved, validated and pinned, trusted hosts included.
 */
export async function fetch(url: string, opts: FetchOptions = {}): Promise<HttpResponse> {
  const method: 'GET' | 'POST' | 'HEAD' = opts.method ?? 'GET';
  // The User-Agent (and its no-contact WARN) is added only when a request is
  // actually sent: a refused, fixture-served or cached request never needs it.
  // cacheKey() ignores user-agent, so the key is the same either way.
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...opts.headers,
  };
  const source: HttpSource = opts.source ?? 'generic';
  const ttlMs = opts.cacheTtlMs ?? TTL_MS_BY_SOURCE[source];
  const key = opts.cacheKey ?? cacheKey(method, url, headers);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const llm = opts.llm;
  const maxBytes = opts.maxBytes ?? (llm !== undefined ? MAX_LLM_RESPONSE_BYTES : MAX_JSON_RESPONSE_BYTES);
  const label = `${method} ${redactUrl(url)}`;
  const started = Date.now();
  const mode: NetworkMode = networkMode();
  const base = { source, method, url, offline: mode.sourcesOffline, ...(llm !== undefined ? { llm: true } : {}) };

  const refuse = (err: Error): never => {
    recordHttp({ ...base, status: null, cache: 'refused', bytes: 0, ms: Date.now() - started, error: err.message });
    throw err;
  };

  // --- 1. Mode (D-17-05 step 1) ---
  if (mode.dryRun) {
    refuse(new OfflineEgressError('dry-run', '--dry-run', label,
      `dry-run: no network request is made (${label})`));
  }
  if (llm !== undefined && mode.llmStubbed) {
    refuse(new OfflineEgressError('llm-stubbed', LLM_STUBBED_REASON, label,
      `LLM stubbed (${LLM_STUBBED_REASON}): no model request is made (${label})`));
  }
  if (mode.sourcesOffline && llm === undefined) {
    // Exact-match fixture replay, never a fallback (D-17-06). Mirrored so
    // --show-prompts lists what the run would have sent.
    const hit = lookupFixture(method, url, opts.body);
    if (!hit) {
      refuse(new OfflineEgressError('offline', mode.reason ?? 'offline', label,
        `offline: no recorded fixture for ${label} — re-run online`));
    }
    const fx = hit as NonNullable<typeof hit>;
    mirrorRequest(method, url, opts.body, false);
    const bytes = Buffer.from(fx.body, 'utf8');
    if (bytes.length > maxBytes) refuse(new ResponseTooLargeError(maxBytes, label));
    recordHttp({ ...base, status: fx.status, cache: 'fixture', bytes: bytes.length, ms: Date.now() - started });
    return { status: fx.status, headers: fx.headers, body: fx.body, bodyBytes: bytes, cached: false, fixture: true };
  }

  // --- Cache short-circuit (live mode, GET only, opt-in) ---
  const cacheAllowed = !mode.sourcesOffline && method === 'GET' && !opts.noCache && llm === undefined;
  if (cacheAllowed) {
    const cached = await readCache(key, ttlMs);
    if (cached) {
      recordHttp({ ...base, status: cached.status, cache: 'hit', bytes: Buffer.byteLength(cached.body, 'utf8'), ms: Date.now() - started });
      return cached;
    }
  }

  let mirrored = false;

  // --- 2..5. One attempt: resolve + validate, pin, mirror, capped stream ---
  const callOnce = async (): Promise<HttpResponse> => {
    const seams = activeSeams();
    const mock = installedMockAgent();
    const resolver: Resolver = seams?.resolve ?? (mock !== null ? mockAgentResolver : defaultResolver);
    const parsed = parseHttpUrl(url);
    const host = bareHost(parsed);

    let addrs: ResolvedAddress[];
    if (llm !== undefined) {
      addrs = await checkLlmEndpoint(url, llm.endpoint, resolver);
      if (mode.sourcesOffline && !addrs.every((a) => isLoopbackIp(a.address))) {
        // Sources offline: the ONLY socket allowed is the configured LOOPBACK
        // LLM endpoint (RUN-04) — e.g. the RUN-21 mock under the test runner.
        throw new OfflineEgressError('offline', mode.reason ?? 'offline', label,
          `offline: only a loopback LLM endpoint may be dialed while sources are offline (${label})`);
      }
    } else {
      const localHosts = seams?.localHosts ?? [];
      addrs = await resolveHost(host, resolver);
      for (const { address } of addrs) {
        const localTestHost = localHosts.includes(host) && isLoopbackIp(address);
        if (isPrivateIp(address) && !localTestHost) {
          throw new SsrfBlockedError(
            `SSRF guard: "${host}" resolves to private/reserved IP ${address} — blocked (RFC1918/loopback/link-local)`,
          );
        }
      }
    }

    const useCa = seams?.ca !== undefined && (seams.localHosts ?? []).includes(host) ? seams.ca : undefined;
    const pinned = mock === null ? pinnedDispatcher(addrs, useCa) : null;
    const dispatcher: Dispatcher = mock ?? (pinned as Agent);

    // --- 4. Mirror before any byte leaves (once per request, not per retry) ---
    if (!mirrored) {
      mirrored = true;
      mirrorRequest(method, url, opts.body, llm !== undefined);
    }

    try {
      const reqInit = {
        method,
        headers: { 'user-agent': userAgent(), ...headers },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        dispatcher,
        // SEC-01: redirects are never followed here (SRC-01 adds a loop that
        // re-pins every hop). tests/ssrf-pinning.test.ts fails if this changes.
        maxRedirections: 0,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
      } as Parameters<typeof request>[1];
      const { statusCode, headers: rh, body } = await request(url, reqInit);
      const flatHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rh)) {
        const lk = k.toLowerCase();
        if (Array.isArray(v)) flatHeaders[lk] = v.join(', ');
        else if (typeof v === 'string') flatHeaders[lk] = v;
        else if (v == null) flatHeaders[lk] = '';
        else flatHeaders[lk] = String(v);
      }
      const declared = Number(flatHeaders['content-length']);
      // --- 5. Stream under the cap; read the raw bytes ONCE (audit #29) ---
      const bodyBytes = await readCapped(
        body as unknown as AsyncIterable<Buffer> & { destroy?: (err?: Error) => void },
        maxBytes,
        label,
        Number.isFinite(declared) && flatHeaders['content-length'] !== '' ? declared : null,
      );
      const text = bodyBytes.toString('utf8');
      return { status: statusCode, headers: flatHeaders, body: text, bodyBytes, cached: false };
    } finally {
      if (pinned !== null) await pinned.destroy().catch(() => undefined);
    }
  };

  // --- Bucket-acquired single attempt ---
  const dispatch = async (): Promise<HttpResponse> => {
    await bucketFor(source).acquire();
    return callOnce();
  };

  // --- Optional retry wrap ---
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

  let response: HttpResponse;
  try {
    response = opts.noRetry
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
  } catch (err) {
    const e = err as Error & { status?: number };
    const refused = err instanceof OfflineEgressError || err instanceof SsrfBlockedError;
    recordHttp({
      ...base,
      status: typeof e.status === 'number' ? e.status : null,
      cache: refused ? 'refused' : 'miss',
      bytes: 0,
      ms: Date.now() - started,
      error: e?.message ?? String(err),
    });
    throw err;
  }

  recordHttp({ ...base, status: response.status, cache: 'miss', bytes: response.bodyBytes?.length ?? 0, ms: Date.now() - started });

  // --- Recorder hook (http-mock.ts isRecordingEnabled: live, outside a test context) ---
  if (llm === undefined && isRecordingEnabled()) {
    recordFixture(method, url, opts.body, source, response);
  }

  // --- Cache write (live GET, success or definite 404) ---
  if (cacheAllowed && (response.status === 200 || response.status === 404)) {
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
