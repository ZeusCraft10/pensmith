// bin/lib/open-access.ts — record where a source's open-access PDF is (SRC-03,
// GRND-14; Phase 19 review rounds 1 and 2).
//
// full-text.ts tells the drafter which sources it may quote directly: those
// whose text Pass 3 can check. For a registrar source with a DOI that is the
// open-access PDF Unpaywall lists for the DOI — the one copy Pass 3 fetches.
// So when a source with a DOI enters the library (`add <doi>`, a research or
// `plan --research` hit that is kept, a PDF URL), Unpaywall is asked, and its
// `oa_pdf_url` is recorded as the entry's `oa_url` ONLY once that URL has been
// asked the way Pass 3 asks it (http.ts, source `generic`, redirects followed)
// and answered HTTP 200 with a PDF (`%PDF-`, pdf-response.ts checkPdfResponse;
// review round 3). Unpaywall's `url_for_pdf` is often a repository landing
// page or a publisher PDF link that answers pensmith with an HTML bot wall
// (403): such a source counts as abstract-only — Pass 3 could not check a
// quote from it either. The check reads only the first PDF_PREFIX_BYTES of the
// answer (FetchOptions.prefixBytes): the file itself is not downloaded here.
// Unpaywall's answer is the only basis: an open-access link another adapter
// reported (OpenAlex's open primary location) is not what Pass 3 checks, so it
// never becomes `oa_url` (the library writer maps only `oa_url`), and it does
// not spare the lookup. A DataCite arXiv DOI (`10.48550/arXiv.…`) is not looked
// up: Unpaywall does not index them, and the source's text is its arXiv PDF
// (full-text.ts).
//
// This is an enrichment, never a gate: a source whose lookup fails, that has
// no open-access copy, or whose listed copy does not serve a PDF, is added all
// the same, with no `oa_url` (so no open-access full-text flag). Without a
// contact email Unpaywall cannot be asked (it requires one) and nothing is
// requested; offline (no recording) and --dry-run make no request either.
// Only the DOI leaves the machine for Unpaywall; the PDF host receives the
// request for the URL Unpaywall listed (plain User-Agent, no contact email).

import { contactEmail } from './contact-email.js';
import { lookupById as unpaywallLookupById } from './sources/unpaywall.js';
import { fetch as httpFetch, isOfflineEgressError, offlineLabel } from './http.js';
import { networkMode } from './http-mock.js';
import type { LookupResult } from './sources/lookup.js';
import { isDataCiteArxivDoi } from './full-text.js';
import { checkPdfResponse } from './pdf-response.js';
import { MAX_PDF_BYTES } from './pdf-text.js';
import { errorFailureReason } from './sources/search-failure.js';

/** How much of a listed open-access PDF is read to confirm it is one: the `%PDF-` header may sit anywhere in the first 1024 bytes. */
export const PDF_PREFIX_BYTES = 1024 + 5;

/** Does `url` serve a PDF the way Pass 3 fetches it? ok, or why not; `offline` when no request could be made. */
export type PdfConfirmation = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly offline?: string };

/**
 * Ask `url` the way Pass 3 does (source `generic`: a plain User-Agent, every
 * hop SSRF-checked, redirects followed) for the first PDF_PREFIX_BYTES bytes,
 * and accept it only as HTTP 200 with the `%PDF-` header (checkPdfResponse).
 * Never throws: a transport failure is `ok: false` with its reason.
 */
export async function confirmOpenAccessPdf(url: string): Promise<PdfConfirmation> {
  try {
    const res = await httpFetch(url, { source: 'generic', noCache: true, maxBytes: MAX_PDF_BYTES, prefixBytes: PDF_PREFIX_BYTES });
    const pdf = checkPdfResponse(res);
    return pdf.ok ? { ok: true } : { ok: false, reason: pdf.reason };
  } catch (e) {
    if (isOfflineEgressError(e)) return { ok: false, reason: `not checked (${offlineLabel(e)})`, offline: offlineLabel(e) };
    return { ok: false, reason: errorFailureReason(e) };
  }
}

/** What enrichOpenAccess needs of a candidate (mutated in place: `oa_url`, and `oa_pdf_url` when Unpaywall has one). */
export interface OpenAccessTarget {
  doi?: string | null | undefined;
  oa_pdf_url?: string | null | undefined;
  oa_url?: string | null | undefined;
}

