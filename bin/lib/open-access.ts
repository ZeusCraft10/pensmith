// bin/lib/open-access.ts — record where a source's open-access PDF is (SRC-03,
// GRND-14; Phase 19 review round 1).
//
// full-text.ts tells the drafter which sources it may quote directly: those
// whose text Pass 3 can check. For a registrar source that is its open-access
// PDF, which Pass 3 finds through Unpaywall by DOI. So when a source with a
// DOI enters the library (`add <doi>`, a research or `plan --research` hit
// that is kept, a PDF URL), its Unpaywall `oa_pdf_url` is recorded as the
// entry's `oa_url` — unless the adapter already carried one (OpenAlex's open
// primary location).
//
// This is an enrichment, never a gate: a source whose lookup fails, or that
// has no open-access copy, is added all the same, with no `oa_url` (so no
// full-text flag). Without a contact email Unpaywall cannot be asked (it
// requires one) and nothing is requested; offline (no recording) and
// --dry-run make no request either. Only the DOI leaves the machine.

import { contactEmail } from './contact-email.js';
import { lookupById as unpaywallLookupById } from './sources/unpaywall.js';
import { isOfflineEgressError, offlineLabel } from './http.js';
import { networkMode } from './http-mock.js';
import type { LookupResult } from './sources/lookup.js';

/** What enrichOpenAccess needs of a candidate (mutated in place: `oa_pdf_url`). */
export interface OpenAccessTarget {
  doi?: string | null | undefined;
  oa_pdf_url?: string | null | undefined;
  oa_url?: string | null | undefined;
}

export interface OpenAccessSummary {
  /** Candidates with a DOI and no open-access URL yet: the ones looked up (or that would have been). */
  readonly asked: number;
  /** Of those, how many now carry an open-access PDF URL. */
  readonly found: number;
  /** Why the lookups did not run, or the first failure reason; null when every lookup answered. */
  readonly problem: string | null;
}

export interface OpenAccessOptions {
  /** The Unpaywall lookup (tests inject one; default: the adapter). */
  readonly lookup?: (doi: string) => Promise<LookupResult>;
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
 * Look up the open-access PDF of every target that has a DOI and no
 * open-access URL yet, and record it as `oa_pdf_url` (see the header). Never
 * throws for a lookup problem; the summary says what happened.
 */
export async function enrichOpenAccess(targets: readonly OpenAccessTarget[], opts: OpenAccessOptions = {}): Promise<OpenAccessSummary> {
  const todo = targets.filter((t) => typeof t.doi === 'string' && t.doi.length > 0 && !validHttpUrl(t.oa_pdf_url) && !validHttpUrl(t.oa_url));
  if (todo.length === 0) return { asked: 0, found: 0, problem: null };
  const mode = networkMode();
  if (mode.dryRun) return { asked: todo.length, found: 0, problem: 'not looked up under --dry-run' };
  const injected = opts.lookup !== undefined;
  if (!injected && contactEmail().email === null) {
    return { asked: todo.length, found: 0, problem: `not looked up: Unpaywall needs a contact email (set ${contactEmail().envName})` };
  }
  const lookup = opts.lookup ?? unpaywallLookupById;
  let found = 0;
  let problem: string | null = null;
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
      if (validHttpUrl(r.candidate.oa_pdf_url)) {
        t.oa_pdf_url = r.candidate.oa_pdf_url;
        found += 1;
      }
    } else if (r.kind === 'failed') {
      problem ??= `Unpaywall lookup failed: ${r.reason}`;
    }
  }
  return { asked: todo.length, found, problem };
}

/** One line for a run's output: how many sources have an open-access PDF. */
export function describeOpenAccess(s: OpenAccessSummary): string | null {
  if (s.asked === 0) return null;
  const base = `open access: ${s.found} of ${s.asked} source(s) with a DOI have an open-access PDF (Unpaywall)`;
  return s.problem !== null ? `${base}; ${s.problem}` : base;
}
