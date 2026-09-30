// bin/lib/citations.ts — BibTeX parse + APA render chokepoint per D-19 / CITE-04.
//
// SOLE call site for `citation-js` in the repo. The ESLint chokepoint
// (eslint.config.js → no-restricted-imports for `citation-js`) bans this
// import everywhere EXCEPT this file (per-file `no-restricted-imports`
// override). The red-team fixture at
// tests/fixtures/lint-chokepoint-fixture.ts is the regression gate.
//
// =====================================================================
//   renderInText — in-text sibling of renderStyle (Phase 13 / REND-01)
// =====================================================================
// renderInText(entries, style) is the per-entry in-text CSL renderer. It
// is the D-19-compliant delegate for exporter.ts: exporter.ts imports
// { parseBib, renderStyle, renderInText } from './citations.js' — it
// NEVER imports Cite or any citation-js symbol directly. All citation-js /
// Cite usage stays inside this file (the D-19 chokepoint).
//
// Implementation note: renderInText calls ensureStyleTemplate(style) for
// Pitfall-2 memoization, then constructs a new Cite([entries], …) and
// calls .format('citation', …). One combined in-text string is returned
// for the provided entries group (callers pass ONE entry per call to get
// a per-key string — Pitfall 1). Offline + deterministic: same
// format:'text' / lang:'en-US' options as renderStyle.
//
// =====================================================================
//   Why parseBib is async, parseBibtex is the alias (executor reconciliation)
// =====================================================================
// Plan 03-02 specifies `parseBibtex`. Wave 0's tests/citation-render.test.ts
// already imports `{ parseBib, renderApa }` and `await parseBib(...)`. To
// pass the Wave 0 test without modification, we define ONE canonical
// async function `parseBib` (the test's spelling) and export an alias
// `parseBibtex = parseBib` so the plan's named signature also resolves.
//
// =====================================================================
//   Why renderApa(entries) takes parsed entries (not bibtex + csl)
// =====================================================================
// Wave 0's tests/citation-render.test.ts calls `await renderApa(entries)`
// with no second argument — entries is the array returned from parseBib.
// The CSL template is read from disk inside renderApa (apa.csl ships in
// Plan 05; until then the function throws a clear diagnostic naming the
// blocking plan). This keeps the test contract intact and concentrates
// the FS read for the CSL template inside the chokepoint instead of
// requiring every caller to read+pass it.
//
// =====================================================================
//   citation-js lazy CSL plugin (RESEARCH.md Pitfall #4 / Phase-10 Pitfall 1)
// =====================================================================
// `citation-js >= 0.7` lazy-loads CSL templates. A custom template must
// be registered via `plugins.config.get('@csl').templates.add(name, csl)`
// BEFORE the first `Cite.format()` call referencing it. citeproc's
// registry has NO idempotency — a second templates.add(name, ...) with the
// same name throws "template already registered" (Phase-10 RESEARCH
// Pitfall 1). We memoize registration via the `registeredStyles` Map so
// each style template (apa + the 7 new styles) is added at most once per
// process. The Map check BEFORE every templates.add is the collision guard.
//
// =====================================================================
//   Re-export Cite (CYCLE-3 NEW-H-1)
// =====================================================================
// Downstream chokepoint consumers (Plan 04 bin/lib/bibtex-write.ts and
// Plan 09 tests/bibtex-write.test.ts) need the Cite class. They import
// `{ Cite } from './citations.js'` instead of `from 'citation-js'`,
// preserving the D-19 LOCKED chokepoint singleton: bin/lib/citations.ts
// remains the SOLE source whose body contains `from 'citation-js'`.
//
// =====================================================================
//   Inline cite resolution is NOT this file's job (D-21)
// =====================================================================
// DRAFT.md uses Pandoc `[@citekey]` tokens. Inline citation rendering
// happens at compile time via Pandoc. citations.ts renders only the
// reference list (bibliography). Phase 6 compile verb wires Pandoc.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import { defaultCitationStyleFor } from './disciplines.js';

// `citation-js@0.7` ships a single default-export class; the `plugins`
// registry hangs off the class (`Cite.plugins`). A `import { plugins }`
// named-import works under esbuild's tsx (which synthesizes CJS-default
// destructure) but FAILS under real Node ESM with
// "does not provide an export named 'plugins'". We bind via the class
// to stay portable across both runtimes.
import Cite from 'citation-js';
import { lookupTable } from './lookup-table.js';
const plugins = Cite.plugins;

