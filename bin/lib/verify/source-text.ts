// bin/lib/verify/source-text.ts — where Pass 3 finds a cited work's real text,
// and the cache that lets compile and done recompute it (VRFY-19, D-20-18).
//
// The open-access copies of one cited work, in the order Pass 3 tries them
// (the user's own PDF comes first, read by byo-text.ts in pass3.ts — never
// here, and never handed to Pass 2):
//   1. every PDF Unpaywall lists for the work's DOI (its oa_locations,
//      best first, de-duplicated; sources/unpaywall.ts lookupOaPdfUrls) —
//      the DOI Pass 1 verified binds the copy to the work;
//   2. the Europe PMC open-access full text of its PMCID (sources/
//      europepmc.ts), used only when the article names the DOI or PMID of the
//      citation (a PMCID in a local file never lends another article's text);
//   3. the arXiv PDF of its arXiv id, derived from the id (never a stored
//      URL, S-17). When the arXiv id is not what Pass 1 checks (the entry also
//      has a registrar DOI), the PDF counts only when it shows the entry's
//      title near its start.
// Each copy is fetched through bin/lib/http.ts (redirects followed, every hop
// checked) as bytes (`bodyBytes`), accepted only as a real PDF
// (pdf-response.ts checkPdfResponse), and read in the SEC-02 worker
// (pdf-text.ts extractPdf) with every error caught.
//
// What a copy can come to (D-20-03):
//   text       the copy's text;
//   no-text    a definitive answer without text: no open-access copy,
//              paywalled (abstract only), no contact email for Unpaywall, a
//              link that answered 403 / 404 or not with a PDF, a corrupt or
//              image-only PDF (`fetch failed: …`, `image-only PDF`) — Pass 3's
//              UNVERIFIABLE-QUOTE when no copy has text;
//   no-answer  no answer: offline with no recording, a transport error or
//              timeout, 429 / 5xx after retries, an exhausted host or an open
//              breaker — Pass 3's UNVERIFIABLE-NETWORK (retry online).
//
// The extracted-text cache (the "source-text" folder of the pensmith data
// dir, one `<sha256(url)>.json` per copy: url, final_url, content_sha256,
// text_sha256, text ≤ 4 MiB, saved_at, source) is written only after a
// successful extraction, through atomicWriteFile, and read only while the
// entry is younger than the TTL of the source that fetched it (http.ts
// sourceTtlMs) and its text still hashes to text_sha256. A copy fetched again
// whose bytes hash to the cached content_sha256 is not extracted again. Like
// the HTTP cache it is never read or written when sources are offline, where
// the recorded fixtures replay exactly and a miss is no-answer. So a second
// verify, compile or done on an unchanged paper makes no PDF request. Public
// open-access text only (PRIVACY.md).

import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import {
  fetch as httpFetch,
  isOfflineEgressError,
  RedirectError,
  ResponseTooLargeError,
  SsrfBlockedError,
  dnsLookupFailure,
  sourceTtlMs,
  type HttpSource,
} from '../http.js';
import { networkMode } from '../http-mock.js';
import { checkPdfResponse } from '../pdf-response.js';
import { extractPdf, MAX_PDF_BYTES, PdfTimeoutError } from '../pdf-text.js';
import { pensmithSourceTextCacheDir } from '../paths.js';
import { lookupOaPdfUrls } from '../sources/unpaywall.js';
import { fullTextXmlUrl, lookupFullText, normPmcid, type ArticleIds } from '../sources/europepmc.js';
import { contactEmail } from '../contact-email.js';
import { errorFailureReason } from '../sources/search-failure.js';
import { arxivIdOfEntry, arxivPdfUrl, isDataCiteArxivDoi } from '../full-text.js';
import { normalizeDoi } from '../doi.js';
import { matchQuote, prepareQuoteText, type PreparedText } from '../fuzzy.js';
import { passagesNearClaim } from '../byo-text.js';
import { libraryPaths, tryLoadLibrary } from '../library.js';
import { parseBibFileAt } from '../citations.js';

/** The longest text the cache keeps (characters); a longer one is used for the run, never cached. */
export const SOURCE_TEXT_MAX_CHARS = 4 * 1024 * 1024;

/** Where a text came from. */
export type TextOrigin = 'open-access PDF' | 'Europe PMC full text' | 'arXiv PDF';

