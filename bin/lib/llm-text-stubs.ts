// bin/lib/llm-text-stubs.ts — deterministic, contract-valid stubs for the TEXT
// prompt slugs (GRND-19 stub half, D-18-06; RUN-04 LLM-stubbed mode, RUN-21).
//
// Under PENSMITH_NO_LLM=1 (and --dry-run, which sets it) complete() returns
// textStub(slug, messages) for every slug without a structured contract, and
// the RUN-21 mock LLM serves the same text as its default reply — one source of
// stub truth, like the structured stubs in llm-stubs.ts.
//
// A stub reads the request the way a model would: the data blocks of the
// request's user message (prompt-request.ts promptHints), optionally merged
// with the caller's stubHint. Each stub satisfies the contract its consumer
// checks:
//   - section-drafter: Markdown paragraphs (no heading, no frontmatter) whose
//     prose runs to the section's word target ±20%, citing EVERY assigned
//     citekey at least once as a bare `[@citekey]` token and nothing else —
//     no citation at all when none is assigned — and never quoting (no double
//     quotes, no block quotes), so Pass 3 has nothing to check and the
//     containment check (FEED-04) passes;
//   - smoother: the boundary passed through unchanged (the placeholder token
//     set is preserved by construction);
//   - revise-swap: a valid strict-JSON `remove` recommendation for the flagged
//     citekey (revise.ts ReviseSwapSchema);
//   - tutorial-section-provenance / tutorial-research-rationale: short text,
//     one labelled line per source.
//
// The prose lives in templates/stubs/text-stubs.json (shipped with templates/);
// this module only assembles it. Untrusted text from the request (titles,
// topics, claims) is reduced to plain words before it is echoed, and only
// citekeys matching the citekey grammar are ever emitted as citations, so a
// crafted source record can neither inject a citation nor open a quote.
//
// These replace Phase 17's fixed placeholder-string reply for text slugs, which
// no consumer could use (a draft that cited nothing, an unparseable swap).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CITEKEY_RE } from './citekey.js';
import { promptHints } from './prompt-request.js';

/** A conversation turn as complete() receives it (structurally ChatMessage). */
export interface StubMessage {
  readonly role: string;
  readonly content: string;
}

/** The renderer's marker for an empty payload (prompt-request.ts renderPromptBlocks). */
const EMPTY_PAYLOAD = '(none)';

// ---------------------------------------------------------------------------
// The prose data file
// ---------------------------------------------------------------------------

function findPkgRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i += 1) {
    try {
      readFileSync(path.join(cur, 'package.json'));
      return cur;
    } catch {
      // keep walking up
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return start;
}

/** The packaged stub prose (shipped through package.json `files` → templates/). */
export const TEXT_STUBS_PATH = path.join(
  findPkgRoot(path.dirname(fileURLToPath(import.meta.url))),
  'templates',
  'stubs',
  'text-stubs.json',
);

const Sentence = z.string().min(1);

const TextStubsFileSchema = z.object({
  $comment: z.string().optional(),
  'section-drafter': z.object({
    default_word_target: z.number().int().positive(),
    opening_with_topic: Sentence,
    opening: Sentence,
    cited: z.array(Sentence).min(1),
    cited_group: Sentence,
    filler: z.array(Sentence).min(1),
    closing: Sentence,
  }).strict(),
  'revise-swap': z.object({ rationale: Sentence }).strict(),
  'tutorial-section-provenance': z.object({
    with_claim: Sentence,
    without_claim: Sentence,
    none: Sentence,
  }).strict(),
  'tutorial-research-rationale': z.object({
    per_source: Sentence,
    coverage: Sentence,
    none: Sentence,
  }).strict(),
}).strict();

type TextStubsFile = z.infer<typeof TextStubsFileSchema>;

let cache: TextStubsFile | null = null;

/** The validated stub prose (read once per process). Throws naming the file when it is malformed. */
export function loadTextStubs(): TextStubsFile {
  if (cache !== null) return cache;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(TEXT_STUBS_PATH, 'utf8')) as unknown;
  } catch (e) {
    throw new Error(`llm-text-stubs: cannot read ${TEXT_STUBS_PATH} (${(e as Error).message})`);
  }
  const parsed = TextStubsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`llm-text-stubs: ${TEXT_STUBS_PATH} is invalid (${first?.path.join('.') ?? ''}: ${first?.message ?? 'schema mismatch'})`);
  }
  for (const s of parsed.data['section-drafter'].cited) {
    if (!s.includes('{cite}')) throw new Error(`llm-text-stubs: every section-drafter "cited" sentence needs a {cite} slot (${s})`);
  }
  cache = parsed.data;
  return cache;
}