// CYCLE-3 NEW-H-1: re-export Cite so downstream Plan 04 / Plan 09
// modules can import { Cite } from './citations.js' without ever
// importing 'citation-js' directly. The D-19 chokepoint stays intact:
// this file remains the SOLE module whose body contains
// `from 'citation-js'`.
export { Cite };

// =====================================================================
//   Locate apa.csl relative to package root (mirrors bin/lib/http.ts)
// =====================================================================
// This file ships at two depths: bin/lib/citations.ts under tsx, and
// dist/bin/lib/citations.js after build. Fixed-depth `..` × N would
// land in the wrong dir post-build (same defect class as IN-03 in
// http.ts). Walk up from HERE until we find package.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const PKG_ROOT = findPkgRoot(__dirname);

// =====================================================================
//   Memoized N-style custom-template registration (Pitfall #4 / Pitfall 1)
// =====================================================================
// CITE-02 / CITE-03: generalized from the single APA boolean to a Map so all
// 8 styles (apa + the 7 new bundled CSL files) share ONE memoization
// mechanism. The Map check before every templates.add is the Phase-10
// Pitfall-1 collision guard ("template already registered").
//
// SINGLE registration path for 'pensmith-apa' (H2 fix): renderApa delegates
// to renderStyle(entries,'apa'), so ensureStyleTemplate('apa') is the SOLE
// registrar of the 'pensmith-apa' citeproc template name. There is no longer
// an independent apa boolean / standalone ensureApaTemplate — calling both
// renderApa() and renderStyle(entries,'apa') in one process registers
// 'pensmith-apa' exactly once.
const registeredStyles = new Map<string, boolean>();

// On-disk filename per style key (value === key for all 8 — Plan 10-00 Task 1
// saved the files under these exact names; apa shipped in Phase 3).
const STYLE_FILENAMES: Readonly<Record<string, string>> = lookupTable({
  'apa': 'apa',
  'mla': 'mla',
  'chicago-notes-bib': 'chicago-notes-bib',
  'chicago-author-date': 'chicago-author-date',
  'ieee': 'ieee',
  'ama': 'ama',
  'vancouver': 'vancouver',
  'harvard': 'harvard',
});

// Register the bundled CSL template for `style` under the citeproc name
// `pensmith-${style}` exactly once per process. Reads the committed .csl via
// readFileSync (OFFLINE — never fetches). For style==='apa' this resolves to
// templates/citation-styles/apa.csl and registers 'pensmith-apa', the same
// name+bytes the old renderApa used → byte-identical output. Throws a clear Error naming the
// path when the .csl is absent (no silent empty bibliography — T-10-01-01).
/** Styles whose citations are notes (class="note"): a prior citation turns theirs into a short form or "Ibid.". */
const noteStyles = new Set<string>();

function ensureStyleTemplate(style: string): void {
  if (registeredStyles.get(style)) return;
  const filename = STYLE_FILENAMES[style] ?? style;
  const cslPath = path.join(PKG_ROOT, 'templates', 'citation-styles', `${filename}.csl`);
  if (!existsSync(cslPath)) {
    throw new Error(
      `renderStyle: CSL file not found for style '${style}' at ${cslPath}`,
    );
  }
  const cslString = readFileSync(cslPath, 'utf8');
  plugins.config.get('@csl').templates.add(`pensmith-${style}`, cslString);
  if (/<style\b[^>]*\bclass="note"/.test(cslString)) noteStyles.add(style);
  registeredStyles.set(style, true);
}

/**
 * Test-only — clear ALL registered style templates so a second test run in
 * the same process re-registers cleanly. NEVER call from production code.
 */
export function _resetStyleTemplatesForTest(): void {
  registeredStyles.clear();
}

/**
 * Test-only — clear the apa-template registration memo so a second test
 * run in the same process re-registers (e.g. if a test mutates the CSL).
 *
 * H2 fix: apa now shares the registeredStyles Map (renderApa delegates to
 * renderStyle(entries,'apa')), so this deletes the single 'apa' entry rather
 * than flipping a stale separate boolean — keeping it in lockstep with
 * _resetStyleTemplatesForTest (both operate on the one Map).
 * NEVER call from production code.
 */
