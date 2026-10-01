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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PensmithError, EXIT_ERROR } from './exit-codes.js';
import { pluginTemplatePath } from './paths.js';
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

// The bundled CSL styles live in the plugin's templates/citation-styles/
// (PLUG-02); paths.ts pluginTemplatePath resolves them from this module's own
// location in every layout (source, dist/, an npm install, the plugin bundle).

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

/** The citeproc template name of each style registered by a `.csl` file, by the style argument (D-21-07). */
const fileStyleTemplates = new Map<string, string>();

/** True when `style` names a CSL file (a path ending in `.csl`) rather than a bundled style key. */
export function isCslFileStyle(style: string): boolean {
  return /\.csl$/i.test(style) && (isAbsolute(style) || /[\\/]/.test(style));
}

/**
 * The CSL XML of `style`: a bundled key (`apa`, …, read from the plugin's
 * citation-styles/) or a `.csl` file path (D-21-07; the caller validated it —
 * export-style.ts `validateCslFile`). Throws a clear Error naming the path when
 * the file is absent (no silent empty output — T-10-01-01).
 */
export function cslStyleText(style: string): string {
  const cslPath = isCslFileStyle(style)
    ? style
    : pluginTemplatePath('citation-styles', `${STYLE_FILENAMES[style] ?? style}.csl`);
  if (!existsSync(cslPath)) {
    throw new Error(`renderStyle: CSL file not found for style '${style}' at ${cslPath}`);
  }
  return readFileSync(cslPath, 'utf8');
}

/**
 * Register `style` with citeproc once per process and return its template
 * name: `pensmith-<key>` for a bundled style; for a `.csl` file, a name made
 * from the sha256 of its bytes, so two files with the same name never collide
 * and an edited file is registered afresh (D-21-07).
 */
function ensureStyleTemplate(style: string): string {
  if (isCslFileStyle(style)) {
    const cslString = cslStyleText(style);
    const name = `pensmith-csl-${createHash('sha256').update(cslString).digest('hex').slice(0, 24)}`;
    if (!registeredStyles.get(name)) {
      plugins.config.get('@csl').templates.add(name, cslString);
      if (/<style\b[^>]*\bclass="note"/.test(cslString)) noteStyles.add(name);
      registeredStyles.set(name, true);
    }
    fileStyleTemplates.set(style, name);
    return name;
  }
  const name = `pensmith-${style}`;
  if (registeredStyles.get(style)) return name;
  const cslString = cslStyleText(style);
  plugins.config.get('@csl').templates.add(name, cslString);
  if (/<style\b[^>]*\bclass="note"/.test(cslString)) noteStyles.add(name);
  registeredStyles.set(style, true);
  return name;
}

