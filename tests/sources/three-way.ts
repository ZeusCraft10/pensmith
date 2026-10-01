// tests/sources/three-way.ts — the three-way lookup contract every registrar
// adapter must meet (SRC-05, D-19-05). Shared by the per-adapter tests (not a
// test file itself).
//
// For one adapter it registers node:test cases that drive the REAL adapter
// through the egress gate against an in-process MockAgent (the test-lane live
// seam, PENSMITH_NETWORK_TESTS=1 for the duration of a case):
//   - a registrar record                 → found, with the adapter's parse checked;
//   - HTTP 404                           → not-found (and fetchById → null);
//   - a 200 that is not the service's answer (an error document, a wrong shape)
//                                        → failed, NOT cached (the HTTP cache
//                                          directory is unchanged and the next
//                                          identical request reaches the network);
//   - the transport refusing the host (rate-limit budget exhausted, circuit
//     breaker open)                      → failed with the adapter's reason, and
//                                          fetchById throws SourceLookupError;
//   - HTTP 503 after the transport's retries → failed (never not-found);
//   - offline with no recorded fixture   → the typed OfflineEgressError;
//   - idFor gives every token its own identifier (checked, not assumed).
//
// The HTTP cache is one directory for the whole `npm test` run (every test file,
// every case), and http.ts keeps a 404 there for an hour (WR-07). So every case
// asks for an identifier no other case of the run asks for: distinct tokens
// (uniq) must map to distinct identifiers. An adapter whose identifier carries
// the token (a DOI) gets that for free; one whose identifier is a few digits
// (an arXiv id, a PMID) builds it from idDigits, never from a hash of the token.
// CI run 72 (ubuntu, Node 22): the arXiv idFor hashed the token into 100 000
// ids, and the 404 case's `missing-…-3` and the invalid case's `invalid-…-4`
// (equal-length tags, read one arXiv rate interval, ~3.16 s, apart) fell on one
// id for a few percent of clock readings with a five-digit pid, so the invalid
// case was answered by the 404 the previous case had just cached.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installMockAgent } from '../helpers/local-servers/mock-agent.js';
import {
  _resetBucketsForTest,
  RateLimitExhaustedError,
  CircuitOpenError,
  type HttpResponse,
} from '../../bin/lib/http.js';
import * as httpModule from '../../bin/lib/http.js';
import { _setPlagiarismPacingForTest } from '../../bin/lib/plagiarism.js';
import { pensmithHttpCacheDir } from '../../bin/lib/paths.js';
import { __setRegistrarSendForTest } from '../../bin/lib/sources/registrar-response.js';
import { isSourceLookupError, type LookupResult } from '../../bin/lib/sources/lookup.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';
import { assertOfflineMiss } from './recorded.js';

type MockAgentT = ReturnType<typeof installMockAgent>['agent'];

/**
 * Forget the transport's per-host state between cases: its rate buckets, and —
 * where the transport keeps them (the SRC-17 exhausted-host marker and circuit
 * breaker) — the host-availability records, so one case's 503s never make the
 * next case's host look unavailable.
 */
function resetTransportState(): void {
  _resetBucketsForTest();
  const hostReset = (httpModule as Record<string, unknown>)['_resetHostStateForTest'];
  if (typeof hostReset === 'function') (hostReset as () => void)();
}