export function _resetApaTemplateForTest(): void {
  registeredStyles.delete('apa');
}

// =====================================================================
//   Public: parseBib (canonical) / parseBibtex (alias)
// =====================================================================
/**
 * Parse a BibTeX string into an array of CSL-JSON-shaped entries.
 *
 * Async return type lets future implementations defer the heavy lazy
 * plugin load (RESEARCH.md Pitfall #4) without breaking the existing
 * call sites. The Wave 0 test calls `await parseBib(bibContent)`.
 *
 * Throws (rather than returning an empty array) on invalid BibTeX so
 * malformed user input surfaces as a clear error, not a silent empty
 * reference list (T-3-04 mitigation — see threat register in PLAN).
 */
export async function parseBib(bibtex: string): Promise<Array<Record<string, unknown>>> {
  return parseBibSync(bibtex);
}

/**
 * The synchronous body of parseBib (citation-js parses BibTeX synchronously).
 * bibtex-write.ts uses it to round-trip every entry it renders before the
 * library writer persists CITATIONS.bib.
 */
export function parseBibSync(bibtex: string): Array<Record<string, unknown>> {
  if (typeof bibtex !== 'string') {
    throw new TypeError('parseBib: input must be a string (BibTeX source text)');
  }
  try {
    // Two steps of the same citation-js chain `new Cite(text, {forceType:
    // '@bibtex/text'})` runs: the text → raw entries (field values still in
    // their BibTeX spelling), then raw entries → CSL-JSON. Keeping the raw
    // entries lets the fields the BibTeX → CSL mapping drops be carried over
    // (SRC-12, D-19-19): see carryDroppedFields.
    const raw = inputChain().chainLink(bibtex, { forceType: '@bibtex/text' });
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('parseBib: no entries parsed from input (malformed BibTeX or empty document)');
    }
    const cite = new Cite(raw, { forceType: '@bibtex/entries+list' });
    const data = cite.data as Array<Record<string, unknown>>;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('parseBib: no entries parsed from input (malformed BibTeX or empty document)');
    }
    carryDroppedFields(raw as RawBibEntry[], data);
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Re-throw with a clearer prefix so the caller can distinguish
    // "your BibTeX is bad" from other failures further upstream.
    throw new Error(`parseBib: invalid BibTeX — ${msg.replace(/^parseBib: /, '')}`);
  }
}

/**
 * citation-js's input-chain registry (`Cite.plugins.input`), narrowed to the
 * one call parseBibSync makes. Kept local to this chokepoint module instead of
 * widening the ambient citation-js typings.
 */
function inputChain(): { chainLink(input: string, opts: { forceType: string }): unknown } {
  return (plugins as unknown as { input: { chainLink(input: string, opts: { forceType: string }): unknown } }).input;
}

/** One entry as citation-js's BibTeX text parser returns it (values unparsed). */
interface RawBibEntry {
  type?: unknown;
  label?: unknown;
  properties?: Record<string, unknown>;
}

/** A raw field value with its outer protective braces removed, trimmed; null when empty. */
function rawField(e: RawBibEntry, name: string): string | null {
  const v = e.properties?.[name];
  if (typeof v !== 'string') return null;
  let s = v.trim();
  while (s.startsWith('{') && s.endsWith('}') && balancedInside(s)) s = s.slice(1, -1).trim();
  return s.length > 0 ? s : null;
}

