// bin/lib/llm-stubs.ts — deterministic, schema-valid stubs for structured slugs
// (D-17-25, D-18-06; RUN-04 LLM-stubbed mode, RUN-21 mock defaults, GRND-19).
//
// Under PENSMITH_NO_LLM=1 (and --dry-run, which sets it) complete() returns
// these instead of contacting a provider; the RUN-21 mock LLM serves the same
// objects as its default replies, so there is one source of stub truth.
//
// A stub reads the request like a model would: its hint object is the
// request's data blocks (prompt-request.ts promptHints — JSON blocks parsed,
// text blocks as strings; see stubHintsFor below) merged with the caller's
// `stubHint`, which call sites set to requestHints(req) — the same object —
// so a stubbed call and a mocked call agree.
//
// Every structured slug gets a minimal instance that its llm-contracts.ts
// schema accepts, with slug overrides where a bare minimum is useless: an
// outline has three sections (intro → body → conclusion) so the pipeline can
// advance, the disambiguator's queries come from the request's topic, and the
// evaluator keeps every candidate citekey it is handed.
//
// Text slugs (section-drafter, smoother, revise-swap, tutorial-*) get
// contract-valid prose from bin/lib/llm-text-stubs.ts (D-18-06).

import { contractFor } from './llm-contracts.js';
import { hintsFromMessages, type StubMessage } from './llm-text-stubs.js';

/** Optional per-call hint: a topic string, or a small object of call context. */
export type StubHint = string | Readonly<Record<string, unknown>> | undefined;

/**
 * The hint object a stub sees: the data blocks of the request's last user
 * message that carries blocks, overlaid with the caller's `stubHint` (a bare
 * string hint is the topic). complete() and the mock LLM both build it here.
 */
export function stubHintsFor(messages: readonly StubMessage[], hint?: StubHint): Record<string, unknown> {
  const base = hintsFromMessages(messages);
  if (typeof hint === 'string') return { ...base, topic: hint };
  return { ...base, ...(hint ?? {}) };
}

/** The renderer's marker for an empty payload (prompt-request.ts renderPromptBlocks). */
const EMPTY_PAYLOAD = '(none)';

function hintString(hint: StubHint, key: string): string | undefined {
  if (typeof hint === 'string') return key === 'topic' ? hint : undefined;
  const v = hint?.[key];
  return typeof v === 'string' && v.trim() && v.trim() !== EMPTY_PAYLOAD ? v.trim() : undefined;
}

