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
//
// Phase 20 (VRFY-09, D-20-06): this module is the ONLY citation parser. A
// regular expression holding `\[@` or `@\{` anywhere else in bin/, mcp/ or
// hooks/ fails lint (chokepoint row `citation-grammar`,
// scripts/chokepoints/citation-grammar.json). Consumers read citations with
// findCitations / citationItems (key, prefix, suffix, locator and label,
// suppress-author, narrative), count or strip them with countCitations /
// replaceCitations, and the verifier reports text it cannot read with
// findUnparseableCitations (UNPARSEABLE, D-20-07).

import type { TextFinding } from './verify/verdicts.js';

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
 * detection/verification only. It follows Pandoc's key grammar (keyMatches: an
 * email-style `name@host` never matches), skips a narrative key only in code
 * Pandoc provably reads as code (findNarrativeCitations), and adds the keys
 * Pandoc reads after decoding a sub/superscript (subSuperscriptKeys) or after a
 * table cuts a row inside a key (tableCutKeys) — every key Pandoc renders is
 * reported; a few it does not are too (fail closed; D-18-42, checked against
 * pandoc by tests/citation-grammar-pandoc.test.ts).
 */
export function extractCitedKeysForVerification(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (key: string): void => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };
  for (const cite of findCitations(md)) for (const key of cite.keys) add(key);
  for (const key of subSuperscriptKeys(md)) add(key);
  for (const key of tableCutKeys(md)) add(key);
  return out;
}

/**
 * A Pandoc table also cuts a row INSIDE a key: a simple or multiline table at
 * the start of each dash group of its rule, a grid table at each `+` / `|`
 * (`@smith2020a` cut after `smith2020` cites smith2020). For every rule line in
 * `md`, the key each such column cuts a key to (review round 3; fail closed).
 * A line holding a tab — whose columns this does not model — gets every
 * prefix of its keys.
 */
function tableCutKeys(md: string): string[] {
  if (!tableMayCut(md)) return [];
  const cuts = new Set<number>();
  for (const m of md.matchAll(new RegExp(TABLE_RULE_RE.source, 'gm'))) {
    const rule = m[0].replace(/\r$/, '');
    if (!/[-=]/.test(rule)) continue;
    for (let i = 0; i < rule.length; i += 1) {
      const c = rule[i] as string;
      if ((c === '-' || c === '=') && !'-='.includes(rule[i - 1] ?? ' ')) cuts.add(i);
      if (c === '+' || c === '|' || c === ':') {
        cuts.add(i);
        cuts.add(i + 1);
      }
    }
  }
  const out: string[] = [];
  for (const line of sourceLines(md)) {
    if (!line.text.includes('@')) continue;
    const tabbed = line.text.includes('\t');
    for (const m of keyMatches(line.text, true)) {
      const at = line.text.indexOf('@', m.index);
      for (let x = at + 2; x < m.index + m.length; x += 1) {
        if (!tabbed && !cuts.has(x)) continue;
        const k = readKey(line.text.slice(0, x), at);
        if (k !== null) out.push(k.key);
      }
    }
  }
  return out;
}

/**
 * Inside a sub- or superscript (`~…~`, `^…^`: no unescaped whitespace between
 * the marks) Pandoc decodes entities and backslash escapes BEFORE it reads
 * citations: `~&#64;smith~` cites smith, `~\\@k~` cites k, `~@a&#58;b~` cites
 * a:b. The keys of every such candidate's decoded content count (review
 * round 3; a candidate Pandoc does not read as one only adds keys: fail closed).
 */
function subSuperscriptKeys(md: string): string[] {
  const out: string[] = [];
  const loose = tableMayCut(md);
  for (let i = 0; i < md.length; i += 1) {
    const mark = md[i];
    if (mark !== '~' && mark !== '^') continue;
    let j = i + 1;
    let close = -1;
    while (j < md.length && j - i <= MAX_SCRIPT_CHARS) {
      const c = md[j] as string;
      if (c === '\\' && j + 1 < md.length) {
        j += 2;
        continue;
      }
      if (c === mark) {
        if (j > i + 1) close = j;
        break;
      }
      if (/\s/u.test(c)) break;
      j += 1;
    }
    if (close === -1) continue;
    const content = md.slice(i + 1, close);
    if (!content.includes('@') && !content.includes('&')) continue;
    for (const m of keyMatches(decodeForSubscripts(content), loose)) out.push(m.key);
  }
  return out;
}

/** The longest sub- or superscript content searched (Pandoc's cannot hold whitespace, so real ones are short). */
const MAX_SCRIPT_CHARS = 512;

/** Named entities that decode to ASCII (every other named entity is read as a letter below). */
const ASCII_ENTITIES: Readonly<Record<string, string>> = {
  excl: '!', quot: '"', QUOT: '"', num: '#', dollar: '$', percnt: '%', amp: '&', AMP: '&', apos: "'", lpar: '(',
  rpar: ')', ast: '*', midast: '*', plus: '+', comma: ',', period: '.', sol: '/', colon: ':', semi: ';', lt: '<',
  LT: '<', equals: '=', gt: '>', GT: '>', quest: '?', commat: '@', lsqb: '[', lbrack: '[', bsol: '\\', rsqb: ']',
  rbrack: ']', Hat: '^', lowbar: '_', UnderBar: '_', grave: '`', DiacriticalGrave: '`', lcub: '{', lbrace: '{',
  verbar: '|', vert: '|', VerticalLine: '|', rcub: '}', rbrace: '}', Tab: '\t', NewLine: '\n',
};

