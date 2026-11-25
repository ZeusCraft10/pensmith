// bin/lib/citations.ts — BibTeX parse + APA render chokepoint per D-19 / CITE-04.
//
// SOLE call site for `citation-js` in the repo. The ESLint chokepoint
// (eslint.config.js → no-restricted-imports for `citation-js`) bans this
// import everywhere EXCEPT this file (per-file `no-restricted-imports`
// override). The red-team fixture at
// tests/fixtures/lint-chokepoint-fixture.ts is the regression gate.
//
// =====================================================================
//   renderCitationsInDocument — the exporter's renderer
// =====================================================================
// The exporter renders a paper's citations through renderCitationsInDocument:
// one citeproc session over every citation in document order, so numeric
// styles number works by first appearance and note styles shorten repeats.
// renderInText / renderStyle render a single group or list on its own and
// stay for callers that need exactly that.
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
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `citation-js@0.7` ships a single default-export class; the `plugins`
// registry hangs off the class (`Cite.plugins`). A `import { plugins }`
// named-import works under esbuild's tsx (which synthesizes CJS-default
// destructure) but FAILS under real Node ESM with
// "does not provide an export named 'plugins'". We bind via the class
// to stay portable across both runtimes.
import Cite, { type BibtexRecord } from 'citation-js';
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
const STYLE_FILENAMES: Readonly<Record<string, string>> = {
  'apa': 'apa',
  'mla': 'mla',
  'chicago-notes-bib': 'chicago-notes-bib',
  'chicago-author-date': 'chicago-author-date',
  'ieee': 'ieee',
  'ama': 'ama',
  'vancouver': 'vancouver',
  'harvard': 'harvard',
};

// Register the bundled CSL template for `style` under the citeproc name
// `pensmith-${style}` exactly once per process. Reads the committed .csl via
// readFileSync (OFFLINE — never fetches). For style==='apa' this resolves to
// templates/citation-styles/apa.csl and registers 'pensmith-apa', the same
// name+bytes the old renderApa used → byte-identical output. Throws a clear Error naming the
// path when the .csl is absent (no silent empty bibliography — T-10-01-01).
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
  if (typeof bibtex !== 'string') {
    throw new TypeError('parseBib: input must be a string (BibTeX source text)');
  }
  try {
    const cite = new Cite(bibtex, { forceType: '@bibtex/text' });
    const data = cite.data as Array<Record<string, unknown>>;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('parseBib: no entries parsed from input (malformed BibTeX or empty document)');
    }
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Re-throw with a clearer prefix so the caller can distinguish
    // "your BibTeX is bad" from other failures further upstream.
    throw new Error(`parseBib: invalid BibTeX — ${msg}`);
  }
}

/**
 * Plan-spec alias for `parseBib`. Both names resolve to the same
 * canonical implementation so the plan's `parseBibtex` reference and the
 * Wave 0 test's `parseBib` import both work.
 */
export const parseBibtex = parseBib;

// =====================================================================
//   Public: formatBibtex — BibTeX that keeps every script
// =====================================================================

// citation-js writes BibTeX in ASCII by default: it turns accented Latin
// letters into LaTeX commands, Greek into math mode, and drops every other
// script (Chinese, Cyrillic, Arabic, ...). With ASCII-only output off it
// escapes nothing at all, so LaTeX's special characters are escaped here
// instead, the way citation-js escapes them. Every other character is kept
// as UTF-8, which Pandoc, biber and reference managers read.
const BIBTEX_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};
// The markup citation-js keeps in titles (<i>, <sc>, <span class="nocase">)
// and turns into LaTeX commands itself.
const RICH_TEXT_TAG = /(<\/?(?:i|b|sc|sup|sub|span)(?:\s[^>]*)?>)/;
// Fields citation-js writes as they are (identifiers, DOI, URL).
const VERBATIM_CSL_FIELDS: ReadonlySet<string> = new Set(['id', 'citation-key', 'type', 'DOI', 'URL']);
const TITLE_CSL_FIELDS: ReadonlySet<string> = new Set([
  'title', 'title-short', 'container-title', 'container-title-short', 'collection-title', 'event-title',
]);

// A capital letter other than A-Z.
const NON_ASCII_CAPITAL = /(?![A-Z])[\p{Lu}\p{Lt}]/u;

/**
 * Pandoc lowercases title words that are not in braces when a style asks
 * for sentence case. citation-js braces only the A-Z part of a word (its
 * pattern stops at any other letter, so ÉCOLE becomes É{COLE}). A word with
 * any other capital (Łódź, Ελλάδα, России, ÉCOLE) is marked as no-case here,
 * which citation-js writes as braces round the whole word.
 */
function protectTitleCase(s: string): string {
  return s
    .split(RICH_TEXT_TAG)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/[\p{L}\p{M}\p{N}]+/gu, (w) => (NON_ASCII_CAPITAL.test(w) ? `<span class="nocase">${w}</span>` : w)),
    )
    .join('');
}