/** Run `fn` in the test-lane live seam with a fresh MockAgent (and the contact email, when given). */
export async function liveLane<T>(fn: (agent: MockAgentT) => Promise<T>, opts: { contactEmail?: string } = {}): Promise<T> {
  const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
  const savedEmail = process.env['PENSMITH_CONTACT_EMAIL'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  if (opts.contactEmail !== undefined) process.env['PENSMITH_CONTACT_EMAIL'] = opts.contactEmail;
  resetTransportState();
  // The MockAgent answers DuckDuckGo at once: no live pacing between queries.
  _setPlagiarismPacingForTest({ minGapMs: 0, maxGapMs: 0, backoffMs: 0 });
  const { agent, restore } = installMockAgent();
  try {
    return await fn(agent);
  } finally {
    _setPlagiarismPacingForTest(null);
    await restore();
    if (savedLane === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
    if (savedEmail === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = savedEmail;
  }
}

/** Run `fn` with the contact email set (and restored after). */
export async function withContactEmail<T>(email: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env['PENSMITH_CONTACT_EMAIL'];
  if (email === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
  else process.env['PENSMITH_CONTACT_EMAIL'] = email;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
}

/**
 * The HTTP cache files whose content mentions `marker` (a token the test put in
 * the body it served). The cache directory is shared by every test file of a
 * run, so a test proves "this body was not cached" by looking for its own
 * marker — never by comparing the directory, which other files write to.
 */
export function cacheMentions(marker: string): string[] {
  const dir = pensmithHttpCacheDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => {
    try {
      return readFileSync(join(dir, f), 'utf8').includes(marker);
    } catch {
      return false;
    }
  });
}

let counter = 0;
/** A per-process unique token for identifiers. */
export function uniq(tag: string): string {
  counter += 1;
  return `${tag}-${process.pid}-${Date.now().toString(36)}-${counter}`;
}

/** The largest serial idDigits hands out (its serial field is five digits, the first always 0). */
export const MAX_ID_SERIAL = 9_999;
const serials = new Map<string, number>();

/**
 * Eight decimal digits that belong to `token` alone: this process's pid (mod
 * 1000, three digits), then a five-digit serial — 1, 2, 3 … in the order this
 * process first asks for a token, so two distinct tokens of one process never
 * share digits (a hash folded into this few digits does collide; see the file
 * header). The same token always gets the same digits. For an adapter whose
 * identifier is too short to carry the token itself (an arXiv id, a PMID).
 */
export function idDigits(token: string): string {
  let serial = serials.get(token);
  if (serial === undefined) {
    serial = serials.size + 1;
    if (serial > MAX_ID_SERIAL) throw new Error(`three-way idDigits: more than ${MAX_ID_SERIAL} tokens in one process`);
    serials.set(token, serial);
  }
  return `${String(process.pid % 1000).padStart(3, '0')}${String(serial).padStart(5, '0')}`;
}

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;

export interface ThreeWayCase {
  /** The adapter's name in test titles and SourceLookupError messages (`crossref`). */
  readonly adapter: string;
  readonly lookupById: (id: string) => Promise<LookupResult>;
  readonly fetchById: (id: string) => Promise<SourceCandidate | null>;
  /** The service origin the adapter calls (`https://api.crossref.org`). */
  readonly origin: string;
  /**
   * The identifier a case asks for with `token`: a different one for every
   * distinct token (the contract checks it), so no case is ever answered from
   * the run-wide HTTP cache by what another case stored. Carry the token itself,
   * or build the identifier from idDigits(token).
   */
  readonly idFor: (token: string) => string;
  /** The request path a lookup of idFor(token) makes starts with this (matched on the decoded path). */
  readonly pathPrefixFor: (token: string) => string;
  /** A registrar answer for idFor(token): [status, body, content-type]. */
  readonly found: (token: string) => { body: unknown; contentType?: string };
  /** Checks on the found candidate. */
  readonly checkFound: (c: SourceCandidate, token: string) => void;
  /** A 200 that is not the service's answer, carrying `marker` (so the cache can be searched for it). */
  readonly invalid: (marker: string) => { body: unknown; contentType?: string };
  /** The reason a rate-limit refusal reads with (keyless, where it matters). */
  readonly rateLimitReason?: RegExp;
  /** An identifier with no recorded fixture (offline). */
  readonly offlineMissId: string;
  /** Environment the adapter needs (e.g. Unpaywall's contact email). */
  readonly contactEmail?: string;
}

function decodedPath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function reply(agent: MockAgentT, origin: string, prefix: string, status: number, body: unknown, contentType = 'application/json'): void {
  agent
    .get(origin)
    .intercept({ path: (p: string) => decodedPath(p).startsWith(prefix), method: 'GET' })
    .reply(status, typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': contentType } });
}

/** Register the three-way contract cases for one adapter. */
export function threeWayContract(c: ThreeWayCase): void {
  const lane = <T>(fn: (agent: MockAgentT) => Promise<T>): Promise<T> =>
    liveLane(fn, c.contactEmail !== undefined ? { contactEmail: c.contactEmail } : {});

  test(`${c.adapter}: idFor gives every token its own identifier (no case is answered by what another case cached)`, () => {
    const tokens: string[] = [];
    // The tokens the cases below make: the same tags, the same or the next clock reading.
    for (let i = 0; i < 40; i += 1) {
      for (const tag of ['found', 'missing', 'invalid', 'exhausted', 'breaker', 'down']) tokens.push(uniq(tag));
    }
    // Tokens that differ only in an equal-length tag, the counter and the clock:
    // the 404 case's second token and the invalid case's, read one arXiv rate
    // interval (~3.16 s) apart. The hash-based arXiv idFor sent a few percent of
    // these pairs to one id when the pid had five digits (CI run 72).
    const t0 = Date.parse('2026-09-30T20:03:19.000Z');
    for (const pid of [4821, 20009, 73115]) {
      for (let ms = 0; ms < 50; ms += 1) {
        for (const gap of [3149, 3154, 3158]) {
          tokens.push(`missing-${pid}-${(t0 + ms).toString(36)}-3`, `invalid-${pid}-${(t0 + ms + gap).toString(36)}-4`);
        }
      }
    }
    // The pair that collided (both were arXiv id 2290.20290).
    tokens.push('missing-20009-muoj4pko-3', 'invalid-20009-muoj4s0a-4');
    const owner = new Map<string, string>();
    for (const token of new Set(tokens)) {
      const id = c.idFor(token);
      const other = owner.get(id);
      assert.equal(other, undefined, `${JSON.stringify(token)} and ${JSON.stringify(other)} both ask for ${id}`);
      owner.set(id, token);
      assert.equal(c.idFor(token), id, 'a token always asks for the same identifier');
    }
  });

  test(`${c.adapter}: lookupById → found (a registrar record, parsed)`, async () => {
    await lane(async (agent) => {
      const token = uniq('found');
      const f = c.found(token);
      reply(agent, c.origin, c.pathPrefixFor(token), 200, f.body, f.contentType);
      const r = await c.lookupById(c.idFor(token));
      assert.equal(r.kind, 'found', JSON.stringify(r));
      if (r.kind === 'found') c.checkFound(r.candidate, token);
    });
  });

  test(`${c.adapter}: HTTP 404 → not-found, and fetchById → null`, async () => {
    await lane(async (agent) => {
      const token = uniq('missing');
      reply(agent, c.origin, c.pathPrefixFor(token), 404, 'Resource not found.', 'text/plain');
      const r = await c.lookupById(c.idFor(token));
      assert.equal(r.kind, 'not-found', JSON.stringify(r));
      assert.match(r.kind === 'not-found' ? r.reason : '', /404/);
      const token2 = uniq('missing');
      reply(agent, c.origin, c.pathPrefixFor(token2), 404, 'Resource not found.', 'text/plain');
      assert.equal(await c.fetchById(c.idFor(token2)), null);
    });
  });

  test(`${c.adapter}: a 200 that is not the service's answer → failed, never cached`, async () => {
    await lane(async (agent) => {
      const token = uniq('invalid');
      const bad = c.invalid(`marker-${token}`);
      reply(agent, c.origin, c.pathPrefixFor(token), 200, bad.body, bad.contentType);
      const r = await c.lookupById(c.idFor(token));
      assert.equal(r.kind, 'failed', JSON.stringify(r));
      assert.match(r.kind === 'failed' ? r.reason : '', /^response is not an? .+ answer \(/);
      assert.deepEqual(cacheMentions(`marker-${token}`), [], 'the error body was not cached');
      // The same request again reaches the network (nothing was cached): a real answer now.
      const f = c.found(token);
      reply(agent, c.origin, c.pathPrefixFor(token), 200, f.body, f.contentType);
      const again = await c.lookupById(c.idFor(token));
      assert.equal(again.kind, 'found', JSON.stringify(again));
    });
  });

  test(`${c.adapter}: an exhausted or open-breaker host → failed (fetchById throws SourceLookupError)`, async () => {
    await lane(async () => {
      try {
        __setRegistrarSendForTest(async (): Promise<HttpResponse> => {
          throw new RateLimitExhaustedError(new URL(c.origin).host, 22_400_000, 429);
        });
        const r = await c.lookupById(c.idFor(uniq('exhausted')));
        assert.equal(r.kind, 'failed', JSON.stringify(r));
        if (r.kind === 'failed') {
          assert.match(r.reason, c.rateLimitReason ?? /rate limit exhausted \(retry after ~6 h\)/);
          assert.equal(r.status, 429);
        }
        const id = c.idFor(uniq('exhausted'));
        await assert.rejects(() => c.fetchById(id), (e: unknown) => {
          assert.ok(isSourceLookupError(e), String(e));
          assert.equal(e.source, c.adapter);
          assert.match(e.message, new RegExp(`^${c.adapter} lookup of .+ failed: `));
          return true;
        });

        __setRegistrarSendForTest(async (): Promise<HttpResponse> => {
          throw new CircuitOpenError(new URL(c.origin).host, 503, 3);
        });
        const open = await c.lookupById(c.idFor(uniq('breaker')));
        assert.equal(open.kind, 'failed', JSON.stringify(open));
        assert.match(open.kind === 'failed' ? open.reason : '', /skipped after 3 consecutive HTTP 503 responses/);
      } finally {
        __setRegistrarSendForTest(null);
      }
    });
  });

  test(`RUN-03: ${c.adapter} offline with no recorded fixture → OfflineEgressError (a mode, not an outcome)`, async () => {
    const run = async (): Promise<void> => {
      await assertOfflineMiss(() => c.lookupById(c.offlineMissId), `${c.adapter}.lookupById miss`);
      await assertOfflineMiss(() => c.fetchById(c.offlineMissId), `${c.adapter}.fetchById miss`);
    };
    if (c.contactEmail !== undefined) await withContactEmail(c.contactEmail, run);
    else await run();
  });

  // Last: at the Phase 19 merge the transport's circuit breaker counts these 503s.
  test(`${c.adapter}: HTTP 503 after the transport's retries → failed, never not-found`, async () => {
    await lane(async (agent) => {
      const token = uniq('down');
      agent
        .get(c.origin)
        .intercept({ path: (p: string) => decodedPath(p).startsWith(c.pathPrefixFor(token)), method: 'GET' })
        .reply(503, 'Service Unavailable', JSON_HEADERS)
        .persist();
      const r = await c.lookupById(c.idFor(token));
      assert.equal(r.kind, 'failed', JSON.stringify(r));
      assert.match(r.kind === 'failed' ? r.reason : '', /503/);
      await assert.rejects(() => c.fetchById(c.idFor(token)), (e: unknown) => isSourceLookupError(e));
    });
  });
}
