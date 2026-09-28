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
  for (const cluster of findCitationClusters(md)) {
    for (const key of cluster.keys) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citation CLUSTERS — the broad Pandoc grammar the fail-closed consumers share.
//
// The drafter is told to write one bare `[@key]` per source, but a model (or the
// humanizer) can still write `[@a; @b]`, `[@a, p. 5]` or `[see @a]`. Every
// consumer that GATES or REPAIRS a draft (the GATE-04 humanizer re-check, the
// Pass-3 quote extractor, revise remove/swap, the GRND-06 density count) must
// see those forms too — an unparseable citation must never look "absent"
// (AUDIT-FINDINGS #2/#3). They all read clusters through these helpers.
// ---------------------------------------------------------------------------

/**
 * A bracketed run with NO nested brackets that contains an `@` (group 1: the
 * inner text). Exported only so a caller can anchor a cluster after other text
 * (the Pass-3 quote extractor); keys are always read with findCitationClusters.
 */
export const CITATION_CLUSTER_RE_SOURCE = String.raw`\[([^[\]]*@[^[\]]*)\]`;
const CLUSTER_RE_SOURCE = CITATION_CLUSTER_RE_SOURCE;
/**
 * Within a cluster, a key is `@` preceded by start / whitespace / ';'. Pandoc
 * citekeys begin with a letter/digit/underscore and may contain internal
 * punctuation; trailing locator punctuation is stripped after capture. The
 * anchor keeps an email-style `name@host` from matching.
 */
const CLUSTER_KEY_RE_SOURCE = String.raw`(?:^|[\s;])@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)`;

/** One citation cluster in a text: its span, its bracketed text and its keys in order. */
export interface CitationCluster {
  /** Offset of the opening `[`. */
  readonly start: number;
  /** Offset just past the closing `]`. */
  readonly end: number;
  /** The whole bracketed cluster, brackets included. */
  readonly text: string;
  /** Every `@key` in the cluster, verbatim (case preserved), in order (duplicates kept). */
  readonly keys: readonly string[];
}

/** The citekeys of one cluster's inner text (between the brackets), in order. */
function clusterKeys(inner: string): string[] {
  const out: string[] = [];
  for (const km of inner.matchAll(new RegExp(CLUSTER_KEY_RE_SOURCE, 'g'))) {
    const key = (km[1] ?? '').replace(/[.,;:]+$/, '');
    if (key) out.push(key);
  }
  return out;
}

/**
 * Every citation cluster in `md` — `[@a]`, `[@a, p. 5]`, `[@a; @b]`,
 * `[see @a; also @b]`, `[@Vaswani2017]` — in document order. A bracketed run
 * whose `@` is not a citation (`[mail a@b.org]`) is not a cluster.
 */
export function findCitationClusters(md: string): CitationCluster[] {
  const out: CitationCluster[] = [];
  for (const cm of md.matchAll(new RegExp(CLUSTER_RE_SOURCE, 'g'))) {
    const keys = clusterKeys(cm[1] ?? '');
    if (keys.length === 0) continue;
    const start = cm.index;
    out.push({ start, end: start + cm[0].length, text: cm[0], keys });
  }
  return out;
}

/** How many citations `md` carries: every key of every cluster (`[@a; @b]` counts 2). */
export function countCitations(md: string): number {
  let n = 0;
  for (const c of findCitationClusters(md)) n += c.keys.length;
  return n;
}

/** Remove every citation cluster from `md` (for word counts over the prose alone). */
export function stripCitationClusters(md: string): string {
  let out = '';
  let at = 0;
  for (const c of findCitationClusters(md)) {
    out += md.slice(at, c.start);
    at = c.end;
  }
  return out + md.slice(at);
}

/** The first citation cluster in `md`, or null. */
export function firstCitationCluster(md: string): CitationCluster | null {
  return findCitationClusters(md)[0] ?? null;
}

/**
 * Rewrite the clusters that cite `key`. `edit` gets the cluster's inner text
 * split into its `;` segments and returns the segments to keep (possibly
 * edited); an empty result removes the whole cluster together with the
 * horizontal whitespace before it (or after it, at the start of a line).
 */
function editClustersCiting(md: string, key: string, edit: (segments: string[]) => string[]): string {
  let out = '';
  let at = 0;
  for (const c of findCitationClusters(md)) {
    if (!c.keys.includes(key)) continue;
    const segments = c.text.slice(1, -1).split(';');
    const kept = edit(segments).map((s) => s.trim()).filter((s) => s.length > 0);
    if (kept.length > 0) {
      out += md.slice(at, c.start) + `[${kept.join('; ')}]`;
      at = c.end;
      continue;
    }
    // Remove the whole cluster: the whitespace before it goes with it (" [@k]." -> "."),
    // or, when it opens a line, the whitespace after it ("[@k] Text" -> "Text").
    const trimmedBefore = md.slice(at, c.start).replace(/[ \t]+$/, '');
    out += trimmedBefore;
    const opensLine = out.length === 0 || out.endsWith('\n');
    at = c.end;
    if (opensLine) {
      const ws = /^[ \t]*/.exec(md.slice(at));
      at += ws ? ws[0].length : 0;
    }
  }
  return out + md.slice(at);
}

/** True when a `;` segment of a cluster cites exactly `key` (as one of its keys). */
function segmentCites(segment: string, key: string): boolean {
  return clusterKeys(segment).includes(key);
}

/**
 * Remove citekey `key` from `md` wherever it is cited: a bare `[@key]` (with the
 * space before it) disappears; inside a cluster only its `;` segment goes
 * (`[@a; @key]` -> `[@a]`). Every other citation is left untouched.
 */
export function removeCitekey(md: string, key: string): string {
  return editClustersCiting(md, key, (segments) => segments.filter((s) => !segmentCites(s, key)));
}

/**
 * Replace citekey `from` with `to` wherever it is cited, bare or inside a
 * cluster, keeping any prefix or locator (`[see @from, p. 5]` -> `[see @to, p. 5]`).
 */
export function renameCitekey(md: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`((?:^|[\\s;])@)${esc}(?![A-Za-z0-9_:#$%&+?<>~/-]|[.][A-Za-z0-9_])`, 'g');
  return editClustersCiting(md, from, (segments) => segments.map((s) => s.replace(keyRe, `$1${to}`)));
}
