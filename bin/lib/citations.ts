// bin/lib/citations.ts — BibTeX parse + APA render chokepoint per D-19 / CITE-04.
//
// SOLE call site for `citation-js` in the repo. The ESLint chokepoint
// (eslint.config.js → no-restricted-imports for `citation-js`) bans this
// import everywhere EXCEPT this file (per-file `no-restricted-imports`
// override). The red-team fixture at
// tests/fixtures/lint-chokepoint-fixture.ts is the regression gate.
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

// `citation-js@0.7` ships a single default-export class; the `plugins`
// registry hangs off the class (`Cite.plugins`). A `import { plugins }`
// named-import works under esbuild's tsx (which synthesizes CJS-default
// destructure) but FAILS under real Node ESM with
// "does not provide an export named 'plugins'". We bind via the class
// to stay portable across both runtimes.
import Cite from 'citation-js';
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
//   Public: resolveStyleName (discipline → CSL style name)
// =====================================================================
/**
 * Map a discipline key (from disciplines.json / PROJECT.md) to its default
 * citation style name (the key `renderStyle` expects). Callers that already
 * know the style can pass it directly; this is a lookup convenience for
 * workflow bodies. Unknown disciplines fall back to 'apa'.
 */
export function resolveStyleName(discipline: string): string {
  const map: Readonly<Record<string, string>> = {
    'computer-science': 'ieee',
    'biology': 'apa',
    'psychology': 'apa',
    'sociology': 'apa',
    'economics': 'apa',
    'history': 'chicago-author-date',
    'philosophy': 'chicago-author-date',
    'literature': 'mla',
    'other': 'apa',
  };
  return map[discipline.toLowerCase()] ?? 'apa';
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
