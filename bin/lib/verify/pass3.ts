// bin/lib/verify/pass3.ts — Pass-3 quote-integrity verifier (VRFY-04, D-13;
// Phase 20 VRFY-18, VRFY-19, VRFY-20).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT). Blocking.
//
// Every direct quote of the draft (quote-extractor.ts: inline and block
// quotes of at least `[verification] quote_min_words` words, with the
// citation(s) they are attributed to) is checked against the cited work's
// real text, in this order:
//   1. the user's own PDF of the work (SRC-15, S-17) — its text read ONLY
//      through byo-text.ts, which re-hashes the PDF against LIBRARY.json (an
//      edited PDF, a forged .txt, a poisoned cache or a PDF attached against a
//      failed identity check is never used). Local: no network. A quote found
//      there reads "verified against your local file <name>" and names the
//      file (`localFile`). When the recorded copy is MISSING or CHANGED since
//      ingest the quote was checkable and no longer is: it is NOT_FOUND
//      (blocking) unless an open-access copy has it, with the way back
//      (restore the PDF, or `--replace-pdf`) — editing or removing a local
//      file never turns a blocking verdict into a passing one;
//   2. the open-access copies verify/source-text.ts finds — every PDF
//      Unpaywall lists for the DOI, the Europe PMC full text of the PMCID, the
//      arXiv PDF of the arXiv id — each fetched through http.ts and cached as
//      extracted text, so compile and done recompute Pass 3 with no PDF
//      request.
//
// Verdicts (verdicts.ts, D-20-02 / D-20-03), one row per (quote, cited key):
//   PASS                  the quote occurs verbatim (after normalization:
//                         ligatures, soft hyphens, smart quotes, dashes,
//                         ellipses, diacritics, whitespace, case) in a copy;
//   FUZZY                 its best match in a copy is >= QUOTE_LEV_THRESHOLD
//                         but not verbatim — a letter or two slipped inside
//                         words, never a whole word changed (an inserted
//                         "not", another number or name) and never elided
//                         parts far apart (fuzzy.ts matchQuote; passes, the
//                         row says so);
//   NOT_FOUND             a copy's real text was read and no copy has it;
//   UNVERIFIABLE-QUOTE    every source answered, none with text: no
//                         open-access copy, paywalled (abstract only), no
//                         contact email for Unpaywall, a link that did not
//                         serve a usable PDF (`fetch failed: …`), an
//                         image-only PDF — blocks until the user adds the PDF,
//                         paraphrases, or accepts THIS quote (VRFY-20);
//   UNVERIFIABLE-NETWORK  no text, and a source gave no answer (offline with
//                         no recording, a transport error, 429 / 5xx after
//                         retries): retry online — never acceptable;
//   UNATTRIBUTED          a direct quote with no citation it can be
//                         attributed to (VRFY-18), keyed `(unattributed)`.
// PDF_UNAVAILABLE / TEXT_UNAVAILABLE are never written (the seam reads them
// only from VERIFICATION.md files an older pensmith wrote).
//
// Reserved dry-run identifiers (RUN-27): under --dry-run a quote of the
// synthetic source is UNVERIFIABLE-QUOTE (it has no text); outside --dry-run
// it is NOT_FOUND ("reserved dry-run identifier") without any request.
//
// Every row carries the quote's id in its draft (`q1`, `q2`, … in document
// order, shared by a cluster's per-key rows) and quoteTextSha256 of the quote:
// what a per-quote acceptance is bound to (VRFY-20, seam S-C).

import { matchQuote, prepareQuoteText, quoteMatched, QUOTE_LEV_THRESHOLD, type PreparedText } from '../fuzzy.js';
import { networkMode } from '../http-mock.js';
import { isReservedDryRunId } from '../doi.js';
import { extractQuotes, type ExtractedQuote } from '../quote-extractor.js';
import { byoText, byoCopyAltered, type ByoTextResult } from '../byo-text.js';
import { tryLoadLibrary } from '../library.js';
import { tryReadPaperConfigSync } from '../config.js';
import type { LibraryEntry } from '../schemas/library.js';
import { quoteTextSha256, UNATTRIBUTED_CITEKEY, type Pass3RowVerdict } from './verdicts.js';
import { sourceIdentity, sourceTextAttempts, type BibIdentityFields } from './source-text.js';

export type Pass3Verdict = Pass3RowVerdict;