/** The identifiers of a cited work Pass 3 looks for text by. */
export interface SourceIdentity {
  readonly doi: string | null;
  readonly pmid: string | null;
  readonly pmcid: string | null;
  readonly arxiv: string | null;
  /**
   * True when the arXiv id IS the work's verified identity: a DataCite arXiv
   * DOI, or an entry with no other DOI (Pass 1 checks the id at arXiv).
   */
  readonly arxivIsIdentity: boolean;
  /** The entry's title (the arXiv PDF of a DOI entry must show it). */
  readonly title: string | null;
}

/** One copy of a work's text. */
export interface SourceText {
  readonly origin: TextOrigin;
  /** The URL asked. */
  readonly url: string;
  /** The URL that answered (after redirects). */
  readonly finalUrl: string;
  /** The copy in a phrase: `the open-access PDF at repo.example`, `the arXiv PDF of 1706.03762`. */
  readonly label: string;
  readonly text: string;
  /** True when the text came from the extracted-text cache (no request). */
  readonly fromCache: boolean;
  /** The text normalized for quote matching (computed once). */
  prepared(): PreparedText;
}

/** What one copy came to (see the header). */
export type TextAttempt =
  | { readonly kind: 'text'; readonly source: SourceText }
  | { readonly kind: 'no-text'; readonly reason: string }
  | { readonly kind: 'no-answer'; readonly reason: string };

export interface SourceTextOptions {
  /**
   * Fetch the copies again (the cache is not read; the fresh text is written
   * back): the citation is due for a re-check (`[verification]
   * recheck_after_days`, VRFY-28).
   */
  readonly refresh?: boolean;
}

// ---------------------------------------------------------------------------
// In-process memo: one lookup / fetch per copy per run (verify's Pass 3 and
// Pass 2 share it), kept briefly so a long-lived process (the MCP server)
// asks again on its next run. An entry holds a whole extracted text, so
// expired entries are dropped on every use and the map is capped (oldest
// first): the long-lived MCP server never keeps every source it ever read in
// memory (review round 2; the on-disk text cache avoids refetching).
// ---------------------------------------------------------------------------

const MEMO_TTL_MS = 60_000;
/** The most entries the memo keeps (the oldest go first). */
export const MEMO_MAX_ENTRIES = 64;
const memo = new Map<string, { readonly at: number; readonly value: Promise<unknown> }>();

/** Drop expired entries, then the oldest beyond MEMO_MAX_ENTRIES (a Map iterates in insertion order). */
function sweepMemo(now: number): void {
  for (const [k, v] of memo) if (now - v.at >= MEMO_TTL_MS) memo.delete(k);
  while (memo.size > MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next();
    if (oldest.done === true) break;
    memo.delete(oldest.value);
  }
}

function memoized<T>(key: string, fresh: boolean, fn: () => Promise<T>): Promise<T> {
  const full = `${networkMode().sourcesOffline ? 'offline' : 'live'}|${key}`;
  const now = Date.now();
  sweepMemo(now);
  const hit = memo.get(full);
  if (!fresh && hit !== undefined && now - hit.at < MEMO_TTL_MS) return hit.value as Promise<T>;
  const value = fn();
  memo.delete(full); // re-inserted last: the newest entry
  memo.set(full, { at: now, value });
  sweepMemo(now);
  return value;
}

/** Test hooks: the memo's size, and the memo itself. */
export function _sourceTextMemoSizeForTest(): number {
  return memo.size;
}
export const _memoizedForTest = memoized;

/** Test hook: forget every memoized lookup and text (a new "run"). */
export function _resetSourceTextMemoForTest(): void {
  memo.clear();
  extractions.clear();
}

/** Extracted texts by the sha256 of the PDF bytes, so identical bytes are read once per process. */
const extractions = new Map<string, Promise<{ text: string; imageOnly: boolean }>>();
const MAX_EXTRACTIONS = 16;

function extractOnce(bytes: Buffer, contentSha: string): Promise<{ text: string; imageOnly: boolean }> {
  const hit = extractions.get(contentSha);
  if (hit !== undefined) return hit;
  const p = extractPdf(bytes).then((ex) => ({ text: ex.text, imageOnly: ex.imageOnly }));
  // A failed extraction is not remembered: the next fetch tries again.
  p.catch(() => extractions.delete(contentSha));
  extractions.set(contentSha, p);
  if (extractions.size > MAX_EXTRACTIONS) extractions.delete(extractions.keys().next().value as string);
  return p;
}

