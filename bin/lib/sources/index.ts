// bin/lib/sources/index.ts — typed adapter registry (RSCH-03/04, T-3-13).
//
// Re-exports the research source adapters under a single typed const. The
// research orchestrator imports `sources` and iterates `AdapterName`.
// Consumers that iterate the registry generically guard with
// `if ('search' in adapter)` before calling.

import * as crossref from './crossref.js';
import * as openalex from './openalex.js';
import * as arxiv from './arxiv.js';
import * as pubmed from './pubmed.js';
import * as semanticscholar from './semanticscholar.js';
import * as unpaywall from './unpaywall.js';
import * as zoteroMcp from './zotero-mcp.js';

export const sources = {
  crossref,
  openalex,
  arxiv,
  pubmed,
  semanticscholar,
  unpaywall,
  // RSCH-06: Zotero MCP source provider. On CI (absent + no client wired)
  // search() safely returns [] (absence-non-breaking, ARCH-03).
  'zotero-mcp': zoteroMcp,
} as const;

export type AdapterName = keyof typeof sources;
