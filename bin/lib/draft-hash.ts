/**
 * bin/lib/draft-hash.ts — D-07 LOCKED per-section draft hash.
 *
 * Computes the SHA-256 "verified_against_draft_hash" for a single section.
 * This hash is stored in sections/<N>/PLAN.md frontmatter and compared by
 * compile to detect stale sections (D-08).
 *
 * D-07 LOCKED input shape:
 *   SHA-256( draftBytes + '\n' + JSON.stringify(assignedSources.slice().sort()) )
 *
 * - draftBytes: raw bytes of sections/<N>/DRAFT.md (no BOM strip, no CRLF→LF normalization)
 * - sources: the `assigned_sources` array from PLAN.md frontmatter
 * - single '\n' separator between the two parts
 * - sorted array (.slice().sort() — NOT a Set; Set would lose duplicate information)
 *
 * Pure function — no I/O, no LLM, no network.
 * This is a PER-SECTION hash (the section's own DRAFT.md), NOT the compiled project draft.
 */

import { createHash } from 'node:crypto';

/**
 * Compute the D-07 draft hash for a section.
 *
 * @param draftBytes Raw bytes of the section's DRAFT.md. Must be a Buffer
 *   (not a string) to avoid encoding ambiguity. No normalization is applied:
 *   CRLF bytes, BOM bytes, and all other byte sequences are preserved exactly.
 *
 * @param assignedSources The `assigned_sources` array from the section's
 *   PLAN.md frontmatter. Sorted alphabetically via .slice().sort() before
 *   hashing — a deterministic array, NOT a Set.
 *
 * @returns 64-character lowercase hex SHA-256 digest.
 *
 * @example
 *   const hash = computeDraftHash(
 *     fs.readFileSync('.paper/sections/01-intro/DRAFT.md'),
 *     ['vaswani2017', 'brown2020'],
 *   );
 *   // → '3a5f...' (64 hex chars)
 */
export function computeDraftHash(draftBytes: Buffer, assignedSources: string[]): string {
  // D-07: sorted array (NOT Set) — identical to slice().sort() in bibtex-write.ts collision pattern
  const sorted = assignedSources.slice().sort();

  // D-07 input shape: draftBytes + '\n' + JSON.stringify(sorted)
  // Using Buffer.concat for exact byte semantics (no string encoding step on draftBytes)
  const hashInput = Buffer.concat([
    draftBytes,
    Buffer.from('\n', 'utf8'),
    Buffer.from(JSON.stringify(sorted), 'utf8'),
  ]);

  return createHash('sha256').update(hashInput).digest('hex');
}
