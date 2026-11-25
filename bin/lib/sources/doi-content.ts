// bin/lib/sources/doi-content.ts — DOI content negotiation through doi.org.
//
// Endpoint: GET https://doi.org/<doi> with Accept: application/vnd.citationstyles.csl+json
//
// doi.org is the DOI system itself, so it knows every registered DOI whatever
// agency holds it (Crossref, DataCite, mEDRA, JaLC, KISTI and others). It
// answers 404 for a DOI that was never registered, and otherwise redirects to
// the agency's metadata service, which returns CSL-JSON. Pass 1 asks it last,
// for the DOIs neither Crossref nor DataCite holds.
//
// http.ts does not follow redirects, so this module does, and only to the
// agencies' own metadata hosts below. An agency without content negotiation
// redirects to the publisher's landing page instead; that proves the DOI is
// registered but gives no metadata to check, so the lookup is "unavailable",
// never "found" and never "not found".

import { fetch as httpFetch } from '../http.js';
import { recordFromCsl, unavailableDetail, type Lookup, type WorkRecord } from './work-record.js';

const CSL_JSON = 'application/vnd.citationstyles.csl+json';

/** Metadata services doi.org redirects content-negotiation requests to. */
export const AGENCY_METADATA_HOSTS: ReadonlySet<string> = new Set([
  'api.crossref.org',     // Crossref
  'data.crosscite.org',   // DataCite
  'api.datacite.org',     // DataCite
  'japanlinkcenter.org',  // JaLC
  'data.medra.org',       // mEDRA
]);

const MAX_HOPS = 3;

/** `doi` as a doi.org path: each part encoded, the `/` after the prefix kept. */
function doiPath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/');
}

/** Ask doi.org for `doi`'s metadata: found, not_found (404) or unavailable. */
export async function lookupDoi(doi: string): Promise<Lookup> {
  let url = `https://doi.org/${doiPath(doi)}`;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res;
    try {
      res = await httpFetch(url, { source: 'doi', headers: { accept: CSL_JSON } });
    } catch (err) {
      return { kind: 'unavailable', registry: 'doi.org', detail: unavailableDetail(err) };
    }
    if (res.status === 404 || res.status === 410) {
      // doi.org itself: the DOI was never registered. An agency's 404 after
      // doi.org redirected there is only a gap in that agency's metadata.
      return hop === 0
        ? { kind: 'not_found', registry: 'doi.org', authoritative: true }
        : { kind: 'unavailable', registry: 'doi.org', detail: 'the registration agency has no metadata for this DOI' };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers['location'];
      let target: URL;
      try {
        target = new URL(next ?? '', url);
      } catch {
        return { kind: 'unavailable', registry: 'doi.org', detail: 'redirect without a usable location' };
      }
      if (target.protocol !== 'https:' || !AGENCY_METADATA_HOSTS.has(target.hostname)) {
        return {
          kind: 'unavailable',
          registry: 'doi.org',
          detail: 'the DOI is registered, but its agency offers no metadata pensmith can read',
        };
      }
      url = target.href;
      continue;
    }
    if (res.status !== 200) return { kind: 'unavailable', registry: 'doi.org', detail: `HTTP ${res.status}` };
    let record: WorkRecord | null = null;
    try {
      const item = JSON.parse(res.body) as unknown;
      record = item && typeof item === 'object' && !Array.isArray(item)
        ? recordFromCsl('doi.org', item as Record<string, unknown>)
        : null;
    } catch {
      record = null;
    }
    return record
      ? { kind: 'found', registry: 'doi.org', record }
      : { kind: 'unavailable', registry: 'doi.org', detail: 'unreadable response' };
  }
  return { kind: 'unavailable', registry: 'doi.org', detail: 'too many redirects' };
}
