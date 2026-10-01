// bin/lib/untrusted-fence.ts — the ONE untrusted-data fence (FEED-05, D-18-04).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copied it byte-identically from
// .planning/phases/18-ground/seams/; after the streams merged, review round 2
// made the marker scan linear-time (stripFenceMarkers).
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
 * The name at the heart of every marker spelling: the exact markers, other
 * UUIDs, lower case, `_`, `-` or whitespace between the words, an `END`
 * prefix. Quantifiers are BOUNDED (T-01-REDOS, pii.ts): the old
 * `<{1,}\s*\/?\s*(?:END…)?PENSMITH…` pattern backtracked quadratically on a long
 * run of `<` or of whitespace (a crafted abstract stalled verify for minutes;
 * review round 2). The brackets around a name are found by scanning outward
 * from each match instead, which is linear.
 */
const NAME_RE = /(?:END[_\s-]{0,32})?PENSMITH[_\s-]{0,32}UNTRUSTED[_\s-]{0,32}DATA/gi;

/** A UUID-ish suffix after a bare marker name (`…_DATA_7f3a…`). */
const BARE_SUFFIX_RE = /^_[0-9a-f-]{8,36}/i;

/**
 * Neutralise every fence marker (and bare marker name) in `text`, so it can be
 * fenced without being able to end the fence early or open a second one. A
 * name with `<` before it (whitespace and `/` may sit between) is a bracketed
 * marker: from its first `<` to the end of its line's text and its closing
 * `>`s. A name without one is a bare name (with any UUID suffix). Linear time.
 */
export function stripFenceMarkers(text: string): string {
  let out = '';
  let at = 0;
  for (const m of text.matchAll(NAME_RE)) {
    let start = m.index;
    if (start < at) continue; // inside the previous marker
    let end = start + m[0].length;
    let i = start;
    while (i > at && /[\s/]/.test(text[i - 1] as string)) i -= 1;
    let j = i;
    while (j > at && text[j - 1] === '<') j -= 1;
    if (j < i) {
      // Bracketed: `<…< [/] NAME …>…>` up to the end of the line's text.
      start = j;
      while (end < text.length && !/[\r\n<>]/.test(text[end] as string)) end += 1;
      while (end < text.length && text[end] === '>') end += 1;
    } else {
      end += BARE_SUFFIX_RE.exec(text.slice(end, end + 37))?.[0].length ?? 0;
    }
    out += text.slice(at, start) + FENCE_MARKER_REPLACEMENT;
    at = end;
  }
  return out + text.slice(at);
}

/**
 * How many fence markers `text` holds: every spelling of a marker name (the
 * exact markers, other UUIDs, any case or separator) and every neutralised
 * marker. A model reply that holds more than the text it was given echoed the
 * fence (rewrite-guard.ts); an export that holds one carries a pensmith
 * artifact (export/zero-trace.ts). Linear time.
 */
export function fenceMarkerCount(text: string): number {
  return [...text.matchAll(NAME_RE)].length + text.split(FENCE_MARKER_REPLACEMENT).length - 1;
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