// ---------------------------------------------------------------------------
// The extracted-text cache.
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly url: string;
  readonly final_url: string;
  readonly content_sha256: string;
  readonly text_sha256: string;
  readonly text: string;
  readonly saved_at: string;
  readonly source: HttpSource;
  /** The article ids a Europe PMC text names (checked against the citation on every read). */
  readonly ids?: ArticleIds;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The cache file of `url`. */
export function sourceTextCacheFile(url: string): string {
  return path.join(pensmithSourceTextCacheDir(), `${sha256Hex(url)}.json`);
}

/** The cached entry of `url` fetched as `source`: fresh (within the TTL), stale, or none. */
async function readCacheEntry(url: string, source: HttpSource): Promise<{ entry: CacheEntry; fresh: boolean } | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(sourceTextCacheFile(url), 'utf8');
  } catch {
    return null;
  }
  let e: Partial<CacheEntry>;
  try {
    e = JSON.parse(raw) as Partial<CacheEntry>;
  } catch {
    return null;
  }
  if (
    e.url !== url ||
    e.source !== source ||
    typeof e.text !== 'string' ||
    typeof e.text_sha256 !== 'string' ||
    typeof e.content_sha256 !== 'string' ||
    typeof e.final_url !== 'string' ||
    typeof e.saved_at !== 'string' ||
    e.text.length > SOURCE_TEXT_MAX_CHARS ||
    sha256Hex(e.text) !== e.text_sha256
  ) {
    return null;
  }
  const savedAt = Date.parse(e.saved_at);
  if (!Number.isFinite(savedAt)) return null;
  const age = Date.now() - savedAt;
  return { entry: e as CacheEntry, fresh: age >= 0 && age < sourceTtlMs(source) };
}

