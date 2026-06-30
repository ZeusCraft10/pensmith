// bin/lib/bibtex-write.ts — SourceCandidate[] -> .paper/CITATIONS.bib serializer
// (D-19 LOCKED citation-js chokepoint, D-07 LOCKED atomic-write chokepoint, D-20,
// VRFY-04).
//
// This module rides two chokepoints:
//   1. citation-js — we import { Cite } from './citations.js' (the SOLE module
//      that imports the library directly). ESLint backstops the chokepoint via
//      no-restricted-imports on 'citation-js'.
//   2. atomic-write — we call atomicWriteFile from './atomic-write.js' for the
//      final write; we NEVER call raw fs write/append directly. ESLint backstops
//      via the callee-property selector banning those node:fs methods.
//
// Citekey strategy:
//   - Every emitted entry is keyed by a deterministic citekey set as CslEntry.id
//     BEFORE Cite.format() is called. citation-js then renders @article{<id>, …}
//     verbatim — no auto-generation, no surprise spelling.
//   - Collisions resolve via base-26 spreadsheet-column encoding (seen=1 -> 'a',
//     26 -> 'z', 27 -> 'aa', 53 -> 'ba', etc.). This stays deterministic for
//     pathologically deep collision chains (e.g. a "Wu, 2017" literature dump)
//     and still satisfies the D-14 citekey regex /^[a-z][a-z0-9_-]*$/.
//
// Sorting:
//   - Entries are sorted by FINAL citekey BEFORE being handed to Cite() so the
//     emitted .bib is git-diff-stable. We do NOT post-process the output via
//     `bibtex.split(/\n(?=@)/)` — that is fragile for field values containing
//     literal `\n@` (URLs in notes, email addresses in abstracts).
//
// Empty array:
//   - writeBibtex([], target) writes a zero-length file. Plan 06 verify.md
//     reads .paper/CITATIONS.bib via citations.parseBib(); we never want it to
//     ENOENT just because a section happens to have zero citations.

import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

interface CslAuthor {
  family: string;
  given?: string;
}

interface CslEntry {
  // CYCLE-3 MEDIUM REVIEWS CONVERGENCE — id is assigned downstream (in the
  // writeBibtex collision loop). Marking optional so toCsl() can return a
  // CslEntry without pre-computing the citekey AND TS still accepts the
  // later assignment.
  id?: string;
  type: 'article-journal' | 'paper-conference' | 'article' | 'book';
  title: string;
  author: CslAuthor[];
  issued?: { 'date-parts': [[number]] };
  DOI?: string;
  ISBN?: string;
  // arXiv id surfaces here per CSL-JSON convention for arxiv preprints.
  number?: string;
  // CYCLE-3 D-15 retracted-flag persistence: SourceCandidate.retracted: true
  // surfaces in compiled output via CSL `note = "RETRACTED"`. citation-js
  // >=0.7 preserves `note` verbatim in BibTeX output, so the flag survives
  // the serializer round-trip and Plan 06 verify can scan emitted .bib for
  // `note = {RETRACTED}` to fail loudly on citing retracted works.
  note?: string;
}

function parseAuthor(s: string): CslAuthor {
  const comma = s.indexOf(',');
  if (comma === -1) return { family: s.trim() };
  const family = s.slice(0, comma).trim();
  const given = s.slice(comma + 1).trim();
  return given ? { family, given } : { family };
}

