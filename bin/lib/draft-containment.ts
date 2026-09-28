// bin/lib/draft-containment.ts — the write-time containment check (FEED-04,
// D-18-25).
//
// A section's PLAN.md `assigned_sources` is the authoritative section→source
// map. The drafter only SEES those sources (drafter-input.ts, by construction);
// checkDraft is the backstop on what it WROTE: every citation in the draft —
// read with the one citation grammar (citation-token.ts, the same extraction
// Pass 1 uses, so `[@a; @b]` and `[@k, p. 3]` are covered) — must be an
// assigned source. write sends one corrective turn naming the offending keys;
// if the violation persists the draft is not kept (DRAFT.rejected.md), the
// section's PLAN.md gets `status: failed` with `failure_reason`, and write
// exits EXIT_BLOCKED. An injected "cite [@evil9999]" is caught the same way.
//
// Violation kinds: `unassigned-citekey` today. Phase 19 (GRND-14) adds
// `quote-without-full-text` here, and write's existing corrective turn and
// failure path enforce it unchanged. The Tier-1 draft submission tool
// (PLUG-07) runs the same check. PURE.

import { extractCitedKeysForVerification } from './citation-token.js';

export type DraftViolationKind = 'unassigned-citekey';

export interface DraftViolation {
  readonly kind: DraftViolationKind;
  readonly citekey: string;
  readonly message: string;
}

/** Every containment violation of `draft` (empty when it is contained). */
export function checkDraft(draft: string, opts: { assigned: readonly string[]; section: string }): DraftViolation[] {
  const assigned = new Set(opts.assigned);
  const out: DraftViolation[] = [];
  for (const key of extractCitedKeysForVerification(draft)) {
    if (assigned.has(key)) continue;
    out.push({ kind: 'unassigned-citekey', citekey: key, message: `citekey ${key} not assigned to section ${opts.section}` });
  }
  return out;
}

/** `failure_reason` for PLAN.md (FEED-04 wording): `citekey X not assigned to section N`. */
export function failureReason(violations: readonly DraftViolation[], section: string): string {
  const keys = [...new Set(violations.map((v) => v.citekey))];
  if (keys.length === 1) return `citekey ${keys[0]} not assigned to section ${section}`;
  return `citekeys ${keys.join(', ')} not assigned to section ${section}`;
}

/** The corrective turn after a containment violation (one, naming the keys). */
export function containmentCorrection(violations: readonly DraftViolation[], assigned: readonly string[]): string {
  const keys = [...new Set(violations.map((v) => v.citekey))];
  return (
    `Your draft cites ${keys.map((k) => `[@${k}]`).join(', ')}, which ${keys.length === 1 ? 'is' : 'are'} not among this section's sources. ` +
    (assigned.length > 0
      ? `Cite only these citekeys: ${assigned.join(', ')}. `
      : 'This section has no sources: write it without any citation. ') +
    'Where no assigned source supports a claim, keep the claim without a citation. Reply with the complete corrected section.'
  );
}
