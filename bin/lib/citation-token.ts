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
 * This detector therefore also catches the forms the narrow regex drops — every
 * form Pandoc's citeproc renders as a citation:
 *   - uppercase / mixed-case / Unicode keys:  [@Vaswani2017]   [@müller2020]
 *   - Pandoc locator forms:                   [@smith2020, p. 5]
 *   - multi-citation clusters:                [@a; @b]   ·   [see @a; also @b]
 *   - author-suppressed citations:            [-@a]   ·   [@a; -@b]
 *   - braced keys:                            [@{a}]   ·   @{a}
 *   - narrative (in-text) citations:          @a says …   ·   -@a
 *
 * It returns the citekey body of every citation, deduped in first-appearance
 * order. Keys are returned VERBATIM (case preserved) so the downstream bib
 * lookup is exact — a case-mismatch against the lowercase-generated bib then
 * fails closed (FABRICATED), which is the point.
 *
 * NOT for substitution/rendering — it is intentionally permissive and is for
 * detection/verification only. The `@` must not follow a letter, a digit or a
 * backslash (Pandoc's rule), so an email-style `name@host` never matches.
 */
export function extractCitedKeysForVerification(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cite of findCitations(md)) {
    for (const key of cite.keys) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citation CLUSTERS and NARRATIVE citations — the broad Pandoc grammar the
// fail-closed consumers share.
//
// The drafter is told to write one bare `[@key]` per source, but a model (or the
// humanizer, or an instruction injected through a source abstract) can still
// write `[@a; @b]`, `[@a, p. 5]`, `[see @a]`, `[-@a]`, `[@{a}]` or a narrative
// `@a says`. Pandoc renders every one of them as a citation, so every consumer
// that GATES or REPAIRS a draft (FEED-04 containment, Pass 1, the GATE-04
// humanizer re-check, the Pass-3 quote extractor, revise remove/swap, the GRND-06
// density count, the export bibliography) must see them too — an unparseable
// citation must never look "absent" (AUDIT-FINDINGS #2/#3). They all read
// citations through these helpers.
// ---------------------------------------------------------------------------

/** A bracketed run with NO nested brackets that contains an `@` (group 1: the inner text). */
const CLUSTER_RE_SOURCE = String.raw`\[([^[\]]*@[^[\]]*)\]`;
/**
 * One citation key, Pandoc's grammar: `@` (optionally `-@`, author suppressed)
 * NOT preceded by a letter, a digit or a backslash (so `name@host` and an
 * escaped `\@` never match), then either a braced key `{…}` (no whitespace) or a
 * key that starts with a letter/digit/underscore and may hold the internal
 * punctuation `:.#$%&-+?<>~/` only when a letter/digit/underscore follows it
 * (so trailing sentence punctuation is never part of the key). Group 1: a
 * braced key; group 2: a plain key. Flags `gu`.
 */
const KEY_RE_SOURCE = String.raw`(?<![\p{L}\p{N}\\])-?@(?:\{([^{}\s]+)\}|([\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&\-+?<>~/](?=[\p{L}\p{N}_]))*))`;

/** One citation in a text: its span, its text and its keys in order. */
export interface CitationCluster {
  /** Offset of the opening `[` (a narrative citation: of its `@` or `-@`). */
  readonly start: number;
  /** Offset just past the closing `]` (a narrative citation: past its key). */
  readonly end: number;
  /** The whole bracketed cluster, brackets included (a narrative citation: `@key`). */
  readonly text: string;
  /** Every `@key` in the cluster, verbatim (case preserved), in order (duplicates kept). */
  readonly keys: readonly string[];
  /** True for a narrative (in-text) `@key` outside brackets. */
  readonly narrative?: boolean;
}

/** Every key match (index, length, key) in `text`. */
function keyMatches(text: string): Array<{ index: number; length: number; key: string }> {
  const out: Array<{ index: number; length: number; key: string }> = [];
  for (const km of text.matchAll(new RegExp(KEY_RE_SOURCE, 'gu'))) {
    const key = km[1] ?? km[2] ?? '';
    if (key) out.push({ index: km.index, length: km[0].length, key });
  }
  return out;
}

/** The citekeys of one cluster's inner text (between the brackets), in order. */
function clusterKeys(inner: string): string[] {
  return keyMatches(inner).map((m) => m.key);
}

/**
 * Every citation cluster in `md` — `[@a]`, `[@a, p. 5]`, `[@a; @b]`,
 * `[see @a; also @b]`, `[-@a]`, `[@{a}]`, `[@Vaswani2017]` — in document order.
 * A bracketed run whose `@` is not a citation (`[mail a@b.org]`) is not a
 * cluster. Narrative citations are not clusters: read every citation with
 * findCitations.
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

/**
 * Spans Pandoc never reads a citation in: fenced code blocks, inline code
 * spans, HTML comments, link destinations `](…)` and autolinks `<scheme:…>`.
 * Only a narrative `@key` is looked for outside them (a Python `@decorator` in a
 * code block is not a citation); a bracketed cluster is detected everywhere
 * (fail closed).
 */
function nonCitationSpans(md: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  // Fenced code blocks: a ``` or ~~~ fence line to the matching fence line.
  // Only CLOSED blocks count: Pandoc reads an unclosed fence as text, citations
  // included — treating it as code to the end would hide them (fail closed).
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let open: { at: number; marker: string } | null = null;
  for (const m of md.matchAll(fence)) {
    const marker = m[1] ?? '';
    if (open === null) open = { at: m.index, marker };
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      spans.push([open.at, m.index + m[0].length]);
      open = null;
    }
  }
  // HTML comments, scanned with indexOf (a lazy `<!--[\s\S]*?-->` regex is
  // quadratic on many unclosed `<!--`). Only CLOSED comments count: Pandoc
  // reads an unclosed `<!--` as text, citations included.
  for (let at = md.indexOf('<!--'); at !== -1; ) {
    const close = md.indexOf('-->', at + 4);
    if (close === -1) break;
    spans.push([at, close + 3]);
    at = md.indexOf('<!--', close + 3);
  }
  for (const re of [/(`+)[^`]*?\1/g, /\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*(?:\s+"[^"]*")?\)/g, /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/g]) {
    for (const m of md.matchAll(re)) {
      // A code span never crosses a blank line (a paragraph break): Pandoc reads
      // an unmatched backtick as text, so such a "span" hides nothing.
      if (/\n[ \t]*\r?\n/.test(m[0])) continue;
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans;
}

function inSpans(at: number, spans: ReadonlyArray<readonly [number, number]>): boolean {
  return spans.some(([s, e]) => at >= s && at < e);
}

/**
 * Every narrative (in-text) citation in `md`: an `@key` / `-@key` / `@{key}`
 * outside every bracketed cluster and outside code, comments and link
 * destinations (Pandoc renders `@smith2020 argues` as "Smith (2020) argues").
 */
export function findNarrativeCitations(md: string): CitationCluster[] {
  const clusters = findCitationClusters(md).map((c) => [c.start, c.end] as const);
  const skip = nonCitationSpans(md);
  const out: CitationCluster[] = [];
  for (const m of keyMatches(md)) {
    if (inSpans(m.index, clusters) || inSpans(m.index, skip)) continue;
    out.push({ start: m.index, end: m.index + m.length, text: md.slice(m.index, m.index + m.length), keys: [m.key], narrative: true });
  }
  return out;
}

/** Every citation in `md` — bracketed clusters and narrative citations — in document order. */
export function findCitations(md: string): CitationCluster[] {
  return [...findCitationClusters(md), ...findNarrativeCitations(md)].sort((a, b) => a.start - b.start);
}

/** How many citations `md` carries: every key of every citation (`[@a; @b]` counts 2, a narrative `@a` 1). */
export function countCitations(md: string): number {
  let n = 0;
  for (const c of findCitations(md)) n += c.keys.length;
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

/** The first citation in `md` — a cluster or a narrative citation — or null. */
export function firstCitation(md: string): CitationCluster | null {
  return findCitations(md)[0] ?? null;
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
 * (`[@a; @key]` -> `[@a]`). Every other citation is left untouched. A narrative
 * `@key` is part of the sentence's grammar, so it is NOT removed mechanically:
 * it stays, and the verifier keeps reporting it (fail closed).
 */
export function removeCitekey(md: string, key: string): string {
  return editClustersCiting(md, key, (segments) => segments.filter((s) => !segmentCites(s, key)));
}

/** `text` with every citation key equal to `from` rewritten to `to` (keeping `-@` and braces). */
function renameKeysIn(text: string, from: string, to: string): string {
  let out = '';
  let at = 0;
  for (const m of keyMatches(text)) {
    if (m.key !== from) continue;
    const token = text.slice(m.index, m.index + m.length);
    const lead = token.startsWith('-') ? '-@' : '@';
    const braced = token.slice(lead.length).startsWith('{');
    out += text.slice(at, m.index) + lead + (braced ? `{${to}}` : to);
    at = m.index + m.length;
  }
  return out + text.slice(at);
}

/**
 * Replace citekey `from` with `to` wherever it is cited — bare, inside a
 * cluster or as a narrative `@from` — keeping any prefix, locator, `-`
 * (author suppression) or braces (`[see @from, p. 5]` -> `[see @to, p. 5]`).
 */
export function renameCitekey(md: string, from: string, to: string): string {
  const clustered = editClustersCiting(md, from, (segments) => segments.map((s) => renameKeysIn(s, from, to)));
  let out = '';
  let at = 0;
  for (const c of findNarrativeCitations(clustered)) {
    if (c.keys[0] !== from) continue;
    out += clustered.slice(at, c.start) + renameKeysIn(c.text, from, to);
    at = c.end;
  }
  return out + clustered.slice(at);
}
