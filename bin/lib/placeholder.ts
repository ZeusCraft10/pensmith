// bin/lib/placeholder.ts — recognise text that no model wrote.
//
// PENSMITH_NO_LLM=1 replaces every generation with a fixed placeholder so the
// pipeline can run without a key (tests, demos). That text must never be
// verified, compiled or exported as if it were a paper. Verbs that save a
// placeholder flag the file with `placeholder: true` frontmatter; the gates
// also recognise the placeholder text itself, because older runs saved it
// without the flag.

import { existsSync, readFileSync } from 'node:fs';
import { parseFrontmatter, updateFrontmatter } from './frontmatter.js';

/** How every PENSMITH_NO_LLM placeholder starts. */
export const NO_LLM_PLACEHOLDER_PREFIX = '[PENSMITH_NO_LLM placeholder';

/** The placeholder complete() returns for a prompt under PENSMITH_NO_LLM. */
export function noLlmPlaceholderText(lastUserMessage: string): string {
  return `${NO_LLM_PLACEHOLDER_PREFIX} — ${lastUserMessage.slice(0, 80)}]`;
}

/** `text` with `placeholder: true` added to its frontmatter (created if absent). */
export function markPlaceholder(text: string): string {
  return updateFrontmatter(text, (fm) => {
    fm['placeholder'] = true;
  });
}

/** True when `text` is placeholder output: flagged, or containing placeholder text. */
export function isPlaceholderText(text: string): boolean {
  if (text.includes(NO_LLM_PLACEHOLDER_PREFIX)) return true;
  try {
    return parseFrontmatter(text).frontmatter['placeholder'] === true;
  } catch {
    // A body that merely starts with a `---` rule is not frontmatter.
    return false;
  }
}

/** True when the file at `p` exists and holds placeholder output. */
export function isPlaceholderFile(p: string): boolean {
  return existsSync(p) && isPlaceholderText(readFileSync(p, 'utf8'));
}

/** Text for a saved artifact: flagged when it came from the placeholder path. */
export function artifactText(result: { text: string; placeholder?: boolean }): string {
  return result.placeholder === true ? markPlaceholder(result.text) : result.text;
}
