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
 *
 * LOWERCASE-CITEKEY CONSTRAINT: the `[a-z]` first-character anchor restricts
 * extraction to lowercase-first citekeys. Pensmith generates all citekeys in
 * lowercase (see bin/lib/citekey.ts), so this is intentional and the regex forms
 * a bijection within that namespace. A mixed-case citekey like `Smith2020` in a
 * [@Smith2020] token would be silently skipped. The same `[a-z]` anchor is used
 * in parseVerdictRows (verdict-rows.ts), keeping the extraction and parse sides
 * consistent. Do NOT widen to `[a-zA-Z]` unless the citekey generator is updated
 * and all extraction points are audited for consistency.
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

/**
 * Broad, FAIL-CLOSED citation-key detector for the VERIFIER (Pass-1) ONLY.
 *
 * CITATION_TOKEN_RE above is deliberately NARROW — lowercase-first BARE `[@key]`
 * tokens, the exact namespace the smoother and bib-regen round-trip. But the
 * verifier has the opposite obligation: it must SEE every citation-shaped
 * reference a draft contains, so an unrecognized one produces a BLOCKING verdict
 * (FABRICATED) instead of silently vanishing. A citation the verifier cannot
 * parse must be treated as "unverifiable", never as "absent / nothing to do".
 *
 * This detector therefore also catches the forms the narrow regex drops:
 *   - uppercase / mixed-case keys:   [@Vaswani2017]
 *   - Pandoc locator forms:          [@smith2020, p. 5]
 *   - multi-citation clusters:       [@a; @b]   ·   [see @a; also @b]
 *
 * It returns the citekey body of every `@key` token inside a bracketed citation
 * cluster, deduped in first-appearance order. Keys are returned VERBATIM (case
 * preserved) so the downstream bib lookup is exact — a case-mismatch against the
 * lowercase-generated bib then fails closed (FABRICATED), which is the point.
 *
 * NOT for substitution/rendering — it is intentionally permissive and is for
 * detection/verification only. The `@` is anchored to start-of-cluster /
 * whitespace / ';' (Pandoc grammar) so an email-style `name@host` never matches.
 */
export function extractCitedKeysForVerification(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // A citation cluster: a bracketed run with NO nested brackets that contains an
  // @token. `[^[\]]` = "not '[' and not ']'", so we never cross bracket bounds.
  const clusterRe = /\[([^[\]]*@[^[\]]*)\]/g;
  // Within a cluster, a key is `@` preceded by start / whitespace / ';'. Pandoc
  // citekeys begin with a letter/digit/underscore and may contain internal
  // punctuation; trailing locator punctuation is stripped after capture.
  const keyRe = /(?:^|[\s;])@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)/g;
  for (const cm of md.matchAll(clusterRe)) {
    const cluster = cm[1] ?? '';
    for (const km of cluster.matchAll(keyRe)) {
      let key = km[1];
      if (key === undefined) continue;
      key = key.replace(/[.,;:]+$/, '');
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}
