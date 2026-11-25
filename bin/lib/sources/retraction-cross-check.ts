// bin/lib/sources/retraction-cross-check.ts — mark retracted research candidates.
//
// Every adapter builds its candidates with `retracted: false`. Research calls
// crossCheckRetractions before CITATIONS.bib is written, so a retracted source
// reaches the bib as `note = {RETRACTED}`, which Pass 1 reads back as
// RETRACTED. The answer comes from each candidate's own registry record
// (Crossref `updated-by`, OpenAlex `is_retracted`, PubMed's "Retracted
// Publication" type) and from a "RETRACTED:" title (bin/lib/verify/retraction.ts),
// so no request is made. Pass 1 checks again at verify time, from the record
// it fetches then.

import type { SourceCandidate } from '../schemas/source-candidate.js';
import { candidateRetraction } from '../verify/retraction.js';

/**
 * Mark each candidate its own record shows as retracted: `retracted: true`,
 * and `retraction_details` saying how it is known. Mutates in place.
 */
export function crossCheckRetractions(candidates: SourceCandidate[]): void {
  for (const c of candidates) {
    const why = candidateRetraction(c);
    if (why === null) continue;
    c.retracted = true;
    c.retraction_details ??= why;
  }
}