export interface OpenAccessSummary {
  /** Candidates with a DOI and no confirmed `oa_url` yet: the ones looked up (or that would have been). */
  readonly asked: number;
  /** Of those, how many now carry a confirmed open-access PDF URL (`oa_url`). */
  readonly found: number;
  /** Links Unpaywall listed that did not answer with a PDF (a landing page, a bot wall): abstract-only. */
  readonly unconfirmed: number;
  /** Why the lookups did not run, or the first failure reason; null when every lookup answered. */
  readonly problem: string | null;
}

export interface OpenAccessOptions {
  /** The Unpaywall lookup (tests inject one; default: the adapter). */
  readonly lookup?: (doi: string) => Promise<LookupResult>;
  /** The PDF check of a listed URL (tests inject one; default: confirmOpenAccessPdf). */
  readonly confirm?: (url: string) => Promise<PdfConfirmation>;
}

function validHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Look up the open-access PDF of every target that has a DOI (not a DataCite
 * arXiv DOI) and no Unpaywall-confirmed `oa_url` yet, and record it as
 * `oa_url` (see the header). Never throws for a lookup problem; the summary
 * says what happened.
 */
export async function enrichOpenAccess(targets: readonly OpenAccessTarget[], opts: OpenAccessOptions = {}): Promise<OpenAccessSummary> {
  const todo = targets.filter((t) => typeof t.doi === 'string' && t.doi.length > 0 && !isDataCiteArxivDoi(t.doi) && !validHttpUrl(t.oa_url));
  if (todo.length === 0) return { asked: 0, found: 0, unconfirmed: 0, problem: null };
  const mode = networkMode();
  if (mode.dryRun) return { asked: todo.length, found: 0, unconfirmed: 0, problem: 'not looked up under --dry-run' };
  const injected = opts.lookup !== undefined;
  if (!injected && contactEmail().email === null) {
    return { asked: todo.length, found: 0, unconfirmed: 0, problem: `not looked up: Unpaywall needs a contact email (set ${contactEmail().envName})` };
  }
  const lookup = opts.lookup ?? unpaywallLookupById;
  const confirm = opts.confirm ?? confirmOpenAccessPdf;
  let found = 0;
  let unconfirmed = 0;
  let problem: string | null = null;
  let firstUnconfirmed: string | null = null;
  let checkOffline: string | null = null;
  for (const t of todo) {
    let r: LookupResult;
    try {
      r = await lookup(t.doi as string);
    } catch (e) {
      if (!isOfflineEgressError(e)) throw e;
      // Offline without a recording: the rest would miss the same way.
      problem ??= `not looked up (${offlineLabel(e)})`;
      break;
    }
    if (r.kind === 'found') {
      const url = r.candidate.oa_pdf_url;
      if (!validHttpUrl(url)) continue;
      t.oa_pdf_url = url;
      // Once a check could not be made (offline), later ones cannot either.
      const c: PdfConfirmation = checkOffline !== null ? { ok: false, reason: `not checked (${checkOffline})`, offline: checkOffline } : await confirm(url);
      if (c.ok) {
        t.oa_url = url;
        found += 1;
      } else {
        unconfirmed += 1;
        if (c.offline !== undefined) checkOffline = c.offline;
        firstUnconfirmed ??= `${hostOf(url)}: ${c.reason}`;
      }
    } else if (r.kind === 'failed') {
      problem ??= `Unpaywall lookup failed: ${r.reason}`;
    }
  }
  if (unconfirmed > 0) {
    const listed =
      checkOffline !== null && firstUnconfirmed !== null && firstUnconfirmed.endsWith(`not checked (${checkOffline})`)
        ? `${unconfirmed} link(s) Unpaywall lists were not checked (${checkOffline}), so they count as abstract-only`
        : `${unconfirmed} link(s) Unpaywall lists did not answer with a PDF (${firstUnconfirmed ?? 'no PDF'}), so they count as abstract-only`;
    problem = problem === null ? listed : `${problem}; ${listed}`;
  }
  return { asked: todo.length, found, unconfirmed, problem };
}

/** The host of `url`, for a one-line reason. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

/** One line for a run's output: how many sources have an open-access PDF pensmith can read. */
export function describeOpenAccess(s: OpenAccessSummary): string | null {
  if (s.asked === 0) return null;
  const base = `open access: ${s.found} of ${s.asked} source(s) with a DOI have an open-access PDF (Unpaywall, checked)`;
  return s.problem !== null ? `${base}; ${s.problem}` : base;
}
