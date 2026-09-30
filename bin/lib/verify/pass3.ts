// bin/lib/verify/pass3.ts — Pass-3 quote-integrity verifier (VRFY-04, D-13).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT).
//
// Pipeline per quote:
//   1. Extract quoted-claim ranges from DRAFT.md via bin/lib/quote-extractor.ts
//      (>= 10 words, with associated [@citekey]).
//   2. The source's own bring-your-own PDF first (SRC-15, S-17; when the caller
//      passes the project root): its text is read ONLY through byo-text.ts,
//      which re-hashes the PDF against LIBRARY.json (an edited PDF, a forged
//      .txt, a poisoned cache or a PDF attached against a failed identity
//      check is never used). A quote found there is OK — "verified against
//      your local file <name> (sha256 …)"; a quote not found there is checked
//      against the open-access copy too, and is NOT_FOUND unless that copy has
//      it. The PDF is local, so this step runs offline too. When the recorded
//      copy is MISSING or CHANGED since ingest (moved, deleted, edited or
//      replaced by another version), the quote was checkable and no longer is:
//      it is NOT_FOUND (blocking) unless the open-access copy has it, with the
//      way back (restore the PDF, or attach the right copy with
//      --replace-pdf) — editing or removing a local file never turns a
//      blocking verdict into a passing one (ROADMAP Phase 19 criterion 6).
//   3. Resolve citekey -> DOI and arXiv id (`eprint`, or a DataCite arXiv DOI)
//      from .paper/CITATIONS.bib.
//   4. Look up the DOI's open-access copy through Unpaywall's three-way lookup
//      (D-19-05): a failed lookup reports its reason (e.g. `Unpaywall skipped:
//      set PENSMITH_CONTACT_EMAIL`, `HTTP 503 after retries`), never "no OA PDF".
//      A work with an arXiv id whose DOI gives no open-access PDF (Unpaywall
//      does not index DataCite arXiv DOIs) — or that has no DOI — is checked
//      against its arXiv PDF, derived from the id Pass 1 verified at arXiv
//      (never from a URL stored in a local file, S-17). full-text.ts marks
//      exactly these sources as quotable (GRND-14).
//   5. Fetch the OA PDF (source 'generic': the PDF host is not a polite pool and
//      never receives the contact email), check that the final response really
//      is a PDF (pdf-response.ts checkPdfResponse on the byte-faithful
//      bodyBytes), then extract its text via bin/lib/pdf-text.ts; an extraction
//      error is reported, never thrown.
//   6. NFKC-normalize both the claimed quote AND the extracted PDF text.
//   7. Compute levenshteinSubstring(quote, pdfText); compare to QUOTE_LEV_THRESHOLD.
//
// Verdict enum:
//   - OK             — match ratio >= QUOTE_LEV_THRESHOLD
//   - NOT_FOUND      — match ratio < QUOTE_LEV_THRESHOLD
//   - PDF_UNAVAILABLE — no DOI or no Unpaywall OA URL, or the text is unavailable
//                       because the run is offline / --dry-run (RUN-04: no
//                       request is made; "text unavailable (offline)")
//   - TEXT_UNAVAILABLE — PDF parsed but appears image-only (<50 non-WS chars)
//
// Reserved dry-run identifiers (RUN-27): accepted only under --dry-run (the
// synthetic source has no text → PDF_UNAVAILABLE "text unavailable (dry-run)");
// outside --dry-run a quote attributed to one is NOT_FOUND ("reserved dry-run
// identifier") without any request.
//
// The OA PDF is fetched byte-faithfully (bodyBytes, audit #29) under the
// MAX_PDF_BYTES response cap (SEC-03).
//
// CYCLE-2 H-4 signature lock:
//   `runPass3(draftMd, bibByCitekey)` is the canonical entrypoint.
//   `runPass3Unit({ claimedQuote, pdfText })` is the fixture-shape helper
//   used by tests/known-bad-quotes.test.ts in Plan 03-09.

