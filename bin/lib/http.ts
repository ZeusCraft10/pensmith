// bin/lib/http.ts — HTTP client chokepoint per ARCH-12 / ARCH-13.
//
// SOLE call site for undici / node:http / node:https in the repo (D-06).
// The eslint chokepoint at eslint.config.js bans `import 'undici'` everywhere
// EXCEPT this file (per-file `no-restricted-imports: 'off'` exemption).
//
// =================================================================
//   Polite scholarly client (D-23, D-24, D-19-08, D-19-09)
// =================================================================
// User-Agent: `pensmith/{version} (mailto:{email})` for the services that ask
// callers to identify themselves (Crossref and its retraction lookup, OpenAlex,
// Unpaywall); the address comes from bin/lib/contact-email.ts contactEmail()
// (the variable named by `[network] contact_email_env`, default
// PENSMITH_CONTACT_EMAIL). Every other request — and any redirect hop that
// leaves the service's origin — carries the plain `pensmith/{version}`. With no
// address set, a polite-pool request says `(no-contact)` and prints the WARN-once
// banner from references/http-warnings.md (locked string — the doctor probe
// reuses it, so drift is a lint failure).
//
// =================================================================
//   Per-source TTL disk cache (D-30)
// =================================================================
// crossref / openalex / arxiv / pubmed: 7d
// unpaywall: 1d  (OA status flips faster than DOI metadata)
// generic:   24h
// Cache key:    sha256(method + ':' + url + ':' + sortedHeaders).slice(0,16), with
//               the secret query parameters (api_key, apikey, key, token,
//               access_token), the contact parameters and every SENSITIVE_HEADERS
//               entry (zotero-api-key included) left out — a keyed and a keyless
//               request share one entry, and no key ever shapes a cache file
//               name (SRC-06, D-19-10).
// Cache file:   pensmithHttpCacheDir() + '/' + key + '.json'
// Cache write:  atomicWriteFile (W2 dependency) — never direct fs.writeFile.
// Cache short-circuits BEFORE network and BEFORE the per-host rate bucket
// (cache hits are free). Only a validated answer is cached (seam S-B validate).
//
// =================================================================
//   Retry (D-31, D-32)
// =================================================================
// Retryable status codes: 429, 500, 502, 503, 504, 529
// Retryable error codes:  ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN
// Backoff:                full-jitter via bin/lib/retry.ts (NOT p-retry's
//                         bounded multiplicative jitter — see retry.ts header)
// 4xx OTHER than 429 are NOT retried (they are application errors).
// The retry's `fn` includes the bucket acquire, so a 429 retry re-acquires
// politely — per ARCH-13. A Retry-After up to RETRY_AFTER_CAP_MS is honoured
// before the next attempt.
//
// =================================================================
//   Per-host politeness (ARCH-13, SRC-17, D-19-08)
// =================================================================
// Token buckets are keyed per HOST (Crossref search, works and retraction
// lookups share api.crossref.org), seeded from the per-source table and a
// per-host floor table (the lower wins):
//   arXiv 1 request per 3 s, Crossref 3/s, PubMed 3/s, Semantic Scholar 1/s,
//   OpenAlex 10/s, Unpaywall 10/s, Open Library 1/s, Zotero 5/s, generic 5/s.
// A bucket holds ONE token (no burst): consecutive requests to a host are at
// least 1 / rate apart, so no window of X-Rate-Limit-Interval ever holds more
// than X-Rate-Limit-Limit requests (review round 3 — a 3-token bucket at 3/s
// let ~6 through in the first second and drew Crossref's 429).
// A scholarly API's own `X-Rate-Limit-Limit` / `X-Rate-Limit-Interval` (e.g.
// 3 / 1s; RATE_HEADER_HOSTS only — any other host cannot lower pensmith's
// rate) lowers that host's rate and never raises it; a declared rate slower
// than one request per RETRY_AFTER_CAP_MS marks the host exhausted instead of
// sleeping. Zotero's `Backoff: <s>` holds the host for that long. Waiting for a
// token counts against the request's timeoutMs (a RateLimitExhaustedError
// when it runs out): the rate limit never hangs a request.
// Host availability (never for a model request, never for a fixture answer):
//   - a Retry-After (or Backoff) beyond RETRY_AFTER_CAP_MS marks the host
//     exhausted until then: the request is not retried, RateLimitExhaustedError
//     is thrown, one stderr line is printed, and later requests to that host
//     fail fast with zero sockets;
//   - a 429 is "slow down", not "down": it holds the WHOLE host (every request
//     to it, not just the retry) for its Retry-After, or — without one — for
//     at least the declared interval (X-Rate-Limit-Interval), one bucket
//     interval and MIN_THROTTLE_HOLD_MS, whichever is longest, and empties the
//     bucket. A request's own 429 retries are ONE breaker strike, counted only
//     when the request still ends throttled; BREAKER_THRESHOLD requests in a
//     row that end throttled open the breaker (a transient throttle that the
//     hold absorbs never takes the host down for the run);
//   - 5xx is "down": the breaker opens after BREAKER_THRESHOLD consecutive 5xx
//     RESPONSES (retries count, D-19-08), so a failing host costs ≤ 3 requests;
//   - an open breaker: CircuitOpenError, one stderr line per host, the host
//     skipped for the rest of the run; any other answer resets both counts;
//     after BREAKER_HALF_OPEN_MS an open breaker lets one probe through (so the
//     long-lived MCP server recovers), and a probe answered 429/5xx re-opens it.
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
//                             exact-match fixture store (recorded redirect hops
//                             are followed through it) or refused; an opts.llm
//                             request is allowed only to a loopback endpoint.
//   2. DNS resolve + validate for EVERY request (trusted hosts included):
//      private, loopback, link-local and CGNAT addresses are refused, except the
//      configured LLM endpoint rules (D-17-09) and the two configured local
//      services (FetchOptions.localService: the Zotero 7 local API at exactly
//      http://127.0.0.1:23119 with PENSMITH_ZOTERO_LOCAL=1, and the loopback
//      origin of PENSMITH_GROBID_URL — read from the environment only, by
//      bin/lib/local-services.ts, so a paper file can enable neither;
//      link-local and metadata addresses stay refused). http.ts itself reads
//      no environment variable.
//   3. Pin: a per-request dispatcher whose connect lookup answers ONLY with the
//      validated addresses (no second DNS resolution — closes WR-03 / DNS
//      rebinding), keeping the hostname for TLS SNI and the Host header.
//      undici never follows a redirect (its redirect count stays zero): http.ts
//      follows 301/302/303/307/308 itself, for GET and HEAD only, at most
//      MAX_REDIRECTS hops, and every hop repeats steps 2-6 for its own URL — the
//      scheme allowlist, DNS resolve + validate, a new pinned dispatcher, its own
//      mirror line and its own http record. A cross-origin hop drops every
//      SENSITIVE_HEADERS entry; https→http, a revisited URL, a missing Location
//      and a sixth redirect are RedirectErrors; 303 becomes GET; a POST's 3xx is
//      returned as-is and a model request's 3xx is an error (SRC-01, D-19-06).
//   4. --show-prompts mirror (D-17-12), before any byte is sent.
//   5. The body streams under maxBytes; ResponseTooLargeError aborts before
//      full buffering (JSON 8 MiB, PDFs MAX_PDF_BYTES, LLM 16 MiB).
//   6. A kind:"http" SESSION.log record for every request (D-17-13), including
//      refused, cached and fixture-served ones, and one per redirect hop.
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
import { pensmithHttpCacheDir, pensmithDataDir, projectRoot, pluginReferencePath } from './paths.js';
import { VERSION } from './version.generated.js';
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
  recordedErrorBody,
  type NetworkMode,
} from './http-mock.js';
import { openSessionLog, isMirrorPromptsEnabled, type SessionLogger } from './session-log.js';
import { contactEmail, DEFAULT_CONTACT_EMAIL_ENV } from './contact-email.js';
import { enabledLocalServiceOrigin, type LocalService } from './local-services.js';
import { lookupTable } from './lookup-table.js';

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

