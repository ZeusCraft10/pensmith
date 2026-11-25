// bin/lib/citations-shim.d.ts — Ambient declaration for citation-js.
//
// `citation-js@0.7.22` ships no `.d.ts` and no @types/citation-js exists.
// We declare only the narrow surface that the D-19 chokepoint
// (bin/lib/citations.ts) consumes:
//   - `Cite` class with `data` field and `format()` method
//   - `plugins.config.get('@csl').templates.add(name, csl)` for the
//     custom-template registration path (RESEARCH.md Pitfall #4 — lazy
//     CSL template loader).
//   - `plugins.config.get('@csl').engine(...)` and `Cite.util.downgradeCsl`,
//     so a whole document's citations render in one citeproc session.
//   - `plugins.config.get('@bibtex').format.asciiOnly`, so formatBibtex can
//     write UTF-8 BibTeX instead of dropping non-Latin text.
//   - `format('bibtex', { format: 'object' })`, the entries before they are
//     written out, so formatBibtex can leave out a field.
//   - `format('ris', { spec: 'new', format: 'text' })`, the RIS2001 output
//     formatRis returns.
//
// Widening this shim is a chokepoint-bypass smell — new fields go via
// the citations.ts wrapper API, not by widening global typings.
// Downstream callers (Plan 04 bin/lib/bibtex-write.ts, Plan 09
// tests/bibtex-write.test.ts) import { Cite } from './citations.js' to
// preserve the D-19 LOCKED chokepoint singleton.

declare module 'citation-js' {
  export interface CiteData extends Record<string, unknown> {
    id?: string;
    type?: string;
    title?: string;
  }

  export interface CiteFormatOptions {
    format?: 'text' | 'html' | 'json';
    template?: string;
    lang?: string;
  }

  export interface CslTemplateRegistry {
    add(name: string, csl: string): void;
    has(name: string): boolean;
  }

  /** The citeproc-js engine surface used for document-level rendering. */
  export interface CiteprocEngine {
    opt?: { xclass?: string };
    rebuildProcessorState(citations: unknown[], format: string, uncited: unknown[]): Array<[string, number, string]>;
    makeBibliography(): [unknown, string[]] | false;
  }

  export interface CslPluginConfig {
    templates: CslTemplateRegistry;
    engine(data: unknown[], template: string, lang: string, format: string): CiteprocEngine;
  }

  export interface BibtexPluginConfig {
    format: { asciiOnly: boolean };
  }

  export interface PluginRegistry {
    config: {
      get(plugin: '@csl'): CslPluginConfig;
      get(plugin: '@bibtex'): BibtexPluginConfig;
      get(plugin: string): unknown;
    };
  }

  /** One BibTeX entry with every field value already written as BibTeX. */
  export interface BibtexRecord {
    type: string;
    label: string;
    properties: Record<string, string>;
  }

  export class Cite {
    constructor(input?: string | object | object[], options?: { forceType?: string });
    readonly data: CiteData[];
    format(name: 'bibtex', options: { format: 'object' }): BibtexRecord[];
    format(name: 'ris', options: { spec: 'new' | 'old'; format: 'text' }): string;
    format(name: string, options?: CiteFormatOptions): string;
    // The `plugins` registry hangs off the class (citation-js@0.7
    // exposes it as a static-like property on the default export).
    static plugins: PluginRegistry;
    static util: { downgradeCsl(data: unknown[]): unknown[] };
  }

  export default Cite;
}