import { levenshteinSubstring, QUOTE_LEV_THRESHOLD } from '../fuzzy.js';
import { nfkcNormalize } from '../normalize.js';
import { extractPdfText, MAX_PDF_BYTES } from '../pdf-text.js';
import { lookupById as unpaywallLookupById } from '../sources/unpaywall.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel, type HttpResponse } from '../http.js';
import { checkPdfResponse } from '../pdf-response.js';
import { errorFailureReason } from '../sources/search-failure.js';
import { networkMode } from '../http-mock.js';
import { isReservedDryRunId } from '../doi.js';
import { extractQuotes, type ExtractedQuote } from '../quote-extractor.js';
import { byoText, byoCopyAltered, type ByoTextResult } from '../byo-text.js';
import { arxivPdfUrl, arxivIdOfEntry, isDataCiteArxivDoi } from '../full-text.js';
import { tryLoadLibrary } from '../library.js';
import type { LibraryEntry } from '../schemas/library.js';
import { quoteId, quoteTextSha256 } from './verdicts.js';

export type Pass3Verdict = 'OK' | 'NOT_FOUND' | 'PDF_UNAVAILABLE' | 'TEXT_UNAVAILABLE';

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
}

interface BibLike {
  DOI?: string;
  /** BibTeX `eprint` / `archivePrefix` (an arXiv preprint). */
  eprint?: string;
  archivePrefix?: string;
}

export interface Pass3Options {
  /**
   * The project root. With it, a quote is checked against the cited source's
   * own bring-your-own PDF first (step 2 of the header). verify, compile and
   * done pass it.
   */
  readonly root?: string;
}

type Verdict = Omit<Pass3Result, 'citekey' | 'id' | 'quoteSha256' | 'quoteSnippet'>;

function unavailableVerdict(reason: string): Verdict {
  return { verdict: 'PDF_UNAVAILABLE', levRatio: 0, reason };
}

/** The bring-your-own entries of the paper's library, by citekey (empty without a root or a library). */
async function byoEntries(root: string | undefined): Promise<Map<string, LibraryEntry>> {
  if (root === undefined) return new Map();
  const lib = await tryLoadLibrary(root);
  return new Map((lib?.entries ?? []).filter((e) => e.byo !== null).map((e) => [e.citekey, e]));
}

