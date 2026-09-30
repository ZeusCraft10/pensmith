// bin/lib/doi.ts — DOI/arXiv/PMID/PMCID normalization chokepoint (ARCH-15).
//
// This is the SOLE file in the repo allowed to use the regex /^10\./
// (Phase 0 D-07 chokepoint, eslint.config.js exemption is in place at line
// 96-99). Every other module that compares citations must call into this
// file — never re-implement the prefix/punctuation handling locally.
//
// Spec (D-15, D-17, D-18):
//
//   normalizeDoi(input)  ──→  string | null
//     1. trim whitespace
//     2. strip prefix (case-insensitive on prefix only):
//          a label — 'doi:' / 'DOI:' (optionally followed by spaces,
//          'DOI: 10.1038/…'), or 'doi ' ('DOI 10.1007/…');
//          or a resolver URL — http(s)://[www.]doi.org/, http(s)://[www.]dx.doi.org/,
//          or doi.org/ / dx.doi.org/ / www.doi.org/ without a scheme — whose
//          remainder is percent-decoded once ('https://doi.org/10.1038%2Fnature14539',
//          SRC-13); then trim again
//     3. strip trailing punctuation in ONE pass (not recursive):
//          [. , ; : ) ] } > " ']+
//     4. lowercase ASCII [A-Z] in BOTH halves; preserve non-ASCII bytes
//        verbatim (so '10.1234/résumé' round-trips identically)
//     5. validate against /^10\.\d{4,9}\/\S+$/  → return canonical OR null
//
//   normalizeArxiv(input)  ──→  string | null
//     - strip trailing punctuation (as for a DOI) and the 'arxiv:' prefix
//       (case-insensitive, optionally followed by spaces)
//     - new format: YYMM.NNNNN[vV]    → canonical 'arxiv:NNNN.NNNNN[vN]'
//     - old format: <archive>[.<subject>]/YYMMNNN[vV] → canonical
//        '<archive>[.<SUBJECT>]/YYMMNNN[vN]' (hep-th/9901001v2, math.GT/0309136;
//        the archive lower case, a two-letter subject upper case — so
//        'HEP-TH/9901001' and 'math.gt/0309136' normalize too; SRC-13)
//
//   normalizePmid(input)   ──→  string | null
//     - accept digits-only OR 'PMID:digits' / 'PMID: digits' / 'PMID digits'
//       (case-insensitive prefix)
//     - canonical: bare digits (max 9, the PubMed limit)
//
//   normalizePmcid(input)  ──→  string | null
//     - accept 'PMC<digits>' (case-insensitive prefix)
//     - canonical: 'PMC<digits>' (PMC uppercase)
//
// Threat model (T-01-DOS-03 catastrophic backtracking):
//   All regexes are LINEAR — no nested quantifiers, no `(.*)*` patterns.
//   The fast-check property test in tests/doi.property.test.ts runs 1000
//   iterations of garbage / valid / trailing-punct corpora and serves as
//   a fuzz harness against pathological input.

// The resolver-URL prefix forms (D-15 step 1, extended by SRC-13): an
// https/http doi.org or dx.doi.org URL (with or without `www.`, or with no
// scheme at all). A DOI given as a URL may be percent-encoded
// (`https://doi.org/10.1038%2Fnature14539`), so the rest of a URL form is
// percent-decoded once; a bare DOI is never decoded (a literal `%` is legal
// in a DOI, and decoding it would break idempotence).
const DOI_URL_PREFIXES: readonly string[] = [
  'https://www.dx.doi.org/',
  'http://www.dx.doi.org/',
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'https://www.doi.org/',
  'http://www.doi.org/',
  'https://doi.org/',
  'http://doi.org/',
  'www.doi.org/',
  'dx.doi.org/',
  'doi.org/',
];

// The label prefixes: `doi:` / `DOI:` (any case, optionally followed by
// spaces — `DOI: 10.1038/…` as journals print it), and `doi ` + space
// (`DOI 10.1007/…`, Springer's footer form). Matched case-insensitively.
const DOI_LABEL_PREFIX = /^doi(?::\s*|\s+)/i;

