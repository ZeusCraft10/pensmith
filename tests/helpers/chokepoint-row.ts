// tests/helpers/chokepoint-row.ts — reads a scripts/chokepoints/<id>.json row
// and applies it to the repository files in its scope, the way the chokepoint
// rule and harness do:
//   - a text row (its one `file-regex` / literal matcher): a scoped file that is
//     not on the allow list and matches the pattern is a violation;
//   - an `import-graph` row (optionally with `content` and `typeImports`): the
//     rule engine's own walk (scripts/eslint-rules/chokepoint.mjs
//     importGraphViolations) over the real in-scope modules, with optional
//     in-memory overrides so a test can prove the row fires on a mutated module.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPO } from './paper-cli-harness.js';
import { importGraphViolations, type ChokepointKind, type ImportGraphViolation } from '../../scripts/eslint-rules/chokepoint.mjs';

export interface ChokepointMatcher {
  kind: string;
  pattern: string;
  flags?: string;
  /** import-graph only: a regex source the reached module's raw text must match too. */
  content?: string;
  /** import / import-graph: type-only imports are exempt (not followed). */
  typeImports?: 'allow';
}

export interface ChokepointRow {
  id: string;
  requirement: string;
  module: string;
  description: string;
  scope: string[];
  allow: string[];
  /** The helper serves one-matcher rows (a row file may list several; matcherOf() refuses those). */
  match: ChokepointMatcher;
  fixture: string;
  /** Where the harness reads the fixture (tests/chokepoints.test.ts). */
  fixturePath?: string;
}

export function loadChokepointRow(id: string): ChokepointRow {
  const row = JSON.parse(readFileSync(join(REPO, 'scripts', 'chokepoints', `${id}.json`), 'utf8')) as ChokepointRow;
  return { ...row, allow: row.allow ?? [] };
}

/** The row's one matcher; throws for a row file that lists several. */
export function matcherOf(row: ChokepointRow): ChokepointMatcher {
  const m: unknown = row.match;
  if (Array.isArray(m)) throw new Error(`chokepoint row ${row.id}: lists ${m.length} matchers; this helper applies one-matcher rows`);
  return row.match;
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

/** The pattern of a text row's matcher (an import-graph row is walked with graphViolations instead). */
export function rowPattern(row: ChokepointRow): RegExp {
  const m = matcherOf(row);
  if (m.kind === 'import-graph') throw new Error(`chokepoint row ${row.id}: an import-graph row — use graphViolations`);
  return new RegExp(m.pattern, m.flags ?? '');
}

/** Scoped, non-allowed files whose text matches the row's pattern. */
export function violations(row: ChokepointRow, files: string[] = scopedFiles(row)): string[] {
  const re = rowPattern(row);
  return files.filter((f) => !isAllowed(row, f) && re.test(readFileSync(join(REPO, f), 'utf8')));
}

/**
 * An import-graph row applied to the real tree: every in-scope module that
 * reaches a violating module, with its chain. `overrides` maps repo-relative
 * paths to replacement text (the file need not exist), so a test can show the
 * row fires once a reachable module is mutated.
 */
export function graphViolations(row: ChokepointRow, overrides: Readonly<Record<string, string>> = {}): ImportGraphViolation[] {
  const m = matcherOf(row);
  if (m.kind !== 'import-graph') throw new Error(`chokepoint row ${row.id}: not an import-graph row — use violations`);
  const byAbs = new Map(Object.entries(overrides).map(([rel, text]) => [join(REPO, ...rel.split('/')), text]));
  return importGraphViolations(
    { ...row, match: { ...m, kind: m.kind as ChokepointKind } },
    scopedFiles(row),
    {
      read: (f) => byAbs.get(f) ?? readFileSync(f, 'utf8'),
      exists: (f) => byAbs.has(f) || existsSync(f),
      root: REPO,
    },
  );
}