/** True when `s` = `{…}` and the outer braces pair with each other. */
function balancedInside(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Carry over what citation-js's BibTeX → CSL mapping drops, so a
 * CITATIONS.bib written by the library writer reads back whole (SRC-12,
 * D-19-19):
 *   - `abstract` → CSL `abstract` (Pass 2 reads it), decoded by citation-js's
 *     own BibLaTeX mapping (the same LaTeX decoder as every other field);
 *   - `pmid` → CSL `PMID` (Pass 1 resolves a DOI-less PubMed record by it);
 *   - `eprint`, `archivePrefix` (or BibLaTeX `eprinttype`) and `primaryClass`
 *     (or `eprintclass`) → the same-named keys, verbatim — the arXiv identity
 *     of a preprint — plus CSL `URL` = its arXiv abstract page (what pandoc
 *     citeproc prints for such an entry) when the entry has no URL.
 * Entries are matched to CSL items by position (citation-js maps entries 1:1)
 * and checked by citekey.
 */
function carryDroppedFields(raw: RawBibEntry[], data: Array<Record<string, unknown>>): void {
  const aligned = raw.length === data.length && raw.every((e, i) => e.label === data[i]?.['id']);
  if (!aligned) return;
  const withAbstract: Array<{ index: number; abstract: string }> = [];
  raw.forEach((e, index) => {
    const out = data[index]!;
    const abs = e.properties?.['abstract'];
    if (typeof abs === 'string' && abs.trim().length > 0) withAbstract.push({ index, abstract: abs });
    // `pmid` → CSL `PMID` (citation-js maps it for BibLaTeX input only).
    const pmid = rawField(e, 'pmid');
    if (pmid && typeof out['PMID'] !== 'string') out['PMID'] = pmid;
    const eprint = rawField(e, 'eprint');
    if (eprint) {
      out['eprint'] = eprint;
      const prefix = rawField(e, 'archiveprefix') ?? rawField(e, 'eprinttype');
      if (prefix) out['archivePrefix'] = prefix;
      const cls = rawField(e, 'primaryclass') ?? rawField(e, 'eprintclass');
      if (cls) out['primaryClass'] = cls;
      // Pandoc citeproc links an arXiv eprint to its abstract page; the offline
      // renderer gets the same link through CSL `URL`.
      if (prefix !== null && /^arxiv$/i.test(prefix) && typeof out['URL'] !== 'string') {
        out['URL'] = `https://arxiv.org/abs/${eprint}`;
      }
    }
  });
  if (withAbstract.length === 0) return;
  const decoded = new Cite(
    withAbstract.map((a) => ({ type: 'misc', label: `abstract-${a.index}`, properties: { abstract: a.abstract } })),
    { forceType: '@biblatex/entries+list' },
  ).data as Array<Record<string, unknown>>;
  if (decoded.length !== withAbstract.length) return;
  withAbstract.forEach((a, j) => {
    const text = decoded[j]?.['abstract'];
    if (typeof text === 'string' && text.length > 0) data[a.index]!['abstract'] = text;
  });
}

/**
 * Plan-spec alias for `parseBib`. Both names resolve to the same
 * canonical implementation so the plan's `parseBibtex` reference and the
 * Wave 0 test's `parseBib` import both work.
 */
export const parseBibtex = parseBib;

/**
 * Parse the CONTENTS OF A CITATIONS.bib FILE. A whitespace-only file is a
 * valid document with zero entries — bin/lib/library.ts renders an empty
 * library that way (BRDTH-01) — so it yields []. Anything else goes through
 * the strict parseBib (T-3-04): malformed text still throws. This never lets
 * a citation look "absent": a draft that cites a key an empty bib lacks is
 * FABRICATED in Pass 1, exactly as a key missing from a non-empty bib is.
 */
export async function parseBibFile(text: string): Promise<Array<Record<string, unknown>>> {
  if (typeof text === 'string' && text.trim().length === 0) return [];
  return parseBib(text);
}

/**
 * A `.paper/CITATIONS.bib` (or an exported bib) that does not parse — an
 * expected, user-fixable condition: one line naming the file and the way out
 * (RUN-12), never an internal-error hint. It is never read as "no entries":
 * verify, compile and done stop here (fail closed).
 */
export class BibParseError extends PensmithError {
  constructor(file: string, detail: string) {
    super(
      `${file} is not valid BibTeX (${detail}) — fix that entry by hand, or re-render the file from ` +
        'LIBRARY.json: `pensmith research` or `pensmith add <id>` rewrites it',
      EXIT_ERROR,
    );
    this.name = 'BibParseError';
  }
}

/**
 * parseBibFile for a file on disk: a parse failure is a one-line BibParseError
 * naming `file` (verify, compile and done read CITATIONS.bib through this).
 */
export async function parseBibFileAt(text: string, file: string): Promise<Array<Record<string, unknown>>> {
  try {
    return await parseBibFile(text);
  } catch (e) {
    const raw = (e instanceof Error ? e.message : String(e)).replace(/^parseBib: invalid BibTeX — /, '');
    const first = raw.split('\n')[0] ?? '';
    throw new BibParseError(file, first.length > 160 ? `${first.slice(0, 160)}…` : first);
  }
}

// =====================================================================
//   Entry-by-entry parse (VRFY-16, D-20-20)
// =====================================================================

/** One BibTeX entry of a bibliography that does not parse on its own. */
export interface BibEntryProblem {
  /** The entry's citekey as written (`@article{<key>, …`), or null when its head cannot be read. */
  readonly key: string | null;
  /** 1-based line of the entry's `@` in the file. */
  readonly line: number;
  /** One line: why the entry does not parse. */
  readonly detail: string;
}

/** A bibliography read entry by entry: the entries that parse, and the ones that do not. */
export interface BibEntriesResult {
  /** CSL-JSON entries (as parseBib returns them) of every entry that parses. */
  readonly entries: Array<Record<string, unknown>>;
  /** Every entry that does not parse on its own, in file order. */
  readonly problems: BibEntryProblem[];
}

/** One `@type{…}` / `@type(…)` block of a BibTeX text. */
interface BibBlock {
  readonly type: string;
  readonly start: number;
  readonly text: string;
  /** False when the block's delimiters never balance (it is cut at the next entry head, or at the end). */
  readonly closed: boolean;
}

const ENTRY_HEAD_RE = /@([A-Za-z][A-Za-z0-9_-]*)\s*([{(])/y;
/** A line that starts a new entry (used to cut a block whose braces never balance). */
const LINE_ENTRY_HEAD_RE = /(?:^|\n)[ \t]*@[A-Za-z][A-Za-z0-9_-]*\s*[{(]/g;

/**
 * Split a BibTeX text into its `@type{…}` blocks (text between blocks is a
 * comment, as in BibTeX). A block ends at the brace (or parenthesis) that
 * balances its opening one; one that never balances is cut at the next line
 * that starts an entry, so one broken entry never swallows the entries after it.
 */
function splitBibBlocks(text: string): BibBlock[] {
  const out: BibBlock[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@', i);
    if (at === -1) break;
    ENTRY_HEAD_RE.lastIndex = at;
    const head = ENTRY_HEAD_RE.exec(text);
    if (!head) {
      i = at + 1;
      continue;
    }
    const type = (head[1] ?? '').toLowerCase();
    const open = head[2] ?? '{';
    // Brace depth inside the entry: a `{…}` entry closes when its opening
    // brace balances; a `(…)` entry at the first `)` outside braces.
    let depth = open === '{' ? 1 : 0;
    let end = -1;
    for (let j = at + head[0].length; j < text.length; j++) {
      const ch = text[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (open === '{' && depth === 0) {
          end = j + 1;
          break;
        }
        if (depth < 0) depth = 0;
      } else if (open === '(' && ch === ')' && depth === 0) {
        end = j + 1;
        break;
      }
    }
    if (end !== -1) {
      out.push({ type, start: at, text: text.slice(at, end), closed: true });
      i = end;
      continue;
    }
    // Never balanced: cut at the next line that starts an entry.
    LINE_ENTRY_HEAD_RE.lastIndex = at + head[0].length;
    const next = LINE_ENTRY_HEAD_RE.exec(text);
    const cut = next ? next.index + (next[0].startsWith('\n') ? 1 : 0) : text.length;
    out.push({ type, start: at, text: text.slice(at, cut), closed: false });
    i = cut;
  }
  return out;
}

/** The citekey written in a block's head (`@article{key,`), or null. */
function blockKey(block: BibBlock): string | null {
  const m = /^@[A-Za-z][A-Za-z0-9_-]*\s*[{(]\s*([^,\s{}()"]+)\s*,/.exec(block.text);
  return m?.[1] ?? null;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
}

function oneLine(msg: string): string {
  // The parser's own "at line L col C" counts within the entry; the problem
  // carries the entry's line in the file instead.
  const first = (msg.replace(/^parseBib: invalid BibTeX — /, '').replace(/^parseBib: /, '').split('\n')[0] ?? '')
    .replace(/\s+at line \d+ col \d+:?\s*$/, '')
    .trim();
  return first.length > 160 ? `${first.slice(0, 160)}…` : first || 'invalid BibTeX';
}

/**
 * Parse a CITATIONS.bib text ENTRY BY ENTRY (VRFY-16, D-20-20): every
 * `@type{key, …}` block is parsed on its own, so one broken entry never hides
 * the others. Returns the entries that parse (CSL-JSON, exactly as parseBib
 * returns them) and, for each entry that does not, its key as written and its
 * line. A key defined in more than one block (compared without regard to
 * case, as BibTeX does) is a problem for every one of its blocks and never an
 * entry (review round 3). Never throws. A whitespace-only text is zero
 * entries; a text with no entry at all is one problem (line 1). `@comment`
 * and `@preamble` blocks are skipped; `@string` definitions are applied to
 * every entry.
 */
export function parseBibEntries(text: string): BibEntriesResult {
  const { entries, problems } = parseBibEntriesRaw(text);
  return { entries: entries.map(detachGraph), problems };
}

/**
 * citation-js keeps, on every entry, a `_graph` of the parse that holds the
 * whole input text's raw entries: serialized, a bibliography of n entries is
 * n² in size (a 60-entry library became megabytes in the MCP verify reply).
 * The graph stays readable (the raw fields CSL has no slot for — rawBibFields)
 * but is not enumerable, so JSON and object spreads leave it out.
 */
function detachGraph(entry: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(entry, '_graph')) return entry;
  const graph = entry['_graph'];
  delete entry['_graph'];
  Object.defineProperty(entry, '_graph', { value: graph, enumerable: false, configurable: true, writable: true });
  return entry;
}

/**
 * The BibTeX fields of an entry parseBibEntries returned, as written (names
 * lower-cased, values with their outer braces removed) — citation-js keeps
 * them in the entry's `_graph`. The biblatex fields CSL has no slot for
 * (`date`, `subtitle`, `titleaddon`, `maintitle`, …), which Pandoc's biblatex
 * reader renders, are only here. Empty when the parser kept no raw entry.
 */
export function bibEntryRawFields(entry: Record<string, unknown>): Readonly<Record<string, string>> {
  const graph = entry['_graph'];
  if (!Array.isArray(graph)) return {};
  const label = String(entry['citation-key'] ?? entry['id'] ?? '');
  for (const step of graph as Array<{ data?: unknown }>) {
    if (!Array.isArray(step?.data)) continue;
    for (const e of step.data as Array<{ label?: unknown; properties?: Record<string, unknown> }>) {
      if (e?.label !== label || typeof e.properties !== 'object' || e.properties === null) continue;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.properties)) {
        if (typeof v === 'string') out[k.toLowerCase()] = v.replace(/^\{(.*)\}$/s, '$1').trim();
      }
      return out;
    }
  }
  return {};
}

/**
 * The keys (lower case — BibTeX and biber match keys without regard to case)
 * written in more than one block, each with the lines of its blocks.
 */
function duplicateKeyLines(blocks: readonly BibBlock[], text: string): Map<string, number[]> {
  const lines = new Map<string, number[]>();
  for (const b of blocks) {
    const key = blockKey(b);
    if (key === null) continue;
    const k = key.toLowerCase();
    lines.set(k, [...(lines.get(k) ?? []), lineOf(text, b.start)]);
  }
  for (const [k, at] of lines) if (at.length < 2) lines.delete(k);
  return lines;
}

function parseBibEntriesRaw(text: string): BibEntriesResult {
  if (typeof text !== 'string' || text.trim().length === 0) return { entries: [], problems: [] };
  const blocks = splitBibBlocks(text);
  const strings = blocks.filter((b) => b.type === 'string' && b.closed).map((b) => b.text).join('\n');
  const regular = blocks.filter((b) => b.type !== 'string' && b.type !== 'comment' && b.type !== 'preamble');
  if (regular.length === 0) {
    return { entries: [], problems: [{ key: null, line: 1, detail: 'no BibTeX entry found (every entry starts with @type{key, …})' }] };
  }
  // A key defined more than once (review round 3): Pass 1 would judge one
  // entry while Pandoc renders the last and BibTeX / biber the first, so the
  // export could print metadata no pass compared. Every such block is a
  // problem (never an entry): a cited duplicate is UNPARSEABLE and blocks.
  const dupLines = duplicateKeyLines(regular, text);
  // Fast path: the whole text parses and yields one entry per block.
  if (dupLines.size === 0 && regular.every((b) => b.closed)) {
    try {
      const all = parseBibSync(text);
      if (all.length === regular.length) return { entries: all, problems: [] };
    } catch {
      /* one or more entries do not parse — go entry by entry */
    }
  }
  const entries: Array<Record<string, unknown>> = [];
  const problems: BibEntryProblem[] = [];
  for (const block of regular) {
    const key = blockKey(block);
    const line = lineOf(text, block.start);
    const dups = key !== null ? dupLines.get(key.toLowerCase()) : undefined;
    if (dups !== undefined) {
      problems.push({
        key,
        line,
        detail: `the key is defined ${dups.length} times (lines ${dups.join(', ')}) — keep one entry: the verifier cannot tell which one the export prints`,
      });
      continue;
    }
    if (!block.closed) {
      problems.push({ key, line, detail: 'the entry\'s braces never close' });
      continue;
    }
    try {
      const parsed = parseBibSync(strings.length > 0 ? `${strings}\n${block.text}` : block.text);
      if (parsed.length !== 1) {
        problems.push({ key, line, detail: `the entry parsed as ${parsed.length} entries` });
        continue;
      }
      entries.push(parsed[0] as Record<string, unknown>);
    } catch (e) {
      problems.push({ key, line, detail: oneLine(e instanceof Error ? e.message : String(e)) });
    }
  }
  return { entries, problems };
}

// =====================================================================
//   Public: renderStyle (CITE-02 / CITE-03 — generic N-style renderer)
// =====================================================================
/**
 * Render the supplied parsed entries as a reference list in the given
 * `style` using the bundled `templates/citation-styles/<style>.csl`.
 *
 * Supported styles: apa, mla, chicago-notes-bib, chicago-author-date,
 * ieee, ama, vancouver, harvard.
 *
 * Accepts the array returned from `parseBib`. Registration is memoized via
 * the registeredStyles Map (Pitfall 1 collision guard) so back-to-back
 * calls for the same style never throw "template already registered".
 *
 * DETERMINISTIC + OFFLINE: format:'text' + lang:'en-US' make citeproc use
 * the bundled en-US locale (no fetch) and emit byte-identical output for
 * identical input. The .csl is read via readFileSync — no render-time
 * network access (T-10-01-04).
 *
 * Throws a clear Error naming the missing path for an unknown style (no
 * silent empty output — T-10-01-01).
 */
export async function renderStyle(
  entries: Array<Record<string, unknown>>,
  style: string,
): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderStyle: input must be an array of parsed entries (from parseBib)');
  }
  ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
  });
}

// =====================================================================
//   Public: renderInText (REND-01 / Phase 13 — per-entry in-text renderer)
// =====================================================================
/**
 * Render the supplied parsed entries as an in-text citation in the given
 * `style` using the bundled `templates/citation-styles/<style>.csl`.
 *
 * This is the in-text SIBLING of renderStyle (which renders a full bibliography).
 * Pass ONE entry at a time to get a per-key in-text string that can be
 * substituted token-by-token into a document (Pitfall 1 guard — passing all
 * entries at once yields one combined string for the entire group). For a
 * single-entry group in numeric styles (IEEE, Vancouver, AMA) the result
 * is always [1] or "1" — correct for single-entry groups; correct sequential
 * numbering for a full document requires the Pandoc citeproc path.
 *
 * Accepts the array returned from `parseBib` (or a one-element slice of it).
 * Registration is memoized via ensureStyleTemplate (Pitfall 2 collision guard).
 *
 * DETERMINISTIC + OFFLINE: format:'text' + lang:'en-US' (same as renderStyle).
 * No wall-clock, no fetch — byte-stable for identical input.
 *
 * Throws a clear TypeError on a non-array input (mirrors renderStyle's guard).
 */
export async function renderInText(
  entries: Array<Record<string, unknown>>,
  style: string,
): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderInText: input must be an array of parsed entries (from parseBib)');
  }
  ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('citation', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
  });
}

