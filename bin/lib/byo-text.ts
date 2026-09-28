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
//
// Pass 2 / Pass 3 and the compile / done recomputation consume byoText in
// Phase 20 (VRFY-19); GRND-14 uses the recorded hash through full-text.ts.

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
      readonly file: string | null;
    };

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
  if (byo === null) return { available: false, reason: `${entry.citekey} has no bring-your-own PDF`, file: null };
  const file = resolveByoFile(root, byo.file);
  if (file === null) {
    return { available: false, reason: `the recorded PDF path ${byo.file} is outside .paper/sources/`, file: null };
  }
  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(file);
  } catch {
    return { available: false, reason: `the PDF ${byo.file} is missing`, file };
  }
  if (sha256Hex(bytes) !== byo.sha256) {
    return { available: false, reason: `PDF changed since ingest (${byo.file} no longer matches its recorded sha256)`, file };
  }
  if (byo.text_sha256 === null) {
    return { available: false, reason: `no extractable text in ${byo.file} (an image-only or scanned PDF)`, file };
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
    if (ex.imageOnly) return { available: false, reason: `no extractable text in ${byo.file}`, file };
    text = ex.text;
  } catch (e) {
    return { available: false, reason: `the PDF ${byo.file} could not be read (${(e as Error).message.split('\n')[0]})`, file };
  }
  if (sha256Hex(text) !== byo.text_sha256) {
    return { available: false, reason: `the text extracted from ${byo.file} does not match its recorded hash`, file };
  }
  await writeByoTextCache(byo.sha256, text);
  return { available: true, text, file, sha256: byo.sha256, fromCache: false };
}