/** True when `style` (a key or a `.csl` path) is a note style (`class="note"`): its citations are footnotes. */
export function isNoteStyle(style: string): boolean {
  return noteStyles.has(ensureStyleTemplate(style));
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
 * n² in size (a 60-entry library once made the MCP verify reply megabytes
 * long; that reply is now a projection that carries no entry, verify-reply.ts).
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
  const template = ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template,
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
  const template = ensureStyleTemplate(style);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('citation', {
    format: 'text',
    template,
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
  const template = ensureStyleTemplate(style);
  // A numeric style numbers sources in the order the document first cites
  // them: one prior citation of every cited key in that order gives each item
  // its document number (not "[1]" for each citation). A note style is left
  // alone — a prior citation would print "Ibid.".
  const citationsPre = citedInOrder.length > 0 && !noteStyles.has(template)
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
    template,
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

// =====================================================================
//   Case protection (D-21-06, carry-over 1: "APA lowercases `china`")
// =====================================================================
// Neither renderer may lowercase a word the source capitalised unless it can
// tell the word is not a proper noun. Both export paths render from the SAME
// protected CSL items: citeproc-js reads them here, and pandoc reads them as
// the CSL JSON bibliography `references.json` (export/pandoc.ts) — never a
// BibTeX file, whose reader sentence-cases every title and so lowercases
// "China" and "World Bank". The stored bibliographies (`.paper/CITATIONS.bib`,
// `export/CITATIONS.bib`) keep the gated bytes; only the renderer input is
// protected. The rule, per title:
//   - acronyms and mixed-case words (`NGO`, `COVID-19`, `iPhone`, `McDonald`)
//     are always protected;
//   - a title that is not Title Case (it has a lowercase content word) gets
//     every capitalised word after its first protected (`Economic growth in
//     China and the World Bank's lending policy`);
//   - a Title Case title is protected whole: a proper noun cannot be told from
//     a capitalised word there, and no sentence-casing is better than wrong
//     lowercasing.

/** The CSL title variables the case-protection pass covers. */
const TITLE_FIELDS: readonly string[] = [
  'title', 'title-short', 'shortTitle', 'container-title', 'container-title-short', 'collection-title',
  'volume-title', 'original-title', 'event-title', 'reviewed-title',
];

/** Words a Title Case title leaves in lower case (CSL's title-case stop words, and `vs.`, `v.`, `per`, `than`, `upon`, `versus`). */
const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'down', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'onto', 'or', 'over',
  'so', 'the', 'till', 'to', 'up', 'via', 'with', 'yet', 'vs', 'v', 'per', 'than', 'upon', 'versus', 'et', 'al',
]);

const NOCASE_OPEN = '<span class="nocase">';
const NOCASE_CLOSE = '</span>';

/** A word's letters and digits without the punctuation around it (`"China,"` → `China`). */
function wordCore(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** True for an acronym or a mixed-case word: two or more capitals, or a capital after a lowercase letter. */
function isMixedCase(core: string): boolean {
  return (core.match(/\p{Lu}/gu)?.length ?? 0) >= 2 || /\p{Ll}\p{Lu}/u.test(core);
}

/**
 * `title` with the words D-21-06 protects wrapped in citeproc's
 * `<span class="nocase">` (the rule is in the section header). Markup the
 * parser put in a title (`<i>…</i>`) is kept: words are read between tags.
 */
export function caseProtectTitle(title: string): string {
  if (title.includes(NOCASE_OPEN)) return title;
  const words: Array<{ start: number; end: number; text: string }> = [];
  const re = /<[^>]*>|[^\s<]+/g;
  for (const m of title.matchAll(re)) {
    if (m[0].startsWith('<')) continue;
    words.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const lettered = words.filter((w) => /\p{L}/u.test(w.text));
  if (lettered.length === 0) return title;
  const titleCase = lettered.every((w, i) => {
    const core = wordCore(w.text);
    if (core === '' || !/^\p{L}/u.test(core)) return true;
    if (i > 0 && TITLE_STOP_WORDS.has(core.toLowerCase())) return true;
    return /^\p{Lu}/u.test(core);
  });
  if (titleCase) return `${NOCASE_OPEN}${title}${NOCASE_CLOSE}`;
  let out = '';
  let at = 0;
  lettered.forEach((w, i) => {
    const core = wordCore(w.text);
    const capitalised = i > 0 && /^\p{Lu}/u.test(core);
    if (!capitalised && !isMixedCase(core)) return;
    out += title.slice(at, w.start) + NOCASE_OPEN + w.text + NOCASE_CLOSE;
    at = w.end;
  });
  return out + title.slice(at);
}

/**
 * The renderer's input items: a plain copy of each parsed entry (no parser
 * graph) with its title variables case-protected (D-21-06). The exporter
 * gives the same items to citeproc-js and, as CSL JSON, to pandoc.
 */
export function caseProtectItems(entries: ReadonlyArray<Record<string, unknown>>): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) if (k !== '_graph') copy[k] = v;
    for (const field of TITLE_FIELDS) {
      const v = copy[field];
      if (typeof v === 'string' && v.trim() !== '') copy[field] = caseProtectTitle(v);
    }
    return copy;
  });
}

