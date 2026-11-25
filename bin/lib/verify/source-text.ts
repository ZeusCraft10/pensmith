// bin/lib/verify/source-text.ts — the open-access text Pass 3 checks a
// quotation against.
//
// The PDF links come from OpenAlex first, which needs no contact email. When
// none of them gives text, Unpaywall is asked too, if PENSMITH_CONTACT_EMAIL
// is set (Unpaywall refuses a request without one): it often knows another
// copy. Each link is tried in turn until one gives a PDF.
//
// A PDF is fetched as bytes, never through the UTF-8 text body, which destroys
// its compressed streams, and never through the HTTP cache, which stores text.
// The link comes from a registry record, not from pensmith, so it is fetched
// as an untrusted URL: the SSRF guard checks it and every redirect hop.

import { fetch as httpFetch } from '../http.js';
import { extractPdfText } from '../pdf-text.js';
import { lookupOaPdfs as openAlexPdfs } from '../sources/openalex.js';
import { lookupOaPdfs as unpaywallPdfs } from '../sources/unpaywall.js';
import { contactEmail, unavailableDetail, type OaPdfAnswer } from '../sources/work-record.js';
import { prepareSource, type QuoteSource } from './quote-match.js';

/** Links tried per work, best first. */
const MAX_LINKS = 3;
/** Redirects followed from one link. */
const MAX_REDIRECTS = 5;
/** Below this many non-space characters a PDF is taken to be scanned images. */
const MIN_TEXT_CHARS = 50;

const TEXT_TYPE = /^\s*(?:text\/|application\/(?:[\w.-]+\+)?(?:json|xml)\b)/i;

/** Whether a response is a PDF: not served as text, and starting with the PDF header. */
function isPdf(bytes: Buffer, contentType: string): boolean {
  if (TEXT_TYPE.test(contentType)) return false;
  const at = bytes.subarray(0, 1024).indexOf('%PDF-');
  return at !== -1;
}

/** The bytes of the PDF at `url`, following redirects, or why there are none. */
export async function fetchPdf(url: string): Promise<{ bytes: Buffer } | { reason: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res;
    try {
      res = await httpFetch(current, {
        source: 'generic',
        untrusted: true,
        noCache: true,
        headers: { accept: 'application/pdf,*/*;q=0.5' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      return { reason: msg.startsWith('SSRF guard') ? 'refused: the link points to a private or local address' : unavailableDetail(err) };
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

export type SourceText =
  | { kind: 'text'; url: string; source: QuoteSource }
  /** `noLinks`: no registry listed an open-access PDF, so nothing was fetched. */
  | { kind: 'none'; scanned: boolean; noLinks: boolean; reason: string };

/**
 * The text of the first PDF among `urls` that gives one. `seen` holds the
 * texts already read in this run, by link; a failure is not kept, so the next
 * quotation of the same work tries again.
 */
async function firstPdfText(urls: readonly string[], seen: Map<string, QuoteSource>): Promise<SourceText> {
  const failures: string[] = [];
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
    if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
      scanned = true;
      failures.push(`${url}: the PDF appears to be scanned images, with no text to check`);
      continue;
    }
    const source = prepareSource(text);
    seen.set(url, source);
    return { kind: 'text', url, source };
  }
  return { kind: 'none', scanned, noLinks: urls.length === 0, reason: failures.join('; ') };
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
 * The text of the first open-access PDF of `doi` that gives one: OpenAlex's
 * links first, then Unpaywall's links not tried yet. `seen` holds the texts
 * already read in this run, by link.
 */
export async function openAccessText(doi: string, seen: Map<string, QuoteSource>): Promise<SourceText> {
  const notes: string[] = [];
  const failures: string[] = [];
  const tried = new Set<string>();
  let scanned = false;
  const fromRegistry = async (registry: string, answer: OaPdfAnswer): Promise<SourceText | null> => {
    const urls = linksFrom(registry, answer, notes).filter((u) => !tried.has(u)).slice(0, MAX_LINKS);
    for (const u of urls) tried.add(u);
    const got = await firstPdfText(urls, seen);
    if (got.kind === 'text') return got;
    if (got.reason) failures.push(got.reason);
    scanned ||= got.scanned;
    return null;
  };
  const viaOpenAlex = await fromRegistry('OpenAlex', await openAlexPdfs(doi));
  if (viaOpenAlex) return viaOpenAlex;
  if (contactEmail()) {
    const viaUnpaywall = await fromRegistry('Unpaywall', await unpaywallPdfs(doi));
    if (viaUnpaywall) return viaUnpaywall;
  } else {
    notes.push('set PENSMITH_CONTACT_EMAIL so Unpaywall can be asked too');
  }
  return { kind: 'none', scanned, noLinks: tried.size === 0, reason: [...failures, ...notes].join('; ') };
}
