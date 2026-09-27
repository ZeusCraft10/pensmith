// bin/lib/bibtex-write.ts — source records -> BibTeX serializer for
// .paper/CITATIONS.bib (D-19 LOCKED citation-js chokepoint, D-07 LOCKED
// atomic-write chokepoint, D-20, VRFY-04).
//
// BRDTH-01 / D-17-43: .paper/CITATIONS.bib is RENDERED from LIBRARY.json by the
// one library writer (bin/lib/library.ts). Only library.ts may call
// renderBibtex / writeBibtex (chokepoint row `library-writer`); every ingest
// path goes through upsertSources instead. The input is the structural
// BibSource shape, which both a LIBRARY.json v2 entry and a research
// SourceCandidate satisfy.
//
// This module rides two chokepoints:
//   1. citation-js — we import { Cite } from './citations.js' (the SOLE module
//      that imports the library directly). ESLint backstops the chokepoint via
//      no-restricted-imports on 'citation-js'.
//   2. atomic-write — writeBibtex calls atomicWriteFile from './atomic-write.js'
//      for the final write; we NEVER call raw fs write/append directly. ESLint
//      backstops via the callee-property selector banning those node:fs methods.
//
// Citekey strategy:
//   - Every emitted entry is keyed by a deterministic citekey set as CslEntry.id
//     BEFORE Cite.format() is called. citation-js then renders @article{<id>, …}
//     verbatim — no auto-generation, no surprise spelling.
//   - Collisions resolve via base-26 spreadsheet-column encoding (seen=1 -> 'a',
//     26 -> 'z', 27 -> 'aa', 53 -> 'ba', etc.). This stays deterministic for
//     pathologically deep collision chains (e.g. a "Wu, 2017" literature dump)
//     and still satisfies the D-14 citekey regex /^[a-z][a-z0-9_-]*$/. (Library
//     citekeys are already unique — LIBRARY.json v2 enforces it — so this only
//     fires for callers that hand in raw candidates.)
//
// Sorting:
//   - Entries are sorted by FINAL citekey BEFORE being handed to Cite() so the
//     emitted .bib is diff-stable. We do NOT post-process the output by
//     splitting on a newline-before-@ lookahead — that is fragile for field
//     values containing a literal newline followed by @ (URLs in notes, email
//     addresses in abstracts).
//
// Empty array:
//   - renderBibtex([]) is '' and writeBibtex([], target) writes a zero-length
//     file. verify reads .paper/CITATIONS.bib via citations.parseBib(); it must
//     never ENOENT just because a paper happens to have zero sources.

import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';

/**
 * The fields the BibTeX/RIS renderers read. A LIBRARY.json v2 entry and a
 * research SourceCandidate both satisfy it structurally.
 */
export interface BibSource {
  citekey: string;
  title?: string | null | undefined;
  authors?: string[] | undefined;
  year?: number | null | undefined;
  doi?: string | null | undefined;
  isbn?: string | null | undefined;
  /** Bare arXiv id (LIBRARY.json v2). */
  arxiv?: string | null | undefined;
  /** Legacy spelling carried by bib-derived candidates. */
  arxivId?: string | null | undefined;
  retracted?: boolean | undefined;
  /** SourceCandidate adapter name — 'arxiv' renders as a preprint. */
  source?: string | undefined;
}

interface CslAuthor {
  family: string;
  given?: string;
}

export interface CslEntry {
  // CYCLE-3 MEDIUM REVIEWS CONVERGENCE — id is assigned downstream (in the
  // collision loop). Marking optional so toCsl() can return a CslEntry without
  // pre-computing the citekey AND TS still accepts the later assignment.
  id?: string;
  type: 'article-journal' | 'paper-conference' | 'article' | 'book';
  title: string;
  author: CslAuthor[];
  issued?: { 'date-parts': [[number]] };
  DOI?: string;
  ISBN?: string;
  // arXiv id surfaces here per CSL-JSON convention for arxiv preprints.
  number?: string;
  // CYCLE-3 D-15 retracted-flag persistence: a retracted source surfaces in
  // compiled output via CSL `note = "RETRACTED"`. citation-js >=0.7 preserves
  // `note` verbatim in BibTeX output, so the flag survives the serializer
  // round-trip and verify can scan emitted .bib for `note = {RETRACTED}` to fail
  // loudly on citing retracted works.
  note?: string;
}

function parseAuthor(s: string): CslAuthor {
  const comma = s.indexOf(',');
  if (comma === -1) return { family: s.trim() };
  const family = s.slice(0, comma).trim();
  const given = s.slice(comma + 1).trim();
  return given ? { family, given } : { family };
}

/** CSL-JSON for one source, or null when it has no persistent identifier. */
export function toCsl(c: BibSource): CslEntry | null {
  // CYCLE-3 REVIEWS — entries lacking ANY persistent identifier (DOI, ISBN,
  // arXiv id) are dropped. The verifier needs a stable id to cross-reference;
  // a source without one cannot be safely cited.
  const arxiv = c.arxiv ?? c.arxivId ?? null;
  const hasId = Boolean(c.doi) || Boolean(c.isbn) || Boolean(arxiv);
  if (!hasId) return null;

  const entry: CslEntry = {
    type: c.source === 'arxiv' || (!c.doi && !c.isbn && Boolean(arxiv)) ? 'article' : 'article-journal',
    title: c.title ?? c.citekey,
    author: (c.authors ?? []).map(parseAuthor),
  };

  if (typeof c.year === 'number') {
    entry.issued = { 'date-parts': [[c.year]] };
  }
  if (c.doi) entry.DOI = c.doi;
  if (c.isbn) entry.ISBN = c.isbn;
  if (arxiv) entry.number = arxiv;
  if (c.retracted === true) entry.note = 'RETRACTED';

  return entry;
}

