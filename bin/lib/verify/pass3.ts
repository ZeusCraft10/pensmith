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
//      it. The PDF is local, so this step runs offline too.
//   3. Resolve citekey -> DOI from .paper/CITATIONS.bib.
//   4. Look up the DOI's open-access copy through Unpaywall's three-way lookup
//      (D-19-05): a failed lookup reports its reason (e.g. `Unpaywall skipped:
//      set PENSMITH_CONTACT_EMAIL`, `HTTP 503 after retries`), never "no OA PDF".
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
import { byoText, type ByoTextResult } from '../byo-text.js';
import { tryLoadLibrary } from '../library.js';
import type { LibraryEntry } from '../schemas/library.js';

export type Pass3Verdict = 'OK' | 'NOT_FOUND' | 'PDF_UNAVAILABLE' | 'TEXT_UNAVAILABLE';

export interface Pass3Result {
  citekey: string;
  /** First 40 chars of the claimed quote — for human-readable diagnostics. */
  quoteSnippet: string;
  verdict: Pass3Verdict;
  levRatio: number;
  reason: string;
}

interface BibLike {
  DOI?: string;
}

export interface Pass3Options {
  /**
   * The project root. With it, a quote is checked against the cited source's
   * own bring-your-own PDF first (step 2 of the header). verify, compile and
   * done pass it.
   */
  readonly root?: string;
}

type Verdict = Omit<Pass3Result, 'citekey' | 'quoteSnippet'>;

function unavailableVerdict(reason: string): Verdict {
  return { verdict: 'PDF_UNAVAILABLE', levRatio: 0, reason };
}

/** The bring-your-own entries of the paper's library, by citekey (empty without a root or a library). */
async function byoEntries(root: string | undefined): Promise<Map<string, LibraryEntry>> {
  if (root === undefined) return new Map();
  const lib = await tryLoadLibrary(root);
  return new Map((lib?.entries ?? []).filter((e) => e.byo !== null).map((e) => [e.citekey, e]));
}

/**
 * The quote checked against the open-access copy of `doi` (steps 4–7), or the
 * reason that copy is unavailable.
 */
async function checkOpenAccess(q: ExtractedQuote, doi: string): Promise<Verdict> {
  const mode = networkMode();
  if (mode.sourcesOffline) {
    // RUN-04: no Unpaywall lookup and no OA-PDF fetch offline or under --dry-run.
    return unavailableVerdict(`text unavailable (${mode.dryRun ? 'dry-run' : 'offline'}) — re-run online to check the quote`);
  }
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

  // The OA PDF host is an arbitrary site: 'generic' (plain User-Agent, no
  // contact email), every hop SSRF-checked by the transport; noCache so the
  // byte-faithful bodyBytes is always present (audit #29).
  let resp: HttpResponse;
  try {
    resp = await httpFetch(oaUrl, { source: 'generic', noCache: true, maxBytes: MAX_PDF_BYTES });
  } catch (err) {
    if (isOfflineEgressError(err)) return unavailableVerdict(`text unavailable (${offlineLabel(err)}) — re-run online to check the quote`);
    return unavailableVerdict(`OA PDF fetch failed: ${errorFailureReason(err)}`);
  }
  const pdf = checkPdfResponse(resp);
  if (!pdf.ok) return unavailableVerdict(`OA PDF fetch returned ${pdf.reason}`);

  let text: string;
  try {
    text = await extractPdfText(pdf.bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailableVerdict(`OA PDF text extraction failed: ${(msg.split(/\r?\n/)[0] ?? '').slice(0, 200)}`);
  }
  if (text.replace(/\s/g, '').length < 50) {
    return { verdict: 'TEXT_UNAVAILABLE', levRatio: 0, reason: 'PDF appears image-only or scanned (<50 non-whitespace chars)' };
  }
  const ratio = levenshteinSubstring(nfkcNormalize(q.text), nfkcNormalize(text));
  if (ratio >= QUOTE_LEV_THRESHOLD) return { verdict: 'OK', levRatio: ratio, reason: 'levenshtein-substring above threshold' };
  return { verdict: 'NOT_FOUND', levRatio: ratio, reason: `quote not found in OA PDF (lev=${ratio.toFixed(3)} < ${QUOTE_LEV_THRESHOLD})` };
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

  for (const q of quotes) {
    const snippet = q.text.slice(0, 40);
    const push = (v: Verdict): void => void results.push({ citekey: q.citekey, quoteSnippet: snippet, ...v });
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
          push({ verdict: 'OK', levRatio: ratio, reason: `verified against your local file ${name} (sha256 ${t.sha256.slice(0, 12)}…)` });
          continue;
        }
        localMiss = { ratio, file: name };
      } else {
        localUnavailable = `your local file: ${t.reason}`;
      }
    }

    // 3–7. The open-access copy.
    const oa: Verdict = claimed?.DOI
      ? await checkOpenAccess(q, claimed.DOI)
      : unavailableVerdict('No DOI for citekey — cannot fetch OA PDF');
    if (oa.verdict === 'OK') {
      push(oa);
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
