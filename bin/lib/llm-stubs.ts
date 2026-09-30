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
import { FALLBACK_DISCIPLINE } from './disciplines.js';
import { disciplineMentionFrom, paperTypeFrom, parseIntakeOverrides, thesisSeedFrom, topicFromAssignment } from './intake-overrides.js';
import { hintsFromMessages, type StubMessage } from './llm-text-stubs.js';
import { expandTopicQueries, topicKeywords, topicLabel, MAX_QUERY_WORDS } from './query-expansion.js';

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

/**
 * intake-clarifier (GRND-02 contract v2, D-18-06/10): suggestions read from the
 * request the way a model would — the fenced `assignment` block (its topic
 * phrase, stated length and style, sectioning notes, paper type, an explicit
 * discipline mention, a `Thesis seed:` line) and the `answers` block (a
 * discipline the user already fixed). Never "the assigned topic" when an
 * assignment exists. One generic follow-up, so a stubbed intake exercises the
 * follow-up path. A plain `topic` hint (older callers) is used as the topic.
 */
function intakeClarifierStub(hint: StubHint): unknown {
  const assignment = hintString(hint, 'assignment') ?? '';
  const answers = typeof hint === 'object' && hint !== null && typeof hint['answers'] === 'object' && hint['answers'] !== null
    ? (hint['answers'] as Record<string, unknown>)
    : {};
  const fixedDiscipline = typeof answers['discipline'] === 'string' ? answers['discipline'] : '';
  const overrides = parseIntakeOverrides(assignment);
  const seed = thesisSeedFrom(assignment);
  const topic =
    topicFromAssignment(assignment) ||
    (seed ? seed.split(/\s+/).slice(0, 12).join(' ') : '') ||
    hintString(hint, 'topic') ||
    (assignment ? queryFrom(assignment) : 'the assigned topic');
  return {
    topic,
    discipline: fixedDiscipline || disciplineMentionFrom(assignment) || hintString(hint, 'discipline') || FALLBACK_DISCIPLINE,
    paper_type: paperTypeFrom(assignment),
    thesis: seed,
    length_target_words: overrides.lengthWords ?? 0,
    citation_style: overrides.citationStyle?.style ?? '',
    sectioning_notes: [...overrides.sectioningNotes],
    follow_ups: [
      {
        id: 'audience',
        question: 'Who is the intended audience for this paper?',
        suggested_answer: 'the course instructor and classmates',
      },
    ],
  };
}

/** A hint block that is absent, blank or the renderer's `(none)`. */
function hintText(hint: StubHint, key: string): string {
  const v = hintString(hint, key);
  return v === undefined || v === '(none)' ? '' : v;
}

/**
 * topic-disambiguator (SRC-08, D-19-15): ONE unambiguous scope whose queries
 * are the deterministic expansion of the request's `topic` (and `discipline`)
 * blocks — bin/lib/query-expansion.ts, the same expansion research discloses
 * as "deterministic expansion of the intake topic". A request without a topic
 * falls back to the assignment's keywords.
 */
function topicDisambiguatorStub(hint: StubHint): unknown {
  const topic = hintText(hint, 'topic');
  const discipline = hintText(hint, 'discipline');
  const seed = topicKeywords(topic).length > 0 ? topic : topicKeywords(hintText(hint, 'assignment')).slice(0, MAX_QUERY_WORDS).join(' ');
  const queries = expandTopicQueries(seed, discipline);
  const label = topicLabel(seed);
  return {
    ambiguous: false,
    scopes: [{
      label,
      description: `Deterministic expansion of the intake topic${seed ? ` "${seed}"` : ''} (LLM stubbed)`,
      queries: queries.length > 0 ? queries : [seed || 'research topic'],
    }],
  };
}

interface StubCandidate {
  citekey: string;
  text: string;
  tier: string | null;
}

/** The candidates of a source-evaluator request (each citekey once): the `candidates` block, else bare citekeys. */
function stubCandidates(hint: StubHint): StubCandidate[] {
  const out: StubCandidate[] = [];
  const raw = typeof hint === 'object' && hint !== null ? hint['candidates'] : undefined;
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c !== 'object' || c === null) continue;
      const r = c as Record<string, unknown>;
      if (typeof r['citekey'] !== 'string' || r['citekey'].length === 0) continue;
      if (out.some((o) => o.citekey === r['citekey'])) continue;
      const text = [r['title'], r['abstract']].filter((x): x is string => typeof x === 'string').join(' ');
      const tier = typeof r['tier_hint'] === 'string' ? r['tier_hint'] : null;
      out.push({ citekey: r['citekey'], text, tier });
    }
    return out;
  }
  return hintStrings(hint, 'citekeys').map((citekey) => ({ citekey, text: '', tier: null }));
}

const STUB_TIERS: ReadonlySet<string> = new Set(['peer-reviewed', 'preprint', 'book', 'gov-report', 'other']);

/**
 * source-evaluator (SRC-09): keeps EVERY candidate it is handed, with its
 * `tier_hint` (else `other`) and a deterministic relevance — the share of the
 * topic's keywords found in the candidate's title and abstract, mapped to
 * 0.50–1.00 — and a reason that says no judgment was made.
 */
function sourceEvaluatorStub(hint: StubHint): unknown {
  const keywords = topicKeywords(hintText(hint, 'topic'));
  return {
    verdicts: stubCandidates(hint).map((c) => {
      const words = new Set(topicKeywords(c.text));
      const share = keywords.length === 0 ? 0 : keywords.filter((k) => words.has(k)).length / keywords.length;
      return {
        citekey: c.citekey,
        keep: true,
        reason: 'LLM stubbed: kept for your review; no relevance judgment was made',
        relevance: Math.round((0.5 + share / 2) * 100) / 100,
        tier: c.tier !== null && STUB_TIERS.has(c.tier) ? c.tier : 'other',
      };
    }),
  };
}

const STUBS: Readonly<Record<string, (hint: StubHint) => unknown>> = Object.freeze({
  'topic-disambiguator': topicDisambiguatorStub,
  'source-evaluator': sourceEvaluatorStub,
  'intake-clarifier': intakeClarifierStub,
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