// =====================================================================
//   The document renderer (D-21-03, D-21-04): one citeproc pass
// =====================================================================
// One citeproc-js engine processes EVERY citation of a document in document
// order (`rebuildProcessorState`, each citation with its note index in a note
// style), then makes the bibliography from the same engine — so numbering,
// first / subsequent / ibid note forms, disambiguation and bibliography order
// are the engine's, as in pandoc, never assembled per citation. A narrative
// (author-in-text) citation is rendered as pandoc renders it: the author-only
// form of its item in the text, and the item with the author suppressed after
// it (an in-text style) or in its note (a note style). citeproc's HTML output
// is parsed into rich-text runs that each writer serialises.

/** One run of rendered text and its formatting. */
export interface RichRun {
  readonly text: string;
  readonly italic?: true;
  readonly bold?: true;
  readonly sup?: true;
  readonly sub?: true;
  readonly smallCaps?: true;
  /** The target of a link (a DOI or URL the style prints). */
  readonly href?: string;
}

/** One citation of a document, in document order. */
export interface DocumentCitation {
  readonly items: readonly CitationItemInput[];
  /** A narrative citation (`@key says`): its one item's author stands in the text. */
  readonly narrative?: boolean;
}

/** What one citation renders to. */
export interface RenderedCitation {
  /**
   * The runs that stand in the text where the citation was: an in-text
   * citation, or a narrative citation's author (followed, in an in-text style,
   * by the rest). Empty for a note style's bracketed citation, and when the
   * style prints nothing for it.
   */
  readonly inline: readonly RichRun[];
  /** The text of the citation's footnote (a note style), else null. */
  readonly note: readonly RichRun[] | null;
}

/** One bibliography entry: its key, its margin label (`[1]`, `1.`) when the style sets one apart, and its text. */
export interface RenderedBibEntry {
  readonly id: string;
  readonly label: readonly RichRun[] | null;
  readonly runs: readonly RichRun[];
}

/** A document's rendered citations and bibliography. */
export interface RenderedDocument {
  readonly noteStyle: boolean;
  readonly citations: readonly RenderedCitation[];
  /** The bibliography of exactly the cited keys, in the style's order. */
  readonly bibliography: readonly RenderedBibEntry[];
  /** The style asks for hanging-indent bibliography paragraphs. */
  readonly hangingIndent: boolean;
}

/** The plain text of runs. */
export function runsText(runs: readonly RichRun[]): string {
  return runs.map((r) => r.text).join('');
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = lookupTable({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
});

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

type RunStyle = Omit<RichRun, 'text'>;

function styleAttr(attrs: string, base: RunStyle): RunStyle {
  const out: { -readonly [K in keyof RunStyle]: RunStyle[K] } = { ...base };
  const style = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
  for (const decl of style.split(';')) {
    const [prop, value] = decl.split(':').map((x) => x.trim().toLowerCase());
    if (prop === 'font-style') {
      if (value === 'italic' || value === 'oblique') out.italic = true;
      else delete out.italic;
    } else if (prop === 'font-weight') {
      if (value === 'bold' || (value !== undefined && Number(value) >= 600)) out.bold = true;
      else delete out.bold;
    } else if (prop === 'font-variant') {
      if (value === 'small-caps') out.smallCaps = true;
      else delete out.smallCaps;
    } else if (prop === 'vertical-align') {
      delete out.sup;
      delete out.sub;
      if (value === 'super' || value === 'sup') out.sup = true;
      else if (value === 'sub') out.sub = true;
    }
  }
  return out;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.italic === b.italic && a.bold === b.bold && a.sup === b.sup && a.sub === b.sub && a.smallCaps === b.smallCaps && a.href === b.href;
}

/** citeproc-js HTML (its `html` output format) as rich-text runs. */
export function citeprocHtmlRuns(html: string): RichRun[] {
  const out: RichRun[] = [];
  const stack: Array<{ tag: string; style: RunStyle }> = [];
  let cur: RunStyle = {};
  const push = (text: string): void => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last !== undefined && sameStyle(last, cur)) out[out.length - 1] = { ...last, text: last.text + text };
    else out.push({ ...cur, text });
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      push(decodeEntities(m[5]));
      continue;
    }
    const tag = (m[2] as string).toLowerCase();
    if (tag === 'br') {
      push('\n');
      continue;
    }
    if (m[1] === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if ((stack[i] as { tag: string }).tag !== tag) continue;
        cur = (stack[i] as { style: RunStyle }).style;
        stack.length = i;
        break;
      }
      continue;
    }
    if (m[4] === '/') continue;
    const attrs = m[3] ?? '';
    let next: RunStyle = styleAttr(attrs, cur);
    if (tag === 'i' || tag === 'em') next = { ...next, italic: true };
    else if (tag === 'b' || tag === 'strong') next = { ...next, bold: true };
    else if (tag === 'sup') next = { ...next, sup: true };
    else if (tag === 'sub') next = { ...next, sub: true };
    else if (tag === 'a') {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
      if (href !== undefined) next = { ...next, href: decodeEntities(href) };
    }
    stack.push({ tag, style: cur });
    cur = next;
  }
  return out;
}

