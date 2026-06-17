// bin/lib/draft-hash.ts — D-07 per-section verified_against_draft_hash input.
//
// Phase 4 Plan 04-05. PURE crypto helper — no I/O, no side effects, same input
// always yields the same output (mirrors the pure-helper shape of citekey.ts).
//
// D-07 (LOCKED) input shape — EXACTLY:
//   SHA-256( DRAFT.md bytes + '\n' + JSON.stringify(assignedSources.slice().sort()) )
//
//   - The draft BYTES are hashed verbatim. NO normalization: no BOM strip, no
//     CRLF→LF conversion. The bytes-as-stored are the input (so a CRLF draft and
//     an otherwise-identical LF draft hash differently — intentional).
//   - A SINGLE '\n' separator follows the draft bytes.
//   - The assigned sources are serialized as a SORTED JS ARRAY (NOT a Set),
//     sorted via Array.prototype.sort (lexicographic ASCII). `.slice()` first so
//     the caller's array is never mutated. Empty sources serialize to "[]".
//
// IMPORTANT: this is a PER-SECTION hash — the input draft is the section's own
// sections/<N>/DRAFT.md, NOT the compiled project-level .paper/DRAFT.md. The
// compile-staleness check (bin/lib/compile.ts) recomputes this per section and
// compares it to the section's PLAN.md `verified_against_draft_hash`.

import { createHash } from 'node:crypto';

/**
 * Compute the D-07 per-section draft hash.
 *
 * @param draftBytes the section's DRAFT.md bytes, exactly as stored on disk
 *   (no normalization). Pass `readFileSync(path)` (a Buffer), never the
 *   decoded-and-re-encoded string, to preserve BOM/CRLF byte-for-byte.
 * @param assignedSources the section's PLAN.md frontmatter `assigned_sources`
 *   (citekey strings). Sorted + JSON-stringified inside; the input is not mutated.
 * @returns the lowercase hex SHA-256 digest.
 */
export function computeDraftHash(draftBytes: Buffer, assignedSources: string[]): string {
  const h = createHash('sha256');
  h.update(draftBytes);
  h.update('\n');
  h.update(JSON.stringify(assignedSources.slice().sort()));
  return h.digest('hex');
}

export default computeDraftHash;