function escapeBibtexText(s: string): string {
  return s
    .split(RICH_TEXT_TAG)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[\\{}&%$#_~^]/g, (c) => BIBTEX_ESCAPES[c] ?? c)))
    .join('');
}

function escapeBibtexValue(v: unknown): unknown {
  if (typeof v === 'string') return escapeBibtexText(v);
  if (Array.isArray(v)) return v.map(escapeBibtexValue);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escapeBibtexValue(x)]));
  }
  return v;
}

/**
 * One entry as citation-js writes it, less the copy of the URL it puts in
 * `howpublished` for a work with no publisher. That copy is a text field,
 * which citation-js does not escape with ASCII-only output off, so a `_`,
 * `%`, `&` or `#` in the URL stopped BibTeX, and Pandoc (which reads `%` as
 * a comment) listed a cut-off second copy of the address. `url` holds it.
 */
function writeBibtexRecord({ type, label, properties }: BibtexRecord): string {
  const fields = Object.entries(properties)
    .filter(([name, value]) => !(name === 'howpublished' && value === properties['url']))
    .map(([name, value]) => `\t${name} = {${value}},\n`)
    .join('');
  return `@${type}{${label},\n${fields}}\n`;
}

/**
 * BibTeX for CSL-JSON `entries`, keyed by each entry's `citation-key` (or
 * `id`). Text in any script is kept as UTF-8.
 */
export function formatBibtex(entries: ReadonlyArray<Record<string, unknown>>): string {
  if (entries.length === 0) return '';
  const prepared = entries.map((e) =>
    Object.fromEntries(
      Object.entries(e).map(([k, v]) => {
        if (VERBATIM_CSL_FIELDS.has(k)) return [k, v];
        return [k, escapeBibtexValue(TITLE_CSL_FIELDS.has(k) && typeof v === 'string' ? protectTitleCase(v) : v)];
      }),
    ),
  );
  const config = plugins.config.get('@bibtex').format;
  const asciiOnly = config.asciiOnly;
  config.asciiOnly = false;
  try {
    const records = new Cite(prepared, { forceType: '@csl/list+object' }).format('bibtex', { format: 'object' });
    return records.map(writeBibtexRecord).join('') + '\n';
  } finally {
    config.asciiOnly = asciiOnly;
  }
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
 * is always [1] or "1" — correct for single-entry groups only. A whole
 * document renders through renderCitationsInDocument.
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

// =====================================================================
//   Public: document-level citation rendering
// =====================================================================

/** One cited work, as the citation grammar parses it. */
export interface CitationItemInput {
  key: string;
  prefix?: string;
  locator?: string;
  label?: string;
  suffix?: string;
  suppressAuthor?: boolean;
}

/** One citation in the document: a bracketed cluster or a narrative `@key`. */
export interface CitationInput {
  narrative: boolean;
  items: CitationItemInput[];
}

export interface RenderedCitations {
  /**
   * One string per input citation, in order. For an in-text style this is the
   * text that replaces the citation. For a note style it is the note's text.
   */
  citations: string[];
  /**
   * For a note style, the text that stays in the running prose (the author's
   * name for a narrative citation, otherwise empty). Empty for in-text styles.
   */
  inline: string[];
  /** The reference list entries, in the order the style sorts them. */
  bibliography: string[];
  /** True when the style puts citations in footnotes (Chicago notes). */
  noteStyle: boolean;
}

// citeproc's marker for a citation that prints nothing (an author-only cite in
// a numeric style).
const NO_PRINTED_FORM = '[NO_PRINTED_FORM]';

function toCiteprocItem(it: CitationItemInput, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { id: it.key, ...extra };
  if (it.prefix) out['prefix'] = /\s$/.test(it.prefix) ? it.prefix : `${it.prefix} `;
  if (it.locator) {
    out['locator'] = it.locator;
    out['label'] = it.label ?? 'page';
  }
  if (it.suffix) out['suffix'] = it.suffix;
  if (it.suppressAuthor) out['suppress-author'] = true;
  return out;
}

/**
 * Render every citation in a document with ONE citeproc session, so numeric
 * styles number works by first appearance, repeated works keep their number,
 * note styles shorten repeated notes, and the reference list follows the
 * style's own order. Rendering citations one at a time gives every numeric
 * citation the number 1.
 *
 * A narrative citation renders like Pandoc's: the author in the prose and the
 * year (or note) after it; in a numeric style it renders as the number alone.
 *
 * Throws when a cited key has no entry in `entries`.
 */
export function renderCitationsInDocument(
  entries: Array<Record<string, unknown>>,
  style: string,
  citations: readonly CitationInput[],
): RenderedCitations {
  ensureStyleTemplate(style);
  const known = new Set(entries.map((e) => String(e['id'] ?? '')));
  for (const c of citations) {
    for (const it of c.items) {
      if (!known.has(it.key)) throw new Error(`no bibliography entry for cited key '${it.key}'`);
    }
  }
  const engine = plugins.config.get('@csl').engine(Cite.util.downgradeCsl(entries), `pensmith-${style}`, 'en-US', 'html');
  const noteStyle = engine.opt?.xclass === 'note';

  // A narrative citation becomes two citeproc citations: the author alone, and
  // the rest with the author suppressed.
  const list: Array<{ citationID: string; citationItems: unknown[]; properties: { noteIndex: number } }> = [];
  let noteIndex = 0;
  citations.forEach((c, i) => {
    const n = noteStyle ? ++noteIndex : 0;
    if (c.narrative) {
      const it = c.items[0]!;
      // The author part stays in the prose, so it is never a note itself.
      list.push({ citationID: `a${i}`, citationItems: [{ id: it.key, 'author-only': true }], properties: { noteIndex: 0 } });
      list.push({
        citationID: `c${i}`,
        citationItems: [toCiteprocItem(it, { 'suppress-author': true })],
        properties: { noteIndex: n },
      });
    } else {
      list.push({ citationID: `c${i}`, citationItems: c.items.map((it) => toCiteprocItem(it)), properties: { noteIndex: n } });
    }
  });

  const byId = new Map<string, string>();
  if (list.length > 0) {
    for (const [id, , text] of engine.rebuildProcessorState(list, 'html', [])) byId.set(id, text.trim());
  }
  const printed = (s: string | undefined): string => (s && s !== NO_PRINTED_FORM ? s : '');

  const rendered: string[] = [];
  const inline: string[] = [];
  citations.forEach((c, i) => {
    const main = printed(byId.get(`c${i}`));
    const author = c.narrative ? printed(byId.get(`a${i}`)) : '';
    if (noteStyle) {
      rendered.push(main);
      inline.push(author);
    } else {
      rendered.push(author && main ? `${author} ${main}` : author || main);
      inline.push('');
    }
  });

  let bibliography: string[] = [];
  if (list.length > 0) {
    const bib = engine.makeBibliography();
    if (Array.isArray(bib)) bibliography = (bib[1] as string[]).map((e) => e.trim()).filter((e) => e.length > 0);
  }
  return { citations: rendered, inline, bibliography, noteStyle };
}

// =====================================================================
//   Public: style names and discipline defaults
// =====================================================================

/** The citation styles pensmith ships a CSL file for. */
export const SUPPORTED_STYLES: readonly string[] = Object.keys(STYLE_FILENAMES);

// Spellings a person might type or the intake clarifier offers.
const STYLE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['apa', 'apa'], ['apa 7', 'apa'], ['apa7', 'apa'], ['apa 7th', 'apa'],
  ['mla', 'mla'], ['mla 8', 'mla'], ['mla 9', 'mla'],
  ['chicago', 'chicago-notes-bib'], ['chicago nb', 'chicago-notes-bib'], ['chicago notes', 'chicago-notes-bib'],
  ['chicago notes-bibliography', 'chicago-notes-bib'], ['chicago notes bibliography', 'chicago-notes-bib'],
  ['chicago (notes-bibliography)', 'chicago-notes-bib'], ['chicago-notes-bib', 'chicago-notes-bib'],
  ['chicago ad', 'chicago-author-date'], ['chicago author-date', 'chicago-author-date'],
  ['chicago author date', 'chicago-author-date'], ['chicago (author-date)', 'chicago-author-date'],
  ['chicago-author-date', 'chicago-author-date'],
  ['ieee', 'ieee'], ['ama', 'ama'], ['vancouver', 'vancouver'], ['harvard', 'harvard'],
]);