/** Best-effort: a cache that cannot be written only means the next run fetches again. */
async function writeCacheEntry(entry: Omit<CacheEntry, 'text_sha256' | 'saved_at'>): Promise<void> {
  if (networkMode().sourcesOffline || entry.text.length > SOURCE_TEXT_MAX_CHARS) return;
  const full: CacheEntry = { ...entry, text_sha256: sha256Hex(entry.text), saved_at: new Date().toISOString() };
  try {
    await atomicWriteFile(sourceTextCacheFile(entry.url), `${JSON.stringify(full)}\n`);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// One copy.
// ---------------------------------------------------------------------------

function textOf(origin: TextOrigin, label: string, url: string, finalUrl: string, text: string, fromCache: boolean): TextAttempt {
  let prepared: PreparedText | null = null;
  return {
    kind: 'text',
    source: {
      origin,
      url,
      finalUrl,
      label,
      text,
      fromCache,
      prepared: () => (prepared ??= prepareQuoteText(text)),
    },
  };
}

/** The host of `url`, for a label. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

/**
 * A thrown fetch error as an attempt: a refusal by policy (a private or
 * loopback address, a redirect outside policy, an oversized body) is an
 * answer (no-text, which the user may accept); anything else is no answer —
 * a host name that did not resolve (offline, the resolver down) included, so
 * a cached Unpaywall answer with no network never invites an acceptance
 * (VRFY-19, D-20-03).
 */
function fetchFailure(err: unknown, label: string): TextAttempt {
  if (isOfflineEgressError(err)) return { kind: 'no-answer', reason: `${label}: ${err.message}` };
  const dns = dnsLookupFailure(err);
  if (dns !== null) {
    const dead = dns === 'ENOTFOUND' || dns === 'EAI_NONAME' || dns === 'ENODATA';
    return {
      kind: 'no-answer',
      reason:
        `no answer from ${label}: its host name did not resolve (${dns}) — retry verification when online` +
        (dead ? "; if this repeats while you are online, the link is dead: add the source's PDF (`pensmith add <pdf>`)" : ''),
    };
  }
  if (err instanceof SsrfBlockedError || err instanceof RedirectError || err instanceof ResponseTooLargeError) {
    return { kind: 'no-text', reason: `fetch failed: ${errorFailureReason(err)} (${label})` };
  }
  return { kind: 'no-answer', reason: `no answer from ${label}: ${errorFailureReason(err)} — retry verification when online` };
}

/** The text of the PDF at `url` (see the header). Never throws. */
async function pdfText(url: string, source: HttpSource, origin: TextOrigin, label: string, opts: SourceTextOptions): Promise<TextAttempt> {
  const live = !networkMode().sourcesOffline;
  const cached = live ? await readCacheEntry(url, source) : null;
  if (cached !== null && cached.fresh && opts.refresh !== true) {
    return textOf(origin, label, url, cached.entry.final_url, cached.entry.text, true);
  }
  let bytes: Buffer;
  let finalUrl = url;
  try {
    const res = await httpFetch(url, { source, noCache: true, maxBytes: MAX_PDF_BYTES });
    finalUrl = res.finalUrl ?? url;
    const pdf = checkPdfResponse(res);
    if (!pdf.ok) return { kind: 'no-text', reason: `fetch failed: ${pdf.reason} (${label})` };
    bytes = pdf.bytes;
  } catch (err) {
    return fetchFailure(err, label);
  }
  const contentSha = sha256Hex(bytes);
  if (cached !== null && cached.entry.content_sha256 === contentSha) {
    // The same bytes as last time: the cached text is still theirs.
    await writeCacheEntry({ url, final_url: finalUrl, content_sha256: contentSha, text: cached.entry.text, source });
    return textOf(origin, label, url, finalUrl, cached.entry.text, false);
  }
  let ex: { text: string; imageOnly: boolean };
  try {
    ex = await extractOnce(bytes, contentSha);
  } catch (err) {
    const why = err instanceof PdfTimeoutError ? 'its text could not be read in time' : `it could not be read (${(errorFailureReason(err).split('\n')[0] ?? '').slice(0, 160)})`;
    return { kind: 'no-text', reason: `fetch failed: the PDF answered but ${why} (${label})` };
  }
  if (ex.imageOnly || ex.text.replace(/\s/g, '').length < 50) {
    return { kind: 'no-text', reason: `image-only PDF: no extractable text (${label})` };
  }
  await writeCacheEntry({ url, final_url: finalUrl, content_sha256: contentSha, text: ex.text, source });
  return textOf(origin, label, url, finalUrl, ex.text, false);
}

/**
 * The text of the open-access PDF at `url`, read exactly as Pass 3 reads a
 * copy (redirects followed, a real PDF required, the SEC-02 worker, the
 * extracted-text cache): for a caller that holds a URL rather than a citation
 * — scripts/live-verify-quotes.mjs checks the services with it. Never throws.
 */
export async function openAccessPdfText(url: string, opts: SourceTextOptions & { readonly source?: 'generic' | 'arxiv' } = {}): Promise<TextAttempt> {
  const source = opts.source ?? 'generic';
  const label = source === 'arxiv' ? `the arXiv PDF at ${url}` : `the open-access PDF at ${hostOf(url)}`;
  return pdfText(url, source, source === 'arxiv' ? 'arXiv PDF' : 'open-access PDF', label, opts);
}

/** A Europe PMC full text and the ids its article names, or why there is none. Never throws. */
async function europePmcText(pmcid: string, opts: SourceTextOptions): Promise<{ attempt: TextAttempt; ids: ArticleIds | null }> {
  const label = `the Europe PMC full text of ${pmcid}`;
  const url = fullTextXmlUrl(pmcid);
  const live = !networkMode().sourcesOffline;
  const cached = live ? await readCacheEntry(url, 'europepmc') : null;
  if (cached !== null && cached.fresh && opts.refresh !== true && cached.entry.ids !== undefined) {
    return { attempt: textOf('Europe PMC full text', label, url, cached.entry.final_url, cached.entry.text, true), ids: cached.entry.ids };
  }
  let r: Awaited<ReturnType<typeof lookupFullText>>;
  try {
    r = await lookupFullText(pmcid);
  } catch (err) {
    return { attempt: fetchFailure(err, label), ids: null };
  }
  if (r.kind === 'not-found') return { attempt: { kind: 'no-text', reason: `no open-access full text at Europe PMC for ${pmcid}` }, ids: null };
  if (r.kind === 'failed') {
    const definitive = r.status !== undefined && r.status >= 400 && r.status < 500 && r.status !== 429;
    return {
      attempt: definitive
        ? { kind: 'no-text', reason: `fetch failed: ${r.reason} (${label})` }
        : { kind: 'no-answer', reason: `no answer from ${label}: ${r.reason} — retry verification when online` },
      ids: null,
    };
  }
  const text = r.article.text;
  if (text.replace(/\s/g, '').length < 50) return { attempt: { kind: 'no-text', reason: `${label} has no body text` }, ids: r.article.ids };
  await writeCacheEntry({ url, final_url: r.url, content_sha256: sha256Hex(r.body), text, source: 'europepmc', ids: r.article.ids });
  return { attempt: textOf('Europe PMC full text', label, url, r.url, text, false), ids: r.article.ids };
}

/** Unpaywall's PDFs for `doi`, or the attempt that stands for them when there are none. Never throws. */
async function unpaywallPdfs(doi: string, refresh: boolean): Promise<{ urls: readonly string[] } | TextAttempt> {
  let r: Awaited<ReturnType<typeof lookupOaPdfUrls>>;
  try {
    r = await lookupOaPdfUrls(doi, { refresh });
  } catch (err) {
    return fetchFailure(err, `the Unpaywall lookup of DOI ${doi}`);
  }
  if (r.kind === 'found') {
    if (r.pdfUrls.length > 0) return { urls: r.pdfUrls };
    return r.isOa
      ? { kind: 'no-text', reason: `no open-access copy: Unpaywall lists no PDF of DOI ${doi}, only landing pages` }
      : { kind: 'no-text', reason: `paywalled (abstract only): Unpaywall lists no open-access copy of DOI ${doi}` };
  }
  if (r.kind === 'not-found') return { kind: 'no-text', reason: `no open-access copy: Unpaywall has no record of DOI ${doi}` };
  if (r.noEmail === true) {
    const envName = contactEmail().envName;
    return { kind: 'no-text', reason: `Unpaywall needs a contact email — set ${envName} (the open-access copy of DOI ${doi} was not looked up)` };
  }
  const definitive = r.status !== undefined && r.status >= 400 && r.status < 500 && r.status !== 429;
  return definitive
    ? { kind: 'no-text', reason: `Unpaywall answered ${r.reason} for DOI ${doi}` }
    : { kind: 'no-answer', reason: `no answer from Unpaywall for DOI ${doi}: ${r.reason} — retry verification when online` };
}

/** True when `text` shows `title` near its start (the arXiv PDF of a DOI entry). */
function showsTitle(title: string, text: string): boolean {
  const head = text.slice(0, 6000);
  const main = title.split(/[:?]\s|\.\s/u)[0] ?? title;
  return [title, main].some((t) => t.trim().split(/\s+/u).length >= 2 && matchQuote(t, head).ratio >= 0.9);
}

/**
 * Every copy of the work's text, in Pass 3's order (see the header), lazily:
 * a caller that finds its quote in the first copy never fetches the others.
 */
export async function* sourceTextAttempts(id: SourceIdentity, opts: SourceTextOptions = {}): AsyncGenerator<TextAttempt> {
  const fresh = opts.refresh === true;
  let routes = 0;
  const doi = id.doi !== null && !isDataCiteArxivDoi(id.doi) ? normalizeDoi(id.doi) : null;
  if (doi !== null) {
    routes += 1;
    const up = await memoized(`unpaywall|${doi}`, fresh, () => unpaywallPdfs(doi, fresh));
    if ('urls' in up) {
      for (const url of up.urls) {
        const label = `the open-access PDF at ${hostOf(url)}`;
        yield await memoized(`pdf|generic|${url}`, fresh, () => pdfText(url, 'generic', 'open-access PDF', label, opts));
      }
    } else {
      yield up;
    }
  }
  const pmcid = id.pmcid !== null ? normPmcid(id.pmcid) : null;
  if (pmcid !== null) {
    routes += 1;
    if (doi === null && id.pmid === null) {
      yield { kind: 'no-text', reason: `the PMCID ${pmcid} is not tied to a DOI or PMID pensmith verifies, so its Europe PMC text is not used` };
    } else {
      const r = await memoized(`europepmc|${pmcid}`, fresh, () => europePmcText(pmcid, opts));
      if (r.attempt.kind === 'text') {
        const ids = r.ids;
        const same = ids !== null && ((doi !== null && ids.doi === doi) || (id.pmid !== null && ids.pmid === id.pmid));
        yield same
          ? r.attempt
          : {
              kind: 'no-text',
              reason: `the Europe PMC full text of ${pmcid} is another article (DOI ${ids?.doi ?? 'none'}, PMID ${ids?.pmid ?? 'none'}), so it is not used`,
            };
      } else {
        yield r.attempt;
      }
    }
  }
  if (id.arxiv !== null) {
    routes += 1;
    const url = arxivPdfUrl(id.arxiv);
    const label = `the arXiv PDF of ${id.arxiv}`;
    const a = await memoized(`pdf|arxiv|${url}`, fresh, () => pdfText(url, 'arxiv', 'arXiv PDF', label, opts));
    if (a.kind === 'text' && !id.arxivIsIdentity && (id.title === null || !showsTitle(id.title, a.source.text))) {
      yield { kind: 'no-text', reason: `${label} does not show this work's title, so it is not used (the entry's arXiv id is not the identifier Pass 1 checks)` };
    } else {
      yield a;
    }
  }
  if (routes === 0) yield { kind: 'no-text', reason: 'no open-access copy: the entry has no DOI, PMCID or arXiv id to find one by' };
}

// ---------------------------------------------------------------------------
// Identities.
// ---------------------------------------------------------------------------

/** The BibTeX fields (citation-js CSL names) Pass 3 reads from a CITATIONS.bib entry. */
export interface BibIdentityFields {
  readonly DOI?: unknown;
  readonly PMID?: unknown;
  readonly PMCID?: unknown;
  readonly eprint?: unknown;
  readonly archivePrefix?: unknown;
  readonly title?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return str(v[0]);
  return null;
}

/**
 * The identity of a citation: DOI, PMID, arXiv id and title from its
 * CITATIONS.bib entry (what Pass 1 verifies), the PMCID from its LIBRARY.json
 * entry (bound to the work by the article's own ids, see the header).
 */
export function sourceIdentity(bib: BibIdentityFields | undefined, library?: { readonly pmcid?: string | null } | null): SourceIdentity {
  const doi = str(bib?.DOI);
  const eprint = str(bib?.eprint);
  const prefix = str(bib?.archivePrefix);
  const arxivEprint = eprint !== null && (prefix === null || /^arxiv$/i.test(prefix)) ? eprint : null;
  const arxiv = arxivIdOfEntry({ doi, arxiv: arxivEprint });
  const pmid = str(bib?.PMID);
  const pmcid = str(bib?.PMCID) ?? library?.pmcid ?? null;
  return {
    doi,
    pmid: pmid !== null && /^\d{1,9}$/.test(pmid) ? pmid : null,
    pmcid,
    arxiv,
    arxivIsIdentity: arxiv !== null && (doi === null || isDataCiteArxivDoi(doi)),
    title: str(bib?.title),
  };
}

// ---------------------------------------------------------------------------
// Pass 2: the passage of the open-access text nearest a claim.
// ---------------------------------------------------------------------------

const bibMemo = new Map<string, { readonly stamp: string; readonly entries: Promise<Map<string, BibIdentityFields>> }>();

async function bibEntriesOf(file: string): Promise<Map<string, BibIdentityFields>> {
  const st = await fsp.stat(file);
  const stamp = `${st.size}:${st.mtimeMs}`;
  const hit = bibMemo.get(file);
  if (hit !== undefined && hit.stamp === stamp) return hit.entries;
  const entries = fsp.readFile(file, 'utf8').then(async (text) => {
    const parsed = await parseBibFileAt(text, file);
    return new Map(parsed.map((e) => [String((e as { id?: unknown }).id ?? ''), e as BibIdentityFields]));
  });
  bibMemo.set(file, { stamp, entries });
  return entries;
}

/**
 * The passage of the cited work's open-access text (Unpaywall PDF, Europe PMC,
 * arXiv — never the user's own PDF) that shares the most words with `claim`,
 * or null when no copy has text. What Pass 2's claim-support judge reads next
 * to the abstract (VRFY-21). Never throws.
 */
export async function sourceTextPassage(root: string, citekey: string, claim: string): Promise<string | null> {
  try {
    const bib = (await bibEntriesOf(libraryPaths(root).bib)).get(citekey);
    if (bib === undefined) return null;
    const lib = await tryLoadLibrary(root);
    const entry = lib?.entries.find((e) => e.citekey === citekey) ?? null;
    for await (const a of sourceTextAttempts(sourceIdentity(bib, entry))) {
      if (a.kind === 'text') return passagesNearClaim(a.source.text, claim);
    }
    return null;
  } catch {
    return null;
  }
}