/**
 * `md` as Pandoc reads it inside a sub- or superscript: numeric and ASCII
 * named entities decoded, backslash escapes of ASCII punctuation dropped. Any
 * other named entity (`&eacute;`, `&mdash;`) becomes the letter `ǂ`, which
 * keeps a key going and matches no library citekey — a key that holds one is
 * reported, and fails closed.
 */
function decodeForSubscripts(md: string): string {
  return md
    .replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (m, dec?: string, hex?: string, name?: string) => {
      if (name !== undefined) return ASCII_ENTITIES[name] ?? '\u01c2';
      const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    })
    .replace(/\\([!-/:-@[-`{-~])/g, '$1');
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

// ---------------------------------------------------------------------------
// Pandoc's citation-key grammar (pandoc 3.x `citeKey`, review round 3 of
// Phase 18). A key is `@` — or `-@`, author suppressed — then either
//   - a braced key `{…}`: any non-space characters with BALANCED braces
//     (`@{ev{i}l}` is the key `ev{i}l`; `@{}` is an empty key, reported as
//     `{}` so it can never match a library citekey), or
//   - a simple key: a first letter, digit, `_` or `*`, then letters, digits
//     and `_`, one of the internal punctuation marks `:.#$%&-+?<>~/` only when
//     a letter, digit or `_` follows it, and `:` or `/` when a `/` follows it
//     (`@a://b`), so trailing sentence punctuation is never part of the key.
// The `@` must not come right after a word (Pandoc's "not after a Str": a
// letter or digit before it, so `name@host` never matches) — except right
// after another key (`@a@b` cites both) — and must not be escaped (an ODD run
// of backslashes before it: `\@k` is literal, `\\@k` cites k; inside a
// sub- or superscript Pandoc decodes escapes and entities first, which
// extractCitedKeysForVerification reads separately). Where Pandoc is
// stricter (`e.g.@k` is not a citation to Pandoc) this grammar reports the key
// anyway: an extra key fails closed; a missing one would be a gate bypass.
// ---------------------------------------------------------------------------

/** Letters and digits (Pandoc's `alphaNum`). */
const ALNUM_RE = /[\p{L}\p{N}]/u;
const INTERNAL_PUNCT = ':.#$%&-+?<>~/';

/** The code point at `i` (astral characters included). */
function charAt(text: string, i: number): string | undefined {
  const cp = text.codePointAt(i);
  return cp === undefined ? undefined : String.fromCodePoint(cp);
}

/** The code point that ends just before `i`. */
function charBefore(text: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const lo = text.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = text.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

function isRegChar(ch: string | undefined): boolean {
  return ch !== undefined && (ch === '_' || ALNUM_RE.test(ch));
}

/** The key after the `@` at `at`: its text and the offset just past it, or null. */
function readKey(text: string, at: number): { key: string; end: number } | null {
  const i = at + 1;
  if (text[i] === '{') {
    let depth = 0;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j] as string;
      if (/\s/u.test(c)) return null;
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          const key = text.slice(i + 1, j);
          return { key: key === '' ? '{}' : key, end: j + 1 };
        }
      }
    }
    return null;
  }
  const first = charAt(text, i);
  if (first === undefined || !(first === '*' || isRegChar(first))) return null;
  let j = i + first.length;
  for (;;) {
    const c = charAt(text, j);
    if (c === undefined) break;
    if (isRegChar(c)) {
      j += c.length;
      continue;
    }
    if (INTERNAL_PUNCT.includes(c)) {
      const next = charAt(text, j + 1);
      if (isRegChar(next) || ((c === ':' || c === '/') && next === '/')) {
        j += 1;
        continue;
      }
    }
    break;
  }
  return { key: text.slice(i, j), end: j };
}

/** True when an odd run of backslashes ends just before `i` (the character at `i` is escaped). */
function escapedAt(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) n += 1;
  return n % 2 === 1;
}

/**
 * Pandoc's example-list reference `@label` (label: runs of letters and digits,
 * each optionally led by `_` or `-`). Pandoc reads one wherever a citation
 * fails — `x@a` is not a citation, but its `@a` is consumed as a label — so the
 * `@` right after it may open a citation again (`x@a@b` cites b).
 */
const EXAMPLE_LABEL_RE = /(?:[\p{L}\p{N}]+|[_-][\p{L}\p{N}]+)+/uy;

/** True when a raw TeX command (`\\cmd`) ends just before `i`: Pandoc reads it as TeX, not as a word (`\\x@k` cites k). */
function afterTexCommand(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && /\p{L}/u.test(text[j - 1] as string)) j -= 1;
  return j < i && j > 0 && text[j - 1] === '\\' && !escapedAt(text, j - 1);
}

