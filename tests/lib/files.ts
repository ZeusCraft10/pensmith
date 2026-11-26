// tests/lib/files.ts
//
// The one recursive file walker the tests share. Callers differ only in which
// files they keep and which directories they skip.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface FilesUnderOptions {
  /** Keep a file when this returns true for its name. Default: every file. */
  keep?: (name: string) => boolean;
  /** Names of directories not to descend into, at any depth. */
  skipDirs?: readonly string[];
}

/** Absolute paths of the files under `dir`, at any depth. */
export function filesUnder(dir: string, opts: FilesUnderOptions = {}): string[] {
  const { keep = () => true, skipDirs = [] } = opts;
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) out.push(...filesUnder(full, opts));
    } else if (keep(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every file under `dir`, by its path relative to `dir`, mapped to the SHA-256 of its bytes. */
export function fileHashes(dir: string): Map<string, string> {
  return new Map(filesUnder(dir).map((f) => [path.relative(dir, f), createHash('sha256').update(readFileSync(f)).digest('hex')]));
}