export interface Pass3Result {
  citekey: string;
  /** The quote's id in its draft, in document order: `q1`, `q2`, … (Phase 20 seam S-C; VRFY-20). */
  id: string;
  /** verdicts.ts quoteTextSha256 of the whole quote — what a quote acceptance is bound to (VRFY-20). */
  quoteSha256: string;
  /** First 40 chars of the claimed quote — for human-readable diagnostics. */
  quoteSnippet: string;
  verdict: Pass3Verdict;
  levRatio: number;
  reason: string;
  /** The user's own PDF the quote was verified against (`sources/<file>`), when it was (VRFY-19, VRFY-26). */
  localFile?: string;
  /** 1-based line of the quote in the draft (VRFY-18). */
  line?: number;
  /** The locator written with this citation (`p. 3`), when there is one. */
  locator?: string;
}

/** The CITATIONS.bib fields Pass 3 reads (citation-js CSL names): the identifiers and the title. */
export type BibLike = BibIdentityFields;

export interface Pass3Options {
  /**
   * The project root. With it, a quote is checked against the cited source's
   * own bring-your-own PDF first, the PMCID comes from LIBRARY.json, and the
   * word floor from `[verification] quote_min_words`. verify, compile and
   * done pass it.
   */
  readonly root?: string;
  /**
   * Citekeys due for a re-check (`[verification] recheck_after_days`,
   * VRFY-28): their open-access copies are fetched again instead of read
   * from the extracted-text cache, and the fresh text is cached.
   */
  readonly refresh?: ReadonlySet<string>;
  /** `[verification] quote_min_words`; default: the paper's config (with `root`), else 5. */
  readonly minWords?: number;
}

type Verdict = Omit<Pass3Result, 'citekey' | 'id' | 'quoteSha256' | 'quoteSnippet'>;

/** The bring-your-own entries of the paper's library, by citekey (empty without a root or a library). */
function byoEntries(entries: readonly LibraryEntry[]): Map<string, LibraryEntry> {
  return new Map(entries.filter((e) => e.byo !== null).map((e) => [e.citekey, e]));
}

const pct = (r: number): string => r.toFixed(3);

/** The verdict for one quote attributed to `citekey` (see the header). */
async function checkQuote(
  q: ExtractedQuote & { citekey: string },
  claimed: BibLike | undefined,
  libEntry: LibraryEntry | undefined,
  root: string | undefined,
  refresh: boolean,
  byoTexts: Map<string, Promise<ByoTextResult>>,
  prepared: WeakMap<object, PreparedText>,
): Promise<Verdict> {
  const mode = networkMode();
  const doi = typeof claimed?.DOI === 'string' ? claimed.DOI : undefined;
  if (doi !== undefined && isReservedDryRunId(doi)) {
    return mode.dryRun
      ? { verdict: 'UNVERIFIABLE-QUOTE', levRatio: 0, reason: 'text unavailable (dry-run): a synthetic dry-run source has no text' }
      : { verdict: 'NOT_FOUND', levRatio: 0, reason: `reserved dry-run identifier ${doi} — a synthetic source cannot be quoted` };
  }

  const checked: string[] = [];
  let best = 0;
  /** Why the best close passage is still not the quote (a whole word differs, elided parts far apart). */
  let refusedWhy: string | undefined;
  const noteBest = (ratio: number, refused: string | undefined): void => {
    if (ratio >= best) {
      best = ratio;
      refusedWhy = refused;
    }
  };
  let altered: string | null = null;
  const noText: string[] = [];
  const noAnswer: string[] = [];

  // 1. The user's own PDF, re-hashed (S-17).
  if (libEntry?.byo != null && root !== undefined) {
    let pending = byoTexts.get(q.citekey);
    if (pending === undefined) {
      pending = byoText(root, libEntry);
      byoTexts.set(q.citekey, pending);
    }
    const t = await pending;
    const name = libEntry.byo.file;
    if (t.available) {
      let p = prepared.get(t);
      if (p === undefined) {
        p = prepareQuoteText(t.text);
        prepared.set(t, p);
      }
      const m = matchQuote(q.text, p);
      const where = `your local file ${name} (sha256 ${t.sha256.slice(0, 12)}…)`;
      if (m.verbatim) return { verdict: 'PASS', levRatio: 1, reason: `verified against ${where}`, localFile: name };
      if (quoteMatched(m)) {
        return { verdict: 'FUZZY', levRatio: m.ratio, reason: `verified against ${where} at lev=${pct(m.ratio)} (not verbatim)`, localFile: name };
      }
      checked.push(`your local file ${name}`);
      noteBest(m.ratio, m.refused);
    } else if (byoCopyAltered(t.code)) {
      altered = t.reason;
    } else {
      noText.push(`your local file: ${t.reason}`);
    }
  }

  // 2. The open-access copies.
  if (claimed === undefined) {
    noText.push('the source is not in CITATIONS.bib (see its Pass-1 row)');
  } else {
    for await (const a of sourceTextAttempts(sourceIdentity(claimed, libEntry ?? null), { refresh })) {
      if (a.kind === 'no-text') {
        noText.push(a.reason);
        continue;
      }
      if (a.kind === 'no-answer') {
        noAnswer.push(a.reason);
        continue;
      }
      const m = matchQuote(q.text, a.source.prepared());
      if (m.verbatim) return { verdict: 'PASS', levRatio: 1, reason: `verbatim in ${a.source.label}` };
      if (quoteMatched(m)) return { verdict: 'FUZZY', levRatio: m.ratio, reason: `found in ${a.source.label} at lev=${pct(m.ratio)} (not verbatim)` };
      checked.push(a.source.label);
      noteBest(m.ratio, m.refused);
    }
  }

  const unanswered = noAnswer.length > 0 ? `; ${noAnswer.join('; ')}` : '';
  if (altered !== null) {
    // The quote was checkable against the user's own PDF, which is no longer
    // what was ingested: blocking, never a pass (see the header, step 1).
    const elsewhere = checked.length > 0 ? `and it is not in ${checked.join(', ')}` : `no open-access copy has it (${[...noText, ...noAnswer].join('; ') || 'none found'})`;
    return {
      verdict: 'NOT_FOUND',
      levRatio: best,
      reason:
        `quote cannot be checked against your local file: ${altered} — restore that PDF, or attach the right copy with ` +
        `\`pensmith add <identifier> --pdf <file> --replace-pdf\`; ${elsewhere}`,
    };
  }
  if (checked.length > 0) {
    // Real text of the work was read, and the quote is not in it.
    return {
      verdict: 'NOT_FOUND',
      levRatio: best,
      reason:
        refusedWhy !== undefined
          ? `quote not found in ${checked.join(', ')} (best lev=${pct(best)}; ${refusedWhy})${unanswered}`
          : `quote not found in ${checked.join(', ')} (best lev=${pct(best)} < ${QUOTE_LEV_THRESHOLD})${unanswered}`,
    };
  }
  if (noAnswer.length > 0) {
    return { verdict: 'UNVERIFIABLE-NETWORK', levRatio: 0, reason: [...noAnswer, ...noText].join('; ') };
  }
  return { verdict: 'UNVERIFIABLE-QUOTE', levRatio: 0, reason: noText.join('; ') || 'no open-access copy' };
}