/** The quote checked against the PDF at `url` (steps 5–7), or why that copy's text is unavailable. */
async function checkPdfAt(q: ExtractedQuote, url: string, source: 'generic' | 'arxiv', what: string): Promise<Verdict> {
  // The OA PDF host is an arbitrary site: 'generic' (plain User-Agent, no
  // contact email), every hop SSRF-checked by the transport; noCache so the
  // byte-faithful bodyBytes is always present (audit #29). arXiv's own PDF
  // goes through the arXiv host's politeness ('arxiv').
  let resp: HttpResponse;
  try {
    resp = await httpFetch(url, { source, noCache: true, maxBytes: MAX_PDF_BYTES });
  } catch (err) {
    if (isOfflineEgressError(err)) return unavailableVerdict(`text unavailable (${offlineLabel(err)}) — re-run online to check the quote`);
    return unavailableVerdict(`${what} fetch failed: ${errorFailureReason(err)}`);
  }
  const pdf = checkPdfResponse(resp);
  if (!pdf.ok) return unavailableVerdict(`${what} fetch returned ${pdf.reason}`);

  let text: string;
  try {
    text = await extractPdfText(pdf.bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailableVerdict(`${what} text extraction failed: ${(msg.split(/\r?\n/)[0] ?? '').slice(0, 200)}`);
  }
  if (text.replace(/\s/g, '').length < 50) {
    return { verdict: 'TEXT_UNAVAILABLE', levRatio: 0, reason: 'PDF appears image-only or scanned (<50 non-whitespace chars)' };
  }
  const ratio = levenshteinSubstring(nfkcNormalize(q.text), nfkcNormalize(text));
  if (ratio >= QUOTE_LEV_THRESHOLD) return { verdict: 'OK', levRatio: ratio, reason: `levenshtein-substring above threshold (${what})` };
  return { verdict: 'NOT_FOUND', levRatio: ratio, reason: `quote not found in the ${what} (lev=${ratio.toFixed(3)} < ${QUOTE_LEV_THRESHOLD})` };
}

/**
 * The quote checked against the open-access copy of `doi` found through
 * Unpaywall (steps 4–7), or the reason that copy is unavailable.
 */
async function checkUnpaywall(q: ExtractedQuote, doi: string): Promise<Verdict> {
  let lookup: Awaited<ReturnType<typeof unpaywallLookupById>>;
  try {
    lookup = await unpaywallLookupById(doi);
  } catch (err) {
    if (!isOfflineEgressError(err)) throw err;
    return unavailableVerdict(`text unavailable (${offlineLabel(err)}) — re-run online to check the quote`);
  }
  if (lookup.kind === 'failed') {
    // D-19-05: the reason, never "no OA PDF" (e.g. the missing contact email).
    return unavailableVerdict(`${lookup.reason} — the open-access copy of DOI ${doi} was not looked up`);
  }
  if (lookup.kind === 'not-found') return unavailableVerdict(`Unpaywall has no record of DOI ${doi} (${lookup.reason})`);
  const oaUrl = lookup.candidate.oa_pdf_url;
  if (!oaUrl) return unavailableVerdict(`No OA PDF available for DOI ${doi}`);
  return checkPdfAt(q, oaUrl, 'generic', 'OA PDF');
}

/**
 * The quote checked against the source's open-access text: the DOI's
 * Unpaywall PDF, else (no DOI, a DataCite arXiv DOI Unpaywall does not index,
 * or no PDF there) the arXiv PDF of its arXiv id; or why neither is available.
 */
async function checkOpenAccess(q: ExtractedQuote, claimed: BibLike | undefined): Promise<Verdict> {
  const doi = claimed?.DOI;
  const arxiv = claimed !== undefined ? arxivIdOfEntry({ doi: doi ?? null, arxiv: arxivEprint(claimed) }) : null;
  if (!doi && arxiv === null) return unavailableVerdict('No DOI for citekey — cannot fetch OA PDF');
  const mode = networkMode();
  if (mode.sourcesOffline) {
    // RUN-04: no Unpaywall lookup and no OA-PDF fetch offline or under --dry-run.
    return unavailableVerdict(`text unavailable (${mode.dryRun ? 'dry-run' : 'offline'}) — re-run online to check the quote`);
  }
  const viaDoi = doi && !isDataCiteArxivDoi(doi) ? await checkUnpaywall(q, doi) : null;
  if (viaDoi !== null && viaDoi.verdict !== 'PDF_UNAVAILABLE') return viaDoi;
  if (arxiv === null) return viaDoi ?? unavailableVerdict('No DOI for citekey — cannot fetch OA PDF');
  const viaArxiv = await checkPdfAt(q, arxivPdfUrl(arxiv), 'arxiv', `arXiv PDF of ${arxiv}`);
  if (viaArxiv.verdict === 'PDF_UNAVAILABLE' && viaDoi !== null) {
    return { ...viaArxiv, reason: `${viaDoi.reason}; ${viaArxiv.reason}` };
  }
  return viaArxiv;
}

/** The entry's arXiv eprint (BibTeX `eprint` with an arXiv or no archivePrefix), else null. */
function arxivEprint(claimed: BibLike): string | null {
  const eprint = typeof claimed.eprint === 'string' ? claimed.eprint.trim() : '';
  const prefix = typeof claimed.archivePrefix === 'string' ? claimed.archivePrefix.trim() : '';
  return eprint && (prefix === '' || /^arxiv$/i.test(prefix)) ? eprint : null;
}

/**
 * Run Pass-3 against every quote in `draftMd`: the cited source's own
 * hash-verified bring-your-own PDF first (with `opts.root`), then its
 * open-access copy via the bib's DOI.
 *
 * Deterministic except for the HTTP fetches, which are made only when the run
 * is live: offline and --dry-run report the open-access text as unavailable.
 */
export async function runPass3(
  draftMd: string,
  bibByCitekey: Map<string, BibLike>,
  opts: Pass3Options = {},
): Promise<Pass3Result[]> {
  const quotes = extractQuotes(draftMd);
  const results: Pass3Result[] = [];
  const mode = networkMode();
  const byo = quotes.length > 0 ? await byoEntries(opts.root) : new Map<string, LibraryEntry>();
  // One re-hash / extraction per source per run.
  const byoTexts = new Map<string, ByoTextResult>();

  for (const [index, q] of quotes.entries()) {
    const snippet = q.text.slice(0, 40);
    const ids = { id: quoteId(index), quoteSha256: quoteTextSha256(q.text) };
    const push = (v: Verdict): void => void results.push({ citekey: q.citekey, ...ids, quoteSnippet: snippet, ...v });
    const claimed = bibByCitekey.get(q.citekey);

    if (claimed?.DOI !== undefined && isReservedDryRunId(claimed.DOI)) {
      push(
        mode.dryRun
          ? unavailableVerdict('text unavailable (dry-run): a synthetic dry-run source has no text')
          : { verdict: 'NOT_FOUND', levRatio: 0, reason: `reserved dry-run identifier ${claimed.DOI} — a synthetic source cannot be quoted` },
      );
      continue;
    }

    // 2. The user's own PDF, re-hashed (S-17).
    let localMiss: { ratio: number; file: string } | null = null;
    let localUnavailable: string | null = null;
    let localAltered: string | null = null;
    const entry = byo.get(q.citekey);
    if (entry !== undefined && opts.root !== undefined) {
      let t = byoTexts.get(q.citekey);
      if (t === undefined) {
        t = await byoText(opts.root, entry);
        byoTexts.set(q.citekey, t);
      }
      const name = entry.byo!.file;
      if (t.available) {
        const ratio = levenshteinSubstring(nfkcNormalize(q.text), nfkcNormalize(t.text));
        if (ratio >= QUOTE_LEV_THRESHOLD) {
          push({ verdict: 'OK', levRatio: ratio, reason: `verified against your local file ${name} (sha256 ${t.sha256.slice(0, 12)}…)`, localFile: name });
          continue;
        }
        localMiss = { ratio, file: name };
      } else if (byoCopyAltered(t.code)) {
        localAltered = t.reason;
      } else {
        localUnavailable = `your local file: ${t.reason}`;
      }
    }

    // 3–7. The open-access copy.
    const oa: Verdict = await checkOpenAccess(q, claimed);
    if (oa.verdict === 'OK') {
      push(oa);
      continue;
    }
    if (localAltered !== null) {
      // The quote was checkable against the user's own PDF, which is no longer
      // what was ingested: blocking, never a pass (see the header, step 2).
      const oaNote = oa.verdict === 'NOT_FOUND' ? 'and it is not in the OA PDF' : `the open-access copy: ${oa.reason}`;
      push({
        verdict: 'NOT_FOUND',
        levRatio: oa.levRatio,
        reason:
          `quote cannot be checked against your local file: ${localAltered} — restore that PDF, or attach the right copy with ` +
          `\`pensmith add <identifier> --pdf <file> --replace-pdf\`; ${oaNote}`,
      });
      continue;
    }
    if (localMiss !== null) {
      // Real text of the work does not contain the quote.
      const oaNote = oa.verdict === 'NOT_FOUND' ? 'nor in the OA PDF' : `the open-access copy: ${oa.reason}`;
      push({
        verdict: 'NOT_FOUND',
        levRatio: Math.max(localMiss.ratio, oa.levRatio),
        reason: `quote not found in your local file ${localMiss.file} (lev=${localMiss.ratio.toFixed(3)} < ${QUOTE_LEV_THRESHOLD}); ${oaNote}`,
      });
      continue;
    }
    push(localUnavailable !== null && oa.verdict !== 'NOT_FOUND' ? { ...oa, reason: `${oa.reason}; ${localUnavailable}` } : oa);
  }
  return results;
}

/**
 * CYCLE-2 H-4 — fixture-shape helper for tests/known-bad-quotes.test.ts.
 *
 * Operates on a single `{ claimedQuote, pdfText }` pair so unit fixtures
 * can be tested in isolation. No HTTP, no Unpaywall, no extractPdfText.
 * Plan 03-09 tests/known-bad-quotes.test.ts MUST import this helper,
 * NOT `runPass3`.
 */
export function runPass3Unit(input: {
  claimedQuote: string;
  pdfText: string;
}): { verdict: Pass3Verdict; levRatio: number } {
  const ratio = levenshteinSubstring(nfkcNormalize(input.claimedQuote), nfkcNormalize(input.pdfText));
  if (ratio >= QUOTE_LEV_THRESHOLD) return { verdict: 'OK', levRatio: ratio };
  return { verdict: 'NOT_FOUND', levRatio: ratio };
}