// Words around a style's name that do not change the style, removed from the
// end one at a time: "APA (7th ed.)", "MLA 9th edition", "IEEE style",
// "Harvard referencing". Each CSL file follows the current edition.
const STYLE_NAME_TAILS: readonly RegExp[] = [
  /[\s.,;:]+$/,
  /\s*\((?:\d+(?:st|nd|rd|th)?\s*)?(?:ed\.?|edition)?\)$/,
  /\s+(?:ed\.?|edition)$/,
  /\s+(?:citation\s+)?(?:style|format|referencing)$/,
  /\s+\d+(?:st|nd|rd|th)?$/,
];

/**
 * The style key for a style name as a person writes it ("Chicago (Author-Date)",
 * "APA 7th edition", "IEEE style", "vancouver"), or null when pensmith has no
 * CSL file for it.
 */
export function normalizeStyleName(name: string): string | null {
  let key = name.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  for (;;) {
    const hit = STYLE_ALIASES.get(key);
    if (hit) return hit;
    const shorter = STYLE_NAME_TAILS.reduce((k, re) => (k === key ? k.replace(re, '') : k), key);
    if (shorter === key || shorter.length === 0) return null;
    key = shorter;
  }
}

/**
 * The default citation style for a discipline slug, read from
 * templates/presets/disciplines.json (the one place presets are defined).
 * An unknown discipline uses the `other` preset.
 */
export function resolveStyleName(discipline: string): string {
  let presets: Record<string, { defaultCitationStyle?: unknown }> = {};
  try {
    presets = JSON.parse(readFileSync(path.join(PKG_ROOT, 'templates', 'presets', 'disciplines.json'), 'utf8')) as typeof presets;
  } catch {
    return 'apa';
  }
  const preset = presets[discipline.toLowerCase()] ?? presets['other'];
  const style = typeof preset?.defaultCitationStyle === 'string' ? normalizeStyleName(preset.defaultCitationStyle) : null;
  return style ?? 'apa';
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
