// bin/lib/prompt-request.ts — the ONE prompt request layout (RUN-26, FEED-05,
// D-18-02, D-18-03).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// Every templates/prompts/<slug>.md is FIXED instruction text: it interpolates
// nothing. A request is
//   system   = loadPrompt(slug) — byte-identical for every call of the slug, so
//              bin/lib/anthropic.ts can mark it with cache_control and every
//              repeat call reads it from the prompt cache (RUN-26);
//   messages = ONE user message holding the per-call data, sent once, as tagged
//              blocks in the order PROMPT_INPUTS declares for the slug:
//
//                <tag>
//                payload
//                </tag>
//
// A payload is text, or JSON (objects and arrays; builders construct them
// field by field in a fixed order, so the bytes are deterministic and a replay
// or cache key never changes between identical calls). An input marked
// `untrusted` — text from outside pensmith and the user: source metadata and
// abstracts, drafts under review, PDF text — is wrapped in the FEED-05 fence
// (untrusted-fence.ts). Every payload is stripped of fence markers, and a
// closing tag of any declared input inside a payload is neutralised, so data
// can neither end its block nor open another one.
//
// Each template's frontmatter lists the same tags (`inputs:`) and its
// "## Inputs" section describes them; tests/prompt-layout.test.ts (Phase 18,
// llm stream) keeps the three in step. Adding or renaming a slug is still a
// D-12 decision; adding or renaming an input tag is a re-pin of the template
// plus an edit of this table.

import { loadPrompt } from './prompt-loader.js';
import { fenceUntrusted, stripFenceMarkers, unfence } from './untrusted-fence.js';
import type { ChatMessage } from './anthropic.js';

/** One data input of a prompt slug. */
export interface PromptInputSpec {
  /** The block tag: lowercase letters, digits and underscores. */
  readonly tag: string;
  /** A required input must be given (an empty value renders as `(none)`). */
  readonly required: boolean;
  /** Text from outside pensmith and the user: fenced (FEED-05). */
  readonly untrusted: boolean;
}

function input(tag: string, required: boolean, untrusted: boolean): PromptInputSpec {
  return Object.freeze({ tag, required, untrusted });
}

/**
 * The data inputs of every prompt slug, in the order they are sent. The keys
 * are exactly the keys of EXPECTED_PROMPT_HASHES (bin/lib/prompt-loader.ts).
 * Payload shapes are specified in .planning/phases/18-ground/18-PLAN.md §3.3.
 */
export const PROMPT_INPUTS: Readonly<Record<string, readonly PromptInputSpec[]>> = Object.freeze({
  'intake-clarifier': [input('disciplines', true, false), input('answers', false, false), input('assignment', true, true)],
  'topic-disambiguator': [input('topic', true, false), input('discipline', true, false), input('assignment', true, true)],
  'source-evaluator': [input('topic', true, false), input('discipline', true, false), input('scope', true, false), input('candidates', true, true)],
  'outline-author': [input('brief', true, false), input('existing_sections', false, false), input('sources', true, true)],
  'section-planner': [input('brief', true, false), input('section', true, false), input('upstream', false, false), input('sources', true, true)],
  'section-drafter': [
    input('brief', true, false),
    input('section', true, false),
    input('voice', true, false),
    input('style_profile', false, false),
    input('plan', true, false),
    input('sources', true, true),
  ],
  'claim-support': [input('citation', true, true), input('claim', true, true), input('abstract', true, true)],
  'orphan-label': [input('paragraph', true, true), input('sentence', true, true)],
  'smoother': [input('boundary', true, false), input('tail', true, true), input('head', true, true)],
  'revise-swap': [input('flag', true, false), input('voice', true, false), input('available_sources', true, true), input('claim', true, true)],
  'pass1-fuzzy-judge': [input('comparison', true, true)],
  'pass3-quote-checker': [input('match', true, false), input('quote', true, true), input('pdf_context', true, true)],
  'tutorial-section-provenance': [input('section', true, false), input('claims', true, true), input('sources', true, true)],
  'tutorial-research-rationale': [input('topic', true, false), input('sources', true, true)],
});

/** A JSON-serialisable payload value. */
export type PromptJson = string | number | boolean | null | readonly PromptJson[] | { readonly [key: string]: PromptJson | undefined };

/** One input's value: text, or a JSON value (rendered with JSON.stringify). */
export type PromptValue = PromptJson;

/** The values of one request, by tag. `undefined` omits an optional input. */
export type PromptValues = Readonly<Record<string, PromptValue | undefined>>;

