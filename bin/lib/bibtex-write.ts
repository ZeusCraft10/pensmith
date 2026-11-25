// bin/lib/bibtex-write.ts — CITATIONS.bib as a view of the library.
//
// .paper/LIBRARY.json is the canonical store; CITATIONS.bib is written from it
// (bin/lib/library.ts) and is what verify, compile and done read. Each item
// becomes one entry, in citekey order:
//   - an item read in from a bibliography (written by hand, imported, or by an
//     older pensmith) is written back exactly as it was read: those bytes are
//     what verify checked;
//   - any other item is rendered through formatBibtex (bin/lib/citations.ts),
//     which keeps text in every script as UTF-8, with the identifiers CSL has
//     no variable for added as raw fields (`eprint` + `archiveprefix` for an
//     arXiv ID, `pmid`) and a retracted work marked `note = {RETRACTED}`, the
//     flag Pass 1 reads offline.
// Rendering one item never changes another's entry, so adding a source leaves
// every verified entry byte for byte as it was.

import { formatBibtex } from './citations.js';
import { generateCitekey } from './citekey.js';
import type { Library, LibraryItem } from './schemas/library.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

/**
 * Base-26 spreadsheet-column collision suffix.
 *
 * seen=1 -> 'a', seen=26 -> 'z', seen=27 -> 'aa', seen=52 -> 'az',
 * seen=53 -> 'ba', seen=702 -> 'zz'.
 *
 * Pure, deterministic, ASCII-lowercase, so a suffixed key still matches the
 * citekey pattern /^[a-z][a-z0-9_-]*$/.
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
 * `base`, or `base` plus the first collision suffix that is free in `taken`
 * (compared ignoring case: BibTeX keys are case-insensitive). The key is
 * added to `taken`.
 */
export function freeCitekey(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 1; taken.has(key.toLowerCase()); n++) key = base + suffixForCollision(n);
  taken.add(key.toLowerCase());
  return key;
}

/**
 * Citekeys that are unique across `candidates`, in order: two candidates
 * sharing a base key (same first author and year) get base, base+'a', ... A
 * base that equals another candidate's suffixed form is suffixed too, so no
 * two candidates share a key. A candidate whose key is already unique is
 * returned by reference; others get a shallow copy with the new key.
 *
 * These keys are provisional, for one research run; the library assigns the
 * key a work keeps (bin/lib/library.ts).
 */
export function assignUniqueCitekeys(candidates: SourceCandidate[]): SourceCandidate[] {
  const taken = new Set<string>();
  return candidates.map((c) => {
    const citekey = freeCitekey(c.citekey || generateCitekey(c), taken);
    return citekey === c.citekey ? c : { ...c, citekey };
  });
}

// ---------------------------------------------------------------------------
// Reading a bibliography's text entry by entry.
// ---------------------------------------------------------------------------

export interface BibBlock {
  /** The entry type, lowercased ('article', 'string', 'preamble', 'comment'). */
  type: string;
  /** The citekey of an entry; '' for @string, @preamble and @comment. */
  key: string;
  /** The block's text from its `@` to its closing delimiter. */
  text: string;
}

const NON_ENTRY: ReadonlySet<string> = new Set(['string', 'preamble', 'comment']);

/**
 * The blocks of BibTeX `text`, each exactly as written. Text between blocks
 * is a comment to BibTeX and is not kept. A block whose closing delimiter is
 * missing runs to the end of the text.
 */
export function splitBibtex(text: string): BibBlock[] {
  const out: BibBlock[] = [];
  const re = /@\s*([A-Za-z]+)\s*([{(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const open = m[2]!;
    let i = re.lastIndex;
    let depth = 0;
    let end = text.length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0 && open === '{') {
          end = i + 1;
          break;
        }
        depth--;
      } else if (ch === ')' && open === '(' && depth === 0) {
        end = i + 1;
        break;
      }
    }
    const type = m[1]!.toLowerCase();
    const body = text.slice(re.lastIndex, end);
    const key = NON_ENTRY.has(type) ? '' : (/^\s*([^,\s]+)/.exec(body)?.[1] ?? '');
    out.push({ type, key, text: text.slice(start, end) });
    re.lastIndex = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing the library as BibTeX.
// ---------------------------------------------------------------------------

// Library-only variables: never part of a bibliography entry.
const NOT_BIBTEX: ReadonlySet<string> = new Set(['custom', 'abstract', 'PMID', 'PMCID', 'note']);

/** The CSL-JSON citation-js renders for `item`. */
function renderedCsl(item: LibraryItem): Record<string, unknown> {
  const csl: Record<string, unknown> = { 'citation-key': item.id };
  for (const [k, v] of Object.entries(item)) if (!NOT_BIBTEX.has(k)) csl[k] = v;
  // A preprint is BibTeX's @misc with its eprint, as arXiv itself writes it.
  if (item.type === 'article') csl['type'] = 'document';
  if (item.custom.retracted) csl['note'] = 'RETRACTED';
  else if (typeof item['note'] === 'string') csl['note'] = item['note'];
  return csl;
}

/** The raw fields `item`'s entry carries for identifiers CSL drops. */
function identifierFields(item: LibraryItem): Record<string, string> {
  const extra: Record<string, string> = {};
  if (item.custom.arxiv) {
    extra['eprint'] = item.custom.arxiv;
    extra['archiveprefix'] = 'arXiv';
  }
  if (item.PMID) extra['pmid'] = item.PMID;
  return extra;
}

/** The BibTeX entry for one library item, without a trailing newline. */
export function itemBibtex(item: LibraryItem): string {
  if (item.custom.bibtex) return item.custom.bibtex.trim();
  return formatBibtex([renderedCsl(item)], new Map([[item.id, identifierFields(item)]])).trim();
}

/** CITATIONS.bib for `library`: any @string/@preamble blocks first, then every item in citekey order. */
export function libraryBibtex(library: Pick<Library, 'entries' | 'bibtex_preamble'>): string {
  const items = [...library.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocks = [...library.bibtex_preamble.map((b) => b.trim()), ...items.map(itemBibtex)];
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`;
}
