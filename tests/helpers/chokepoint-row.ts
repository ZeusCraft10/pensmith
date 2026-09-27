// tests/helpers/chokepoint-row.ts — reads a scripts/chokepoints/<id>.json row
// and applies its `file-regex` match to the repository files in its scope, the
// way the chokepoint rule does: a scoped file that is not on the allow list
// and matches the pattern is a violation.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPO } from './paper-cli-harness.js';

export interface ChokepointRow {
  id: string;
  requirement: string;
  module: string;
  description: string;
  scope: string[];
  allow: string[];
  match: { kind: string; pattern: string };
  fixture: string;
}

export function loadChokepointRow(id: string): ChokepointRow {
  return JSON.parse(readFileSync(join(REPO, 'scripts', 'chokepoints', `${id}.json`), 'utf8')) as ChokepointRow;
}

// Glob → RegExp for the subset the rows use: `**` spans directories, `*`
// stays inside one segment. Paths are compared in POSIX form.
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function walk(dir: string, into: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, into);
    else into.push(relative(REPO, full).split(sep).join('/'));
  }
}

/** Repository files (POSIX-relative) inside the row's scope. */
export function scopedFiles(row: ChokepointRow): string[] {
  const scope = row.scope.map(globToRegExp);
  const tops = new Set(row.scope.map((g) => g.split('/')[0]!));
  const files: string[] = [];
  for (const top of tops) walk(join(REPO, top), files);
  return files.filter((f) => scope.some((re) => re.test(f))).sort();
}

export function isAllowed(row: ChokepointRow, file: string): boolean {
  return row.allow.some((g) => globToRegExp(g).test(file));
}

export function rowPattern(row: ChokepointRow): RegExp {
  return new RegExp(row.match.pattern);
}

/** Scoped, non-allowed files whose text matches the row's pattern. */
export function violations(row: ChokepointRow, files: string[] = scopedFiles(row)): string[] {
  const re = rowPattern(row);
  return files.filter((f) => !isAllowed(row, f) && re.test(readFileSync(join(REPO, f), 'utf8')));
}
