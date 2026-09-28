// bin/lib/sources/index.ts — typed adapter registry (RSCH-03/04, T-3-13).
//
// Re-exports all 7 source adapters under a single typed const. Downstream
// consumers (the research orchestrator, the verifier's retraction filter)
// import `sources` and iterate `AdapterName`.
//
// IMPORTANT: 'retraction-watch' (D-15 LOCKED) exposes `fetchById` ONLY —
// the registry surface for that key intentionally omits `search`. Consumers
// that iterate the registry generically MUST guard with `if ('search' in
// adapter)` before calling.

import * as crossref from './crossref.js';
import * as openalex from './openalex.js';
import * as arxiv from './arxiv.js';
import * as pubmed from './pubmed.js';
import * as semanticscholar from './semanticscholar.js';
import * as unpaywall from './unpaywall.js';
import * as retractionWatch from './retraction-watch.js';
import * as zotero from './zotero.js';

export const sources = {
  crossref,
  openalex,
  arxiv,
  pubmed,
  semanticscholar,
  unpaywall,
  'retraction-watch': retractionWatch,
  // SRC-16 (D-19-24): the user's Zotero library through the Zotero Web API
  // (ZOTERO_API_KEY) or the Zotero 7 local API (PENSMITH_ZOTERO_LOCAL=1) —
  // registry key `zotero` (was `zotero-mcp`). Not configured → search()
  // returns [] without a request. Tier 1 reaches Zotero through the user's
  // Zotero MCP server and the paper_ingest_zotero_items tool instead.
  zotero,
} as const;

export type AdapterName = keyof typeof sources;
