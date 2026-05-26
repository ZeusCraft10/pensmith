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
//   citation-js lazy CSL plugin (RESEARCH.md Pitfall #4)
// =====================================================================
// `citation-js >= 0.7` lazy-loads CSL templates. A custom template must
// be registered via `plugins.config.get('@csl').templates.add(name, csl)`
// BEFORE the first `Cite.format()` call referencing it. We memoize
// registration via `apaRegistered` so multiple renderApa() calls in a
// single process register once, not per-call.
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
const APA_CSL_PATH = path.join(PKG_ROOT, 'templates', 'citation-styles', 'apa.csl');

// =====================================================================
//   Memoized custom-template registration (Pitfall #4)
// =====================================================================
const CUSTOM_APA_NAME = 'pensmith-apa';
let apaRegistered = false;

function ensureApaTemplate(cslTemplateString: string): void {
  if (apaRegistered) return;
  const cslPlugin = plugins.config.get('@csl');
  cslPlugin.templates.add(CUSTOM_APA_NAME, cslTemplateString);
  apaRegistered = true;
}

/**
 * Test-only — clear the apa-template registration memo so a second test
 * run in the same process re-registers (e.g. if a test mutates the CSL).
 * NEVER call from production code.
 */
export function _resetApaTemplateForTest(): void {
  apaRegistered = false;
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
//   Public: renderApa
// =====================================================================
/**
 * Render the supplied parsed entries as an APA-7 reference list using
 * the bundled apa.csl template.
 *
 * Accepts the array returned from `parseBib` (the Wave 0 test contract).
 * Reads apa.csl from `templates/citation-styles/apa.csl` lazily on first
 * call and memoizes the registered template across the process.
 *
 * Until Plan 05 lands apa.csl, this function throws a clear diagnostic
 * naming the blocking plan rather than silently producing empty output.
 * The Wave 0 test guards this call with a `shouldSkip` check on
 * apa.csl's existence so the test does not invoke renderApa before
 * Plan 05.
 */
export async function renderApa(entries: Array<Record<string, unknown>>): Promise<string> {
  if (!Array.isArray(entries)) {
    throw new TypeError('renderApa: input must be an array of parsed entries (from parseBib)');
  }
  if (!existsSync(APA_CSL_PATH)) {
    throw new Error(
      `renderApa: apa.csl not yet present at ${APA_CSL_PATH} — Plan 03-05 ships the bundled CSL template (D-22). ` +
        `If you are seeing this error during Phase 3 Wave 4 or later, run the build and confirm templates/citation-styles/apa.csl is on disk.`,
    );
  }
  const cslString = readFileSync(APA_CSL_PATH, 'utf8');
  ensureApaTemplate(cslString);
  const cite = new Cite(entries, { forceType: '@csl/object' });
  return cite.format('bibliography', {
    format: 'text',
    template: CUSTOM_APA_NAME,
    lang: 'en-US',
  });
}