/**
 * A line that may rule a Pandoc table (`-  ---`, ` - `, `+---+`, `|:--|`, `===`)
 * or a setext heading. A simple, multiline or grid table cuts its rows at the
 * rule's column positions, so a cell may start right at an `@` that follows a
 * word (`k@h` → the cell `@h`, a citation) or an escaping backslash.
 */
const TABLE_RULE_RE = /^[ \t]*[-+=:|][-+=:| \t]*\r?$/m;

/** True when `md` may hold a table whose cells can start at any `@` (see TABLE_RULE_RE). */
function tableMayCut(md: string): boolean {
  for (const m of md.matchAll(new RegExp(TABLE_RULE_RE.source, 'gm'))) if (/[-=]/.test(m[0])) return true;
  return false;
}

/**
 * Every key match (index, length, key) in `text`, in order. `loose` (a text
 * that may hold a table, tableMayCut) counts every `@` followed by a key,
 * whatever comes before it.
 */
function keyMatches(text: string, loose = false): Array<{ index: number; length: number; key: string }> {
  const out: Array<{ index: number; length: number; key: string }> = [];
  // Where the last `@` token (a key, or a label Pandoc read instead of a
  // failed citation) ended: an `@` there is not "after a word".
  let lastEnd = -1;
  const startsAt = (s: number): boolean => {
    if (loose || s === lastEnd) return true; // right after another key or label: `@a@b`, `@a-@b`, `x@a@b`
    const before = charBefore(text, s);
    if (before !== undefined && ALNUM_RE.test(before) && !afterTexCommand(text, s)) return false;
    return !escapedAt(text, s);
  };
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = -1;
    if (at > 0 && text[at - 1] === '-' && startsAt(at - 1)) start = at - 1;
    else if (startsAt(at)) start = at;
    const k = start === -1 ? null : readKey(text, at);
    if (k !== null) {
      out.push({ index: start, length: k.end - start, key: k.key });
      lastEnd = k.end;
      continue;
    }
    // Not a citation: Pandoc reads an unescaped `@label` as an example reference.
    if (escapedAt(text, at)) continue;
    EXAMPLE_LABEL_RE.lastIndex = at + 1;
    const label = EXAMPLE_LABEL_RE.exec(text);
    if (label !== null) lastEnd = at + 1 + label[0].length;
  }
  return out;
}

/** The citekeys of one cluster's inner text (between the brackets), in order. */
function clusterKeys(inner: string, loose = false): string[] {
  return keyMatches(inner, loose).map((m) => m.key);
}

/**
 * Every citation cluster in `md` — `[@a]`, `[@a, p. 5]`, `[@a; @b]`,
 * `[see @a; also @b]`, `[-@a]`, `[@{a}]`, `[@Vaswani2017]` — in document order.
 * A bracketed run whose `@` is not a citation (`[mail a@b.org]`) is not a
 * cluster. Narrative citations are not clusters: read every citation with
 * findCitations. A cluster is found everywhere, code included (fail closed).
 */
