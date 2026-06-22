// bin/lib/ris-write.ts — SourceCandidate[] -> .paper/CITATIONS.ris serializer
// (CITE-05; D-19 LOCKED citation-js chokepoint, D-07 LOCKED atomic-write
// chokepoint).
//
// This module is the RIS sibling of bibtex-write.ts and rides the same two
// chokepoints:
//   1. citation-js — we import { Cite } from './citations.js' (the SOLE module
//      that imports the library directly). NEVER import 'citation-js' here —
//      ESLint no-restricted-imports backstops the chokepoint (RESEARCH Pitfall
//      8). The @citation-js/plugin-ris formatter is already bundled inside
//      citation-js@0.7.22, so no new npm dep is required.
//   2. atomic-write — we call atomicWriteFile from './atomic-write.js' for the
//      final write; we NEVER call raw fs write/append directly. ESLint backstops
//      via the callee-property selector banning those node:fs methods.
//
// Structural copy of bibtex-write.ts:
//   - The CSL intermediate (CslAuthor, CslEntry, parseAuthor, toCsl) is
//     IDENTICAL — RIS is produced from the same CSL-JSON entries as BibTeX.
//   - The seenKeys collision loop and entries.sort(citekey) are IDENTICAL, so
//     the emitted .ris is git-diff-stable across runs.
//   - suffixForCollision is imported from './bibtex-write.js' (already exported
//     there) — we do NOT re-declare it privately.
//
// THE ONLY DIVERGENCE from bibtex-write.ts is the final format call: we ask
// citation-js for 'ris' with spec:'new' (REQUIRED for Mendeley/EndNote
// interop — RESEARCH Pitfall 4) instead of 'bibtex'. RIS records carry no
// citekey header, so the bibtex `@<type>{<autokey>,` header-rewrite regex is
// dropped entirely.
//
// Empty array:
//   - writeRis([], target) writes a zero-length file (parity with
//     writeBibtex([], target)), so no downstream ENOENT just because a section
//     happens to have zero citations.

import { Cite } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';
import { suffixForCollision } from './bibtex-write.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

interface CslAuthor {
  family: string;
  given?: string;
}

interface CslEntry {
  // id is assigned downstream (in the writeRis collision loop). Marking
  // optional so toCsl() can return a CslEntry without pre-computing the
  // citekey AND TS still accepts the later assignment.
  id?: string;
  type: 'article-journal' | 'paper-conference' | 'article' | 'book';
  title: string;
  author: CslAuthor[];
  issued?: { 'date-parts': [[number]] };
  DOI?: string;
  ISBN?: string;
  // arXiv id surfaces here per CSL-JSON convention for arxiv preprints.
  number?: string;
  // D-15 retracted-flag persistence: SourceCandidate.retracted: true surfaces
  // in output via CSL `note = "RETRACTED"`, identical to bibtex-write.ts.
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
  // Entries lacking ANY persistent identifier (DOI, ISBN, arXiv id) are
  // dropped — identical to bibtex-write.ts. The verifier needs a stable id to
  // cross-reference; a candidate without one cannot be safely cited.
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
 * Serialize SourceCandidate[] to a RIS file at `targetPath`.
 *
 * RIS sibling of writeBibtex: same CSL intermediate, same deterministic
 * collision-suffixed citekeys, same citekey sort so the file is git-diff-stable
 * across runs. The SOLE divergence is the format call — `ris` with spec:'new'
 * (RIS2001, required for Mendeley/EndNote interop) instead of `bibtex`.
 *
 * Empty input still writes a zero-length file (parity with writeBibtex) so
 * downstream readers do not ENOENT on .paper/CITATIONS.ris.
 *
 * @param candidates SourceCandidate[] (per D-14 schema).
 * @param targetPath Absolute or relative path; parent dir created if missing.
 */
export async function writeRis(
  candidates: SourceCandidate[],
  targetPath: string,
): Promise<void> {
  const seenKeys = new Map<string, number>();
  const entries: Array<{ citekey: string; csl: CslEntry }> = [];

  for (const c of candidates) {
    const csl = toCsl(c);
    if (!csl) continue;

    const baseKey = c.citekey || generateCitekey(c);
    const seen = seenKeys.get(baseKey) ?? 0;
    const citekey = seen === 0 ? baseKey : baseKey + suffixForCollision(seen);
    seenKeys.set(baseKey, seen + 1);

    csl.id = citekey;
    entries.push({ citekey, csl });
  }

  // Sort by FINAL citekey before rendering — input order is preserved by
  // citation-js, so this guarantees the output is sorted (git-diff-stable).
  entries.sort((a, b) => a.citekey.localeCompare(b.citekey));

  // THE SOLE DIVERGENCE from writeBibtex: format 'ris' with spec:'new'
  // (RIS2001 — Pitfall 4) instead of 'bibtex'. RIS has no citekey header to
  // rewrite, so the bibtex post-process regex is dropped.
  let ris = '';
  if (entries.length > 0) {
    const cite = new Cite(entries.map((e) => e.csl));
    ris = (cite as { format: (...args: unknown[]) => string }).format('ris', {
      spec: 'new',
      format: 'text',
    });
  }

  await atomicWriteFile(targetPath, ris);
}