function hintNumber(hint: StubHint, key: string): number | undefined {
  if (typeof hint !== 'object' || hint === null) return undefined;
  const v = hint[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function hintStrings(hint: StubHint, key: string): string[] {
  if (typeof hint !== 'object' || hint === null) return [];
  const v = hint[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Citekeys of a list of records (`[{citekey, …}]`, e.g. the evaluator's `candidates` block). */
function hintRecordCitekeys(hint: StubHint, key: string): string[] {
  if (typeof hint !== 'object' || hint === null) return [];
  const v = hint[key];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const k = item !== null && typeof item === 'object' ? (item as Record<string, unknown>)['citekey'] : undefined;
    if (typeof k === 'string' && k.length > 0 && !out.includes(k)) out.push(k);
  }
  return out;
}

function queryFrom(topic: string): string {
  return topic.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
}

function outlineStub(hint: StubHint): unknown {
  const words = hintNumber(hint, 'length') ?? 1500;
  const sources = hintStrings(hint, 'sources');
  const intro = Math.max(1, Math.round(words * 0.2));
  const conclusion = Math.max(1, Math.round(words * 0.2));
  const body = Math.max(1, words - intro - conclusion);
  const topic = hintString(hint, 'topic') ?? 'the assigned topic';
  return {
    thesis: `A structured account of ${queryFrom(topic)}.`,
    sections: [
      { n: 1, slug: 'introduction', title: 'Introduction', purpose: 'Frame the question and state the thesis.', depends_on: [], estimated_word_count: intro, assigned_sources: sources.slice(0, 3), role: 'intro' },
      { n: 2, slug: 'discussion', title: 'Discussion', purpose: 'Develop the main argument from the assigned sources.', depends_on: ['introduction'], estimated_word_count: body, assigned_sources: sources, role: 'body' },
      { n: 3, slug: 'conclusion', title: 'Conclusion', purpose: 'Summarize the argument and its limits.', depends_on: ['discussion'], estimated_word_count: conclusion, assigned_sources: sources.slice(0, 3), role: 'conclusion' },
    ],
  };
}

const STUBS: Readonly<Record<string, (hint: StubHint) => unknown>> = Object.freeze({
  // The `topic` block (the brief's topic); a request with no topic falls back
  // to the first words of its `assignment` block.
  'topic-disambiguator': (hint) => {
    const topic = hintString(hint, 'topic') ?? hintString(hint, 'assignment') ?? 'research topic';
    return { scopes: [{ label: 'primary-scope', queries: [queryFrom(topic)] }] };
  },
  // Keeps every candidate of the `candidates` block (or a bare `citekeys` list).
  'source-evaluator': (hint) => {
    const fromRecords = hintRecordCitekeys(hint, 'candidates');
    return {
      verdicts: (fromRecords.length > 0 ? fromRecords : hintStrings(hint, 'citekeys')).map((citekey) => ({
        citekey,
        keep: true,
        reason: 'stub verdict (LLM stubbed): kept for review',
      })),
    };
  },
  'intake-clarifier': (hint) => ({
    topic: hintString(hint, 'topic') ?? 'the assigned topic',
    discipline: hintString(hint, 'discipline') ?? 'other',
    questions: [
      { id: 'discipline', question: 'Which discipline best fits this assignment? Suggested: CS, Bio, History, Lit, Psych, Econ, Philosophy, Other.', suggested_answer: 'Other' },
      { id: 'length', question: 'What length target should I plan for? (word count or page count)', suggested_answer: '1500 words' },
      { id: 'citation-style', question: 'Which citation style? (APA, MLA, Chicago NB, Chicago AD, IEEE, AMA, Vancouver, Harvard)', suggested_answer: 'APA' },
      { id: 'audience', question: 'Who is the audience? (undergraduate course, graduate seminar, journal, conference)', suggested_answer: 'undergraduate course' },
      { id: 'counterargument', question: 'Should the paper include a counterargument section?', suggested_answer: 'optional' },
    ],
  }),
  'outline-author': outlineStub,
  'section-planner': (hint) => {
    const n = hintNumber(hint, 'section') ?? 1;
    const slug = hintString(hint, 'slug') ?? `section-${n}`;
    const title = hintString(hint, 'title') ?? slug;
    return {
      frontmatter: {
        section: n,
        slug,
        title,
        depends_on: hintStrings(hint, 'depends_on'),
        assigned_sources: hintStrings(hint, 'sources'),
      },
      body: `## Brief\n\nStub plan (LLM stubbed) for section ${n}, "${title}". Cover the section purpose using only the assigned sources. Voice: declarative, precise.`,
    };
  },
  'claim-support': () => ({ verdict: 'UNCLEAR', rationale: 'LLM stubbed: no claim-support judgment was made.', evidence: '' }),
  'orphan-label': () => ({ label: 'UNCLEAR' }),
});

/** True when a deterministic structured stub exists for `slug`. */
export function hasStructuredStub(slug: string): boolean {
  return slug in STUBS;
}

/**
 * The schema-valid stub object for a structured slug (validated through the
 * slug's own contract, so a stub can never drift from the schema).
 */
export function structuredStub(slug: string, hint?: StubHint): unknown {
  const make = STUBS[slug];
  const contract = contractFor(slug);
  if (!make || !contract) throw new Error(`llm-stubs: no structured stub for slug "${slug}"`);
  return contract.schema.parse(make(hint));
}