/**
 * One cited source of a citation, as CSL's citation items carry it (review
 * round 3 of Phase 18: the offline renderer keeps what Pandoc keeps).
 */
export interface CitationItemInput {
  /** The entry's citekey (its CSL `id`). */
  readonly id: string;
  /** Text before the reference (`see `), spacing included. */
  readonly prefix?: string;
  /** Text after it (`, emphasis added`), spacing included. */
  readonly suffix?: string;
  /** A locator and its CSL label (`5` / `page`). */
  readonly locator?: string;
  readonly label?: string;
  /** Leave the author out (`-@key`, and the year part of a narrative citation). */
  readonly suppressAuthor?: boolean;
  /** Only the author (the name part of a narrative citation). */
  readonly authorOnly?: boolean;
}

/**
 * Render ONE citation — its items in order, with their prefixes, suffixes,
 * locators and author suppression — in `style`, as renderInText does for a
 * bare key. `entries` is the parsed bibliography (every item's id must be in
 * it); `citedInOrder` the document's cited keys in first-citation order (so a
 * numeric style numbers them as the bibliography does when it is rendered from
 * entries in that order). A style that cannot print a part (an author-only
 * item in a numeric style) yields the text citeproc gives; the caller decides.
 */
export async function renderCitationItems(
  entries: Array<Record<string, unknown>>,
  style: string,
  items: readonly CitationItemInput[],
  citedInOrder: readonly string[] = [],
): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderCitationItems: input must be an array of parsed entries (from parseBib)');
  }
  ensureStyleTemplate(style);
  // A numeric style numbers sources in the order the document first cites
  // them: one prior citation of every cited key in that order gives each item
  // its document number (not "[1]" for each citation). A note style is left
  // alone — a prior citation would print "Ibid.".
  const citationsPre = citedInOrder.length > 0 && !noteStyles.has(style)
    ? [{ citationItems: citedInOrder.map((id) => ({ id })), properties: { noteIndex: 0 } }]
    : [];
  const cite = new Cite(entries, { forceType: '@csl/object' });
  const entry = items.map((i) => ({
    id: i.id,
    ...(i.prefix ? { prefix: i.prefix } : {}),
    ...(i.suffix ? { suffix: i.suffix } : {}),
    ...(i.locator ? { locator: i.locator, label: i.label ?? 'page' } : {}),
    ...(i.suppressAuthor ? { 'suppress-author': true } : {}),
    ...(i.authorOnly ? { 'author-only': true } : {}),
  }));
  return cite.format('citation', {
    format: 'text',
    template: `pensmith-${style}`,
    lang: 'en-US',
    entry,
    citationsPre,
  } as Parameters<typeof cite.format>[1]);
}

