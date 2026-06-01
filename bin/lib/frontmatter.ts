// bin/lib/frontmatter.ts — round-trip-safe YAML frontmatter helper.
//
// Phase 3 Plan 03-03 Task 3.4 (CYCLE-2 H-1 REVIEWS CONVERGENCE — moved from
// Plan 08 to Wave 2 so Task 3.2 D-09 migration has a real import target).
//
// Three exports:
//   - parseFrontmatter(text): split a markdown document into { frontmatter, body }
//   - serializeFrontmatter(fm): emit `---\n<yaml>\n---\n` from a plain JS object
//   - updateFrontmatter(text, mutator): in-place mutator on the LIVE yaml@^2
//     Document via a Proxy whose set/deleteProperty traps route through
//     doc.set / doc.delete. This preserves:
//       - comments adjacent to surviving keys
//       - key order
//       - key DELETION (CYCLE-1 REVIEWS CONVERGENCE — the naïve
//         "Object.entries(json) → doc.set" pattern silently keeps deleted keys
//         because they never appear in the JSON projection)
//
// Pure function: NO filesystem I/O. Callers persist the returned string via
// bin/lib/atomic-write.ts atomicWriteFile (D-07 LOCKED chokepoint).

import { parseDocument, type Document } from 'yaml';

// Frontmatter delimiter regex — accepts \n or \r\n line endings.
// Group 1: the YAML body between the --- fences. Group 2: the markdown body
// after the trailing fence (including any leading newline, which we keep so
// `---\n` + body round-trips byte-for-byte when no edits occur).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(
  text: string,
): { frontmatter: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const doc = parseDocument(match[1] ?? '');
  const json = doc.toJSON();
  return {
    frontmatter: (json && typeof json === 'object' ? (json as Record<string, unknown>) : {}),
    body: match[2] ?? '',
  };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const doc = parseDocument('');
  for (const [k, v] of Object.entries(frontmatter)) {
    doc.set(k, v);
  }
  return `---\n${doc.toString()}---\n`;
}

/**
 * Round-trip-safe AND deletion-safe frontmatter mutator.
 *
 * The mutator receives a Proxy whose every set / deleteProperty call routes
 * through the LIVE yaml@^2 Document (doc.set / doc.delete) — NOT through a
 * JSON projection. This preserves:
 *   - comments adjacent to surviving keys (yaml@^2 Document API contract)
 *   - key order (yaml@^2 preserves source order on set; new keys are appended)
 *   - key DELETION via `delete fm.key` (CYCLE-1 REVIEWS CONVERGENCE —
 *     Gemini/OpenCode MEDIUM "frontmatter helper key-deletion preservation")
 *
 * Returns the new full markdown string. If the input had no frontmatter,
 * the output begins with a fresh `---\n…\n---\n` followed by the original
 * body unchanged.
 */
export function updateFrontmatter(
  text: string,
  mutator: (fm: Record<string, unknown>) => void,
): string {
  const match = FRONTMATTER_RE.exec(text);
  const doc: Document = match ? parseDocument(match[1] ?? '') : parseDocument('');
  const body = match ? (match[2] ?? '') : text;

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_t, prop): unknown {
      if (typeof prop !== 'string') return undefined;
      return doc.get(prop);
    },
    set(_t, prop, value): boolean {
      if (typeof prop !== 'string') return false;
      doc.set(prop, value);
      return true;
    },
    deleteProperty(_t, prop): boolean {
      if (typeof prop !== 'string') return false;
      doc.delete(prop); // live-Document deletion — adjacent comments survive
      return true;
    },
    has(_t, prop): boolean {
      if (typeof prop !== 'string') return false;
      return doc.has(prop);
    },
    ownKeys(): string[] {
      const json = doc.toJSON();
      if (!json || typeof json !== 'object') return [];
      return Object.keys(json as Record<string, unknown>);
    },
    getOwnPropertyDescriptor(_t, prop): PropertyDescriptor | undefined {
      if (typeof prop !== 'string') return undefined;
      if (!doc.has(prop)) return undefined;
      return { enumerable: true, configurable: true, value: doc.get(prop) };
    },
  });

  mutator(proxy);

  return `---\n${doc.toString()}---\n${body}`;
}
