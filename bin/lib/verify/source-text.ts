// bin/lib/verify/source-text.ts — the open-access text Pass 3 checks a
// quotation against.
//
// For a work with a DOI, the PDF links come from OpenAlex first, which needs
// no contact email. When none of them gives text, Unpaywall is asked too, if
// PENSMITH_CONTACT_EMAIL is set (Unpaywall refuses a request without one): it
// often knows another copy. Each link is tried in turn until one gives a PDF.
// A work known by its arXiv ID is read from arXiv's own PDF of it.
//
// A PDF is fetched as bytes, never through the UTF-8 text body, which destroys
// its compressed streams, and never through the HTTP cache, which stores text.
// The link comes from a registry record, not from pensmith, so it is fetched
// as an untrusted URL: the SSRF guard checks it and every redirect hop.

import { fetch as httpFetch, ResponseTooLargeError, SsrfBlockedError } from '../http.js';
import { extractPdfText, isImageOnlyText, MAX_PDF_BYTES } from '../pdf-text.js';
import { lookupOaPdfs as openAlexPdfs } from '../sources/openalex.js';
import { lookupOaPdfs as unpaywallPdfs } from '../sources/unpaywall.js';
import { contactEmail, unavailableDetail, type OaPdfAnswer } from '../sources/work-record.js';
import { prepareSource, type QuoteSource } from './quote-match.js';

/** Links tried per work, best first. */
const MAX_LINKS = 3;
/** Redirects followed from one link. */
const MAX_REDIRECTS = 5;

/**
 * Content types a PDF is never served as: text/*, JSON and XML. Not the HTTP
 * cache's wider text list, which also names JavaScript, BibTeX and RIS: a
 * real PDF a server labels with one of those is still read.
 */
const TEXT_TYPE = /^\s*(?:text\/|application\/(?:[\w.-]+\+)?(?:json|xml)\b)/i;

/** Whether a response is a PDF: not served as text, and starting with the PDF header. */
function isPdf(bytes: Buffer, contentType: string): boolean {
  return !TEXT_TYPE.test(contentType) && bytes.subarray(0, 1024).includes('%PDF-');
}

/** The bytes of the PDF at `url`, following redirects, or why there are none. */
async function fetchPdf(url: string): Promise<{ bytes: Buffer } | { reason: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res;
    try {
      res = await httpFetch(current, {
        source: 'generic',
        untrusted: true,
        noCache: true,
        // A PDF past the extraction limit is refused while it downloads.
        maxBodyBytes: MAX_PDF_BYTES,
        headers: { accept: 'application/pdf,*/*;q=0.5' },
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) return { reason: 'refused: the link points to a private or local address' };
      if (err instanceof ResponseTooLargeError) return { reason: `the PDF is larger than ${MAX_PDF_BYTES / (1024 * 1024)} MB` };
      return { reason: unavailableDetail(err) };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers['location'];
      if (!location) return { reason: `HTTP ${res.status} without a location` };
      try {
        current = new URL(location, current).toString();
      } catch {
        return { reason: 'a redirect to an unreadable location' };
      }
      if (!/^https?:/i.test(current)) return { reason: 'a redirect away from http(s)' };
      continue;
    }
    if (res.status !== 200) return { reason: `HTTP ${res.status}` };
    const bytes = res.bodyBytes ?? Buffer.alloc(0);
    const type = res.headers['content-type'] ?? '';
    if (!isPdf(bytes, type)) return { reason: `served ${type.split(';')[0]?.trim() || 'something'} rather than a PDF` };
    return { bytes };
  }
  return { reason: 'too many redirects' };
}

/** A text found: the PDF link it came from, and the text prepared for matching. */
interface FoundText {
  kind: 'text';
  url: string;
  source: QuoteSource;
}

export type SourceText =
  /** `via`: the copy the text was read from ("OA PDF", "arXiv PDF"). */
  | (FoundText & { via: string })
  | { kind: 'none'; scanned: boolean; reason: string };

/**
 * The text of the first PDF among `urls` that gives one, adding why each
 * other link failed to `failures`. `seen` holds the texts already read in
 * this run, by link; a failure is not kept, so the next quotation of the same
 * work tries again.
 */
