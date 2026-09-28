// bin/lib/llm-stubs.ts — deterministic, schema-valid stubs for structured slugs
// (D-17-25; RUN-04 LLM-stubbed mode, RUN-21 mock defaults).
//
// Under PENSMITH_NO_LLM=1 (and --dry-run, which sets it) complete() returns
// these instead of contacting a provider; the RUN-21 mock LLM serves the same
// objects as its default replies, so there is one source of stub truth.
//
// Every structured slug gets a minimal instance that its llm-contracts.ts
// schema accepts, with slug overrides where a bare minimum is useless: an
// outline has three sections (intro → body → conclusion) so the pipeline can
// advance, the disambiguator's queries come from the caller's stubHint (the
// topic), and the evaluator keeps every candidate citekey it is handed.
//
// Text slugs (section-drafter, smoother, revise-swap, tutorial-*) keep the
// `[PENSMITH_NO_LLM placeholder — …]` string in Phase 17; GRND-19 (Phase 18)
// adds contract-valid prose stubs and moves stub text into a data file.

import { contractFor } from './llm-contracts.js';

/** Optional per-call hint: a topic string, or a small object of call context. */
export type StubHint = string | Readonly<Record<string, unknown>> | undefined;

function hintString(hint: StubHint, key: string): string | undefined {
  if (typeof hint === 'string') return key === 'topic' ? hint : undefined;
  const v = hint?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
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

function queryFrom(topic: string): string {
  return topic.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
}

// --- sections-stream region (18-PLAN.md §6): the outline-author and
// section-planner stubs. They read the request's data blocks (promptHints —
// `brief`, `section`, `sources` as JSON) and still accept the Phase-17 flat
// hint (`topic`, `length`, `sources` as citekey strings, `section`/`slug`/
// `title`), so a stubbed or mocked pipeline advances like a real one (§3.4).

/** A hint value as an object (a parsed JSON data block), or undefined. */
function hintObject(hint: StubHint, key: string): Readonly<Record<string, unknown>> | undefined {
  if (typeof hint !== 'object' || hint === null) return undefined;
  const v = hint[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** The citekeys of a `sources` hint: SourceContextRecord-like objects or bare strings. */
function hintCitekeys(hint: StubHint): string[] {
  if (typeof hint !== 'object' || hint === null) return [];
  const v = hint['sources'];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) {
    const key = typeof s === 'string' ? s : typeof s === 'object' && s !== null ? (s as { citekey?: unknown }).citekey : undefined;
    if (typeof key === 'string' && key.length > 0 && !out.includes(key)) out.push(key);
  }
  return out;
}

function objString(o: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const v = o?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function objNumber(o: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const v = o?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Split `total` into `parts` near-equal positive integers that sum to `total`. */
function splitWords(total: number, parts: number): number[] {
  const base = Math.max(1, Math.floor(total / parts));
  const out = Array.from({ length: parts }, () => base);
  out[0] = Math.max(1, total - base * (parts - 1));
  return out;
}

function outlineStub(hint: StubHint): unknown {
  const brief = hintObject(hint, 'brief');
  const words = Math.max(3, Math.round(objNumber(brief, 'length_target_words') ?? hintNumber(hint, 'length') ?? 1500));
  const sources = hintCitekeys(hint);
  const topic = objString(brief, 'topic') ?? hintString(hint, 'topic') ?? 'the assigned topic';
  const thesis = objString(brief, 'thesis') ?? `A structured account of ${queryFrom(topic)}.`;
  const counter = brief?.['counterargument_required'] === true;
  const head = sources.slice(0, Math.min(3, sources.length));
  const intro = Math.max(1, Math.round(words * 0.2));
  const conclusion = Math.max(1, Math.round(words * 0.2));
  const middle = splitWords(Math.max(counter ? 3 : 1, words - intro - conclusion), counter ? 3 : 1);
  const sections: Array<Record<string, unknown>> = [
    { n: 1, slug: 'introduction', title: 'Introduction', purpose: 'Frame the question and state the thesis.', depends_on: [], estimated_word_count: intro, assigned_sources: head, role: 'intro' },
    { n: 2, slug: 'discussion', title: 'Discussion', purpose: 'Develop the main argument from the assigned sources.', depends_on: ['introduction'], estimated_word_count: middle[0], assigned_sources: sources, role: 'body' },
  ];
  if (counter) {
    const tail = sources.length > 0 ? [sources[sources.length - 1] as string] : [];
    sections.push(
      { n: 3, slug: 'counterargument', title: 'Counterargument', purpose: 'State the strongest objection to the thesis.', depends_on: ['discussion'], estimated_word_count: middle[1], assigned_sources: tail, role: 'counterargument' },
      { n: 4, slug: 'rebuttal', title: 'Rebuttal', purpose: 'Answer the objection from the evidence.', depends_on: ['counterargument'], estimated_word_count: middle[2], assigned_sources: head, role: 'rebuttal' },
    );
  }
  const last = sections[sections.length - 1] as { slug: string };
  sections.push({ n: sections.length + 1, slug: 'conclusion', title: 'Conclusion', purpose: 'Summarize the argument and its limits.', depends_on: [last.slug], estimated_word_count: conclusion, assigned_sources: head, role: 'conclusion' });
  return { thesis, sections };
}

function plannerStub(hint: StubHint): unknown {
  const section = hintObject(hint, 'section');
  const brief = hintObject(hint, 'brief');
  const n = objNumber(section, 'n') ?? hintNumber(hint, 'section') ?? 1;
  const slug = objString(section, 'slug') ?? hintString(hint, 'slug') ?? `section-${n}`;
  const title = objString(section, 'title') ?? hintString(hint, 'title') ?? slug;
  const deps = Array.isArray(section?.['depends_on'])
    ? (section?.['depends_on'] as unknown[]).filter((d): d is string => typeof d === 'string')
    : hintStrings(hint, 'depends_on');
  const sources = hintCitekeys(hint);
  const claims = sources.length > 0
    ? sources.map((key, i) => ({ claim: `Point ${i + 1} of "${title}", grounded in its source.`, sources: [key], evidence: 'The source reports the finding this point relies on.', counterexamples: '' }))
    : [{ claim: `The central point of "${title}".`, sources: [], evidence: '', counterexamples: '' }];
  return {
    frontmatter: { section: n, slug, title, depends_on: deps, assigned_sources: sources },
    claims,
    structure: claims.map((_c, i) => ({ paragraph: i + 1, purpose: `Develop point ${i + 1}.`, claims: [i + 1] })),
    voice: objString(brief, 'tone') ?? 'declarative, precise',
  };
}
// --- end sections-stream region

const STUBS: Readonly<Record<string, (hint: StubHint) => unknown>> = Object.freeze({
  'topic-disambiguator': (hint) => {
    const topic = hintString(hint, 'topic') ?? 'research topic';
    return { scopes: [{ label: 'primary-scope', queries: [queryFrom(topic)] }] };
  },
  'source-evaluator': (hint) => ({
    verdicts: hintStrings(hint, 'citekeys').map((citekey) => ({
      citekey,
      keep: true,
      reason: 'stub verdict (LLM stubbed): kept for review',
    })),
  }),
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
  'section-planner': plannerStub,
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

/** The Phase-17 text-slug placeholder (unchanged contract: tests and GRND-19 key on it). */
export function textPlaceholder(lastUserContent: string): string {
  return `[PENSMITH_NO_LLM placeholder — ${lastUserContent.slice(0, 80)}]`;
}
