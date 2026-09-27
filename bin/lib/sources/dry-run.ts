// bin/lib/sources/dry-run.ts — the labelled synthetic dry-run source provider
// (RUN-27, D-17-11).
//
// `--dry-run` must reach the end of the pipeline on ANY assignment with zero
// sockets. Cassette replay cannot do that (RUN-03 limits it to exact recorded
// requests), so --dry-run gets its own provider: for any query it returns
// deterministic synthetic sources minted from the packaged corpus
// templates/dry-run/corpus.json (shipped through package.json `files`, never
// under tests/ — RUN-05).
//
// Every source it mints:
//   - carries `synthetic: true` and source 'dry-run';
//   - has a reserved DOI `10.0000/pensmith-dryrun.<8 hex>`;
//   - preprint-kind sources also carry an arXiv-style id `pensmith-dryrun.<8 hex>`,
//     book-kind sources an ISBN-style id `978-0-00-<6 digits>-<check>` with a
//     deliberately INVALID check digit (bin/lib/doi.ts isReservedDryRunId);
//   - is a pure function of its 8-hex id, so fetchById(doi) reconstructs
//     exactly what search() returned (Pass 1 re-fetches it under --dry-run and
//     runs the same title/author AND-gate).
// The 8-hex ids are seeded by sha256 of the query, so the same query always
// yields the same sources.
//
// This provider is used ONLY under --dry-run (research-orchestrator.ts,
// verify/pass1.ts). It is never used for cassette replay, and outside --dry-run
// every reserved identifier it could produce is refused (RUN-27).

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCitekey } from '../citekey.js';
import { DRY_RUN_DOI_PREFIX, isbn13CheckDigit, normalizeDoi } from '../doi.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