async function firstPdfText(
  urls: readonly string[],
  seen: Map<string, QuoteSource>,
  failures: string[],
): Promise<FoundText | { kind: 'none'; scanned: boolean }> {
  let scanned = false;
  for (const url of urls) {
    const known = seen.get(url);
    if (known) return { kind: 'text', url, source: known };
    const got = await fetchPdf(url);
    if ('reason' in got) {
      failures.push(`${url}: ${got.reason}`);
      continue;
    }
    let text: string;
    try {
      text = await extractPdfText(got.bytes);
    } catch (err) {
      failures.push(`${url}: the PDF could not be read (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    if (isImageOnlyText(text)) {
      scanned = true;
      failures.push(`${url}: the PDF appears to be scanned images, with no text to check`);
      continue;
    }
    const source = prepareSource(text);
    seen.set(url, source);
    return { kind: 'text', url, source };
  }
  return { kind: 'none', scanned };
}

/** The PDF links a registry's answer lists, noting in `notes` why it lists none. */
function linksFrom(registry: string, a: OaPdfAnswer, notes: string[]): string[] {
  if (a.kind === 'found') {
    if (a.urls.length === 0) notes.push(`${registry} lists no open-access PDF`);
    return a.urls;
  }
  notes.push(a.kind === 'not_found' ? `${registry} does not hold the DOI` : `${registry} did not answer (${a.detail})`);
  return [];
}

/**
 * The text of the first PDF of a work that gives one: its DOI's open-access
 * links (OpenAlex's, then Unpaywall's), then arXiv's PDF of its arXiv ID
 * (`2003.02433`, `cs/0112017`), which a work kept under its arXiv record, and
 * many computer-science papers with no DOI at all, can still be read from.
 * `seen` holds the texts already read in this run, by link. OpenAlex often
 * lists an arXiv preprint's PDF at that same address. A text read there is
 * not fetched again, but a link that failed as the DOI's is asked again as the
 * arXiv ID's, so one failed answer does not leave a quotation unchecked. The
 * `reason` of none says, for the DOI and the arXiv ID, why each gave no text.
 */
export async function workText(
  ids: { doi: string | null; arxiv: string | null },
  seen: Map<string, QuoteSource>,
): Promise<SourceText> {
  const reasons: string[] = [];
  const tried = new Set<string>();
  let scanned = false;
  /** The text of the first of `urls` not tried yet that gives one, adding why each other failed to `failures`. */
  const read = async (urls: readonly string[], failures: string[]): Promise<FoundText | null> => {
    const fresh = urls.filter((u) => !tried.has(u)).slice(0, MAX_LINKS);
    for (const u of fresh) tried.add(u);
    const got = await firstPdfText(fresh, seen, failures);
    if (got.kind === 'text') return got;
    scanned ||= got.scanned;
    return null;
  };
  if (ids.doi) {
    const notes: string[] = [];
    const failures: string[] = [];
    const viaOpenAlex = await read(linksFrom('OpenAlex', await openAlexPdfs(ids.doi), notes), failures);
    if (viaOpenAlex) return { ...viaOpenAlex, via: 'OA PDF' };
    if (contactEmail()) {
      const viaUnpaywall = await read(linksFrom('Unpaywall', await unpaywallPdfs(ids.doi), notes), failures);
      if (viaUnpaywall) return { ...viaUnpaywall, via: 'OA PDF' };
    } else {
      notes.push('set PENSMITH_CONTACT_EMAIL so Unpaywall can be asked too');
    }
    const why = [...failures, ...notes].join('; ');
    // Nothing was tried when no registry listed an open-access PDF.
    reasons.push(tried.size === 0 ? `No OA PDF available for DOI ${ids.doi}: ${why}` : `PDF fetch/parse failed: ${why}`);
  }
  if (ids.arxiv) {
    // arXiv serves the latest version, or the one the ID names ("2003.02433v2").
    // Not through `read`: a DOI link at this address that failed is asked again.
    const failures: string[] = [];
    const got = await firstPdfText([`https://arxiv.org/pdf/${ids.arxiv}`], seen, failures);
    if (got.kind === 'text') return { ...got, via: 'arXiv PDF' };
    scanned ||= got.scanned;
    reasons.push(`the arXiv PDF of ${ids.arxiv} could not be read: ${failures.join('; ')}`);
  }
  return { kind: 'none', scanned, reason: reasons.join('; ') };
}