/** Runs with the white space at both ends removed (and empty runs dropped). */
function trimRuns(runs: readonly RichRun[]): RichRun[] {
  const out = runs.filter((r) => r.text !== '').map((r) => ({ ...r }));
  while (out.length > 0 && (out[0] as RichRun).text.trim() === '') out.shift();
  while (out.length > 0 && (out[out.length - 1] as RichRun).text.trim() === '') out.pop();
  if (out.length === 0) return out;
  out[0] = { ...(out[0] as RichRun), text: (out[0] as RichRun).text.replace(/^\s+/u, '') };
  const li = out.length - 1;
  out[li] = { ...(out[li] as RichRun), text: (out[li] as RichRun).text.replace(/\s+$/u, '') };
  return out;
}

/** A citation's printed runs, or [] when the style prints nothing for it (`[NO_PRINTED_FORM]`, an empty `()`). */
function printedRuns(html: string): RichRun[] {
  if (html.includes('NO_PRINTED_FORM')) return [];
  const runs = trimRuns(citeprocHtmlRuns(html));
  return /[\p{L}\p{N}]/u.test(runsText(runs)) ? runs : [];
}

/** One citeproc citation item from a CitationItemInput. */
function citeprocItem(i: CitationItemInput, flag?: 'suppress-author' | 'author-only'): Record<string, unknown> {
  return {
    id: i.id,
    ...(i.prefix ? { prefix: i.prefix } : {}),
    ...(i.suffix ? { suffix: i.suffix } : {}),
    ...(i.locator ? { locator: i.locator, label: i.label ?? 'page' } : {}),
    ...(i.suppressAuthor || flag === 'suppress-author' ? { 'suppress-author': true } : {}),
    ...(flag === 'author-only' ? { 'author-only': true } : {}),
  };
}

/** The citeproc engine (citation-js's CSL plugin) for `template`, over `items`, emitting HTML. */
interface CiteprocEngine {
  rebuildProcessorState(citations: unknown[], mode: string, uncited: unknown[]): Array<[string, number, string]>;
  makeBibliography(): [{ entry_ids: string[][]; hangingindent?: unknown; 'second-field-align'?: unknown }, string[]] | false;
  opt: { development_extensions: Record<string, unknown> };
}

function citeprocEngine(items: ReadonlyArray<Record<string, unknown>>, template: string): CiteprocEngine {
  const util = (Cite as unknown as { util: { downgradeCsl(items: unknown): unknown } }).util;
  const data = util.downgradeCsl(items.map((i) => ({ ...i }))) as unknown[];
  const engine = (plugins.config.get('@csl') as unknown as { engine(d: unknown[], t: string, l: string, f: string): CiteprocEngine }).engine(
    data, template, 'en-US', 'html',
  );
  // Links for the DOIs and URLs a style prints (each writer decides how to show them).
  engine.opt.development_extensions['wrap_url_and_doi'] = true;
  return engine;
}