interface DryRunCorpus {
  schema_version: number;
  abstract_marker: string;
  per_query: number;
  year_min: number;
  year_max: number;
  title_templates: string[];
  book_templates: string[];
  adjectives: string[];
  nouns: string[];
  fields: string[];
  surnames: string[];
  given_names: string[];
  venues: string[];
  publishers: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ships at bin/lib/sources/ (tsx) and dist/bin/lib/sources/ (build): walk up to
// the directory that owns package.json (IN-03 defect class).
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

/** The packaged corpus path (the canonical asset root; PLUG-02 moves it later). */
export const DRY_RUN_CORPUS_PATH = path.join(findPkgRoot(__dirname), 'templates', 'dry-run', 'corpus.json');

let corpusCache: DryRunCorpus | null = null;

function corpus(): DryRunCorpus {
  if (corpusCache !== null) return corpusCache;
  const parsed = JSON.parse(readFileSync(DRY_RUN_CORPUS_PATH, 'utf8')) as DryRunCorpus;
  const lists: Array<keyof DryRunCorpus> = [
    'title_templates', 'book_templates', 'adjectives', 'nouns', 'fields',
    'surnames', 'given_names', 'venues', 'publishers',
  ];
  for (const k of lists) {
    const v = parsed[k];
    if (!Array.isArray(v) || v.length === 0) {
      throw new Error(`dry-run corpus ${DRY_RUN_CORPUS_PATH}: "${String(k)}" must be a non-empty array`);
    }
  }
  corpusCache = parsed;
  return parsed;
}

export type DryRunKind = 'article' | 'preprint' | 'book';

/** The kind of a synthetic source is a pure function of its id. */
export function kindOf(hex: string): DryRunKind {
  const n = parseInt(hex.slice(0, 2), 16) % 6;
  return n === 4 ? 'preprint' : n === 5 ? 'book' : 'article';
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Deterministic pick: a stable index into `list` from `hex` and a salt. */
function pick<T>(list: readonly T[], hex: string, salt: string): T {
  const h = sha256Hex(`${hex}:${salt}`);
  return list[parseInt(h.slice(0, 8), 16) % list.length] as T;
}

function fill(template: string, hex: string): string {
  const c = corpus();
  return template
    .replace('{adj}', pick(c.adjectives, hex, 'adj'))
    .replace('{noun}', pick(c.nouns, hex, 'noun'))
    .replace('{field}', pick(c.fields, hex, 'field'));
}

/** The ISBN-style reserved id for a book-kind source (check digit deliberately wrong). */
function isbnFor(hex: string): string {
  const six = String(parseInt(hex.slice(0, 6), 16) % 1_000_000).padStart(6, '0');
  const first12 = `978000${six}`;
  const invalidCheck = (isbn13CheckDigit(first12) + 1) % 10;
  return `978-0-00-${six}-${invalidCheck}`;
}

/** Build the synthetic source for an 8-hex id (pure). */
export function syntheticSource(hex: string): SourceCandidate {
  const c = corpus();
  const kind = kindOf(hex);
  const doi = `${DRY_RUN_DOI_PREFIX}${hex}`;
  const title = fill(pick(kind === 'book' ? c.book_templates : c.title_templates, hex, 'title'), hex);
  const authorCount = 1 + (parseInt(hex.slice(2, 3), 16) % 3);
  const authors: string[] = [];
  for (let i = 0; i < authorCount; i++) {
    const family = pick(c.surnames, hex, `family${i}`);
    const given = pick(c.given_names, hex, `given${i}`);
    const name = `${family}, ${given}`;
    if (!authors.includes(name)) authors.push(name);
  }
  const span = Math.max(1, c.year_max - c.year_min + 1);
  const year = c.year_min + (parseInt(hex.slice(3, 7), 16) % span);
  const venue = kind === 'book' ? pick(c.publishers, hex, 'publisher') : pick(c.venues, hex, 'venue');
  const citekey = generateCitekey({ authors, year });
  const cand: SourceCandidate = {
    source: 'dry-run',
    id: doi,
    doi,
    title,
    authors,
    year,
    abstract: `${c.abstract_marker} A synthetic ${kind} minted for a --dry-run rehearsal; it does not refer to a real work.`,
    retracted: false,
    last_verified: new Date().toISOString(),
    citekey,
    synthetic: true,
    raw: { synthetic: true, kind, hex, venue },
  };
  if (kind === 'preprint') cand.arxiv = `pensmith-dryrun.${hex}`;
  if (kind === 'book') cand.isbn = isbnFor(hex);
  return cand;
}

/** The kinds a query's source list is guaranteed to cover (articles + a preprint + a book). */
function wantedKind(i: number): DryRunKind {
  if (i === 3) return 'preprint';
  if (i === 4) return 'book';
  return 'article';
}

/**
 * Deterministic synthetic sources for `query`: at least 5 (corpus per_query,
 * default 6), always including a preprint (arXiv-style id) and a book
 * (ISBN-style id). Same query ⇒ same sources.
 */
export async function search(query: string, opts: { limit?: number } = {}): Promise<SourceCandidate[]> {
  const perQuery = Math.max(5, corpus().per_query);
  const n = Math.max(5, Math.min(opts.limit ?? perQuery, perQuery));
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const out: SourceCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const want = wantedKind(i);
    for (let salt = 0; salt < 256; salt++) {
      const hex = sha256Hex(`${q}\n${i}\n${salt}`).slice(0, 8);
      if (seen.has(hex) || kindOf(hex) !== want) continue;
      seen.add(hex);
      out.push(syntheticSource(hex));
      break;
    }
  }
  return out;
}

/**
 * Reconstruct the synthetic source for a reserved identifier (DOI, arXiv-style
 * or ISBN-style is not invertible, so only the DOI and arXiv-style ids are).
 * Returns null for anything outside the reserved namespace.
 */
export async function fetchById(id: string): Promise<SourceCandidate | null> {
  const s = id.trim();
  const doi = normalizeDoi(s);
  let hex: string | undefined;
  if (doi !== null && doi.startsWith(DRY_RUN_DOI_PREFIX)) hex = doi.slice(DRY_RUN_DOI_PREFIX.length);
  else {
    const m = /^(?:arxiv:)?pensmith-dryrun\.([0-9a-f]{8})$/i.exec(s);
    if (m?.[1]) hex = m[1].toLowerCase();
  }
  if (hex === undefined || !/^[0-9a-f]{8}$/.test(hex)) return null;
  return syntheticSource(hex);
}
