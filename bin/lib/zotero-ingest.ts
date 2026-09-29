// bin/lib/zotero-ingest.ts — Zotero items into the paper's library, for both
// tiers (SRC-16, D-19-24).
//
//   Tier 1: Claude reads the user's Zotero through their own Zotero MCP server
//           and submits the items to the MCP tool `paper_ingest_zotero_items`
//           (mcp/tools.ts, a thin shim) → ingestZoteroItems().
//   Tier 2: bin/lib/sources/zotero.ts pulls them from the Zotero Web API or
//           the Zotero 7 local API → pullZoteroIntoLibrary().
//
// Both paths: validate every item (zod, sources/zotero-mcp.ts — ONE malformed
// item rejects the whole batch with its schema error, and nothing is written),
// normalize (creators → authors / editors, itemType → type, DOI, ISBN, arXiv /
// PMID from `extra`, venue, volume, issue, pages, publisher, the zotero ref),
// upsert through the one library writer with provenance `zotero` (so the entry
// is tagged zotero in RESEARCH.md, and an item whose DOI is already in the
// library merges into that entry), then refresh RESEARCH.md's sources block.
// Notes, attachments, annotations and title-less items are skipped with a
// reason, never silently.
//
// No network happens here for Tier 1: the items arrive as data. The paper must
// already exist (a .paper/ folder) — ingest never creates a paper.
//
// A collection named by the paper's `[sources] zotero_collection` is the
// READER's material (own-source-approvals.ts): both tiers refuse to add its
// items until the user approved that collection for this paper (review round
// 2). Tier 2 asks at research's `zotero-collection` gate; Tier 1 asks with
// AskUserQuestion and submits `collection` + `approveCollection: true`, which
// records the approval (never inferred from --yolo). Items submitted without
// `collection` are the results of a per-query search of the user's own Zotero.

import { existsSync } from 'node:fs';
import { paperDir } from './paths.js';
import { upsertSources } from './library.js';
import { refreshResearchSources } from './research-md.js';
import { PensmithError, EXIT_USAGE, EXIT_APPROVAL } from './exit-codes.js';
import { isZoteroCollectionApproved, approveZoteroCollection } from './own-source-approvals.js';
import { validateZoteroItem, normalizeZoteroItem, type ZoteroItem, type ZoteroCandidate } from './sources/zotero-mcp.js';
import { pullZoteroItems, itemLibrary, configuredZoteroCollection, type PullOptions } from './sources/zotero.js';

/** The most items one ingest call accepts. */
export const MAX_ZOTERO_INGEST_ITEMS = 1000;

/** A batch with at least one malformed item (usage error: nothing was written). */
export class ZoteroItemsInvalidError extends PensmithError {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    const shown = problems.slice(0, 5).join('; ');
    super(
      `rejected ${problems.length} malformed Zotero item(s); nothing was added: ${shown}${problems.length > 5 ? `; … (${problems.length - 5} more)` : ''}`,
      EXIT_USAGE,
    );
    this.name = 'ZoteroItemsInvalidError';
    this.problems = problems;
  }
}

/** A collection the user has not approved for this paper (exit 3: nothing was read or written). */
export class ZoteroCollectionNotApprovedError extends PensmithError {
  readonly collection: string;
  constructor(collection: string, how: string) {
    super(`[sources] zotero_collection "${collection}" has not been approved for this paper; nothing was added — ${how}`, EXIT_APPROVAL);
    this.name = 'ZoteroCollectionNotApprovedError';
    this.collection = collection;
  }
}

export interface ZoteroSkip {
  readonly index: number;
  readonly key: string;
  readonly reason: string;
}

export interface ZoteroIngestResult {
  /** Citekeys of new LIBRARY.json entries. */
  readonly added: string[];
  /** Citekeys of existing entries the items merged into (e.g. the same DOI). */
  readonly merged: string[];
  /** Citekeys of existing entries the items did not change. */
  readonly unchanged: string[];
  /** Items that are not works (notes, attachments …) or have no title. */
  readonly skipped: ZoteroSkip[];
  /** Entries in LIBRARY.json afterwards. */
  readonly entries: number;
  /** Whether RESEARCH.md's sources block changed. */
  readonly researchMdChanged: boolean;
}

function skipReason(item: ZoteroItem): string {
  const t = item.data.itemType;
  if (t === 'note' || t === 'attachment' || t === 'annotation') return `a Zotero ${t}, not a citable work`;
  return 'the item has no title';
}