/**
 * Base-26 spreadsheet-column collision suffix.
 *
 * seen=1 -> 'a', seen=26 -> 'z', seen=27 -> 'aa', seen=52 -> 'az',
 * seen=53 -> 'ba', seen=702 -> 'zz'.
 *
 * Pure, deterministic, ASCII-lowercase. Satisfies the D-14 citekey
 * regex /^[a-z][a-z0-9_-]*$/ for any positive integer input.
 */
export function suffixForCollision(seen: number): string {
  if (!Number.isInteger(seen) || seen < 1) {
    throw new Error(`suffixForCollision: seen must be a positive integer (got ${seen})`);
  }
  let n = seen;
  let out = '';
  while (n > 0) {
    n--; // 1-indexed -> 0-indexed
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * Assign collision-suffixed citekeys that are GLOBALLY UNIQUE across the set, so
 * the citekey is a stable primary key shared by LIBRARY.json, CITATIONS.bib, the
 * RIS export, and the research keep-sets (audit #21/#31/#32).
 *
 * Two sources sharing a base key (same first-author + year) get
 * base / base+'a' / base+'b' …. Crucially, the suffix loop also skips any value
 * already taken, so a base key that happens to equal another source's
 * suffixed form (e.g. a literal 'wu2017a' alongside a second 'wu2017') ends up
 * unique rather than silently duplicated — the bug a naive per-base counter has.
 *
 * Order-preserving. A source whose citekey is already unique is returned by
 * reference; others get a shallow copy with the new `citekey`.
 */
export function assignUniqueCitekeys<T extends { citekey: string; authors?: string[] | undefined; year?: number | null | undefined }>(
  candidates: T[],
): T[] {
  const used = new Set<string>();
  return candidates.map((c) => {
    const base =
      c.citekey ||
      generateCitekey({ authors: c.authors ?? [], ...(typeof c.year === 'number' ? { year: c.year } : {}) });
    let citekey = base;
    let n = 0;
    while (used.has(citekey)) {
      n += 1;
      citekey = base + suffixForCollision(n);
    }
    used.add(citekey);
    return citekey === c.citekey ? c : { ...c, citekey };
  });
}

/**
 * Render sources as BibTeX text: keyed by their (collision-suffixed) citekeys,
 * sorted by citekey (diff-stable), id-less sources dropped. '' for none.
 */
export function renderBibtex(sources: BibSource[]): string {
  // Keep only serializable sources (toCsl drops id-less ones), THEN assign
  // globally-unique citekeys over that surviving set. assignUniqueCitekeys is the
  // single uniqueness authority (audit #21) — it handles base-vs-suffix collisions
  // a per-base counter would silently duplicate. Computing toCsl once per
  // source avoids re-deriving it after keying.
  const survivors: Array<{ source: BibSource; csl: CslEntry }> = [];
  for (const c of sources) {
    const csl = toCsl(c);
    if (csl) survivors.push({ source: c, csl });
  }
  const keyed = assignUniqueCitekeys(survivors.map((s) => s.source));
  const entries: Array<{ citekey: string; csl: CslEntry }> = keyed.map((c, i) => {
    const csl = survivors[i]!.csl;
    csl.id = c.citekey;
    return { citekey: c.citekey, csl };
  });

  // Sort by FINAL citekey before rendering — input order is preserved by
  // citation-js, so this guarantees the output is sorted.
  entries.sort((a, b) => a.citekey.localeCompare(b.citekey));

  if (entries.length === 0) return '';
  const cite = new Cite(entries.map((e) => e.csl));
  const rendered = (cite as { format: (...args: unknown[]) => unknown }).format('bibtex', { format: 'text' }) as string;

  // citation-js auto-generates its own BibTeX citekeys (label) regardless
  // of CslEntry.id — e.g. our 'wu2017' becomes 'Wu2017Foo' in the output.
  // To honor the deterministic citekey contract (D-14) AND the collision-
  // suffix policy (CYCLE-2 H-4), rewrite each `@<type>{<autokey>,` header
  // in-place with our citekey. Input order is preserved by citation-js,
  // so iterating `entries` and replacing the N-th header is safe.
  let i = 0;
  return rendered.replace(/^(@\w+\{)[^,]+(,)/gm, (_match, p1: string, p2: string) => {
    const entry = entries[i++];
    const key = entry?.citekey ?? 'unknown';
    return `${p1}${key}${p2}`;
  });
}

/**
 * Render `sources` (renderBibtex) and write them atomically to `targetPath`.
 * Only bin/lib/library.ts calls this in shipped code (chokepoint row
 * `library-writer`).
 *
 * @param sources LIBRARY.json v2 entries (or SourceCandidate[]).
 * @param targetPath Absolute or relative path; parent dir created if missing.
 */
export async function writeBibtex(sources: BibSource[], targetPath: string): Promise<void> {
  await atomicWriteFile(targetPath, renderBibtex(sources));
}
