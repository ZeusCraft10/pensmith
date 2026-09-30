// Type declarations for scripts/eslint-rules/chokepoint.mjs (RUN-29), so the
// strict TypeScript tests (tests/chokepoints.test.ts) can import the harness.

export type ChokepointKind = 'string-literal' | 'import' | 'call' | 'member' | 'file-regex' | 'import-graph' | 'regex-literal';

export interface ChokepointMatcher {
  kind: ChokepointKind;
  pattern: string;
  flags?: string;
  names?: string;
  typeImports?: 'allow';
  arg?: { index?: number; pattern: string };
}

export interface ChokepointRow {
  id: string;
  requirement: string;
  module: string;
  description: string;
  scope: string[];
  allow?: string[];
  match: ChokepointMatcher | ChokepointMatcher[];
  fixture: string;
  baseline?: Record<string, number>;
}

export interface ImportGraphViolation {
  row: string;
  entry: string;
  reached: string;
  chain: string[];
}

export const REPO_ROOT: string;
export const CHOKEPOINT_DIR: string;
export const MATCH_KINDS: readonly ChokepointKind[];
export function globToRegExp(glob: string): RegExp;
export function matchesAny(rel: string, globs: readonly string[] | undefined): boolean;
export function toRepoRelative(file: string, root?: string, p?: typeof import('node:path')): string;
export function fromRepoRelative(rel: string, root?: string, p?: typeof import('node:path')): string;
export function matchersOf(row: ChokepointRow): ChokepointMatcher[];
export function loadChokepointRows(dir?: string): ChokepointRow[];
export function validateRow(row: unknown, fileName?: string): string[];
export function rowsForFile(rows: readonly ChokepointRow[], rel: string): ChokepointRow[];
export function fileRegexMatches(matcher: ChokepointMatcher, text: string): Array<{ index: number; text: string }>;
export function relativeImports(text: string): string[];
export function resolveImport(
  fromFile: string,
  spec: string,
  exists: (abs: string) => boolean,
  p?: typeof import('node:path'),
): string | null;
export function importGraphViolations(
  row: ChokepointRow,
  entries: readonly string[],
  io: { read(abs: string): string; exists(abs: string): boolean; root?: string; path?: typeof import('node:path') },
): ImportGraphViolation[];

/** The static text(s) of a RegExp pattern argument (an ESTree node), or [] when not static. */
export function staticPatternTexts(node: unknown, sourceCode: unknown, context: unknown, depth?: number): string[];

declare const rule: {
  meta: Record<string, unknown>;
  create(context: unknown): Record<string, (node: unknown) => void>;
};
export default rule;