export function findCitationClusters(md: string): CitationCluster[] {
  const out: CitationCluster[] = [];
  const loose = tableMayCut(md);
  for (const cm of md.matchAll(new RegExp(CLUSTER_RE_SOURCE, 'g'))) {
    const keys = clusterKeys(cm[1] ?? '', loose);
    if (keys.length === 0) continue;
    const start = cm.index;
    out.push({ start, end: start + cm[0].length, text: cm[0], keys });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where a narrative `@key` is NOT a citation: code, and nothing else (review
// round 3). Pandoc ignores an `@` in code, HTML comments, link destinations and
// autolinks, but telling those apart from text needs Pandoc's whole parser — a
// heuristic that marks a span Pandoc reads as text hides a citation from every
// gate (a drafter reply, a humanizer rewrite or an injected instruction could
// then carry a key that is never contained and never verified). So comments,
// link destinations and autolinks are NOT skipped (an `@` in them fails closed),
// and code is skipped only where this module can PROVE Pandoc reads code:
//   - a fenced code block whose fences are unambiguous (fencedCodeBlocks);
//   - an inline code span in a paragraph where no other construct can take a
//     backtick (inlineCodeSpans).
// Whenever the proof fails, the `@key` is a citation (fail closed). The rules
// are checked against pandoc 3.9 by tests/citation-grammar-pandoc.test.ts.
// ---------------------------------------------------------------------------

interface SourceLine {
  /** Offset of the line's first character. */
  readonly start: number;
  /** Offset of the line's end (its `\r\n` / `\n` excluded). */
  readonly end: number;
  /** The line without its line ending. */
  readonly text: string;
}

function sourceLines(md: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (;;) {
    const nl = md.indexOf('\n', start);
    const rawEnd = nl === -1 ? md.length : nl;
    const end = rawEnd > start && md[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    out.push({ start, end, text: md.slice(start, end) });
    if (nl === -1) return out;
    start = nl + 1;
  }
}

const BLANK_LINE_RE = /^[ \t]*$/;
/**
 * Constructs that can make a fence line or a backtick mean something else and
 * that this module does not model: raw HTML, comments and autolinks (`<` + a
 * letter, `!`, `?` or `/`), raw TeX (a backslash and a letter: its argument
 * may run across paragraphs; a plain escape only matters in its own paragraph,
 * BACKTICK_TAKER_RE), the end of a
 * YAML metadata block (`...`; its `---` start is a table rule, tableMayCut),
 * a byte-order mark, and a bare carriage return. Their presence (or a table
 * rule) turns the code proof off for the whole document.
 */
const UNMODELLED_RE = /<[\p{L}!?/]|\\\p{L}|\uFEFF|\r(?!\n)|^\.\.\.[ \t]*\r?$/mu;
/** A fence-like line: up to three spaces of indent, then 3+ backticks or tildes. */
const FENCE_LINE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** An attribute block Pandoc accepts after a fence: `{.lang #id key=value}` or a raw `{=format}`. */
const FENCE_ATTRS_RE = /^\{(?:=[\p{L}\p{N}_-]+|[ \t]*(?:(?:[#.]\p{L}[\p{L}\p{N}_:.-]*|\p{L}[\p{L}\p{N}_:.-]*=(?:"[^"\\]*"|'[^'\\]*'|[^\s"'}\\]*))(?:[ \t]+|(?=\})))*)\}$/u;

/**
 * A paragraph line Pandoc may continue across the next line with a construct
 * that swallows a fence line (a code span, math, link text or destination, a
 * note or span, a table row, a definition or div marker): a backtick fence
 * right after such a paragraph cannot be proved to open a code block.
 */
const SPANS_LINES_RE = /[`$[\]^|{}]|^[ \t]*[:~]/;

/**
 * The fenced code blocks of `md`, when every fence in it is unambiguous: an
 * opening fence at column 0 — right after a blank line, the start of the
 * document or a closed block, or (backticks only: Pandoc lets them interrupt
 * a paragraph) right after paragraph lines that nothing can continue into it
 * — whose info string is empty, one word without backticks or braces, or an
 * attribute block; closed by the first line of 0-3 spaces and at least as
 * many of the same fence character with nothing after. Any other fence-like
 * line — indented (it may sit in a list item), right after text that may
 * swallow it, with an odd info string, or never closed — means Pandoc's
 * reading cannot be proved, and no block is returned (every `@key` then
 * counts, fail closed).
 */
function fencedCodeBlocks(lines: readonly SourceLine[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let afterBlank = true;
  let paragraphSpansLines = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as SourceLine;
    const m = FENCE_LINE_RE.exec(line.text);
    if (m === null) {
      afterBlank = BLANK_LINE_RE.test(line.text);
      paragraphSpansLines = afterBlank ? false : paragraphSpansLines || SPANS_LINES_RE.test(line.text);
      continue;
    }
    const fence = m[2] as string;
    const info = (m[3] as string).trim();
    const infoOk = info === '' || /^[^\s`{}]+$/u.test(info) || FENCE_ATTRS_RE.test(info);
    const opens = afterBlank || (fence[0] === '`' && !paragraphSpansLines);
    if ((m[1] as string) !== '' || !opens || !infoOk) return [];
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec((lines[j] as SourceLine).text);
      if (c !== null && (c[1] as string)[0] === fence[0] && (c[1] as string).length >= fence.length) {
        close = j;
        break;
      }
    }
    if (close === -1) return [];
    out.push([line.start, (lines[close] as SourceLine).end]);
    i = close;
    afterBlank = true;
    paragraphSpansLines = false;
  }
  return out;
}

/** A paragraph that holds a construct able to take a backtick (math, a table cell, attributes, a note, a link or span, an escape): no inline-code proof there. */
const BACKTICK_TAKER_RE = /[$|{}^~\\]|\][ \t\r\n]*[([{:]/;
/** Paragraphs longer than this are not searched for code spans (every `@key` in them counts). */
const MAX_PARAGRAPH_LINES = 64;
const MAX_PARAGRAPH_CHARS = 20_000;

/**
 * Pandoc's code spans in `text`, as Pandoc pairs them: a backtick run opens a
 * span closed by the next run of exactly the same length; when there is none,
 * ONE backtick is literal and the rest of the run opens again (`` ``a`@k` ``
 * is a literal backtick, the code `a`, then the citation @k).
 */
function pairBackticks(text: string): Array<[number, number]> {
  // The maximal backtick runs, and each length's run starts in order (a
  // closer is looked up by binary search, so many unmatched runs stay linear).
  const runs: Array<{ start: number; length: number }> = [];
  for (let i = text.indexOf('`'); i !== -1; ) {
    let n = 0;
    while (text[i + n] === '`') n += 1;
    runs.push({ start: i, length: n });
    i = text.indexOf('`', i + n);
  }
  const byLength = new Map<number, number[]>();
  for (const r of runs) {
    const list = byLength.get(r.length) ?? [];
    list.push(r.start);
    byLength.set(r.length, list);
  }
  const closerAfter = (from: number, n: number): number => {
    const list = byLength.get(n);
    if (list === undefined) return -1;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as number) < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length ? (list[lo] as number) : -1;
  };
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const run of runs) {
    if (run.start < cursor) continue;
    cursor = run.start + run.length;
    for (let off = 0; off < run.length; off += 1) {
      const n = run.length - off;
      const close = closerAfter(run.start + run.length, n);
      if (close === -1) continue; // one backtick is literal; the rest of the run opens again
      out.push([run.start + off, close + n]);
      cursor = close + n;
      break;
    }
  }
  return out;
}

/**
 * The inline code spans of `md` that Pandoc provably reads as code: in a
 * paragraph (a run of non-blank lines outside the fenced blocks) that holds no
 * construct able to take a backtick, a span that lies on ONE line and that
 * every possible start of the enclosing block (each earlier line of the
 * paragraph, since a heading or list item may open a new block mid-paragraph)
 * pairs the same way.
 */
function inlineCodeSpans(md: string, lines: readonly SourceLine[], fences: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const inFence = (l: SourceLine): boolean => fences.some(([s, e]) => l.start >= s && l.start < e);
  let i = 0;
  while (i < lines.length) {
    const first = lines[i] as SourceLine;
    if (BLANK_LINE_RE.test(first.text) || inFence(first)) {
      i += 1;
      continue;
    }
    let k = i;
    while (k + 1 < lines.length && !BLANK_LINE_RE.test((lines[k + 1] as SourceLine).text) && !inFence(lines[k + 1] as SourceLine)) k += 1;
    const para = lines.slice(i, k + 1);
    i = k + 1;
    const last = para[para.length - 1] as SourceLine;
    const text = md.slice(first.start, last.end);
    if (!text.includes('`') || BACKTICK_TAKER_RE.test(text)) continue;
    if (para.length > MAX_PARAGRAPH_LINES || text.length > MAX_PARAGRAPH_CHARS) continue;
    // The one-line spans of each possible block start, keyed by absolute offsets.
    const pairings = para.map((from) =>
      new Set(
        pairBackticks(md.slice(from.start, last.end))
          .map(([s, e]) => [s + from.start, e + from.start] as const)
          .filter(([s, e]) => !md.slice(s, e).includes('\n'))
          .map(([s, e]) => `${s}:${e}`),
      ),
    );
    para.forEach((line, li) => {
      for (const span of pairings[0] as Set<string>) {
        const [s, e] = span.split(':').map(Number) as [number, number];
        if (s < line.start || e > line.end) continue;
        if (pairings.slice(0, li + 1).every((p) => p.has(span))) out.push([s, e]);
      }
    });
  }
  return out;
}

/**
 * Characters that change where Pandoc's lines end or what it reads anywhere in
 * the document — a bare carriage return is a line break to Pandoc (so a fence
 * interior may end sooner than the proof thinks) and a byte-order mark — turn
 * the proof off even inside a fenced block.
 */
const GLOBALLY_UNMODELLED_RE = /\r(?!\n)|\uFEFF/;

/**
 * `md` with the interior lines of each proven fenced block blanked (offsets
 * kept). Pandoc reads a fenced block's interior verbatim, so a construct inside
 * it (raw TeX, HTML, a comment opener) cannot swallow anything outside it; only
 * the text outside the blocks can make a fence line mean something else.
 */
function outsideFenceInteriors(md: string, lines: readonly SourceLine[], fences: ReadonlyArray<readonly [number, number]>): string {
  if (fences.length === 0) return md;
  let out = '';
  let at = 0;
  for (const [start, end] of fences) {
    const open = lines.find((l) => l.start === start) as SourceLine;
    const closeStart = lines.filter((l) => l.end === end).map((l) => l.start)[0] ?? end;
    const from = Math.min(open.end, closeStart);
    out += md.slice(at, from) + md.slice(from, closeStart).replace(/[^\n]/g, ' ');
    at = closeStart;
  }
  return out + md.slice(at);
}

/**
 * The spans of `md` Pandoc provably reads as code (see above); empty when that
 * cannot be proved. The unmodelled constructs are looked for outside the
 * interiors of the fenced blocks (a `\cite{}` or `<div>` shown in a code block
 * does not void the proof), a bare carriage return, a byte-order mark and a
 * table rule anywhere (checked against pandoc 3.9 by
 * tests/citation-grammar-pandoc.test.ts).
 */
function codeSpans(md: string): Array<[number, number]> {
  if (GLOBALLY_UNMODELLED_RE.test(md) || tableMayCut(md)) return [];
  const lines = sourceLines(md);
  const fences = fencedCodeBlocks(lines);
  if (UNMODELLED_RE.test(outsideFenceInteriors(md, lines, fences))) return [];
  return [...fences, ...inlineCodeSpans(md, lines, fences)];
}

/**
 * The spans of `md` that Pandoc provably reads as code — fenced code blocks
 * and inline code spans — as `[start, end)` offsets, in document order. Empty
 * whenever the proof fails (every construct then counts as text: fail closed).
 * The text scanners (UNPARSEABLE, UNSUPPORTED-FORM) skip exactly these spans.
 */
export function provableCodeSpans(md: string): Array<[number, number]> {
  if (!md.includes('`') && !md.includes('~')) return [];
  return codeSpans(md).sort((a, b) => a[0] - b[0]);
}

/** True when offset `at` lies inside one of `spans`. */
export function offsetInSpans(at: number, spans: ReadonlyArray<readonly [number, number]>): boolean {
  return inSpans(at, spans);
}

/** The 1-based line of offset `at` in `md` (LF and CRLF alike: lines end at `\n`). */
export function lineOfOffset(md: string, at: number): number {
  let line = 1;
  for (let i = md.indexOf('\n'); i !== -1 && i < at; i = md.indexOf('\n', i + 1)) line += 1;
  return line;
}

function inSpans(at: number, spans: ReadonlyArray<readonly [number, number]>): boolean {
  return spans.some(([s, e]) => at >= s && at < e);
}

/**
 * Every narrative (in-text) citation in `md`: an `@key` / `-@key` / `@{key}`
 * outside every bracketed cluster and outside code (Pandoc renders
 * `@smith2020 argues` as "Smith (2020) argues"). An `@key` in an HTML comment,
 * a link destination or an autolink counts (fail closed, see above).
 */
export function findNarrativeCitations(md: string): CitationCluster[] {
  const clusters = findCitationClusters(md);
  const code = md.includes('`') || md.includes('~') ? codeSpans(md) : [];
  const out: CitationCluster[] = [];
  for (const m of keyMatches(md, tableMayCut(md))) {
    const end = m.index + m.length;
    if (clusters.some((c) => m.index >= c.start && end <= c.end)) continue;
    if (inSpans(m.index, code)) continue;
    out.push({ start: m.index, end, text: md.slice(m.index, end), keys: [m.key], narrative: true });
  }
  return out;
}

/** Every citation in `md` — bracketed clusters and narrative citations — in document order. */
export function findCitations(md: string): CitationCluster[] {
  return [...findCitationClusters(md), ...findNarrativeCitations(md)].sort((a, b) => a.start - b.start);
}

/**
 * The citations Pandoc renders in `md`, for an offline renderer: every
 * citation of findCitations that does not sit in code (a cluster inside code
 * still counts for the gates, but is left as written in an export).
 */
export function findRenderedCitations(md: string): CitationCluster[] {
  const code = md.includes('`') || md.includes('~') ? codeSpans(md) : [];
  return findCitations(md).filter((c) => !inSpans(c.start, code));
}

// ---------------------------------------------------------------------------
// UNPARSEABLE — citation-shaped text the grammar cannot read the way Pandoc
// renders it (VRFY-09, D-20-07). Each form is a blocking Pass-1 row naming
// the text and its line: a citation that does not parse must never look
// "absent" (AUDIT-FINDINGS #2/#3). The rules are checked against pandoc 3.9 by
// tests/citation-grammar-pandoc.test.ts (tests/fixtures/citation-grammar/
// unparseable.json): Pandoc prints the first three as text (or reads a
// narrative citation where a bracketed one was meant) and reads the fourth as
// one bracketed citation whose prefix or suffix holds a bracket — a structure
// findCitations does not model (it reads a narrative citation there).
// ---------------------------------------------------------------------------

const UNPARSEABLE_REASONS: Readonly<Record<string, string>> = {
  'empty-key': 'a citation with no key — Pandoc prints it as text; write [@citekey] with a key from CITATIONS.bib',
  'unbalanced-bracket':
    'a citation bracket that is never closed in its paragraph — Pandoc prints the "[" as text around a narrative citation; close it: [@citekey]',
  'unterminated-braced-key':
    'a braced key "@{" with no closing "}" before a space — Pandoc prints it as text; write @{citekey} or [@citekey]',
  'nested-bracket':
    'a citation bracket that holds another bracket — Pandoc renders a form the verifier does not model; take the inner brackets out (e.g. [@citekey, p. 5, see note])',
};

/** A paragraph of `md`: a run of lines between blank lines (a heading line is a paragraph of its own). */
function paragraphSpans(md: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  for (const line of sourceLines(md)) {
    const blank = BLANK_LINE_RE.test(line.text);
    const heading = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line.text);
    if (blank || heading) {
      if (start !== -1) out.push([start, end]);
      start = -1;
      if (heading) out.push([line.start, line.end]);
      continue;
    }
    if (start === -1) start = line.start;
    end = line.end;
  }
  if (start !== -1) out.push([start, end]);
  return out;
}

/** The text of a finding: `md[start, end)` cut at its line end and at `max` characters. */
function findingText(md: string, start: number, end: number, max = 80): string {
  const nl = md.indexOf('\n', start);
  const stop = Math.min(end, nl === -1 ? md.length : nl, start + max);
  return md.slice(start, stop).replace(/\r$/, '');
}

interface OpenBracket {
  readonly open: number;
  /** A citation-start `@key` sits in this bracket at its own depth. */
  hasKey: boolean;
  /** Another bracket opened inside this one. */
  nested: boolean;
}

/**
 * Every citation-shaped token of `md` that does not parse (VRFY-09, D-20-07),
 * outside provable code (provableCodeSpans), in document order:
 *   - `empty-key`: `[@` / `[-@` — or a `;` segment start inside a citation
 *     bracket — not followed by a key: `[@]`, `[@ k]`, `[-@]`, `[@k; @]`;
 *   - `unbalanced-bracket`: a `[` whose own `@key` run is never closed in its
 *     paragraph: `[@k`, `[see @k and more`;
 *   - `unterminated-braced-key`: `@{` with no balanced `}` before whitespace:
 *     `@{unterminated`, `[@{a b}]`;
 *   - `nested-bracket`: a bracket holding a citation-start `@key` and a nested
 *     bracket: `[@smith2020 [see note]]`, `[see [x] @k]`, `[@k, p. [5]]`.
 * An `@` Pandoc cannot read as a citation start (`name@host`, `\@k`) is never
 * reported, and neither is an escaped bracket (`\[`). Line numbers are 1-based
 * and count `\n`, so an LF and a CRLF copy of a draft report the same lines.
 */
export function findUnparseableCitations(md: string): TextFinding[] {
  if (!md.includes('@')) return [];
  const code = provableCodeSpans(md);
  const loose = tableMayCut(md);
  const out: Array<{ readonly at: number; readonly finding: TextFinding }> = [];
  const report = (form: string, at: number, end: number): void => {
    if (offsetInSpans(at, code)) return;
    const finding: TextFinding = { verdict: 'UNPARSEABLE', form, text: findingText(md, at, end), line: lineOfOffset(md, at), reason: UNPARSEABLE_REASONS[form] as string };
    out.push({ at, finding });
  };
  for (const [pStart, pEnd] of paragraphSpans(md)) {
    const para = md.slice(pStart, pEnd);
    if (!para.includes('@')) continue;
    // Citation starts Pandoc can read (the `@` of every key match), and those
    // whose key does not parse.
    const keyAt = new Set<number>();
    for (const m of keyMatches(para, loose)) keyAt.add(para.indexOf('@', m.index));
    const failedStarts = failedCitationStarts(para, loose);
    const paraCode = code.filter(([s, e]) => e > pStart && s < pEnd).map(([s, e]) => [s - pStart, e - pStart] as const);
    const stack: OpenBracket[] = [];
    for (let i = 0; i < para.length; i += 1) {
      const inCode = paraCode.find(([s, e]) => i >= s && i < e);
      if (inCode !== undefined) {
        i = inCode[1] - 1; // a bracket or `@` in code is not citation syntax
        continue;
      }
      const c = para[i] as string;
      if (c === '[' && !escapedAt(para, i)) {
        const top = stack[stack.length - 1];
        if (top !== undefined) top.nested = true;
        stack.push({ open: i, hasKey: false, nested: false });
        continue;
      }
      if (c === ']' && !escapedAt(para, i)) {
        const b = stack.pop();
        if (b !== undefined && b.hasKey && b.nested) report('nested-bracket', pStart + b.open, pStart + i + 1);
        continue;
      }
      if (c !== '@') continue;
      const top = stack[stack.length - 1];
      if (keyAt.has(i)) {
        if (top !== undefined) top.hasKey = true;
        continue;
      }
      if (!failedStarts.has(i)) continue;
      const lead = i > 0 && para[i - 1] === '-' ? i - 1 : i;
      if (para[i + 1] === '{') {
        const ws = /\s/.exec(para.slice(i));
        report('unterminated-braced-key', pStart + lead, pStart + (ws === null ? para.length : i + ws.index));
        continue;
      }
      if (top === undefined) continue;
      // A key-less `@` opening a citation item: right after the bracket, or
      // after a `;` of a bracket that already cites (`[@k; @]`).
      const before = para.slice(top.open, lead).replace(/[ \t]+$/, '');
      if (before === '[') report('empty-key', pStart + top.open, pStart + closingBracketAfter(para, i));
      else if (before.endsWith(';') && top.hasKey) report('empty-key', pStart + lead, pStart + closingBracketAfter(para, i));
    }
    for (const b of stack) if (b.hasKey) report('unbalanced-bracket', pStart + b.open, pEnd);
  }
  return out.sort((a, b) => a.at - b.at).map((f) => f.finding);
}

/** The offset just past the `]` closing the bracket around offset `i` on its line, or its line end. */
function closingBracketAfter(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  const lineEnd = nl === -1 ? text.length : nl;
  const close = text.indexOf(']', i);
  return close !== -1 && close < lineEnd ? close + 1 : lineEnd;
}

/**
 * The `@` offsets of `text` where Pandoc could start a citation (not escaped,
 * not right after a word — keyMatches' rule) but no key follows (`@]`, `@ k`,
 * `@{a b}`).
 */
function failedCitationStarts(text: string, loose: boolean): Set<number> {
  const out = new Set<number>();
  const keys = new Set(keyMatches(text, loose).map((m) => text.indexOf('@', m.index)));
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (keys.has(at) || escapedAt(text, at)) continue;
    const before = charBefore(text, at);
    if (!loose && before !== undefined && ALNUM_RE.test(before) && !afterTexCommand(text, at)) continue;
    if (readKey(text, at) === null) out.add(at);
  }
  return out;
}

/** One cited source of a cluster, as Pandoc splits it: `[see @a, p. 5; -@b]` → two items. */
export interface CitationItem {
  /** Text before the key (`see`), trimmed. */
  readonly prefix: string;
  readonly key: string;
  /** True for `-@key` (author suppressed). */
  readonly suppressAuthor: boolean;
  /** Text after the key (`, p. 5`), trailing space trimmed — the locator included. */
  readonly suffix: string;
  /** The locator value when the suffix opens with one (`5` in `, p. 5`; `33-35` in `, 33-35`). */
  readonly locator?: string;
  /** The locator's CSL label (`page`, `chapter`, …) when there is a locator. */
  readonly label?: string;
  /** True for a narrative (in-text) citation `@key` outside brackets. */
  readonly narrative: boolean;
}

/**
 * Locator terms Pandoc recognises after a citekey (`[@k, p. 5]`, `[@k, chap. 3]`),
 * with their CSL labels. A bare number (`[@k, 33]`) is a page, as in Pandoc.
 * The offline exporter (exporter.ts) renders locators from this table too.
 */
export const LOCATOR_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:pp?\.|pages?\b)/i, 'page'],
  [/^(?:chaps?\.|chapters?\b)/i, 'chapter'],
  [/^(?:secs?\.|sections?\b|§§?)/i, 'section'],
  [/^(?:figs?\.|figures?\b)/i, 'figure'],
  [/^(?:vols?\.|volumes?\b)/i, 'volume'],
  [/^(?:paras?\.|paragraphs?\b|¶¶?)/i, 'paragraph'],
  [/^(?:ll?\.|lines?\b)/i, 'line'],
  [/^(?:nn?\.|notes?\b)/i, 'note'],
  [/^(?:nos?\.|numbers?\b)/i, 'issue'],
  [/^(?:cols?\.|columns?\b)/i, 'column'],
  [/^(?:pts?\.|parts?\b)/i, 'part'],
  [/^(?:vv?\.|verses?\b)/i, 'verse'],
  [/^(?:bks?\.|books?\b)/i, 'book'],
  [/^(?:fols?\.|folios?\b)/i, 'folio'],
  [/^(?:s\.vv?\.|sub verbo\b)/i, 'sub-verbo'],
];
/** A locator value: a number or roman numeral, an optional range, more comma-separated numbers. */
export const LOCATOR_VALUE_RE = /^[\p{N}ivxlcdm]+(?:[-–—][\p{N}ivxlcdm]+)?(?:,\s*[\p{N}]+(?:[-–—][\p{N}]+)?)*/iu;

/** A citation item's locator: its value, its CSL label and the suffix text after it. */
export interface LocatorSplit {
  readonly locator: string;
  readonly label: string;
  /** The suffix after the locator (`, emphasis added`), as written. */
  readonly rest: string;
}

/**
 * The locator a citation item's suffix opens with (`, p. 5` → 5 / page;
 * ` chap. 3, note` → 3 / chapter, rest `, note`; `, 33-35` → a page range),
 * or null. A term needs a value (`p. 5`, `chap. iv`); a bare number is a page
 * only after a comma, as in Pandoc.
 */
export function splitLocator(suffix: string): LocatorSplit | null {
  const rest = suffix.replace(/^\s*,?\s*/, '');
  if (rest === '') return null;
  for (const [term, label] of LOCATOR_TERMS) {
    const t = term.exec(rest);
    if (t === null) continue;
    const after = rest.slice(t[0].length).trimStart();
    const v = LOCATOR_VALUE_RE.exec(after);
    if (v === null || !/\p{N}|^[ivxlcdm]+$/iu.test(v[0])) break;
    return { locator: v[0], label, rest: after.slice(v[0].length) };
  }
  const page = /^,\s*/.test(suffix) ? /^\p{N}+(?:[-–—]\p{N}+)?/u.exec(rest) : null;
  if (page !== null) return { locator: page[0], label: 'page', rest: rest.slice(page[0].length) };
  return null;
}

/**
 * The items of one citation (a cluster's `;` segments, or a narrative
 * citation's one key): prefix, key, suffix, locator and its label,
 * suppress-author and narrative, for every Pandoc form (VRFY-09).
 */
export function citationItems(c: CitationCluster): CitationItem[] {
  const narrative = c.narrative === true;
  const segments = narrative ? [c.text] : c.text.slice(1, -1).split(';');
  const out: CitationItem[] = [];
  for (const segment of segments) {
    const m = keyMatches(segment)[0];
    if (m === undefined) continue;
    const token = segment.slice(m.index, m.index + m.length);
    const suffix = segment.slice(m.index + m.length).trimEnd();
    const loc = splitLocator(suffix);
    out.push({
      prefix: segment.slice(0, m.index).trim(),
      key: m.key,
      suppressAuthor: token.startsWith('-'),
      suffix,
      ...(loc !== null ? { locator: loc.locator, label: loc.label } : {}),
      narrative,
    });
  }
  return out;
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

/**
 * `md` with every citation of findCitations — bracketed clusters and narrative
 * citations, code included — replaced by `fn(citation)`; the text between
 * citations is left untouched. For the fail-closed rewriters that must not
 * miss a citation form: compile's smoother masking (every citation becomes a
 * placeholder the model cannot rewrite, drop or re-key) and byo-text.ts's
 * claim words (Phase 19 review round 2).
 */
export function replaceCitations(md: string, fn: (citation: CitationCluster) => string): string {
  let out = '';
  let at = 0;
  for (const c of findCitations(md)) {
    if (c.start < at) continue;
    out += md.slice(at, c.start) + fn(c);
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