/** Replace every `{name}` slot; a slot with no value is a programming error. */
function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`llm-text-stubs: no value for {${name}} in "${template}"`);
    return v;
  });
}

// ---------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------

/**
 * The data blocks of a request as a hint object: promptHints() of the LAST
 * user message that carries blocks (a corrective retry ends with a plain
 * correction turn), or {} when no message does.
 */
export function hintsFromMessages(messages: readonly StubMessage[]): Record<string, unknown> {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m === undefined || m.role !== 'user') continue;
    const hints = promptHints(m.content);
    if (Object.keys(hints).length > 0) return hints;
  }
  return {};
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A text payload (the renderer's empty marker counts as absent). */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t !== EMPTY_PAYLOAD ? t : null;
}

/** Citekeys from a list of source records ({citekey}) or bare strings, grammar-checked, deduplicated, in order. */
function citekeysOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const key = typeof item === 'string' ? item : asRecord(item)?.['citekey'];
    if (typeof key === 'string' && CITEKEY_RE.test(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Untrusted text reduced to plain words before it is echoed: letters, digits,
 * whitespace and light punctuation only (no brackets, braces, `@`, quotes,
 * Markdown markers), whitespace collapsed, cut at a word boundary.
 */
function plainWords(s: string, max = 80): string {
  const cleaned = s.replace(/[^\p{L}\p{N}\s,.;:()\-/&]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/** Words of prose, citation tokens excluded — the measure the word target applies to. */
export function proseWordCount(md: string): number {
  return md.replace(/\[@[^\]]*\]/g, ' ').split(/\s+/).filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// section-drafter
// ---------------------------------------------------------------------------

/** A usable word target: the section's own, else the data file default. */
function wordTargetOf(section: Record<string, unknown> | null, fallback: number): number {
  const v = section?.['word_target'] ?? section?.['estimated_word_count'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.round(v) : fallback;
}

function drafterStub(hints: Record<string, unknown>): string {
  const prose = loadTextStubs()['section-drafter'];
  const section = asRecord(hints['section']);
  const brief = asRecord(hints['brief']);
  const target = wordTargetOf(section, prose.default_word_target);
  const lower = Math.ceil(target * 0.8);
  const upper = Math.floor(target * 1.2);
  const keys = citekeysOf(hints['sources']);

  const title = plainWords(text(section?.['title']) ?? text(section?.['slug']) ?? 'this part of the paper');
  const topic = text(brief?.['topic']);
  const opening = topic !== null
    ? fill(prose.opening_with_topic, { title, topic: plainWords(topic) })
    : fill(prose.opening, { title });

  // Every assigned citekey is cited once, in its own sentence; when that would
  // overrun the word target, the keys share one grouped sentence instead.
  let cited = keys.map((k, i) => fill(prose.cited[i % prose.cited.length] as string, { cite: `[@${k}]` }));
  const words = (list: readonly string[]): number => list.reduce((a, s) => a + proseWordCount(s), 0);
  const closing = prose.closing;
  if (keys.length > 1 && words([opening, ...cited, closing]) > upper) {
    cited = [fill(prose.cited_group, { cites: keys.map((k) => `[@${k}]`).join(' ') })];
  }

  // Filler sentences (uncited, never claiming a finding) bring the prose to
  // the target: the longest one that still fits under the upper bound, in a
  // fixed rotation, until the lower bound is reached.
  const filler: string[] = [];
  let total = words([opening, ...cited, closing]);
  let turn = 0;
  while (total < lower) {
    let picked: string | null = null;
    for (let j = 0; j < prose.filler.length; j += 1) {
      const candidate = prose.filler[(turn + j) % prose.filler.length] as string;
      if (total + proseWordCount(candidate) <= upper) {
        picked = candidate;
        turn = (turn + j + 1) % prose.filler.length;
        break;
      }
    }
    if (picked === null) break; // no sentence fits: the closest reachable length
    filler.push(picked);
    total += proseWordCount(picked);
  }

  // Spread the cited sentences evenly through the filler, opening first and
  // closing last, then group into paragraphs of four sentences.
  const body: string[] = [...filler];
  cited.forEach((c, i) => {
    const at = Math.min(body.length, Math.round(((i + 1) * body.length) / (cited.length + 1)) + i);
    body.splice(at, 0, c);
  });
  const sentences = [opening, ...body, closing];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 4) paragraphs.push(sentences.slice(i, i + 4).join(' '));
  if (paragraphs.length > 1 && (sentences.length % 4 === 1)) {
    const last = paragraphs.pop() as string;
    paragraphs[paragraphs.length - 1] = `${paragraphs[paragraphs.length - 1] as string} ${last}`;
  }
  return `${paragraphs.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// smoother, revise-swap, tutorial text
// ---------------------------------------------------------------------------

/** The boundary unchanged: rewritten tail, one blank line, rewritten head. */
function smootherStub(hints: Record<string, unknown>): string {
  const tail = typeof hints['tail'] === 'string' ? (hints['tail'] as string).trim() : '';
  const head = typeof hints['head'] === 'string' ? (hints['head'] as string).trim() : '';
  return [tail, head].filter((p) => p.length > 0).join('\n\n');
}

/** A strict-JSON `remove` recommendation for the flagged citekey. */
function reviseSwapStub(hints: Record<string, unknown>): string {
  const flag = asRecord(hints['flag']);
  const flagged = typeof flag?.['flagged_citekey'] === 'string' ? (flag['flagged_citekey'] as string).trim() : '';
  return JSON.stringify({
    action: 'remove',
    flagged_citekey: flagged,
    replacement_citekey: null,
    rationale: loadTextStubs()['revise-swap'].rationale,
    patch: { before_excerpt: `[@${flagged}]`, after_excerpt: '' },
  });
}

/** One bullet per assigned source (the template's output format), in `sources` order. */
function sectionProvenanceStub(hints: Record<string, unknown>): string {
  const prose = loadTextStubs()['tutorial-section-provenance'];
  const keys = citekeysOf(hints['sources']);
  if (keys.length === 0) return `${prose.none}\n`;
  const claims = Array.isArray(hints['claims']) ? (hints['claims'] as unknown[]).map(asRecord).filter((c) => c !== null) : [];
  const lines = keys.map((citekey) => {
    const claim = claims.find((c) => citekeysOf(c['citekeys']).includes(citekey));
    const claimText = claim ? text(claim['claim']) : null;
    return claimText !== null
      ? `- ${fill(prose.with_claim, { citekey, claim: plainWords(claimText, 160) })}`
      : `- ${fill(prose.without_claim, { citekey })}`;
  });
  return `${lines.join('\n')}\n`;
}

/** One bullet per curated source, then the coverage note (the template's output format). */
function researchRationaleStub(hints: Record<string, unknown>): string {
  const prose = loadTextStubs()['tutorial-research-rationale'];
  const keys = citekeysOf(hints['sources']);
  if (keys.length === 0) return `${prose.none}\n`;
  const topic = plainWords(text(hints['topic']) ?? 'the assigned topic');
  const lines = keys.map((citekey) => `- ${fill(prose.per_source, { citekey, topic })}`);
  return `${lines.join('\n')}\n\n${prose.coverage}\n`;
}

const TEXT_STUBS: Readonly<Record<string, (hints: Record<string, unknown>) => string>> = Object.freeze({
  'section-drafter': drafterStub,
  smoother: smootherStub,
  'revise-swap': reviseSwapStub,
  'tutorial-section-provenance': sectionProvenanceStub,
  'tutorial-research-rationale': researchRationaleStub,
});

/** True when `slug` has a text stub. */
export function hasTextStub(slug: string): boolean {
  return slug in TEXT_STUBS;
}

/**
 * The stub reply for a text slug: built from the request's data blocks (the
 * last user message that carries them), with `hint` fields taking precedence.
 * Throws for a slug with no text stub (every text slug in llm-models.ts has
 * one; tests/llm-text-stubs.test.ts keeps it so).
 */
export function textStub(slug: string, messages: readonly StubMessage[], hint?: Readonly<Record<string, unknown>>): string {
  const make = TEXT_STUBS[slug];
  if (!make) throw new Error(`llm-text-stubs: no text stub for slug "${slug}"`);
  return make({ ...hintsFromMessages(messages), ...(hint ?? {}) });
}