async function ingestValidated(root: string, items: readonly ZoteroItem[], library: (item: ZoteroItem) => string): Promise<ZoteroIngestResult> {
  const candidates: ZoteroCandidate[] = [];
  const skipped: ZoteroSkip[] = [];
  items.forEach((item, index) => {
    const c = normalizeZoteroItem(item, library(item));
    if (c === null) skipped.push({ index, key: item.data.key, reason: skipReason(item) });
    else candidates.push(c);
  });
  const added: string[] = [];
  const merged: string[] = [];
  const unchanged: string[] = [];
  let entries = 0;
  if (candidates.length > 0) {
    const res = await upsertSources(root, candidates, { provenance: 'zotero' });
    for (const o of res.outcomes) (o.status === 'added' ? added : o.status === 'merged' ? merged : unchanged).push(o.citekey);
    entries = res.library.entries.length;
  }
  const refresh = await refreshResearchSources(root);
  if (candidates.length === 0) entries = refresh.count;
  return { added, merged, unchanged, skipped, entries, researchMdChanged: refresh.changed };
}

function assertPaper(root: string): void {
  if (!existsSync(paperDir(root))) {
    throw new PensmithError(`no paper at ${root} (no .paper/ folder) — create one with \`pensmith new\` first`, EXIT_USAGE);
  }
}

export interface ZoteroIngestOptions {
  /** The ref for items that do not name their library (default `local`). */
  readonly library?: string;
  /** The collection the items were read from (`[sources] zotero_collection`); absent for per-query search results. */
  readonly collection?: string;
  /** The user approved `collection` for this paper just now (AskUserQuestion): record it. */
  readonly approveCollection?: boolean;
}

/**
 * Tier 1: ingest items a Zotero MCP server returned (full Zotero API items or
 * their `data` objects). Throws ZoteroItemsInvalidError (exit 2) naming each
 * malformed item's field — and writes nothing — when any item is malformed,
 * and ZoteroCollectionNotApprovedError (exit 3) for items of a collection the
 * user has not approved for this paper (see the header).
 */
export async function ingestZoteroItems(root: string, rawItems: readonly unknown[], opts: ZoteroIngestOptions = {}): Promise<ZoteroIngestResult> {
  assertPaper(root);
  const collection = opts.collection?.trim();
  if (collection && !isZoteroCollectionApproved(root, collection) && opts.approveCollection !== true) {
    throw new ZoteroCollectionNotApprovedError(
      collection,
      'ask the user whether to add that collection of their Zotero library to this paper, and on yes submit the items again with approveCollection: true',
    );
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new ZoteroItemsInvalidError(['items: expected at least one Zotero item']);
  if (rawItems.length > MAX_ZOTERO_INGEST_ITEMS) {
    throw new ZoteroItemsInvalidError([`items: at most ${MAX_ZOTERO_INGEST_ITEMS} items per call, got ${rawItems.length}`]);
  }
  const items: ZoteroItem[] = [];
  const problems: string[] = [];
  rawItems.forEach((raw, i) => {
    const v = validateZoteroItem(raw, `items[${i}]`);
    if (v.ok) items.push(v.item);
    else problems.push(v.error);
  });
  if (problems.length > 0) throw new ZoteroItemsInvalidError(problems);
  if (collection && opts.approveCollection === true) await approveZoteroCollection(root, collection);
  const fallback = opts.library ?? 'local';
  return ingestValidated(root, items, () => fallback);
}

export interface ZoteroPullResult extends ZoteroIngestResult {
  /** The library read (`users/<id>`, `groups/<id>` or `local`). */
  readonly library: string;
  /** The collection read, or null for the whole library. */
  readonly collection: string | null;
  /** Items the service returned that failed validation (reported, not ingested). */
  readonly invalid: string[];
}

/**
 * Tier 2: pull the configured collection (`[sources] zotero_collection`, or
 * the whole library) through the Zotero Web / local API and ingest it. Throws
 * sources/zotero.ts ZoteroError (one line) or OfflineEgressError, and
 * ZoteroCollectionNotApprovedError — before any request — for a collection the
 * user has not approved for this paper (research asks first).
 */
export async function pullZoteroIntoLibrary(root: string, opts: Omit<PullOptions, 'root'> = {}): Promise<ZoteroPullResult> {
  assertPaper(root);
  const collection = opts.collection === undefined ? configuredZoteroCollection(root) : opts.collection;
  if (collection !== null && !isZoteroCollectionApproved(root, collection)) {
    throw new ZoteroCollectionNotApprovedError(collection, 'approve it by running pensmith research in a terminal');
  }
  const pull = await pullZoteroItems({ ...opts, collection, root });
  const result = await ingestValidated(root, pull.items, (item) => itemLibrary(item, pull.library));
  return { ...result, library: pull.library, collection: pull.collection, invalid: pull.invalid };
}