// 8 trailing-punctuation forms (D-15 step 2). The character class covers
// 10 characters because the spec lumps `]`/`}`/`>`/`"` with the brackets
// and quotes — see plan 01-04 line 96-97.
const TRAILING_PUNCT = /[.,;:)\]}>"']+$/;

// The DOI chokepoint regex (D-07). This is the ONE file allowed to write
// the literal `/^10\./` pattern; eslint.config.js exempts it.
const DOI_VALID = /^10\.\d{4,9}\/\S+$/;

/**
 * Lowercase only ASCII [A-Z]; preserve every other code point verbatim.
 * String#toLowerCase() would also touch latin-1 supplement and other
 * locale-affected ranges (D-15 step 3 forbids that — DOIs are byte-stable).
 */
function lowerAsciiOnly(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Normalize a DOI string to its canonical lowercase ASCII form.
 *
 * Returns null if the input is empty, garbage, or fails the
 * /^10\.\d{4,9}\/\S+$/ validation after normalization.
 *
 * Idempotence guarantee (D-19): for any input x where
 * `normalizeDoi(x) !== null`, `normalizeDoi(normalizeDoi(x)) === normalizeDoi(x)`.
 * Verified by tests/doi.property.test.ts over 1000 fast-check iterations.
 */
export function normalizeDoi(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  // Step 1: strip prefix (longest match wins). Case-insensitive on the
  // prefix only — the body's case is handled by step 4. A resolver URL's
  // remainder is percent-decoded once (SRC-13: `%2F` doi.org links).
  const lower = s.toLowerCase();
  let matchedUrl = false;
  for (const p of DOI_URL_PREFIXES) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length);
      matchedUrl = true;
      break;
    }
  }
  if (matchedUrl) {
    try {
      s = decodeURIComponent(s);
    } catch {
      return null; // a malformed escape (`%zz`) — not a DOI
    }
  } else {
    s = s.replace(DOI_LABEL_PREFIX, '');
  }
  s = s.trim();

  // Step 2: strip trailing punctuation in ONE pass (NOT recursive).
  s = s.replace(TRAILING_PUNCT, '');
  if (!s) return null;

  // Step 3: split on first '/' to isolate registrant code from suffix.
  const idx = s.indexOf('/');
  if (idx < 0) return null;
  const prefix = s.slice(0, idx);
  const suffix = s.slice(idx + 1);
  if (!suffix) return null;

  // Step 4: lowercase ASCII alpha in BOTH halves; non-ASCII preserved.
  const canonical = `${lowerAsciiOnly(prefix)}/${lowerAsciiOnly(suffix)}`;

  // Step 5: validate against the chokepoint regex.
  return DOI_VALID.test(canonical) ? canonical : null;
}

/**
 * Type-guard form of normalizeDoi — true iff normalizeDoi(s) !== null.
 */
export function isDoi(s: string): boolean {
  return normalizeDoi(s) !== null;
}