// ------------------------------------------------------------
//   Host-availability and redirect errors (Phase 19 seam S-B, SRC-01, SRC-17)
// ------------------------------------------------------------
// Declared by the seam so adapters and verbs can report them; thrown by the
// transport once stream `net` lands the redirect loop, the exhausted-host
// marker and the per-host circuit breaker.

/** A rough, human wait: `~35 s`, `~12 min`, `~6 h`, `~2 d`. */
export function formatRetryAfter(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return `~${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `~${min} min`;
  const h = Math.round(s / 3600);
  if (h < 48) return `~${h} h`;
  return `~${Math.round(s / 86_400)} d`;
}

/**
 * A host whose server asked callers to wait longer than RETRY_AFTER_CAP_MS
 * (e.g. keyless OpenAlex's `Retry-After: 22400`): the request is not retried,
 * and no further request goes to that host in this process until the wait has
 * passed (SRC-17). Adapters report it as a failed lookup / search.
 */
export class RateLimitExhaustedError extends PensmithError {
  readonly host: string;
  readonly retryAfterMs: number;
  readonly status: number;
  /**
   * What the response that exhausted the host said (its bounded body and its
   * headers), so an adapter can tell WHY (e.g. OpenAlex's keyless daily budget
   * versus its short load-shedding limit). Absent for a token-wait timeout.
   */
  readonly detail: { readonly body?: string; readonly headers?: Readonly<Record<string, string>> } | undefined;
  constructor(
    host: string,
    retryAfterMs: number,
    status: number = 429,
    detail?: { readonly body?: string; readonly headers?: Readonly<Record<string, string>> },
  ) {
    super(`${host}: rate limit exhausted (retry after ${formatRetryAfter(retryAfterMs)})`, EXIT_ERROR);
    this.name = 'RateLimitExhaustedError';
    this.host = host;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * A host whose per-host circuit breaker is open: it answered 429/5xx too many
 * times in a row, so it is skipped for the rest of the run (SRC-17).
 */
export class CircuitOpenError extends PensmithError {
  readonly host: string;
  readonly lastStatus: number;
  readonly failures: number;
  /**
   * What opened the breaker, without the host: `3 consecutive HTTP 503
   * responses` (5xx: responses count, retries included) or `3 requests in a
   * row throttled (HTTP 429)` (429: a request counts once, when it still ends
   * throttled after its retries).
   */
  readonly summary: string;
  constructor(host: string, lastStatus: number, failures: number) {
    const summary = lastStatus === 429
      ? `${failures} requests in a row throttled (HTTP 429)`
      : `${failures} consecutive HTTP ${lastStatus} responses`;
    super(`${host}: skipped for the rest of this run after ${summary}`, EXIT_ERROR);
    this.name = 'CircuitOpenError';
    this.host = host;
    this.lastStatus = lastStatus;
    this.failures = failures;
    this.summary = summary;
  }
}

/** True for either host-availability error (the host is not being asked right now). */
export function isHostUnavailableError(e: unknown): e is RateLimitExhaustedError | CircuitOpenError {
  return e instanceof RateLimitExhaustedError || e instanceof CircuitOpenError;
}

/** Why a redirect chain was not followed to the end (SRC-01). */
export type RedirectErrorKind = 'too-many' | 'loop' | 'downgrade' | 'no-location' | 'not-followed';

/** A redirect chain http.ts refused to follow (every hop is SSRF-checked and pinned separately). */
export class RedirectError extends PensmithError {
  readonly kind: RedirectErrorKind;
  /** The URL whose redirect was refused (secret params redacted). */
  readonly url: string;
  constructor(kind: RedirectErrorKind, url: string, detail: string) {
    super(`${kind === 'too-many' ? 'too many redirects' : 'redirect refused'}: ${detail}`, EXIT_ERROR);
    this.name = 'RedirectError';
    this.kind = kind;
    this.url = url;
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

/**
 * The IPv4 address an IPv6 address stands for, or null: IPv4-mapped
 * (::ffff:0:0/96) and IPv4-compatible (::/96), the NAT64 well-known prefix
 * 64:ff9b::/96 (RFC 6052 — a DNS64 resolver answers with it on IPv6-only
 * hosts and the gateway dials the embedded IPv4), 6to4 (2002::/16) and a
 * Teredo client (2001::/32, the obfuscated low 32 bits). The SSRF rules
 * re-check the embedded IPv4, so `64:ff9b::a9fe:a9fe` is 169.254.169.254.
 */
function embeddedV4(addr: string): string | null {
  const m = mappedV4(addr);
  if (m) return m;
  const g = ipv6Groups(addr);
  if (!g) return null;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const v4 = (hi: number, lo: number): string => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  const zeroTo = (k: number): boolean => g.slice(0, k).every((x) => x === 0);
  if (zeroTo(5) && g5 === 0xffff) return v4(g6, g7); // ::ffff:a.b.c.d (any spelling)
  if (zeroTo(6) && g6 !== 0) return v4(g6, g7); // ::a.b.c.d (IPv4-compatible; ::, ::1 stay IPv6)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4(g6, g7); // NAT64 WKP
  if (g0 === 0x2002) return v4(g1, g2); // 6to4
  if (g0 === 0x2001 && g1 === 0) return v4(~g6 & 0xffff, ~g7 & 0xffff); // Teredo client
  return null;
}

/** 64:ff9b:1::/48 — the local-use NAT64 prefix (RFC 8215): a site-internal translator. */
function isLocalUseNat64(addr: string): boolean {
  const g = ipv6Groups(addr);
  return g !== null && g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1;
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
 * 169.254.0.0/16 (link-local / cloud metadata), fe80::/10, fd00:ec2::254 —
 * and any IPv6 form that embeds such an IPv4 (embeddedV4: NAT64, 6to4, …).
 */
export function isNeverAllowedIp(addr: string): boolean {
  const m = embeddedV4(addr);
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
 *   IPv6 that embeds an IPv4 — mapped (::ffff:x.x.x.x dotted OR hex-colon),
 *   IPv4-compatible, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo — extracts the
 *   embedded v4 and re-checks (embeddedV4); the local-use NAT64 prefix
 *   64:ff9b:1::/48 is site-internal and always private.
 */
export function isPrivateIp(addr: string): boolean {
  const m = embeddedV4(addr);
  if (m) return isPrivateIp(m);
  if (isLocalUseNat64(addr)) return true;

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

// ============================================================
//   Configured local services (SRC-15, SRC-16, D-19-21, D-19-24)
// ============================================================

// Which local services are enabled is read from the environment by
// bin/lib/local-services.ts (never from a paper file); http.ts only enforces
// the policy. Re-exported here for the modules and tests that speak to the gate.
export { ZOTERO_LOCAL_ORIGIN, grobidOrigin, isZoteroLocalEnabled, type LocalService } from './local-services.js';

/**
 * The origin an ENABLED local service may be reached at right now, or null
 * when the environment has not enabled it. (Under a test context a seam may
 * move an enabled service to a loopback test server's origin.)
 */
export function localServiceOrigin(kind: LocalService): string | null {
  const origin = enabledLocalServiceOrigin(kind);
  if (origin === null) return null;
  return activeSeams()?.localServiceOrigins?.[kind] ?? origin;
}

const LOCAL_SERVICE_HOW: Readonly<Record<LocalService, string>> = {
  'zotero-local': 'the Zotero local API is enabled only by PENSMITH_ZOTERO_LOCAL=1',
  grobid: 'GROBID is enabled only by PENSMITH_GROBID_URL naming a loopback server (127.0.0.1, ::1 or localhost)',
};

/**
 * The local-service policy (enforced ONLY here): the request origin must equal
 * the enabled service's origin, and every resolved address must be loopback
 * (never link-local / metadata). Returns the validated addresses (pinned).
 */
async function checkLocalService(url: string, kind: LocalService, resolveFn: Resolver): Promise<ResolvedAddress[]> {
  const parsed = parseHttpUrl(url);
  const origin = localServiceOrigin(kind);
  if (origin === null) {
    throw new SsrfBlockedError(`SSRF guard: ${kind} is not enabled — ${LOCAL_SERVICE_HOW[kind]}`);
  }
  if (parsed.origin !== origin) {
    throw new SsrfBlockedError(
      `SSRF guard: ${kind} request origin ${parsed.origin} is not the enabled origin ${origin} (${LOCAL_SERVICE_HOW[kind]})`,
    );
  }
  const host = bareHost(parsed);
  const addrs = await resolveHost(host, resolveFn);
  for (const { address } of addrs) {
    if (isNeverAllowedIp(address) || !isLoopbackIp(address)) {
      throw new SsrfBlockedError(
        `SSRF guard: ${kind} host "${host}" resolves to ${address}, which is not a loopback address — blocked`,
      );
    }
  }
  return addrs;
}

// ============================================================
//   WARN-once for missing contact email
// ============================================================
// The locked banner lives in the plugin's references/http-warnings.md
// (PLUG-02), found through the one asset resolver (paths.ts, D-23a-03) in
// every layout: source, dist/, an npm install and the plugin bundle (IN-03 —
// never a fixed-depth `..` walk).
const warnFile = (): string => pluginReferencePath('http-warnings.md');

let warnString: string | null = null;
let warnedNoEmail = false;

function loadWarnString(): string {
  if (warnString !== null) return warnString;
  let md: string;
  try {
    md = readFileSync(warnFile(), 'utf8');
  } catch {
    // Defensive fallback if the references file is missing — should never
    // happen in shipped builds because plugin/ is in package.json files[].
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

/**
 * Print the locked no-contact banner once per process. When the paper names a
 * different variable (`[network] contact_email_env`, validated by
 * contact-email.ts), the banner names that variable instead of the default.
 */
function warnNoEmailOnce(envName: string): void {
  if (warnedNoEmail) return;
  warnedNoEmail = true;
  const text = loadWarnString();
  const named = envName === DEFAULT_CONTACT_EMAIL_ENV ? text : text.split(DEFAULT_CONTACT_EMAIL_ENV).join(envName);
  process.stderr.write(named + '\n');
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
/**
 * The running version for the User-Agent: the prebuild-generated VERSION
 * (package.json#version, WR-01) — the same constant in every layout, including
 * the plugin bundle, which ships no package.json.
 */
function pkgVersion(): string {
  return VERSION;
}

/**
 * Sources whose APIs ask callers to identify themselves with a contact email
 * (the "polite pool"): Crossref (api.crossref.org, which also serves the
 * Retraction Watch data the retraction-watch adapter reads), OpenAlex and
 * Unpaywall. Only these get the contact email in the User-Agent (D-19-08).
 */
const POLITE_POOL_SOURCES: ReadonlySet<HttpSource> = new Set<HttpSource>(['crossref', 'openalex', 'unpaywall', 'retraction-watch']);

/** True when requests for `source` identify pensmith with the contact email. */
export function isPolitePoolSource(source: HttpSource): boolean {
  return POLITE_POOL_SOURCES.has(source);
}

/**
 * The User-Agent for one request (hop). A polite-pool source gets
 * `pensmith/<version> (mailto:<email>)` — the form Crossref, OpenAlex and
 * Unpaywall document — with the address from contact-email.ts, and the
 * missing-email WARN when none is set. Every other request — a model provider
 * (opts.llm), the DuckDuckGo phrase search, GPTZero, a URL the user passed to
 * `add`, an open-access PDF host, and any redirect hop that leaves the polite
 * service's origin (`polite` false) — gets the plain `pensmith/<version>`: the
 * contact email is personal data meant for the polite pools only (PRIVACY.md),
 * and a run that never called them has no reason to warn about their limits.
 */
function userAgent(source: HttpSource, llm: boolean, polite = true): string {
  if (llm || !polite || !POLITE_POOL_SOURCES.has(source)) return `pensmith/${pkgVersion()}`;
  const { email, envName } = contactEmail();
  if (email === null) {
    warnNoEmailOnce(envName);
    return `pensmith/${pkgVersion()} (no-contact)`;
  }
  return `pensmith/${pkgVersion()} (mailto:${email})`;
}

/**
 * Remove the contact email (raw or percent-encoded, e.g. in a URL embedded in
 * an error message) from text bound for a SESSION.log record (PRIVACY.md: the
 * contact email is dropped from every log record).
 */
function scrubContactEmail(text: string): string {
  const email = contactEmail().email;
  if (!email) return text;
  let out = text;
  for (const form of new Set([email, encodeURIComponent(email)])) out = out.split(form).join('REDACTED_CONTACT_EMAIL');
  return out;
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
  // Phase 19 seam S-B: the books adapter (Open Library, Google Books; SRC-11)
  // and the Zotero Web / local API client (SRC-16).
  | 'books'
  | 'zotero'
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
  /**
   * The URL that answered when http.ts followed redirects to get here (SRC-01).
   * Absent when the requested URL answered itself (and on a cache hit, which
   * stores the final answer under the requested URL).
   */
  finalUrl?: string;
  /**
   * True when the request asked for only a prefix of the body (`prefixBytes`)
   * and the server had more: `body` / `bodyBytes` hold the first bytes only.
   */
  truncated?: boolean;
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
   * A configured service on the user's own machine (see LocalService): the
   * request may go to exactly that service's enabled loopback origin and
   * nowhere else. Enabled only by the environment (PENSMITH_ZOTERO_LOCAL=1,
   * PENSMITH_GROBID_URL), never by a paper file.
   */
  localService?: LocalService;
  /**
   * Phase 17 seam (verbatim V3): marks a call to the configured LLM endpoint.
   * Only the completion module (bin/lib/anthropic.ts) sets it. `endpoint` is the
   * configured base URL (e.g. https://api.anthropic.com or http://127.0.0.1:11434/v1);
   * http.ts allows exactly its origin for this request (RUN-04, RUN-08, SEC-01).
   */
  llm?: { endpoint: string };
  /** Phase 17 seam (verbatim V3): abort once the response body exceeds this many bytes (SEC-03). */
  maxBytes?: number;
  /**
   * false: return a GET / HEAD's 3xx as the answer instead of following it
   * (default true, SRC-01). The DOI freshness probe asks only whether doi.org
   * resolves the handle — its 302 IS the answer; following it would land on
   * Crossref's content-negotiation endpoint (which answers HEAD with 405) or
   * on a publisher host.
   */
  followRedirects?: boolean;
  /**
   * Phase 19 seam S-B (SRC-17): the caller's schema check. Called with a live
   * response before it is cached or recorded; a non-null return (the reason
   * the body is not the service's answer) keeps it out of the HTTP cache and
   * out of any recording. The response is still returned: the caller reports
   * it as a failed lookup. Independently, a 200 whose body is an API error
   * document (http-mock.ts recordedErrorBody) is never cached.
   */
  validate?: (res: HttpResponse) => string | null;
  /**
   * Read only the first `prefixBytes` bytes of the final answer's body, then
   * close the connection (review round 3: open-access.ts asks whether a URL
   * serves a PDF — its `%PDF-` header — without downloading the whole file).
   * The response is marked `truncated` when more followed, and it is never
   * cached. A prefix read never reads past the prefix, so `maxBytes` (and a
   * larger declared Content-Length) does not refuse it.
   */
  prefixBytes?: number;
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
  // Phase 19 seam S-B: book metadata changes rarely; a Zotero library changes
  // under the user's hands (its client passes noCache).
  books: 7 * ONE_DAY_MS,
  zotero: ONE_HOUR_MS,
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
//   Per-host TokenBucket seeds (ARCH-13, SRC-17, D-19-08; docs/SOURCES.md)
// ============================================================
// Requests per second, seeded per source; a host's bucket takes the LOWEST seed
// of every source that reaches it and of HOST_RPS_FLOOR below, and a service's
// own X-Rate-Limit-* headers can lower it further (never raise it).
const RPS_BY_SOURCE: Record<HttpSource, number> = {
  // Crossref's polite pool answers list queries with `x-rate-limit-limit: 3`
  // (`polite-array`; single-work lookups allow 10, the public pool 1) — seed at
  // 3/s and let its headers lower it (never raise it).
  crossref: 3,
  // OpenAlex: 10/s within the (keyed) daily budget.
  openalex: 10,
  unpaywall: 10,
  // arXiv API terms: no more than one request every three seconds.
  arxiv: 1 / 3,
  // NCBI E-utilities without an API key: 3 requests per second.
  pubmed: 3,
  // Semantic Scholar: 1 request per second (keyless requests share a public pool).
  semanticscholar: 1,
  // The retraction lookup is a Crossref REST query (api.crossref.org, D-17-47):
  // same host, same seed — the per-host bucket makes them share one budget.
  'retraction-watch': 3,
  // Phase 19 seam S-B: Open Library asks clients not to exceed ~1 request/s.
  books: 1,
  zotero: 5,
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
    private capacity: number,
    private refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  /** The current refill rate (requests per second). */
  get rate(): number {
    return this.refillPerSec;
  }

  /**
   * Lower the rate (never raises it). The capacity never grows: a per-host
   * bucket holds one token (hostStateFor), so it never bursts above the rate.
   * `drain` empties the bucket: used when a server's own rate-limit headers
   * arrive on a response, so the NEXT request waits a full interval (1 / rate)
   * after the one that was just answered (SRC-17).
   */
  lower(refillPerSec: number, drain: boolean): boolean {
    if (!(refillPerSec > 0) || refillPerSec >= this.refillPerSec) return false;
    this.refill();
    this.refillPerSec = refillPerSec;
    this.capacity = Math.min(this.capacity, Math.max(1, refillPerSec));
    this.tokens = drain ? Math.min(this.tokens, 0) : Math.min(this.tokens, this.capacity);
    this.lastRefillMs = Date.now();
    return true;
  }

  /** Empty the bucket: the next token is a full interval (1 / rate) away (a 429, SRC-17). */
  drain(): void {
    this.refill();
    this.tokens = Math.min(this.tokens, 0);
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefillMs = now;
  }

  /**
   * Take one token, waiting in FIFO order. With `timeoutMs`, a wait longer
   * than that rejects with `onTimeout()` and gives up its place in the queue:
   * the rate limit never holds a request longer than the request's own
   * timeout (SRC-17, audit #22 — "back off, but never hang").
   */
  async acquire(timeoutMs?: number, onTimeout?: () => Error): Promise<void> {
    this.refill();
    // Fast-path: tokens available AND no one waiting ahead of us.
    if (this.tokens >= 1 && this.waiters.length === 0) {
      this.tokens -= 1;
      return;
    }
    // Slow-path: enqueue and wait for the single grant timer to fire.
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      this.waiters.push(waiter);
      if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
        timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i < 0) return;
          this.waiters.splice(i, 1);
          reject(onTimeout?.() ?? new Error(`waited more than ${timeoutMs} ms for the rate limit`));
        }, timeoutMs);
        timer.unref?.();
      }
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

// ============================================================
//   Per-host state: bucket, exhausted marker, circuit breaker (SRC-17)
// ============================================================

/**
 * Per-host floors (requests per second) for hosts a request can reach under
 * more than one source label — e.g. an arXiv PDF fetched as `generic` still
 * gets arXiv's one-request-per-3-seconds rule. The lower of this and the
 * source seed wins.
 */
const HOST_RPS_FLOOR: Readonly<Record<string, number>> = lookupTable({
  'export.arxiv.org': 1 / 3,
  'arxiv.org': 1 / 3,
  'api.crossref.org': 3,
  'eutils.ncbi.nlm.nih.gov': 3,
  'api.semanticscholar.org': 1,
  'openlibrary.org': 1,
  'api.zotero.org': 5,
});

/**
 * The hosts whose `X-Rate-Limit-Limit` / `X-Rate-Limit-Interval` headers are
 * honoured (SRC-17): the scholarly APIs pensmith is written against. Any other
 * host — a URL from `add`, an open-access PDF host, a redirect target — cannot
 * lower pensmith's rate: a server may ask to be asked less often, but only a
 * service we are polite to by design gets to say how.
 */
const RATE_HEADER_HOSTS: ReadonlySet<string> = new Set([
  'api.crossref.org',
  'api.openalex.org',
  'export.arxiv.org',
  'eutils.ncbi.nlm.nih.gov',
  'api.semanticscholar.org',
  'api.unpaywall.org',
  'openlibrary.org',
  'www.googleapis.com',
  'api.zotero.org',
]);

/**
 * The slowest declared rate a bucket is lowered to: one request per
 * RETRY_AFTER_CAP_MS. A server that declares a slower rate asks for a wait
 * longer than the cap, which pensmith never sleeps through: the host is marked
 * exhausted instead (fail fast, RateLimitExhaustedError), exactly like a long
 * Retry-After (audit #22).
 */
export function minHonouredRate(): number {
  return 1000 / RETRY_AFTER_CAP_MS;
}

/**
 * What opens a host's circuit breaker: this many consecutive 5xx responses, or
 * this many requests in a row that still end throttled (429) after their
 * retries.
 */
export const BREAKER_THRESHOLD = 3;
/**
 * The least a 429 without a Retry-After holds its host (SRC-17, review round
 * 3): a throttled service is not asked again within the same second.
 */
export const MIN_THROTTLE_HOLD_MS = 1000;
/** How long an open breaker waits before it lets one probe request through. */
export const BREAKER_HALF_OPEN_MS = 10 * 60_000;

interface HostState {
  /** The URL host (hostname, plus the port when it is not the default). */
  readonly host: string;
  /** The bare hostname (lower case). */
  readonly hostname: string;
  readonly bucket: TokenBucket;
  /** Epoch ms before which no request goes to the host (a short Backoff). */
  notBefore: number;
  /** Epoch ms until which the host is exhausted (a long Retry-After / Backoff); 0 = not. */
  exhaustedUntil: number;
  exhaustedStatus: number;
  /** What the response that exhausted the host said (RateLimitExhaustedError.detail). */
  exhaustedDetail: { body?: string; headers?: Record<string, string> } | undefined;
  /** Consecutive 5xx responses (a request's retries count). */
  failures: number;
  /** Consecutive requests that ended throttled (429) after their retries. */
  throttled: number;
  lastStatus: number;
  /** When the breaker opened (epoch ms), or null when closed. */
  openedAt: number | null;
  /** A half-open probe is in flight. */
  probing: boolean;
  announcedOpen: boolean;
  announcedExhausted: boolean;
}

const HOSTS = new Map<string, HostState>();

/** The state of `host`, created on first use; a lower seed from another source lowers its rate. */
function hostStateFor(host: string, hostname: string, source: HttpSource): HostState {
  const seed = Math.min(RPS_BY_SOURCE[source], HOST_RPS_FLOOR[hostname] ?? Number.POSITIVE_INFINITY);
  let st = HOSTS.get(host);
  if (!st) {
    st = {
      host,
      hostname,
      // One token: no burst above the seed (or the declared) rate.
      bucket: new TokenBucket(1, seed),
      notBefore: 0,
      exhaustedUntil: 0,
      exhaustedStatus: 0,
      exhaustedDetail: undefined,
      failures: 0,
      throttled: 0,
      lastStatus: 0,
      openedAt: null,
      probing: false,
      announcedOpen: false,
      announcedExhausted: false,
    };
    HOSTS.set(host, st);
  } else {
    st.bucket.lower(seed, false);
  }
  return st;
}

const sleepMs = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Admit one request to `st`'s host: fail fast (zero sockets) while the host is
 * exhausted or its breaker is open — except the one half-open probe — honour a
 * short Backoff, then take a token from the host's bucket. A model request
 * (llm) only takes the token: provider failures are classified by
 * anthropic.ts, not by the breaker.
 */
async function enterHost(st: HostState, llm: boolean, timeoutMs: number): Promise<void> {
  if (!llm) {
    const now = Date.now();
    if (st.exhaustedUntil > now) throw new RateLimitExhaustedError(st.host, st.exhaustedUntil - now, st.exhaustedStatus, st.exhaustedDetail);
    if (st.exhaustedUntil !== 0) st.exhaustedUntil = 0;
    if (st.openedAt !== null) {
      if (st.probing || now - st.openedAt < BREAKER_HALF_OPEN_MS) {
        throw new CircuitOpenError(st.host, st.lastStatus, st.lastStatus === 429 ? st.throttled : st.failures);
      }
      st.probing = true; // half-open: this request is the one probe
    }
    if (st.notBefore > now) await sleepMs(st.notBefore - now);
  }
  // The wait for a token counts against the request's timeout: never a hang.
  await st.bucket.acquire(timeoutMs, () => new RateLimitExhaustedError(st.host, Math.ceil(1000 / st.bucket.rate), 0));
}

/** A request that got no response from the host (transport error, refusal): a half-open probe re-opens. */
function hostNoAnswer(st: HostState): void {
  if (st.probing) {
    st.probing = false;
    st.openedAt = Date.now();
  }
}

/** The `X-Rate-Limit-Interval` a server declares, in seconds (`1s`, `500ms`, `1m`, `1h`; bare = seconds), or null. */
function declaredIntervalSec(headers: Record<string, string>): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec((headers['x-rate-limit-interval'] ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const seconds = unit === 'ms' ? n / 1000 : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n;
  return seconds > 0 ? seconds : null;
}

/** Requests per second a server declares (`X-Rate-Limit-Limit` / `X-Rate-Limit-Interval`), or null. */
export function declaredRate(headers: Record<string, string>): number | null {
  const limit = Number((headers['x-rate-limit-limit'] ?? '').trim());
  const seconds = declaredIntervalSec(headers);
  if (!Number.isFinite(limit) || limit <= 0 || seconds === null) return null;
  return limit / seconds;
}

/** True when a Retry-After header is present and parses (delta-seconds or an HTTP-date) — `0` included. */
function hasRetryAfter(raw: string | undefined): boolean {
  const v = (raw ?? '').trim();
  return /^\d+$/.test(v) || (v !== '' && !Number.isNaN(Date.parse(v)));
}

/**
 * How long a 429 holds its host (SRC-17, review round 3): the Retry-After when
 * the server sent one (already known to be within the cap); otherwise at least
 * the declared interval (only a RATE_HEADER_HOSTS host may declare one), one
 * interval of the host's bucket, and MIN_THROTTLE_HOLD_MS — never capped
 * below, never above RETRY_AFTER_CAP_MS.
 */
function throttleHoldMs(st: HostState, headers: Record<string, string>, retryAfterMs: number): number {
  if (hasRetryAfter(headers['retry-after'])) return retryAfterMs;
  const intervalSec = RATE_HEADER_HOSTS.has(st.hostname) ? declaredIntervalSec(headers) : null;
  return Math.min(
    RETRY_AFTER_CAP_MS,
    Math.max(MIN_THROTTLE_HOLD_MS, Math.ceil(1000 / st.bucket.rate), intervalSec !== null ? Math.ceil(intervalSec * 1000) : 0),
  );
}

/** Open `st`'s breaker (announced once per host) and return the error to throw. */
function openBreaker(st: HostState, status: number, count: number, now: number): CircuitOpenError {
  st.openedAt = now;
  st.probing = false;
  const err = new CircuitOpenError(st.host, status, count);
  if (!st.announcedOpen) {
    st.announcedOpen = true;
    process.stderr.write(`pensmith: ${err.message}\n`);
  }
  return err;
}

/**
 * A request to `st`'s host ended throttled — its last answer was a 429 after
 * every retry it was allowed (or it asked for no retries): one breaker strike.
 * Returns the CircuitOpenError to throw when this strike opens the breaker.
 */
function noteRequestThrottled(st: HostState): CircuitOpenError | null {
  st.throttled += 1;
  st.lastStatus = 429;
  return st.throttled >= BREAKER_THRESHOLD ? openBreaker(st, 429, st.throttled, Date.now()) : null;
}

function markExhausted(
  st: HostState,
  waitMs: number,
  status: number,
  detail?: { body?: string; headers?: Record<string, string> },
): RateLimitExhaustedError {
  st.exhaustedUntil = Date.now() + waitMs;
  st.exhaustedStatus = status;
  st.exhaustedDetail = detail;
  st.probing = false;
  const err = new RateLimitExhaustedError(st.host, waitMs, status, detail);
  if (!st.announcedExhausted) {
    st.announcedExhausted = true;
    process.stderr.write(`pensmith: ${err.message} — no further requests go to it in this run\n`);
  }
  return err;
}

/**
 * Account one live response from `st`'s host (never a fixture, never a model
 * response): lower the rate to what the server declares, honour Backoff, hold
 * the host after a 429, and count 5xx toward the breaker. Throws
 * RateLimitExhaustedError (a Retry-After beyond the cap) or CircuitOpenError
 * (the BREAKER_THRESHOLD-th consecutive 5xx, or a failed half-open probe); any
 * other answer resets both counts and closes the breaker. A 429 is counted per
 * request, when the request ends (noteRequestThrottled).
 */
function noteHostResponse(st: HostState, status: number, headers: Record<string, string>, body = ''): void {
  const now = Date.now();
  const detail = { body: body.slice(0, 2000), headers };
  // Only the scholarly APIs may lower the rate, and never below one request
  // per RETRY_AFTER_CAP_MS: slower is "exhausted", never a sleep.
  const declared = RATE_HEADER_HOSTS.has(st.hostname) ? declaredRate(headers) : null;
  if (declared !== null) {
    if (declared < minHonouredRate()) markExhausted(st, Math.ceil(1000 / declared), status, detail);
    else st.bucket.lower(declared, true);
  }
  const backoffMs = parseRetryAfter(headers['backoff'], now);
  if (backoffMs > RETRY_AFTER_CAP_MS) markExhausted(st, backoffMs, status, detail);
  else if (backoffMs > 0) st.notBefore = Math.max(st.notBefore, now + backoffMs);
  if (!RETRYABLE_STATUSES.has(status)) {
    st.failures = 0;
    st.throttled = 0;
    st.openedAt = null;
    st.probing = false;
    return;
  }
  st.lastStatus = status;
  const retryAfterMs = parseRetryAfter(headers['retry-after'], now);
  if (retryAfterMs > RETRY_AFTER_CAP_MS) throw markExhausted(st, retryAfterMs, status, detail);
  if (status === 429) {
    // Slow down: nothing goes to this host until the hold ends, and the next
    // token is a full interval after that (review round 3).
    st.notBefore = Math.max(st.notBefore, now + throttleHoldMs(st, headers, retryAfterMs));
    st.bucket.drain();
    if (st.probing) throw openBreaker(st, status, Math.max(st.throttled, 1), now);
    return;
  }
  st.failures += 1;
  if (st.probing || st.failures >= BREAKER_THRESHOLD) throw openBreaker(st, status, st.failures, now);
}

/**
 * Test-only — forget every host's bucket, exhausted marker and breaker so test
 * ordering doesn't leak rate-limit state. NEVER call from production code.
 */
export function _resetHostStateForTest(): void {
  HOSTS.clear();
}

/**
 * Test-only — reset the rate buckets. Buckets are per host now (SRC-17), so
 * this is _resetHostStateForTest: the breaker and exhausted markers go too.
 * NEVER call from production code.
 */
export function _resetBucketsForTest(): void {
  _resetHostStateForTest();
}

// ============================================================
//   Cache key + I/O
// ============================================================
function cacheKey(method: string, url: string, headers: Record<string, string>): string {
  // We exclude User-Agent from the cache key on purpose — otherwise version
  // bumps and PENSMITH_CONTACT_EMAIL changes would invalidate every cached
  // body. The body is API-supplied and does not depend on those headers.
  //
  // SRC-06 (D-19-10): secrets never shape a cache key. The secret query
  // parameters (api_key, apikey, key, token, access_token), the contact
  // parameters (mailto, email) and every SENSITIVE_HEADERS entry (Authorization,
  // x-api-key, Zotero-API-Key, cookies …) are left out, so a keyed and a keyless
  // request for the same resource share one cache entry, and a key never
  // influences which file a response lands in.
  const filtered: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'user-agent' || SENSITIVE_HEADERS.has(lk)) continue;
    filtered.push([lk, v]);
  }
  filtered.sort(([a], [b]) => a.localeCompare(b));
  const headerStr = filtered.map(([k, v]) => `${k}:${v}`).join('|');
  return createHash('sha256').update(`${method}:${cacheKeyUrl(url)}:${headerStr}`).digest('hex').slice(0, 16);
}

/** The URL a cache key hashes: secret and contact query parameters removed (order kept). */
function cacheKeyUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const kept = [...u.searchParams.entries()].filter(([k]) => {
    const lk = k.toLowerCase();
    return !SECRET_QUERY_PARAMS.has(lk) && !CONTACT_QUERY_PARAMS.has(lk);
  });
  const q = new URLSearchParams(kept).toString();
  u.username = '';
  u.password = '';
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
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
/**
 * Transient statuses fetch() retries (5 attempts, full-jitter backoff, the
 * server's Retry-After honoured up to RETRY_AFTER_CAP_MS). 529 is Anthropic's
 * `overloaded_error` — a routine, momentary condition the official SDKs retry.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504, 529]);

/** True when fetch() retried a response with this status before giving up (callers word errors by it). */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

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
  /**
   * Where an ENABLED local service listens in this test (a loopback test
   * server's origin instead of 127.0.0.1:23119). The environment still has to
   * enable the service; the origin and loopback rules still apply.
   */
  readonly localServiceOrigins?: Partial<Record<LocalService, string>>;
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
  prefixBytes?: number,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const prefix = prefixBytes !== undefined && Number.isFinite(prefixBytes) && prefixBytes > 0 ? Math.floor(prefixBytes) : null;
  if (prefix === null && declaredLength !== null && declaredLength > maxBytes) {
    body.destroy?.();
    throw new ResponseTooLargeError(maxBytes, requestLabel);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (prefix !== null && total + buf.length >= prefix) {
      // Enough: keep the prefix and close the connection (FetchOptions.prefixBytes).
      chunks.push(buf.subarray(0, prefix - total));
      const more = total + buf.length > prefix;
      total = prefix;
      body.destroy?.();
      return { bytes: Buffer.concat(chunks, total), truncated: more || declaredLength === null || declaredLength > prefix };
    }
    total += buf.length;
    if (total > maxBytes) {
      body.destroy?.();
      throw new ResponseTooLargeError(maxBytes, requestLabel);
    }
    chunks.push(buf);
  }
  return { bytes: Buffer.concat(chunks, total), truncated: false };
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
    } else if (method === 'POST' && Buffer.isBuffer(body)) {
      // A binary upload (a PDF to a local GROBID server): its size, never its bytes.
      lines.push(`[show-prompts] body: ${body.length} bytes (binary)`);
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
  // One handle per (paper root, data dir): the 'auto' scope resolves the log file
  // when the handle opens (.paper/SESSION.log of the resolved paper — RUN-14's
  // projectRoot(), never the raw cwd — else the global session.log).
  const cwd = projectRoot();
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
      ...(r.error !== undefined ? { error: scrubContactEmail(r.error) } : {}),
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

/**
 * Response headers a recorded fixture keeps (never Set-Cookie / Authorization …):
 * the content type, and a redirect hop's `location` (D-19-07) so offline replay
 * can follow the recorded chain.
 */
const RECORD_HEADER_ALLOWLIST: ReadonlySet<string> = new Set(['content-type', 'location']);

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
  /** `base64`: `response` is the base64 of a non-text body (a PDF) — D-19-07. */
  bodyEncoding?: 'base64';
  bodySha256?: string;
  source: HttpSource;
}

/** One request/response of a fetch() call, as the recorder sees it (a redirect chain has several). */
export interface RecordedHop {
  readonly method: 'GET' | 'POST' | 'HEAD';
  readonly url: string;
  readonly body: string | Buffer | undefined;
  readonly requestHeaders: Record<string, string>;
  readonly res: HttpResponse;
}

/** The hops behind a live response that came through redirects (read by recordFixture). */
const RESPONSE_CHAINS = new WeakMap<HttpResponse, readonly RecordedHop[]>();

const recordedFixtures: RecordedFixture[] = [];

/** Content types whose body is recorded as text (anything else is base64). */
const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml)\b|application\/(?:javascript|x-www-form-urlencoded)\b)/i;

/** True when `bytes` is valid UTF-8 (a lossless text recording). */
function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The values a recording must never contain: every sensitive request header
 * value and every secret query parameter value of the request (a service can
 * echo them — Zotero's /keys/current answers with the key itself).
 */
function secretValues(url: string, requestHeaders: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase()) && v.length >= 6) {
      out.add(v);
      const bearer = /^bearer\s+(.+)$/i.exec(v);
      if (bearer?.[1]) out.add(bearer[1]);
    }
  }
  try {
    for (const [k, v] of new URL(url).searchParams.entries()) {
      if (SECRET_QUERY_PARAMS.has(k.toLowerCase()) && v.length >= 6) out.add(v);
    }
  } catch {
    /* an unparseable URL carries no parameters */
  }
  return [...out];
}

function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('REDACTED');
  return out;
}

/**
 * The recorded-fixture entry for one hop (pure; the recorder hook pushes it):
 * only allowlisted response headers (content-type, location); a non-text body
 * base64-encoded with `bodyEncoding` (D-19-07); JSON bodies parsed; every
 * secret the request carried (sensitive header values, secret query values)
 * removed from the stored body and Location; the path without the scrubbed
 * query parameters (contact and secret ones).
 */
export function fixtureEntryFor(hop: RecordedHop, source: HttpSource): RecordedFixture {
  const { method, url, body, res } = hop;
  const u = new URL(url);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    const lk = k.toLowerCase();
    if (RECORD_HEADER_ALLOWLIST.has(lk) && !SENSITIVE_HEADERS.has(lk)) headers[lk] = v;
  }
  const secrets = secretValues(url, hop.requestHeaders);
  if (headers['location'] !== undefined) headers['location'] = scrubSecrets(headers['location'], secrets);
  const bytes = res.bodyBytes ?? Buffer.from(res.body, 'utf8');
  const contentType = headers['content-type'] ?? '';
  const asText = bytes.length === 0 || ((contentType === '' || TEXT_CONTENT_TYPE.test(contentType)) && isUtf8(bytes));
  let response: unknown;
  let bodyEncoding: 'base64' | undefined;
  if (!asText) {
    // A non-text body (a PDF): stored as base64 so replay returns the exact bytes.
    response = bytes.toString('base64');
    bodyEncoding = 'base64';
  } else {
    const text = scrubSecrets(bytes.toString('utf8'), secrets);
    response = text;
    if (contentType.includes('json')) {
      try {
        response = JSON.parse(text);
      } catch {
        response = text;
      }
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
    ...(bodyEncoding !== undefined ? { bodyEncoding } : {}),
  };
  if (body !== undefined && method === 'POST') {
    entry.bodySha256 = createHash('sha256').update(body).digest('hex');
  }
  return entry;
}

function pushFixture(hop: RecordedHop, source: HttpSource): void {
  recordedFixtures.push(fixtureEntryFor(hop, source));
}

/**
 * Buffer the recording of one fetch() call: one entry per hop when the answer
 * came through redirects (each hop under its own URL, the 3xx with its
 * `location`), else one entry for the request.
 */
function recordFixture(
  method: 'GET' | 'POST' | 'HEAD',
  url: string,
  body: string | Buffer | undefined,
  source: HttpSource,
  res: HttpResponse,
): void {
  const chain = RESPONSE_CHAINS.get(res);
  if (chain !== undefined) {
    for (const hop of chain) pushFixture(hop, source);
    return;
  }
  pushFixture({ method, url, body, requestHeaders: {}, res }, source);
}

/** Drain the fixtures recorded so far (scripts/refresh-cassettes.mjs). */
export function takeRecordedFixtures(): RecordedFixture[] {
  return recordedFixtures.splice(0, recordedFixtures.length);
}

// ============================================================
//   Redirects (SRC-01, D-19-06, D-19-07)
// ============================================================

/** The statuses http.ts follows (for GET and HEAD). 300 and 304 are answers, not redirects. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Redirects followed per request; the next one is RedirectError('too-many'). */
export const MAX_REDIRECTS = 5;

interface RedirectHop {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'HEAD';
}

function hrefWithoutHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Request headers minus every credential (SENSITIVE_HEADERS: Authorization, x-api-key, Zotero-API-Key, cookies …). */
function withoutSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (!SENSITIVE_HEADERS.has(k.toLowerCase())) out[k] = v;
  return out;
}

/** Request headers minus those that describe a request body (a 303 turns the request into a bodiless GET). */
function withoutBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk !== 'content-type' && lk !== 'content-length' && lk !== 'content-encoding') out[k] = v;
  }
  return out;
}

/**
 * Where a response redirects the request, or null when it is an answer to
 * return (not a redirect status, or a POST's 3xx, which is returned as-is).
 * Throws RedirectError for a model request's redirect (`not-followed`), a
 * missing or unusable Location (`no-location`), https → http (`downgrade`), a
 * redirect beyond MAX_REDIRECTS (`too-many`) and a revisited URL (`loop`). The
 * target's scheme, address and pin are checked when it is requested, like any
 * other URL.
 */
function redirectTarget(
  res: { status: number; headers: Record<string, string> },
  fromUrl: string,
  method: 'GET' | 'POST' | 'HEAD',
  redirects: number,
  visited: ReadonlySet<string>,
  llm: boolean,
): RedirectHop | null {
  if (!REDIRECT_STATUSES.has(res.status)) return null;
  const from = redactUrl(fromUrl, { dropContact: true });
  if (llm) {
    throw new RedirectError('not-followed', from, `the model endpoint answered HTTP ${res.status} at ${from} — a model request never follows a redirect`);
  }
  if (method === 'POST') return null;
  const location = (res.headers['location'] ?? '').trim();
  if (location === '') {
    throw new RedirectError('no-location', from, `HTTP ${res.status} from ${from} has no Location header`);
  }
  let target: URL;
  try {
    target = new URL(location, fromUrl);
  } catch {
    throw new RedirectError('no-location', from, `HTTP ${res.status} from ${from} has an unusable Location header`);
  }
  target.hash = '';
  const to = redactUrl(target.href, { dropContact: true });
  if (new URL(fromUrl).protocol === 'https:' && target.protocol === 'http:') {
    throw new RedirectError('downgrade', from, `${from} redirects to ${to} (https to http is never followed)`);
  }
  if (redirects >= MAX_REDIRECTS) {
    throw new RedirectError('too-many', from, `more than ${MAX_REDIRECTS} redirects (the last from ${from} to ${to})`);
  }
  if (visited.has(target.href)) {
    throw new RedirectError('loop', from, `${from} redirects back to ${to} (a redirect loop)`);
  }
  const nextMethod = res.status === 303 && method !== 'HEAD' ? 'GET' : method;
  return { url: target.href, method: nextMethod };
}

/**
 * A recorded redirect hop's target, checked without DNS (offline opens no
 * socket): an allowed scheme, and never a private / reserved IP literal.
 */
function assertReplayHopAllowed(url: string): void {
  const parsed = parseHttpUrl(url);
  const host = bareHost(parsed);
  if (isIP(host) !== 0 && isPrivateIp(host)) {
    throw new SsrfBlockedError(`SSRF guard: "${host}" is a private/reserved IP — blocked (RFC1918/loopback/link-local)`);
  }
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
  // Error messages carry this label, and SESSION.log stores them: the contact
  // email is dropped here as it is from the logged url (PRIVACY.md).
  const label = `${method} ${redactUrl(url, { dropContact: true })}`;
  const started = Date.now();
  const mode: NetworkMode = networkMode();
  const base = { source, method, url, offline: mode.sourcesOffline, ...(llm !== undefined ? { llm: true } : {}) };

  const refuse = (err: Error, at: string = url, how: string = method): never => {
    recordHttp({ ...base, url: at, method: how, status: null, cache: 'refused', bytes: 0, ms: Date.now() - started, error: err.message });
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
    // --show-prompts lists what the run would have sent. A recorded redirect
    // is followed hop by hop through the same store under the same rules as a
    // live chain (D-19-07); a fixture answer never touches the host state.
    let hopUrl = url;
    let hopMethod = method;
    let hopBody = opts.body;
    const visited = new Set<string>([hrefWithoutHash(url)]);
    for (let redirects = 0; ; redirects += 1) {
      const hopStarted = Date.now();
      const hopLabel = `${hopMethod} ${redactUrl(hopUrl, { dropContact: true })}`;
      const hit = lookupFixture(hopMethod, hopUrl, hopBody);
      if (!hit) {
        refuse(new OfflineEgressError('offline', mode.reason ?? 'offline', hopLabel,
          `offline: no recorded fixture for ${hopLabel} — re-run online`), hopUrl, hopMethod);
      }
      const fx = hit as NonNullable<typeof hit>;
      mirrorRequest(hopMethod, hopUrl, hopBody, false);
      let next: RedirectHop | null = null;
      try {
        next = opts.followRedirects === false ? null : redirectTarget(fx, hopUrl, hopMethod, redirects, visited, false);
        if (next !== null) assertReplayHopAllowed(next.url);
      } catch (e) {
        refuse(e as Error, hopUrl, hopMethod);
      }
      const bytes = fx.bodyBytes;
      if (next === null) {
        const prefix = opts.prefixBytes !== undefined && opts.prefixBytes > 0 ? Math.floor(opts.prefixBytes) : null;
        if (prefix === null && bytes.length > maxBytes) refuse(new ResponseTooLargeError(maxBytes, hopLabel), hopUrl, hopMethod);
        const cut = prefix !== null && bytes.length > prefix ? bytes.subarray(0, prefix) : bytes;
        recordHttp({ ...base, url: hopUrl, method: hopMethod, status: fx.status, cache: 'fixture', bytes: cut.length, ms: Date.now() - hopStarted });
        return {
          status: fx.status,
          headers: fx.headers,
          body: cut === bytes ? fx.body : cut.toString('utf8'),
          bodyBytes: cut,
          cached: false,
          fixture: true,
          ...(cut !== bytes ? { truncated: true } : {}),
          ...(hopUrl !== url ? { finalUrl: hopUrl } : {}),
        };
      }
      recordHttp({ ...base, url: hopUrl, method: hopMethod, status: fx.status, cache: 'fixture', bytes: bytes.length, ms: Date.now() - hopStarted });
      visited.add(next.url);
      if (next.method !== hopMethod) {
        hopMethod = next.method;
        hopBody = undefined;
      }
      hopUrl = next.url;
    }
  }

  // --- Cache short-circuit (live mode, GET only, opt-in) ---
  const cacheAllowed = !mode.sourcesOffline && method === 'GET' && !opts.noCache && llm === undefined && opts.prefixBytes === undefined;
  if (cacheAllowed) {
    const cached = await readCache(key, ttlMs);
    if (cached) {
      recordHttp({ ...base, status: cached.status, cache: 'hit', bytes: Buffer.byteLength(cached.body, 'utf8'), ms: Date.now() - started });
      return cached;
    }
  }

  // --- 2..6, once per hop: host gate, resolve + validate, pin, mirror, capped
  // stream. A redirect is followed by http.ts itself (SRC-01, D-19-06): every
  // hop is a fresh request through this same function. ---
  const mirroredHops = new Set<string>();
  const localService = opts.localService;
  let hops: RecordedHop[] = [];
  // The host that gave the latest live (non-model) answer: a request that
  // ends throttled is one breaker strike against it (noteRequestThrottled).
  let lastHost: HostState | null = null;

  const hopOnce = async (
    hopUrl: string,
    hopMethod: 'GET' | 'POST' | 'HEAD',
    hopHeaders: Record<string, string>,
    hopBody: string | Buffer | undefined,
    polite: boolean,
  ): Promise<HttpResponse> => {
    const seams = activeSeams();
    const mock = installedMockAgent();
    const resolver: Resolver = seams?.resolve ?? (mock !== null ? mockAgentResolver : defaultResolver);
    const parsed = parseHttpUrl(hopUrl);
    const host = bareHost(parsed);
    const hopLabel = `${hopMethod} ${redactUrl(hopUrl, { dropContact: true })}`;
    const st = hostStateFor(parsed.host.toLowerCase(), host.toLowerCase(), source);
    // Exhausted host / open breaker: refused here, before DNS or any socket.
    await enterHost(st, llm !== undefined, timeoutMs);
    let answered = false;
    try {
      let addrs: ResolvedAddress[];
      if (llm !== undefined) {
        addrs = await checkLlmEndpoint(hopUrl, llm.endpoint, resolver);
        if (mode.sourcesOffline && !addrs.every((a) => isLoopbackIp(a.address))) {
          // Sources offline: the ONLY socket allowed is the configured LOOPBACK
          // LLM endpoint (RUN-04) — e.g. the RUN-21 mock under the test runner.
          throw new OfflineEgressError('offline', mode.reason ?? 'offline', hopLabel,
            `offline: only a loopback LLM endpoint may be dialed while sources are offline (${hopLabel})`);
        }
      } else if (localService !== undefined) {
        addrs = await checkLocalService(hopUrl, localService, resolver);
      } else {
        // No trusted-source bypass anywhere (D-19-06): an OA link, a URL from a
        // paper, a redirect target — every hop is resolved and validated.
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

      // --- 4. Mirror before any byte leaves (once per hop URL, not per retry) ---
      if (!mirroredHops.has(`${hopMethod} ${hopUrl}`)) {
        mirroredHops.add(`${hopMethod} ${hopUrl}`);
        mirrorRequest(hopMethod, hopUrl, hopBody, llm !== undefined);
      }

      let res: HttpResponse;
      try {
        const reqInit = {
          method: hopMethod,
          headers: { 'user-agent': userAgent(source, llm !== undefined, polite), ...hopHeaders },
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          dispatcher,
          // SEC-01 / SRC-01: undici never follows a redirect — the loop in
          // attempt() does, re-validating and re-pinning every hop.
          // tests/ssrf-pinning.test.ts fails if this changes.
          maxRedirections: 0,
          ...(hopBody !== undefined ? { body: hopBody } : {}),
        } as Parameters<typeof request>[1];
        const { statusCode, headers: rh, body } = await request(hopUrl, reqInit);
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
        // A redirect hop's body is never the answer: only the final hop is
        // cut to the prefix (it is the one the caller reads).
        const isRedirect = statusCode >= 300 && statusCode < 400;
        const read = await readCapped(
          body as unknown as AsyncIterable<Buffer> & { destroy?: (err?: Error) => void },
          maxBytes,
          hopLabel,
          Number.isFinite(declared) && flatHeaders['content-length'] !== '' ? declared : null,
          isRedirect ? undefined : opts.prefixBytes,
        );
        const bodyBytes = read.bytes;
        res = {
          status: statusCode,
          headers: flatHeaders,
          body: bodyBytes.toString('utf8'),
          bodyBytes,
          cached: false,
          ...(read.truncated ? { truncated: true } : {}),
        };
      } finally {
        if (pinned !== null) await pinned.destroy().catch(() => undefined);
      }
      answered = true;
      // SRC-17: rate headers, Backoff, the 429 hold, the exhausted marker and the breaker.
      if (llm === undefined) {
        lastHost = st;
        noteHostResponse(st, res.status, res.headers, RETRYABLE_STATUSES.has(res.status) ? res.body : '');
      }
      return res;
    } finally {
      if (!answered) hostNoAnswer(st);
    }
  };

  // --- One attempt: the request plus the redirects it is answered with ---
  const attempt = async (): Promise<HttpResponse> => {
    hops = [];
    let hopUrl = url;
    let hopMethod = method;
    let hopBody = opts.body;
    let hopHeaders = headers;
    const startOrigin = originOf(url);
    const visited = new Set<string>([hrefWithoutHash(url)]);
    for (let redirects = 0; ; redirects += 1) {
      const hopStarted = Date.now();
      const res = await hopOnce(hopUrl, hopMethod, hopHeaders, hopBody, originOf(hopUrl) === startOrigin);
      hops.push({ method: hopMethod, url: hopUrl, body: hopBody, requestHeaders: hopHeaders, res });
      const next =
        opts.followRedirects === false && llm === undefined
          ? null
          : redirectTarget(res, hopUrl, hopMethod, redirects, visited, llm !== undefined);
      if (next === null) return hopUrl === url ? res : { ...res, finalUrl: hopUrl };
      // Each hop gets its own kind:"http" record (the final answer's is below).
      recordHttp({
        ...base,
        url: hopUrl,
        method: hopMethod,
        status: res.status,
        cache: 'miss',
        bytes: res.bodyBytes?.length ?? 0,
        ms: Date.now() - hopStarted,
      });
      visited.add(next.url);
      // A hop to another origin never carries credentials (D-19-06).
      if (originOf(next.url) !== originOf(hopUrl)) hopHeaders = withoutSensitiveHeaders(hopHeaders);
      if (next.method !== hopMethod) {
        // 303 See Other: the next request is a GET without a body.
        hopMethod = next.method;
        hopBody = undefined;
        hopHeaders = withoutBodyHeaders(hopHeaders);
      }
      hopUrl = next.url;
    }
  };

  // --- Optional retry wrap ---
  // serverRetryDelay captures the parsed Retry-After header from the most-recent
  // retryable response. On the next attempt, we sleep for this duration BEFORE
  // re-acquiring the rate bucket + dispatching — honoring the server's request
  // on top of the existing fullJitter backoff (per ARCH-13 / D-01). A longer
  // Retry-After never gets here: the host is marked exhausted instead (SRC-17).
  let serverRetryDelay = 0;
  const wrapped = async (): Promise<HttpResponse> => {
    if (serverRetryDelay > 0) {
      // Server asked us to wait — honor it (already capped, audit #22) before the
      // next attempt.
      const delay = serverRetryDelay;
      serverRetryDelay = 0;
      await sleepMs(delay);
    }
    const r = await attempt();
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

  // A request whose last answer is still a 429 — after its retries, or with
  // noRetry — is one strike against that host (SRC-17, review round 3); the
  // strike that opens the breaker surfaces as the CircuitOpenError.
  const endedThrottled = (status: number | undefined): CircuitOpenError | null =>
    status === 429 && lastHost !== null ? noteRequestThrottled(lastHost) : null;

  let response: HttpResponse;
  try {
    response = opts.noRetry
      ? await attempt()
      : await retry(wrapped, {
          maxAttempts: 5,
          baseMs: 200,
          capMs: 30_000,
          retryOn: (err) => {
            // The host said stop (exhausted / breaker open) or the redirect
            // chain was refused: retrying cannot change the answer.
            if (isHostUnavailableError(err) || err instanceof RedirectError) return false;
            const e = err as { status?: number; code?: string } | null;
            if (!e) return false;
            if (typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status)) return true;
            if (typeof e.code === 'string' && RETRYABLE_ERR_CODES.has(e.code)) return true;
            return false;
          },
        });
    const opened = endedThrottled(response.status);
    if (opened !== null) throw opened;
  } catch (caught) {
    const opened = caught instanceof CircuitOpenError ? null : endedThrottled((caught as { status?: number } | null)?.status);
    const err: unknown = opened ?? caught;
    const e = err as Error & { status?: number };
    const refused =
      err instanceof OfflineEgressError ||
      err instanceof SsrfBlockedError ||
      err instanceof RedirectError ||
      isHostUnavailableError(err);
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

  // The recorder writes one entry per hop, each under its own URL (D-19-07).
  RESPONSE_CHAINS.set(response, hops);
  recordHttp({ ...base, url: response.finalUrl ?? url, status: response.status, cache: 'miss', bytes: response.bodyBytes?.length ?? 0, ms: Date.now() - started });

  // --- Phase 19 seam S-B (SRC-17): a body that is not the service's answer is
  // never cached and never recorded — the caller's schema check (validate), or
  // an API error document served with HTTP 200 ---
  const invalid = llm === undefined ? (opts.validate?.(response) ?? recordedErrorBody(response.status, response.body)) : null;

  // --- Recorder hook (http-mock.ts isRecordingEnabled: live, outside a test context) ---
  if (llm === undefined && invalid === null && isRecordingEnabled()) {
    recordFixture(method, url, opts.body, source, response);
  }

  // --- Cache write (live GET, success or definite 404) ---
  if (cacheAllowed && invalid === null && (response.status === 200 || response.status === 404)) {
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
