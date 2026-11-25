// bin/lib/sources/zotero-mcp.ts — RSCH-06 Zotero MCP source provider.
//
// Zotero is a SOURCE PROVIDER + DOCTOR PROBE, never a verb (no 17th verb). This
// adapter is the EXECUTABLE "used-as-source" path: when a client is wired AND
// ZOTERO_API_KEY is set, search() PULLS items from the Zotero source and
// NORMALIZES each one to the SAME SourceCandidate shape every other adapter
// returns (source:'zotero-mcp') so they flow into the research pipeline
// (scoring + RSCH-11 retraction cross-check). When no client is wired OR the key
// is unset, search() returns [] so research continues on the other 7 adapters
// (ARCH-03). search() NEVER throws — absence MUST NOT break research. Whether a
// Zotero MCP server is configured on disk is the doctor's question, not this
// adapter's: without a client there is nothing to pull from either way.
//
// Transport reality (RESEARCH §Anti-Patterns; Assumption A4): a real MCP tool
// call is issued from the Tier-1 workflow body (Claude Code Task tool), not from
// inside this Tier-2 adapter process. To make the normalization path EXECUTABLE
// AND TESTED without a live MCP server on CI, the adapter accepts an INJECTABLE
// client (the ZoteroClient interface). In production Tier-1 the workflow body
// (workflows/research.md) wires the real MCP-backed client through
// setZoteroClientForTest; in tests a fake client returns canned raw items. The
// live end-to-end against a real Zotero MCP server is a MANUAL-only item — there
// is NO CI coverage of the transport itself.
//
// CONSTRAINTS:
//   - NO http.ts import — Zotero MCP uses the MCP protocol, not HTTP. Any future
//     Zotero Web API call is a later phase and must go through http.ts then.
//   - NO citation-js import (D-19).
//   - T-01-07 no-leak: ZOTERO_API_KEY is checked as a BOOLEAN only — its value is
//     NEVER logged, persisted, or interpolated into any string.

import { generateCitekey } from '../citekey.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

/**
 * A single Zotero creator. The real MCP payload varies by server, so every
 * field is optional and the normalizer is defensive.
 */
export interface ZoteroCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
}

/**
 * The minimal raw fields the normalizer reads off a Zotero item. Kept optional
 * and defensive — the real MCP item shape varies by server version.
 */
export interface ZoteroItem {
  id?: string;
  key?: string;
  title?: string;
  creators?: ZoteroCreator[];
  authors?: string[];
  date?: string;
  year?: number | string;
  DOI?: string;
  abstractNote?: string;
}

/**
 * The injectable transport seam. In production Tier-1 the research workflow body
 * wires an MCP-backed implementation; in tests a fake returns canned items.
 */
export interface ZoteroClient {
  search(query: string, limit: number): Promise<ZoteroItem[]>;
}

// Module-level injected client. null = no client wired (Tier-2 default, or the
// real Tier-1 path before the workflow body injects).
let _client: ZoteroClient | null = null;

/**
 * Wire the Zotero client. Named *ForTest for parity with _reset*ForTest
 * conventions, but it is ALSO the production injection point: the Tier-1
 * research workflow body (workflows/research.md) calls this to wire the real
 * MCP-backed client. Pass null to clear.
 */
export function setZoteroClientForTest(client: ZoteroClient | null): void {
  _client = client;
}

/**
 * CANONICAL auth predicate — KEY-ONLY, decoupled from FS-presence (H3) so the
 * injected-client CI path is authorizable with just ZOTERO_API_KEY. T-01-07:
 * boolean presence of the env var ONLY — NEVER the value.
 *
 * NOTE: the doctor probe (bin/lib/doctor/probes/zotero-mcp-presence.ts) does NOT
 * call this helper — it composes its own `configured && !!key` check so
 * it can distinguish ABSENT from CONFIGURED_NO_AUTH and report REAL FS+key state.
 */
export function isZoteroAuthenticated(): boolean {
  return !!process.env['ZOTERO_API_KEY'];
}

/**
 * Normalize one raw Zotero item to a SourceCandidate. Mirrors
 * semanticscholar.toCandidate: requires a non-empty id, a non-empty title, and
 * >=1 author; drops the item (returns null) on any missing required field, then
 * the call site .filter()s the nulls out.
 */
function toCandidate(item: ZoteroItem): SourceCandidate | null {
  const id = String(item.id ?? item.key ?? '').trim();
  if (!id) return null;

  const title = String(item.title ?? '').trim();
  if (!title) return null;

  const fromCreators = (item.creators ?? [])
    .map((c) => {
      if (c.name) return String(c.name).trim();
      const parts = [c.firstName, c.lastName].filter(Boolean).map(String);
      return parts.join(' ').trim();
    })
    .filter(Boolean);
  const fromAuthors = (item.authors ?? []).map((a) => String(a).trim()).filter(Boolean);
  const authors = fromCreators.length > 0 ? fromCreators : fromAuthors;
  if (authors.length === 0) return null;

  // Year: prefer a numeric `year`; else parse a 4-digit year out of `date`.
  let year: number | undefined;
  const rawYear =
    typeof item.year === 'number'
      ? item.year
      : item.year !== undefined
        ? Number.parseInt(String(item.year), 10)
        : item.date
          ? Number.parseInt((String(item.date).match(/\d{4}/) ?? [''])[0], 10)
          : NaN;
  if (Number.isInteger(rawYear) && rawYear >= 1800 && rawYear <= 2100) {
    year = rawYear;
  }

  const doi = item.DOI ? String(item.DOI) : undefined;
  const citekey = generateCitekey({ authors, year });

  return {
    source: 'zotero-mcp',
    id,
    doi,
    title,
    authors,
    year,
    abstract: item.abstractNote,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    raw: item,
  };
}

/**
 * Pull + normalize Zotero items into SourceCandidate[].
 *
 * >>> CANONICAL GATE PREDICATE — SINGLE SOURCE OF TRUTH (H3 fix) <<<
 * This is the ONE authoritative definition of the client + auth gating.
 * tests/sources/zotero-mcp.test.ts leg (c) restates this block as its test
 * contract. The three steps below MUST stay in this order.
 *
 * The KEY contract: NEVER throw, ALWAYS return an array; and on the
 * client+authenticated path it ACTUALLY normalizes real items into
 * SourceCandidate[] (the H1 fix).
 */
export async function search(query: string, limit = 10): Promise<SourceCandidate[]> {
  // (1) NO-CLIENT GATE — nothing is wired to pull from (Tier-2 default, or Tier-1
  //     before the workflow body injects one), whatever MCP config is on disk. This
  //     keeps absence non-breaking and makes the (3) _client deref safe.
  if (_client === null) return []; // no client wired → non-breaking []

  // (2) AUTH GATE — the key alone authorizes the pull (H3), so the injected-client
  //     CI path is authorizable with just ZOTERO_API_KEY.
  if (!isZoteroAuthenticated()) return []; // no ZOTERO_API_KEY → skip (Pitfall 6)

  // (3) PULL + NORMALIZE — reached only when a client is wired AND authenticated.
  try {
    const items = await _client.search(query, limit);
    return items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
  } catch {
    return []; // ARCH-03: never throw, always an array
  }
}