// arXiv new format (post-2007): YYMM.NNNNN[vV]
//   - YY = 00..99, MM = 01..12 — we accept any 4-digit prefix; the
//     authoritative arXiv API will reject impossible months. We're a
//     normalizer, not a validator of arXiv's own bookkeeping.
//   - NNNNN = 4..5 digits, optional 'v<digit>' suffix.
const ARXIV_NEW = /^(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i;

// arXiv old format (pre-April-2007, D-17 + SRC-13): <archive>[.<subject>]/YYMMNNN[vV].
// The archive names arXiv used for old-style identifiers (including the
// retired ones, e.g. alg-geom, chao-dyn); an unknown archive returns null
// rather than a false positive.
const ARXIV_OLD_ARCHIVES: ReadonlySet<string> = new Set([
  'acc-phys', 'adap-org', 'alg-geom', 'ao-sci', 'astro-ph', 'atom-ph', 'bayes-an', 'chao-dyn', 'chem-ph',
  'cmp-lg', 'comp-gas', 'cond-mat', 'cs', 'dg-ga', 'funct-an', 'gr-qc', 'hep-ex', 'hep-lat', 'hep-ph',
  'hep-th', 'math', 'math-ph', 'mtrl-th', 'nlin', 'nucl-ex', 'nucl-th', 'patt-sol', 'physics', 'plasm-ph',
  'q-alg', 'q-bio', 'q-fin', 'quant-ph', 'solv-int', 'stat', 'supr-con',
]);

// Archives whose subject classes are two upper-case letters (math.GT, cs.CL,
// astro-ph.CO, …) — written upper case whatever the input's case.
const ARXIV_TWO_LETTER_SUBJECTS: ReadonlySet<string> = new Set(['astro-ph', 'cs', 'math', 'nlin', 'q-bio', 'q-fin', 'stat']);

// The lower-case subject classes of cond-mat and physics (cond-mat.str-el,
// physics.optics, …).
const ARXIV_WORD_SUBJECTS: Readonly<Record<string, ReadonlySet<string>>> = {
  'cond-mat': new Set(['dis-nn', 'mes-hall', 'mtrl-sci', 'other', 'quant-gas', 'soft', 'stat-mech', 'str-el', 'supr-con']),
  physics: new Set([
    'acc-ph', 'ao-ph', 'app-ph', 'atm-clus', 'atom-ph', 'bio-ph', 'chem-ph', 'class-ph', 'comp-ph', 'data-an',
    'ed-ph', 'flu-dyn', 'gen-ph', 'geo-ph', 'hist-ph', 'ins-det', 'med-ph', 'optics', 'plasm-ph', 'pop-ph',
    'soc-ph', 'space-ph',
  ]),
};

/** The canonical `<archive>[.<subject>]` of an old-style class, or null when unknown. */
function canonicalOldClass(cls: string): string | null {
  const dot = cls.indexOf('.');
  const archive = (dot < 0 ? cls : cls.slice(0, dot)).toLowerCase();
  if (!ARXIV_OLD_ARCHIVES.has(archive)) return null;
  if (dot < 0) return archive;
  const subject = cls.slice(dot + 1);
  if (ARXIV_TWO_LETTER_SUBJECTS.has(archive) && /^[A-Za-z]{2}$/.test(subject)) return `${archive}.${subject.toUpperCase()}`;
  const words = ARXIV_WORD_SUBJECTS[archive];
  if (words?.has(subject.toLowerCase())) return `${archive}.${subject.toLowerCase()}`;
  return null;
}

/**
 * Normalize an arXiv identifier.
 *
 *   - 'arXiv:2103.00020'    → 'arxiv:2103.00020'
 *   - 'arXiv:2103.00020v2'  → 'arxiv:2103.00020v2'
 *   - '2103.00020'          → 'arxiv:2103.00020'
 *   - 'arXiv:1706.03762.'   → 'arxiv:1706.03762' (trailing punctuation dropped)
 *   - 'cs.CL/0301012'       → 'cs.CL/0301012'
 *   - 'arxiv:cs.CL/0301012' → 'cs.CL/0301012'
 *   - 'hep-th/9901001v2'    → 'hep-th/9901001v2'
 *   - 'HEP-TH/9901001'      → 'hep-th/9901001'
 *   - 'math.gt/0309136'     → 'math.GT/0309136'
 *
 * Returns null on garbage or an unknown archive / subject class.
 */
export function normalizeArxiv(input: string): string | null {
  if (typeof input !== 'string') return null;
  // Trailing sentence punctuation ('arXiv:1706.03762.' in running text) is
  // stripped exactly like a DOI's (SRC-13); 'arXiv: 1706.03762' (a space after
  // the label) is accepted.
  const s = input.trim().replace(TRAILING_PUNCT, '').replace(/^arxiv:\s+/i, 'arXiv:');
  if (!s) return null;

  // New format (with or without 'arxiv:' prefix). The capture group
  // contains the body (digits.digits[v<digit>]).
  const newMatch = ARXIV_NEW.exec(s);
  if (newMatch && newMatch[1]) {
    // Lowercase only the optional 'v' marker; the digits are case-neutral.
    return `arxiv:${newMatch[1].toLowerCase()}`;
  }

  // Old format: optional 'arxiv:' prefix + <archive>[.<subject>]/YYMMNNN[vV]
  // (hep-th/9901001v2, math.GT/0309136, HEP-TH/9901001). The archive is
  // written lower case, a two-letter subject upper case (cs.CL, math.GT).
  const stripped = s.replace(/^arxiv:/i, '');
  const slashIdx = stripped.indexOf('/');
  if (slashIdx < 0) return null;
  const cls = canonicalOldClass(stripped.slice(0, slashIdx));
  const body = /^(\d{7})(v\d+)?$/i.exec(stripped.slice(slashIdx + 1));
  if (cls === null || !body) return null;
  return `${cls}/${body[1]}${(body[2] ?? '').toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Identifiers inside running text (SRC-13 / SRC-15 PDF identification).
// ---------------------------------------------------------------------------

// A DOI as it appears in a PDF: `doi:10.…`, `https://doi.org/10.…`, `DOI 10.…`
// or bare. The match stops at whitespace and at characters that do not occur
// in DOIs printed in running text; normalizeDoi then strips trailing
// punctuation. Linear: no nested quantifiers (T-01-DOS-03).
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>{}|\\^`]+/g;

/**
 * The distinct normalized DOIs in `text`, in order of first appearance. A DOI
 * broken across a line end is not joined (a PDF's own DOI is usually printed
 * on one line).
 */
export function findDoisInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOI_IN_TEXT)) {
    const doi = normalizeDoi(m[0]);
    if (doi !== null && !out.includes(doi)) out.push(doi);
  }
  return out;
}

// The stamp arXiv prints down the left margin of every page 1:
// `arXiv:1706.03762v7 [cs.CL] 2 Aug 2023` (new style) or
// `arXiv:hep-th/9901001v2 …` (old style).
const ARXIV_STAMP_IN_TEXT = /\barxiv:\s?((?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z-]{2,})?\/\d{7})(?:v\d+)?)\s*\[[^\]\n]{1,20}\]/gi;
const ARXIV_LABEL_IN_TEXT = /\barxiv:\s?((?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z-]{2,})?\/\d{7})(?:v\d+)?)/gi;

/**
 * The arXiv ids in `text` (canonical normalizeArxiv form, versions dropped),
 * stamped ids (`arXiv:<id> [<class>]`) first, then other `arXiv:<id>`
 * mentions, each in order of first appearance.
 */
export function findArxivIdsInText(text: string): { stamped: string[]; mentioned: string[] } {
  const norm = (raw: string): string | null => {
    const n = normalizeArxiv(`arXiv:${raw}`);
    return n === null ? null : n.replace(/^arxiv:/, '').replace(/v\d+$/, '');
  };
  const stamped: string[] = [];
  for (const m of text.matchAll(ARXIV_STAMP_IN_TEXT)) {
    const id = norm(m[1] ?? '');
    if (id !== null && !stamped.includes(id)) stamped.push(id);
  }
  const mentioned: string[] = [];
  for (const m of text.matchAll(ARXIV_LABEL_IN_TEXT)) {
    const id = norm(m[1] ?? '');
    if (id !== null && !stamped.includes(id) && !mentioned.includes(id)) mentioned.push(id);
  }
  return { stamped, mentioned };
}

/**
 * Type-guard form of normalizeArxiv.
 */
export function isArxiv(s: string): boolean {
  return normalizeArxiv(s) !== null;
}

/**
 * Normalize a PubMed ID (PMID).
 *
 * Accepts bare digits OR a 'PMID:' / 'PMID ' prefix (case-insensitive). Canonical
 * form is bare digits, max 9 (PubMed's hard upper bound — IDs above 1e9
 * have not been issued at the time of writing).
 */
export function normalizePmid(input: string): string | null {
  if (typeof input !== 'string') return null;
  // 'PMID:31978945', 'pmid: 31978945' and PubMed's own 'PMID 31978945' (SRC-13).
  const s = input.trim().replace(/^pmid(?::\s*|\s+)/i, '');
  return /^\d+$/.test(s) && s.length >= 1 && s.length <= 9 ? s : null;
}

/**
 * Type-guard form of normalizePmid.
 */
export function isPmid(s: string): boolean {
  return normalizePmid(s) !== null;
}

/**
 * Normalize a PMC (PubMed Central) identifier.
 *
 * Requires a 'PMC' prefix (case-insensitive on input); canonical form
 * uppercases the prefix: 'pmc1234567' → 'PMC1234567'. Bare digits return
 * null because they cannot be disambiguated from a PMID.
 */
export function normalizePmcid(input: string): string | null {
  if (typeof input !== 'string') return null;
  const m = /^pmc(\d+)$/i.exec(input.trim());
  return m && m[1] ? `PMC${m[1]}` : null;
}

/**
 * Type-guard form of normalizePmcid.
 */
export function isPmcid(s: string): boolean {
  return normalizePmcid(s) !== null;
}

// ---------------------------------------------------------------------------
// Bare identifiers in a draft's prose (Phase 20, VRFY-10, D-20-14).
//
// A draft can attribute a claim to a work with no Pandoc citation at all:
// `doi:10.…`, a doi.org link, a bare `10.….` DOI, `arXiv:…`, an arxiv.org
// abs / pdf link, `PMID: …` or a PubMed link. Pass 1 verifies each one at its
// registrar (a fabricated identifier is FABRICATED, never silently absent).
// Everything is scanned except spans that are provably code: a fenced code
// block (``` / ~~~, closed) and an inline code span (a backtick run closed by
// the same run in its paragraph). Anything else — an unclosed fence, an
// indented block, a link target — is scanned (fail closed). Every pattern is
// linear (T-01-DOS-03).
// ---------------------------------------------------------------------------

export type BareIdentifierKind = 'doi' | 'arxiv' | 'pmid';

/** One identifier found in a draft's text. */
export interface BareIdentifier {
  readonly kind: BareIdentifierKind;
  /** The canonical id: a normalized DOI, an arXiv id without its version, PMID digits. */
  readonly id: string;
  /** The text as written. */
  readonly text: string;
  /** Offsets of the match in the scanned text. */
  readonly start: number;
  readonly end: number;
  /** 1-based line of the match (CRLF-safe). */
  readonly line: number;
}

/** The Pass-1 row key of a bare identifier: `doi:<doi>`, `arXiv:<id>`, `PMID:<id>`. */
export function bareIdentifierKey(b: Pick<BareIdentifier, 'kind' | 'id'>): string {
  return b.kind === 'doi' ? `doi:${b.id}` : b.kind === 'arxiv' ? `arXiv:${b.id}` : `PMID:${b.id}`;
}

const DOI_BODY = String.raw`10\.\d{4,9}\/[^\s"'<>{}|\\^\x60\]]+`;
const ARXIV_BODY = String.raw`(?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Za-z-]{2,})?\/\d{7})(?:v\d+)?`;
const BARE_ID_PATTERNS: ReadonlyArray<{ kind: BareIdentifierKind; re: RegExp }> = [
  // doi.org links (any scheme / host spelling doi.ts accepts) and `doi:` labels first:
  // they claim the DOI text a bare-DOI match would also see.
  { kind: 'doi', re: new RegExp(String.raw`(?:https?:\/\/)?(?:www\.|dx\.)*doi\.org\/(?:10\.\d{4,9}(?:\/|%2[fF])[^\s"'<>{}|\\^\x60\]]+)`, 'gi') },
  { kind: 'doi', re: new RegExp(String.raw`\bdoi:\s?${DOI_BODY}`, 'gi') },
  { kind: 'doi', re: new RegExp(String.raw`\b${DOI_BODY}`, 'g') },
  { kind: 'arxiv', re: new RegExp(String.raw`(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/${ARXIV_BODY}(?:\.pdf)?`, 'gi') },
  { kind: 'arxiv', re: new RegExp(String.raw`\barxiv:\s?${ARXIV_BODY}`, 'gi') },
  { kind: 'pmid', re: /(?:https?:\/\/)?(?:pubmed\.ncbi\.nlm\.nih\.gov\/|(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/)\d{1,9}\b/gi },
  { kind: 'pmid', re: /\bPMID:?\s*\d{1,9}\b/gi },
];

/** The spans of `md` that are provably code (closed fences, closed inline code spans). */
export function provableCodeSpans(md: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  // Fenced code blocks: an opening ``` / ~~~ line (≤ 3 spaces of indent) closed
  // by a fence of the same character at least as long. An unclosed fence is
  // not provable code.
  const lineStarts: number[] = [0];
  for (let i = 0; i < md.length; i++) if (md[i] === '\n') lineStarts.push(i + 1);
  const lineText = (k: number): string => md.slice(lineStarts[k]!, (lineStarts[k + 1] ?? md.length + 1) - 1).replace(/\r$/, '');
  for (let k = 0; k < lineStarts.length; k++) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lineText(k));
    if (!open) continue;
    const fence = open[1]!;
    let close = -1;
    for (let j = k + 1; j < lineStarts.length; j++) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lineText(j));
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) {
        close = j;
        break;
      }
    }
    if (close < 0) continue;
    spans.push([lineStarts[k]!, (lineStarts[close + 1] ?? md.length + 1) - 1]);
    k = close;
  }
  // Inline code: a backtick run closed by a run of the same length in its paragraph.
  const inFence = (i: number): boolean => spans.some(([a, b]) => i >= a && i < b);
  const tick = /`+/g;
  for (let m = tick.exec(md); m !== null; m = tick.exec(md)) {
    if (inFence(m.index)) continue;
    const run = m[0];
    const rest = md.slice(m.index + run.length);
    const paragraphEnd = rest.search(/\r?\n[ \t]*\r?\n/);
    const scope = paragraphEnd >= 0 ? rest.slice(0, paragraphEnd) : rest;
    const closeRe = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
    const close = closeRe.exec(scope);
    if (!close) continue;
    const end = m.index + run.length + close.index + run.length;
    spans.push([m.index, end]);
    tick.lastIndex = end;
  }
  return spans;
}

function canonicalBareId(kind: BareIdentifierKind, text: string): string | null {
  if (kind === 'doi') return normalizeDoi(text);
  if (kind === 'pmid') return normalizePmid(text.replace(/^.*\/(?=\d)/, ''));
  const url = /arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i.exec(text);
  const n = normalizeArxiv(url?.[1] ? `arXiv:${url[1]}` : text);
  return n === null ? null : n.replace(/^arxiv:/, '').replace(/v\d+$/, '');
}

/**
 * The identifiers in `md`'s prose (see the section header), in order of
 * appearance, one per canonical id (the first occurrence).
 */
export function findBareIdentifiers(md: string): BareIdentifier[] {
  const code = md.includes('`') || md.includes('~') ? provableCodeSpans(md) : [];
  const inCode = (i: number): boolean => code.some(([a, b]) => i >= a && i < b);
  const claimed: Array<[number, number]> = [];
  const overlaps = (a: number, b: number): boolean => claimed.some(([x, y]) => a < y && x < b);
  const found: BareIdentifier[] = [];
  for (const { kind, re } of BARE_ID_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(md); m !== null; m = re.exec(md)) {
      const start = m.index;
      const end = start + m[0].length;
      if (inCode(start) || overlaps(start, end)) continue;
      const id = canonicalBareId(kind, m[0]);
      if (id === null) continue;
      claimed.push([start, end]);
      let line = 1;
      for (let i = 0; i < start; i++) if (md.charCodeAt(i) === 10) line++;
      found.push({ kind, id, text: m[0], start, end, line });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  return found.filter((b) => {
    const key = bareIdentifierKey(b);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// DOI verification — re-fetch + metadata check via Crossref (Phase 2).
// This is the thin integration point between the normalization chokepoint
// and bin/lib/http.ts. mcp/tools.ts paper_doi_verify delegates here.
// ---------------------------------------------------------------------------

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from './http.js';

// ---------------------------------------------------------------------------
// Reserved dry-run identifier namespace (RUN-27, D-17-11).
//
// The synthetic dry-run provider (bin/lib/sources/dry-run.ts) mints ids that no
// real work can carry:
//   - DOIs      10.0000/pensmith-dryrun.<8 hex>   (10.0000 is never assigned)
//   - arXiv-ish pensmith-dryrun.<8 hex>          (not an arXiv id shape)
//   - ISBN-ish  978-0-00-<6 digits>-<check>       with a DELIBERATELY INVALID
//               ISBN-13 check digit, so no real book (978-0-00 is a live
//               publisher prefix) can ever collide with the reserved range.
// Outside --dry-run, research filters these, `add` refuses them and Pass 1 /
// Pass 3 treat them as FABRICATED ("reserved dry-run identifier").
// ---------------------------------------------------------------------------

export const DRY_RUN_DOI_PREFIX = '10.0000/pensmith-dryrun.';
const DRY_RUN_DOI_RE = /^10\.0000\/pensmith-dryrun\.[0-9a-f]{8}$/;
const DRY_RUN_ARXIV_RE = /^(?:arxiv:)?pensmith-dryrun\.[0-9a-f]{8}$/i;
const DRY_RUN_ISBN_PREFIX = '978000';

/** The ISBN-13 check digit for the first 12 digits. */
export function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * True for an identifier in the reserved dry-run namespace (RUN-27): a
 * `10.0000/pensmith-dryrun.<8 hex>` DOI (any accepted DOI spelling), a
 * `pensmith-dryrun.<8 hex>` arXiv-style id, or a `978-0-00-…` ISBN-style id
 * whose check digit is deliberately wrong.
 */
export function isReservedDryRunId(id: string | null | undefined): boolean {
  if (typeof id !== 'string') return false;
  const s = id.trim();
  if (!s) return false;
  const doi = normalizeDoi(s);
  if (doi !== null && (DRY_RUN_DOI_RE.test(doi) || doi.startsWith(DRY_RUN_DOI_PREFIX))) return true;
  if (DRY_RUN_ARXIV_RE.test(s)) return true;
  const digits = s.replace(/^isbn[:\s]*/i, '').replace(/[-\s]/g, '');
  if (/^\d{13}$/.test(digits) && digits.startsWith(DRY_RUN_ISBN_PREFIX)) {
    return isbn13CheckDigit(digits.slice(0, 12)) !== Number(digits[12]);
  }
  return false;
}

export interface DoiVerifyResult {
  readonly valid: boolean;
  readonly canonical: string | null;
  readonly metadata?: unknown;
}

/**
 * Normalize `doi`, then re-fetch it from Crossref to verify it resolves to a
 * real work. Returns `{ valid: true, canonical, metadata }` on success or
 * `{ valid: false, canonical }` when the DOI is malformed or Crossref returns
 * a non-200 response. Network errors propagate to the caller — including
 * the typed OfflineEgressError (offline fixture miss or --dry-run), which the
 * caller maps to "DOI verification unavailable (offline | dry-run)" (RUN-04).
 */
export async function verifyDoi(doi: string): Promise<DoiVerifyResult> {
  const canonical = normalizeDoi(doi);
  if (!canonical) {
    return { valid: false, canonical: null };
  }
  const url = `https://api.crossref.org/works/${encodeURIComponent(canonical)}`;
  const res = await httpFetch(url, { source: 'crossref', maxBytes: MAX_JSON_RESPONSE_BYTES });
  if (res.status !== 200) {
    return { valid: false, canonical };
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(res.body);
  } catch {
    metadata = undefined;
  }
  return { valid: true, canonical, metadata };
}