/** A built request: the fixed system prompt and the one data message. */
export interface PromptRequest {
  readonly slug: string;
  readonly system: string;
  readonly messages: ChatMessage[];
}

export class PromptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptInputError';
  }
}

const TAG_RE = /^[a-z][a-z0-9_]*$/;

/** The declared inputs of `slug` (throws for a slug with no table entry). */
export function promptInputs(slug: string): readonly PromptInputSpec[] {
  const spec = PROMPT_INPUTS[slug];
  if (!spec) throw new PromptInputError(`prompt-request: "${slug}" has no PROMPT_INPUTS entry`);
  return spec;
}

/** Text or JSON → the payload text (JSON.stringify, 2-space indentation, `undefined` members dropped). */
function payloadText(value: PromptValue): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Neutralise `</tag>` for every declared tag, so a payload cannot close a block early. */
function neutraliseClosingTags(text: string, tags: readonly string[]): string {
  let out = text;
  for (const tag of tags) out = out.split(`</${tag}>`).join(`<\\/${tag}>`);
  return out;
}

/**
 * Render the data message for `slug` from `values`: one block per given input,
 * in declared order, separated by a blank line. Throws PromptInputError for an
 * undeclared input or a missing required one.
 */
export function renderPromptBlocks(slug: string, values: PromptValues): string {
  const spec = promptInputs(slug);
  const declared = new Set(spec.map((s) => s.tag));
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      throw new PromptInputError(`prompt-request: "${slug}" has no input "${key}" (inputs: ${[...declared].join(', ')})`);
    }
  }
  const tags = spec.map((s) => s.tag);
  const blocks: string[] = [];
  for (const s of spec) {
    if (!TAG_RE.test(s.tag)) throw new PromptInputError(`prompt-request: invalid tag "${s.tag}" for "${slug}"`);
    const value = values[s.tag];
    if (value === undefined) {
      if (s.required) throw new PromptInputError(`prompt-request: "${slug}" needs input "${s.tag}"`);
      continue;
    }
    let text = payloadText(value);
    if (text.trim().length === 0) text = '(none)';
    text = neutraliseClosingTags(stripFenceMarkers(text), tags);
    const body = s.untrusted ? fenceUntrusted(text) : text;
    blocks.push(`<${s.tag}>\n${body}\n</${s.tag}>`);
  }
  return blocks.join('\n\n');
}

/**
 * Build the request for `slug`: the fixed template as the system prompt and
 * the rendered data blocks as the one user message.
 */
export function buildPromptRequest(slug: string, values: PromptValues): PromptRequest {
  const content = renderPromptBlocks(slug, values);
  return { slug, system: loadPrompt(slug), messages: [{ role: 'user', content }] };
}

/**
 * Parse a rendered data message back into tag → payload text (the fence
 * removed from untrusted inputs). Used by the contract stubs and the mock LLM
 * to read a request the way a model would; never throws. Unknown or malformed
 * blocks are skipped.
 */
export function parsePromptBlocks(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = content.replace(/\r\n/g, '\n');
  const re = /(?:^|\n)<([a-z][a-z0-9_]*)>\n([\s\S]*?)\n<\/\1>(?=\n|$)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const tag = m[1] as string;
    const raw = m[2] ?? '';
    if (out.has(tag)) continue;
    out.set(tag, unfence(raw) ?? raw);
  }
  return out;
}

/** A parsed block as JSON, or undefined when it is absent or not JSON. */
export function promptBlockJson(blocks: ReadonlyMap<string, string>, tag: string): unknown {
  const raw = blocks.get(tag);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A request's data blocks as a hint object for the contract stubs (GRND-19)
 * and the mock LLM (RUN-21): tag → the parsed JSON payload, or the text for a
 * text block. Call sites pass `stubHint: promptHints(req)` so a stubbed call
 * sees exactly what a model would; the mock derives the same object from the
 * request body it receives.
 */
export function promptHints(content: string): Record<string, unknown> {
  const blocks = parsePromptBlocks(content);
  const out: Record<string, unknown> = {};
  for (const [tag, raw] of blocks) {
    const json = promptBlockJson(blocks, tag);
    out[tag] = json === undefined || typeof json !== 'object' || json === null ? raw : json;
  }
  return out;
}

/** promptHints() of a built request's data message. */
export function requestHints(req: PromptRequest): Record<string, unknown> {
  const last = req.messages[req.messages.length - 1];
  return promptHints(last?.content ?? '');
}
