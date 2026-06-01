// bin/lib/citations-shim.d.ts — Ambient declaration for citation-js.
//
// `citation-js@0.7.22` ships no `.d.ts` and no @types/citation-js exists.
// We declare only the narrow surface that the D-19 chokepoint
// (bin/lib/citations.ts) consumes:
//   - `Cite` class with `data` field and `format()` method
//   - `plugins.config.get('@csl').templates.add(name, csl)` for the
//     custom-template registration path (RESEARCH.md Pitfall #4 — lazy
//     CSL template loader).
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

  export interface CslPluginConfig {
    templates: CslTemplateRegistry;
  }

  export interface PluginRegistry {
    config: {
      get(plugin: '@csl'): CslPluginConfig;
      get(plugin: string): unknown;
    };
  }

  export class Cite {
    constructor(input?: string | object | object[], options?: { forceType?: string });
    readonly data: CiteData[];
    format(name: string, options?: CiteFormatOptions): string;
    // The `plugins` registry hangs off the class (citation-js@0.7
    // exposes it as a static-like property on the default export).
    static plugins: PluginRegistry;
  }

  export default Cite;
}
