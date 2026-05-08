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
//     2. strip prefix (one of 6 forms, case-insensitive on prefix only):
//          'doi:', 'DOI:',
//          'https://doi.org/',  'http://doi.org/',
//          'https://dx.doi.org/', 'http://dx.doi.org/'
//     3. strip trailing punctuation in ONE pass (not recursive):
//          [. , ; : ) ] } > " ']+
//     4. lowercase ASCII [A-Z] in BOTH halves; preserve non-ASCII bytes
//        verbatim (so '10.1234/résumé' round-trips identically)
//     5. validate against /^10\.\d{4,9}\/\S+$/  → return canonical OR null
//
//   normalizeArxiv(input)  ──→  string | null
//     - strip 'arxiv:' prefix (case-insensitive)
//     - new format: YYMM.NNNNN[vV]    → canonical 'arxiv:NNNN.NNNNN[vN]'
//     - old format: <subj-class>/YYMMNNN  → canonical '<subj-class>/YYMMNNN'
//        (subject classes preserve dotted-case; only the arxiv: prefix is
//         normalized away)
//
//   normalizePmid(input)   ──→  string | null
//     - accept digits-only OR 'PMID:digits' (case-insensitive prefix)
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

// The 6 prefix forms (D-15 step 1). Order matters — we match longest-first
// so that 'https://dx.doi.org/' is tried before 'doi:' (which would also
// match the substring 'oi:' inside the URL form, but only at index 0).
const DOI_PREFIXES: readonly string[] = [
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'https://doi.org/',
  'http://doi.org/',
  'doi:',
  'DOI:',
];

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
  // prefix only — the body's case is handled by step 4.
  const lower = s.toLowerCase();
  for (const p of DOI_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) {
      s = s.slice(p.length);
      break;
    }
  }

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

// arXiv old format subject classes (D-17). Pre-April-2007 archive names.
// Some have dotted subclasses (e.g. 'cs.CL'). We list the major archives
// plus common subclasses; an unknown class returns null rather than a
// false positive.
const ARXIV_OLD_CLASSES: ReadonlySet<string> = new Set([
  // Top-level archives
  'cs', 'math', 'physics', 'astro-ph', 'cond-mat', 'gr-qc', 'hep-ex',
  'hep-lat', 'hep-ph', 'hep-th', 'math-ph', 'nlin', 'nucl-ex', 'nucl-th',
  'q-bio', 'quant-ph', 'stat',
  // Common cs subclasses
  'cs.CL', 'cs.AI', 'cs.LG', 'cs.CV', 'cs.IR', 'cs.NE', 'cs.DS', 'cs.SE',
  // Common math subclasses
  'math.AG', 'math.AT', 'math.CA', 'math.CO', 'math.NT', 'math.PR',
  // Common astro-ph subclasses (post-2008 split)
  'astro-ph.CO', 'astro-ph.EP', 'astro-ph.GA', 'astro-ph.HE',
  'astro-ph.IM', 'astro-ph.SR',
]);

/**
 * Normalize an arXiv identifier.
 *
 *   - 'arXiv:2103.00020'    → 'arxiv:2103.00020'
 *   - 'arXiv:2103.00020v2'  → 'arxiv:2103.00020v2'
 *   - '2103.00020'          → 'arxiv:2103.00020'
 *   - 'cs.CL/0301012'       → 'cs.CL/0301012' (subject-class case preserved)
 *   - 'arxiv:cs.CL/0301012' → 'cs.CL/0301012'
 *
 * Returns null on garbage or unknown subject class.
 */
export function normalizeArxiv(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;

  // New format (with or without 'arxiv:' prefix). The capture group
  // contains the body (digits.digits[v<digit>]).
  const newMatch = ARXIV_NEW.exec(s);
  if (newMatch && newMatch[1]) {
    // Lowercase only the optional 'v' marker; the digits are case-neutral.
    return `arxiv:${newMatch[1].toLowerCase()}`;
  }

  // Old format: optional 'arxiv:' prefix + <class>/YYMMNNN
  // The 'arxiv:' prefix is case-insensitive; the subject class is NOT —
  // 'cs.CL' is the canonical capitalization.
  const stripped = s.replace(/^arxiv:/i, '');
  const slashIdx = stripped.indexOf('/');
  if (slashIdx < 0) return null;
  const cls = stripped.slice(0, slashIdx);
  const body = stripped.slice(slashIdx + 1);
  if (!ARXIV_OLD_CLASSES.has(cls)) return null;
  if (!/^\d{7}$/.test(body)) return null;
  return `${cls}/${body}`;
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
 * Accepts bare digits OR a 'PMID:' prefix (case-insensitive). Canonical
 * form is bare digits, max 9 (PubMed's hard upper bound — IDs above 1e9
 * have not been issued at the time of writing).
 */
export function normalizePmid(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^pmid:/i, '');
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
