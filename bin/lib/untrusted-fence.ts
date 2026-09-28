// bin/lib/untrusted-fence.ts — the ONE untrusted-data fence (FEED-05, D-18-04).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// Text that comes from outside pensmith and the user — source titles, author
// lists and abstracts from the registrars, draft sentences under verification,
// PDF text — is wrapped in this fence before it reaches a model, and every
// template that receives such text says that fenced content is data, never
// instructions. The fence delimiter is public source, so a crafted abstract can
// carry the exact close marker (or a look-alike) to "break out" of the fence:
// stripFenceMarkers() neutralises every spelling of a marker before the text
// is fenced. The UUID is the one Pass 2 / Pass 4 have used since HARD-04c, so
// existing templates, docs and tests keep naming the same markers.

/** The fence id (unchanged since HARD-04c, Phase 15). */
export const FENCE_UUID = '7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a';

/** The line that opens a fenced block. */
export const FENCE_OPEN = `<<<PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;

/** The line that closes a fenced block. */
export const FENCE_CLOSE = `<<<END_PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;

/** What a neutralised marker becomes. */
export const FENCE_MARKER_REPLACEMENT = '[REDACTED-FENCE-MARKER]';

/**
 * Any spelling of an open or close marker: the exact markers, other UUIDs,
 * missing or extra angle brackets, lower case, spaces or a slash after the
 * brackets. The text between the brackets is limited to one line.
 */
const MARKER_RE = /<{1,}\s*\/?\s*(?:END[_\s-]*)?PENSMITH[_\s-]*UNTRUSTED[_\s-]*DATA[^\r\n<>]*>*/gi;

/** A bare marker name without brackets (a model could still read it as a delimiter). */
const BARE_NAME_RE = /(?:END[_\s-]*)?PENSMITH[_\s-]*UNTRUSTED[_\s-]*DATA(?:_[0-9a-f-]{8,36})?/gi;

/**
 * Neutralise every fence marker (and bare marker name) in `text`, so it can be
 * fenced without being able to end the fence early or open a second one.
 */
export function stripFenceMarkers(text: string): string {
  return text.replace(MARKER_RE, FENCE_MARKER_REPLACEMENT).replace(BARE_NAME_RE, FENCE_MARKER_REPLACEMENT);
}

/**
 * Wrap `text` in the fence: the open marker, the neutralised text, the close
 * marker, each on its own line. The result contains exactly one open and one
 * close marker whatever `text` holds.
 */
export function fenceUntrusted(text: string): string {
  return `${FENCE_OPEN}\n${stripFenceMarkers(text)}\n${FENCE_CLOSE}`;
}

/**
 * The text inside a fenced block (the inverse of fenceUntrusted for text that
 * held no marker), or null when `block` is not exactly one fenced block.
 */
export function unfence(block: string): string | null {
  const trimmed = block.replace(/^\r?\n+|\r?\n+$/g, '');
  const open = `${FENCE_OPEN}\n`;
  const close = `\n${FENCE_CLOSE}`;
  const normalized = trimmed.replace(/\r\n/g, '\n');
  if (!normalized.startsWith(open) || !normalized.endsWith(close)) return null;
  const inner = normalized.slice(open.length, normalized.length - close.length);
  if (inner.includes(FENCE_OPEN) || inner.includes(FENCE_CLOSE)) return null;
  return inner;
}