function toCsl(c: SourceCandidate): CslEntry | null {
  // CYCLE-3 REVIEWS — entries lacking ANY persistent identifier (DOI, ISBN,
  // arXiv id) are dropped. The verifier needs a stable id to cross-reference;
  // a candidate without one cannot be safely cited.
  const asExt = c as { isbn?: string; arxivId?: string };
  const hasId = Boolean(c.doi) || Boolean(asExt.isbn) || Boolean(asExt.arxivId);
  if (!hasId) return null;

  const entry: CslEntry = {
    type: c.source === 'arxiv' ? 'article' : 'article-journal',
    title: c.title,
    author: (c.authors ?? []).map(parseAuthor),
  };

  if (typeof c.year === 'number') {
    entry.issued = { 'date-parts': [[c.year]] };
  }
  if (c.doi) entry.DOI = c.doi;
  if (asExt.isbn) entry.ISBN = asExt.isbn;
  if (asExt.arxivId) entry.number = asExt.arxivId;
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
 * Two candidates sharing a base key (same first-author + year) get
 * base / base+'a' / base+'b' …. Crucially, the suffix loop also skips any value
 * already taken, so a base key that happens to equal another candidate's
 * suffixed form (e.g. a literal 'wu2017a' alongside a second 'wu2017') ends up
 * unique rather than silently duplicated — the bug a naive per-base counter has.
 *
 * Order-preserving. A candidate whose citekey is already unique is returned by
 * reference; others get a shallow copy with the new `citekey`.
 */
export function assignUniqueCitekeys(candidates: SourceCandidate[]): SourceCandidate[] {
  const used = new Set<string>();
  return candidates.map((c) => {
    const base = c.citekey || generateCitekey(c);
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
 * Serialize SourceCandidate[] to a BibTeX file at `targetPath`.
 *
 * Entries are keyed by a deterministic citekey (collision-suffixed when
 * multiple candidates share a base key). Output is sorted by citekey so
 * the file is git-diff-stable across runs.
 *
 * Empty input still writes a zero-length file so Plan 06 verify.md
 * does not ENOENT on .paper/CITATIONS.bib (D-20 LOCKED canonical path).
 *
 * @param candidates SourceCandidate[] (per D-14 schema).
 * @param targetPath Absolute or relative path; parent dir created if missing.
 */
export async function writeBibtex(
  candidates: SourceCandidate[],
  targetPath: string,
): Promise<void> {
  // Keep only serializable candidates (toCsl drops id-less ones), THEN assign
  // globally-unique citekeys over that surviving set. assignUniqueCitekeys is the
  // single uniqueness authority (audit #21) — it handles base-vs-suffix collisions
  // a per-base counter would silently duplicate. Computing toCsl once per
  // candidate avoids re-deriving it after keying.
  const survivors: Array<{ candidate: SourceCandidate; csl: CslEntry }> = [];
  for (const c of candidates) {
    const csl = toCsl(c);
    if (csl) survivors.push({ candidate: c, csl });
  }
  const keyed = assignUniqueCitekeys(survivors.map((s) => s.candidate));
  const entries: Array<{ citekey: string; csl: CslEntry }> = keyed.map((c, i) => {
    const csl = survivors[i]!.csl;
    csl.id = c.citekey;
    return { citekey: c.citekey, csl };
  });

  // Sort by FINAL citekey before rendering — input order is preserved by
  // citation-js, so this guarantees the output is sorted.
  entries.sort((a, b) => a.citekey.localeCompare(b.citekey));

  let bibtex = '';
  if (entries.length > 0) {
    const cite = new Cite(entries.map((e) => e.csl));
    const rendered = (cite as { format: (...args: unknown[]) => unknown }).format(
      'bibtex',
      { format: 'text' },
    ) as string;

    // citation-js auto-generates its own BibTeX citekeys (label) regardless
    // of CslEntry.id — e.g. our 'wu2017' becomes 'Wu2017Foo' in the output.
    // To honor the deterministic citekey contract (D-14) AND the collision-
    // suffix policy (CYCLE-2 H-4), rewrite each `@<type>{<autokey>,` header
    // in-place with our citekey. Input order is preserved by citation-js,
    // so iterating `entries` and replacing the N-th header is safe.
    let i = 0;
    bibtex = rendered.replace(/^(@\w+\{)[^,]+(,)/gm, (_match, p1: string, p2: string) => {
      const entry = entries[i++];
      const key = entry?.citekey ?? 'unknown';
      return `${p1}${key}${p2}`;
    });
  }

  await atomicWriteFile(targetPath, bibtex);
}
