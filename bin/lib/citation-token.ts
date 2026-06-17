// bin/lib/citation-token.ts — shared Pandoc citation-token helpers (Phase 4).
//
// Factored out of bin/lib/verify/pass1.ts:187 (extraction regex) and aligned
// with bin/lib/citekey.ts:25 (CITEKEY_RE grammar) so the Phase 4 compile
// smoother (Plan 05) substitutes the SAME token family the verifier extracts.
//
// LOCKED regex literal — identical to pass1.ts:187:
//   /\[@([a-z][a-z0-9_-]*)\]/g
//
// Scope (Phase 4): BARE `[@citekey]` tokens only. Pandoc locator syntax
// (`[@key, p. 23]`) and multi-citation groups (`[@a; @b]`) are explicitly
// OUT OF SCOPE here — deferred to Phase 10. Do NOT extend this regex.
//
// The smoother's placeholder family `{{cite_K_M}}` (D-13) is disjoint from
// this regex by construction (`{{...}}` is not `[@...]`), so no special-casing
// is needed to keep placeholders from being mistaken for citation tokens.
//
// PURE module: no I/O, no side effects. Every function is referentially
// transparent (same input → same output).

/**
 * LOCKED bare-citekey token regex. Group 1 captures the citekey body.
 *
 * The `g` flag is required by extractCitekeys / replaceCitekeys (matchAll /
 * replace-all semantics). Callers that need a fresh `lastIndex` should build a
 * new RegExp from `.source` rather than reusing this shared instance with
 * `.test()` (a stateful global regex carries lastIndex across calls).
 */
export const CITATION_TOKEN_RE = /\[@([a-z][a-z0-9_-]*)\]/g;

/**
 * Extract every citekey referenced by a `[@key]` token, deduplicated and
 * preserving first-appearance order.
 *
 * @example
 *   extractCitekeys('text [@smith2020] and [@jones-2019], [@smith2020] again')
 *   // -> ['smith2020', 'jones-2019']
 */
export function extractCitekeys(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Build a fresh global regex so we never depend on / mutate the shared
  // CITATION_TOKEN_RE.lastIndex.
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  for (const m of md.matchAll(re)) {
    const key = m[1];
    if (key === undefined) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Replace every `[@key]` token by running its citekey through `fn` and
 * substituting the result in place. Non-token text (including the
 * `{{cite_K_M}}` placeholder family) is left untouched.
 *
 * @example
 *   replaceCitekeys('see [@smith2020]', (k) => `{{cite_0_0}}`)
 *   // -> 'see {{cite_0_0}}'
 */
export function replaceCitekeys(md: string, fn: (key: string) => string): string {
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  return md.replace(re, (_match, key: string) => fn(key));
}
