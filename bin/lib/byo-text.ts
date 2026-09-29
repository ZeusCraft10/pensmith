// bin/lib/byo-text.ts — the ONLY way to read a bring-your-own PDF's text
// (SRC-15, D-19-21; S-17 "the gate trusts only what it recomputes").
//
// A BYO source's text can make a Pass-3 quote verdict pass (VRFY-19, Phase
// 20) and tells the drafter that direct quotes are possible (GRND-14). Files
// in `.paper/` are inputs to check, never evidence (S-17): `.paper/` may sit in
// a synced folder, be edited by hand, or be copied from someone else. So:
//
//   1. The PDF at `.paper/<byo.file>` (always under `.paper/sources/`) is
//      re-hashed; a sha256 that differs from LIBRARY.json's `byo.sha256` makes
//      the text UNAVAILABLE ("PDF changed since ingest") — never trusted.
//   2. The text is served from a cache in the pensmith DATA dir (outside the
//      paper, keyed by the PDF's sha256) only when the cached text's sha256
//      equals the recorded `byo.text_sha256`; otherwise the PDF is extracted
//      again (in the SEC-02 worker) and its text must hash to `text_sha256`.
//   3. A loose `.paper/sources/<citekey>.txt` is never read: nothing here even
//      looks for one.
//   4. A PDF the user attached to a registrar record although its first page
//      does not show that work (`byo.asserted`, the `pdf-attach-unmatched`
//      gate of `add <id> --pdf`) is never evidence: its text is unavailable.
//
// Consumers: Pass 3 checks a quote against this text first (verify, and the
// compile / done recomputation re-run it — every read re-hashes the PDF);
// Pass 2 gives the claim-support judge the passages of it nearest the claim
// (byoPassages); GRND-14's full-text flag reads the same record through
// full-text.ts.

import { replaceCitationClusters } from './citation-token.js';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { extractPdf } from './pdf-text.js';
import { libraryPaths } from './library.js';
import { pensmithDataDir } from './paths.js';
import type { LibraryEntry } from './schemas/library.js';

export type ByoTextResult =
  | {
      readonly available: true;
      readonly text: string;
      /** The PDF's path. */
      readonly file: string;
      readonly sha256: string;
      /** True when the verified text came from the data-dir cache. */
      readonly fromCache: boolean;
    }
  | {
      readonly available: false;
      /** One line: why the text cannot be used. */
      readonly reason: string;
      /**
       * Why, as a code. `missing`, `changed` and `outside` mean the recorded
       * copy of the user's own PDF is no longer what was ingested — Pass 3 then
       * blocks the quote (it was checkable, and editing or moving a local file
       * must never turn a verdict into a pass); the others mean the copy never
       * had usable text (`none`, `asserted`, `no-text`) or it cannot be read
       * the same way now (`unreadable`, `text-mismatch`).
       */
      readonly code: ByoUnavailableCode;
      readonly file: string | null;
    };

export type ByoUnavailableCode = 'none' | 'asserted' | 'outside' | 'missing' | 'changed' | 'no-text' | 'unreadable' | 'text-mismatch';

