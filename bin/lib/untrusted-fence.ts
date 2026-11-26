// bin/lib/untrusted-fence.ts — text from outside goes into a prompt as data.
//
// Titles and abstracts come from registries anyone can publish to, and a
// draft's sentences from a model that read them. A prompt that shows such
// text puts it between two marker lines and tells the model that what lies
// between them is data, not instructions. The markers are in this public
// source, so the text is first stripped of anything that could pass for one:
// the marker's name, and any run of three or more angle brackets.
//
// Every value interpolated into a prompt goes through one of the prompt*
// helpers below, which also escape template tokens (intake-parse.ts).
//
// The markers are the ones the claim-support and orphan-label prompts name
// (verify/pass2.ts and verify/pass4.ts import them from here).

import { escapeTemplateTokens } from './intake-parse.js';

const FENCE_ID = '7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a';
export const FENCE_OPEN = `<<<PENSMITH_UNTRUSTED_DATA_${FENCE_ID}>>>`;
export const FENCE_CLOSE = `<<<END_PENSMITH_UNTRUSTED_DATA_${FENCE_ID}>>>`;

/** `text` with nothing left that could open or close a fence. */
function stripFenceMarkers(text: string): string {
  return text
    .replace(/PENSMITH_UNTRUSTED_DATA/gi, '[marker removed]')
    .replace(/<{3,}/g, '<<')
    .replace(/>{3,}/g, '>>');
}

/** `text` as a plain prompt value: stripped of fence markers, template tokens escaped. */
export function promptText(text: string): string {
  return escapeTemplateTokens(stripFenceMarkers(text));
}

/** `text`, stripped, between the fence's marker lines, template tokens escaped. */
export function promptFenced(text: string): string {
  return escapeTemplateTokens(`${FENCE_OPEN}\n${stripFenceMarkers(text)}\n${FENCE_CLOSE}`);
}

/** `value` as indented JSON inside the fence (promptFenced). */
export function fencedJson(value: unknown): string {
  return promptFenced(JSON.stringify(value, null, 2));
}