/**
 * Run Pass 3 over every quote of `draftMd` (see the header). `bibByCitekey`
 * holds the parsed CITATIONS.bib entries (DOI, PMID, eprint, title). Never
 * throws for a missing, unreadable or unreachable copy: each ends as a verdict.
 */
export async function runPass3(
  draftMd: string,
  bibByCitekey: ReadonlyMap<string, BibLike>,
  opts: Pass3Options = {},
): Promise<Pass3Result[]> {
  const minWords = opts.minWords ?? (opts.root !== undefined ? tryReadPaperConfigSync(opts.root)?.verification?.quote_min_words : undefined);
  const quotes = extractQuotes(draftMd, minWords !== undefined ? { minWords } : {});
  const results: Pass3Result[] = [];
  if (quotes.length === 0) return results;
  const library = opts.root !== undefined ? ((await tryLoadLibrary(opts.root))?.entries ?? []) : [];
  const byKey = new Map(library.map((e) => [e.citekey, e]));
  const byo = byoEntries(library);
  // One re-hash / extraction per source per run.
  const byoTexts = new Map<string, Promise<ByoTextResult>>();
  const prepared = new WeakMap<object, PreparedText>();

  for (const q of quotes) {
    const ids = { id: q.id, quoteSha256: quoteTextSha256(q.text) };
    const where = { line: q.line, ...(q.locator !== undefined ? { locator: q.locator } : {}) };
    const push = (citekey: string, v: Verdict): void => void results.push({ citekey, ...ids, quoteSnippet: q.text.slice(0, 40), ...v, ...where });
    if (q.citekey === null) {
      push(UNATTRIBUTED_CITEKEY, {
        verdict: 'UNATTRIBUTED',
        levRatio: 0,
        reason: 'a direct quote with no citation to attribute it to — cite its source right after the quote ("…" [@key]) or paraphrase it',
      });
      continue;
    }
    const key = q.citekey;
    const entry = byo.get(key) ?? byKey.get(key);
    push(key, await checkQuote({ ...q, citekey: key }, bibByCitekey.get(key), entry, opts.root, opts.refresh?.has(key) === true, byoTexts, prepared));
  }
  return results;
}