/**
 * Render every citation of a document and its bibliography in `style` (a
 * bundled key or a `.csl` path) through ONE citeproc engine (D-21-03; the
 * section header has the rules). `entries` are parsed bibliography entries
 * (every cited id must be among them; they are case-protected here, D-21-06);
 * `citations` are the document's citations in order. Deterministic and
 * offline. The bibliography holds exactly the cited keys.
 */
export async function renderDocumentCitations(
  entries: ReadonlyArray<Record<string, unknown>>,
  style: string,
  citations: readonly DocumentCitation[],
): Promise<RenderedDocument> {
  if (!Array.isArray(entries)) throw new TypeError('renderDocumentCitations: entries must be an array of parsed entries');
  const template = ensureStyleTemplate(style);
  const noteStyle = noteStyles.has(template);
  const items = caseProtectItems(entries);
  const known = new Set(items.map((e) => String(e['id'] ?? '')));
  for (const c of citations) {
    for (const i of c.items) {
      if (!known.has(i.id)) throw new Error(`renderDocumentCitations: no bibliography entry for "${i.id}"`);
    }
  }
  const build = (flag: 'suppress-author' | 'author-only'): unknown[] =>
    citations.map((c, n) => ({
      citationID: `c${n}`,
      citationItems: c.items.map((i, k) => citeprocItem(i, c.narrative === true && k === 0 ? flag : undefined)),
      properties: { noteIndex: noteStyle ? n + 1 : 0 },
    }));
  // The author-only pass first (only when a narrative citation needs it): its
  // positions are the same as the main pass's, so a narrative citation's name
  // takes the first or subsequent form pandoc gives it.
  const authors: string[] = [];
  if (citations.some((c) => c.narrative === true)) {
    const passB = citeprocEngine(items, template).rebuildProcessorState(build('author-only'), 'html', []);
    passB.forEach((r, n) => (authors[n] = r[2]));
  }
  const engine = citeprocEngine(items, template);
  const passA = engine.rebuildProcessorState(build('suppress-author'), 'html', []);
  const rendered: RenderedCitation[] = citations.map((c, n) => {
    const rest = printedRuns(passA[n]?.[2] ?? '');
    if (c.narrative !== true) return noteStyle ? { inline: [], note: rest.length > 0 ? rest : null } : { inline: rest, note: null };
    const author = printedRuns(authors[n] ?? '');
    if (noteStyle) return { inline: author, note: rest.length > 0 ? rest : null };
    const inline = author.length > 0 && rest.length > 0 ? [...author, { text: ' ' }, ...rest] : author.length > 0 ? author : rest;
    return { inline, note: null };
  });
  const bib = citations.length > 0 ? engine.makeBibliography() : false;
  const bibliography: RenderedBibEntry[] = [];
  let hangingIndent = false;
  if (bib !== false) {
    const [meta, html] = bib;
    hangingIndent = Boolean(meta.hangingindent);
    html.forEach((entryHtml, n) => {
      const id = meta.entry_ids[n]?.[0] ?? '';
      const margin = /<div class="csl-left-margin">([\s\S]*?)<\/div>/.exec(entryHtml);
      const right = /<div class="csl-right-inline">([\s\S]*)<\/div>\s*<\/div>\s*$/.exec(entryHtml);
      const label = margin !== null ? trimRuns(citeprocHtmlRuns(margin[1] as string)) : null;
      const body = margin !== null && right !== null ? (right[1] as string) : entryHtml;
      bibliography.push({ id, label: label !== null && label.length > 0 ? label : null, runs: trimRuns(citeprocHtmlRuns(body)) });
    });
  }
  return { noteStyle, citations: rendered, bibliography, hangingIndent };
}