/** True when the unavailable code means the recorded copy was moved, deleted or edited since ingest. */
export function byoCopyAltered(code: ByoUnavailableCode): boolean {
  return code === 'missing' || code === 'changed' || code === 'outside';
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The data-dir text cache (outside every paper, keyed by PDF sha256). */
export function byoTextCacheDir(): string {
  return path.join(pensmithDataDir(), 'byo-text');
}

function cacheFile(pdfSha256: string): string {
  return path.join(byoTextCacheDir(), `${pdfSha256}.txt`);
}

/**
 * Cache `text` for the PDF with sha256 `pdfSha256` (ingest calls it right
 * after extraction). Best-effort: a cache that cannot be written only means
 * the next read re-extracts.
 */
export async function writeByoTextCache(pdfSha256: string, text: string): Promise<void> {
  try {
    await atomicWriteFile(cacheFile(pdfSha256), text);
  } catch {
    /* best-effort */
  }
}

/** `.paper/sources/` of the paper at `root`. */
export function byoSourcesDir(root: string): string {
  return path.join(libraryPaths(root).dir, 'sources');
}

/** The PDF's absolute path when `file` (a `.paper/`-relative path) lies inside `.paper/sources/`, else null. */
export function resolveByoFile(root: string, file: string): string | null {
  const paperDir = libraryPaths(root).dir;
  const abs = path.resolve(paperDir, file);
  const rel = path.relative(byoSourcesDir(root), abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * The verified text of a bring-your-own PDF, or why it is unavailable (see
 * the header). Never throws for a missing, changed or unreadable PDF.
 */
export async function byoText(root: string, entry: Pick<LibraryEntry, 'citekey' | 'byo'>): Promise<ByoTextResult> {
  const byo = entry.byo;
  if (byo === null) return { available: false, reason: `${entry.citekey} has no bring-your-own PDF`, code: 'none', file: null };
  if (byo.asserted === true) {
    return {
      available: false,
      reason: `${byo.file} was attached although its first page does not show this work, so its text is not used as evidence`,
      code: 'asserted',
      file: null,
    };
  }
  const file = resolveByoFile(root, byo.file);
  if (file === null) {
    return { available: false, reason: `the recorded PDF path ${byo.file} is outside .paper/sources/`, code: 'outside', file: null };
  }
  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(file);
  } catch {
    return { available: false, reason: `the PDF ${byo.file} is missing`, code: 'missing', file };
  }
  if (sha256Hex(bytes) !== byo.sha256) {
    return { available: false, reason: `PDF changed since ingest (${byo.file} no longer matches its recorded sha256)`, code: 'changed', file };
  }
  if (byo.text_sha256 === null) {
    return { available: false, reason: `no extractable text in ${byo.file} (an image-only or scanned PDF)`, code: 'no-text', file };
  }
  try {
    const cached = await fsp.readFile(cacheFile(byo.sha256), 'utf8');
    if (sha256Hex(cached) === byo.text_sha256) {
      return { available: true, text: cached, file, sha256: byo.sha256, fromCache: true };
    }
  } catch {
    /* no cache entry — extract below */
  }
  let text: string;
  try {
    const ex = await extractPdf(bytes);
    if (ex.imageOnly) return { available: false, reason: `no extractable text in ${byo.file}`, code: 'no-text', file };
    text = ex.text;
  } catch (e) {
    return { available: false, reason: `the PDF ${byo.file} could not be read (${(e as Error).message.split('\n')[0]})`, code: 'unreadable', file };
  }
  if (sha256Hex(text) !== byo.text_sha256) {
    return { available: false, reason: `the text extracted from ${byo.file} does not match its recorded hash`, code: 'text-mismatch', file };
  }
  await writeByoTextCache(byo.sha256, text);
  return { available: true, text, file, sha256: byo.sha256, fromCache: false };
}

// ---------------------------------------------------------------------------
// Passages for the claim-support judge (Pass 2).
// ---------------------------------------------------------------------------

/** How much of a bring-your-own text Pass 2 sends with one claim. */
export const BYO_PASSAGE_CHARS = 2400;
const PASSAGE_WINDOW = 600;

const STOP = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'which', 'their', 'have', 'has', 'been',
  'not', 'but', 'its', 'can', 'than', 'these', 'those', 'into', 'more', 'most', 'such', 'also', 'they', 'them', 'our',
]);

function words(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * The passages of a bring-your-own text that share the most content words with
 * `claim` — deterministic, in document order, at most `maxChars` in all (the
 * judge sees what the source says about the claim, not the whole PDF).
 */
export function byoPassages(text: string, claim: string, maxChars: number = BYO_PASSAGE_CHARS): string {
  // The claim's own words: every citation cluster out (citation-token.ts, the one citation grammar).
  const want = new Set(words(replaceCitationClusters(claim, () => ' ')));
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const windows: Array<{ start: number; text: string; score: number }> = [];
  for (let start = 0; start < flat.length; start += PASSAGE_WINDOW / 2) {
    const chunk = flat.slice(start, start + PASSAGE_WINDOW);
    let score = 0;
    for (const w of new Set(words(chunk))) if (want.has(w)) score += 1;
    windows.push({ start, text: chunk, score });
    if (start + PASSAGE_WINDOW >= flat.length) break;
  }
  const picked: Array<{ start: number; text: string }> = [];
  let used = 0;
  for (const w of [...windows].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (w.score === 0 || used + w.text.length > maxChars) continue;
    if (picked.some((p) => Math.abs(p.start - w.start) < PASSAGE_WINDOW)) continue;
    picked.push(w);
    used += w.text.length;
  }
  if (picked.length === 0) return flat.slice(0, maxChars);
  return picked
    .sort((a, b) => a.start - b.start)
    .map((p) => p.text.trim())
    .join(' … ');
}