// =====================================================================
//   Public: resolveStyleName (discipline → CSL style name)
// =====================================================================
/**
 * Map a discipline (a preset slug, name or alias from INTAKE.md) to its
 * default citation style name (the key `renderStyle` expects). The mapping is
 * the discipline preset's `defaultCitationStyle` — bin/lib/disciplines.ts is
 * the one place a discipline maps to a style (GRND-06, PRD §8); an unknown
 * discipline gets the fallback preset's style.
 */
export function resolveStyleName(discipline: string): string {
  return defaultCitationStyleFor(discipline);
}

// =====================================================================
//   Public: renderApa (locked Wave-0 contract — delegates to renderStyle)
// =====================================================================
/**
 * Render the supplied parsed entries as an APA-7 reference list using
 * the bundled apa.csl template.
 *
 * Accepts the array returned from `parseBib` (the Wave 0 test contract).
 * This is the LOCKED Wave-0 export: its name, async-ness, and single-array
 * argument signature are unchanged.
 *
 * H2 single-registration fix: the body delegates to renderStyle(entries,'apa')
 * after the array guard, so 'pensmith-apa' has exactly ONE registrar
 * (ensureStyleTemplate). Output is byte-identical to the previous
 * self-contained implementation — same apa.csl (via the 'apa'
 * STYLE_FILENAMES entry), same 'pensmith-apa' template name, same
 * format:'text' / lang:'en-US' options. Calling renderApa() and
 * renderStyle(entries,'apa') in one process no longer collides.
 *
 * The not-yet-present apa.csl case is handled inside ensureStyleTemplate,
 * which throws a clear Error naming the path (no silent empty output).
 */
export async function renderApa(entries: Array<Record<string, unknown>>): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderApa: input must be an array of parsed entries (from parseBib)');
  }
  return renderStyle(entries, 'apa');
}
