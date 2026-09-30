// bin/lib/sources/doi-ra.ts — which registration agency holds a DOI prefix
// (doi.org's RA lookup; SRC-13, D-19-05, review round 3).
//
// `add` resolves a DOI at Crossref. Crossref's 404 is definitive only for a
// DOI Crossref registers: DataCite (Zenodo 10.5281, Figshare, Dryad), mEDRA,
// JaLC and the other agencies register DOIs Crossref has never seen, so a
// Crossref 404 for one of them says nothing about whether the DOI exists.
// Before `add` tells the user "not found — check the identifier", it asks
// doi.org which agency holds the DOI's PREFIX (only the prefix leaves the
// machine, never the full DOI):
//
//   GET https://doi.org/ra/10.5281   →   [{"DOI":"10.5281","RA":"DataCite"}]
//   GET https://doi.org/ra/10.99999  →   [{"DOI":"10.99999","status":"DOI does not exist"}]
//
// Three outcomes: the agency's name, an unknown prefix (no agency holds it —
// the DOI cannot exist), or failed (the question could not be answered). The
// request goes through the one egress gate (http.ts, source `generic`); the
// typed OfflineEgressError propagates (a mode, not an outcome).

import { fetch as httpFetch, MAX_JSON_RESPONSE_BYTES } from '../http.js';
import { exchange, jsonShape, validator, parseJsonBody, statusReason } from './registrar-response.js';

export type RegistrationAgency =
  | { readonly kind: 'agency'; readonly agency: string }
  | { readonly kind: 'unknown-prefix' }
  | { readonly kind: 'failed'; readonly reason: string };

/** doi.org's answer: a one-element array with `RA`, or `status` for an unknown prefix. */
function firstRecord(body: unknown): Record<string, unknown> | null {
  if (!Array.isArray(body)) return null;
  const first: unknown = body[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
}

const RA_ANSWER = jsonShape((body) => {
  const rec = firstRecord(body);
  return rec !== null && (typeof rec['RA'] === 'string' || typeof rec['status'] === 'string');
}, 'registration agency');

/** The DOI's prefix (`10.5281` of `10.5281/zenodo.3242074`), or null. */
export function doiPrefix(doi: string): string | null {
  const slash = doi.indexOf('/');
  const prefix = slash > 0 ? doi.slice(0, slash) : '';
  return /^\d+\.\d+(?:\.\d+)*$/.test(prefix) ? prefix : null;
}

/** Ask doi.org which registration agency holds `doi`'s prefix (see the header). */
export async function registrationAgency(doi: string): Promise<RegistrationAgency> {
  const prefix = doiPrefix(doi);
  if (prefix === null) return { kind: 'unknown-prefix' };
  const ex = await exchange(
    () => httpFetch(`https://doi.org/ra/${prefix}`, { source: 'generic', maxBytes: MAX_JSON_RESPONSE_BYTES, validate: validator(RA_ANSWER) }),
    { service: 'doi.org', check: RA_ANSWER },
  );
  if (ex.kind === 'failed') return { kind: 'failed', reason: ex.reason };
  if (ex.kind === 'status') return { kind: 'failed', reason: statusReason(ex.res) };
  const rec = firstRecord(parseJsonBody(ex.res));
  const ra = rec?.['RA'];
  if (typeof ra === 'string' && ra.trim() !== '') return { kind: 'agency', agency: ra.trim() };
  return { kind: 'unknown-prefix' };
}
