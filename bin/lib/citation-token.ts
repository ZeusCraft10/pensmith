/**
 * bin/lib/citation-token.ts
 * 
 * Shared helpers for Pandoc citation tokens [@citekey].
 */

export const CITATION_TOKEN_RE = /\[@([a-z][a-z0-9_-]*)\]/g;

/**
 * Extract all unique citekeys from markdown text.
 * Preserves first-appearance order.
 */
export function extractCitekeys(md: string): string[] {
  const keys = new Set<string>();
  const matches = md.matchAll(CITATION_TOKEN_RE);
  for (const match of matches) {
    if (match[1]) keys.add(match[1]);
  }
  return Array.from(keys);
}

/**
 * Replace every [@citekey] token in markdown text via a callback.
 */
export function replaceCitekeys(md: string, fn: (key: string) => string): string {
  return md.replace(CITATION_TOKEN_RE, (_match, key) => {
    return fn(key);
  });
}
