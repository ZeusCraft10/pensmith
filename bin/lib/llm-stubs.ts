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
import { expandTopicQueries, topicKeywords, topicLabel, MAX_QUERY_WORDS } from './query-expansion.js';

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

/** The candidates of a source-evaluator request: the `candidates` block, else bare citekeys. */
function stubCandidates(hint: StubHint): StubCandidate[] {
  const out: StubCandidate[] = [];
  const raw = typeof hint === 'object' && hint !== null ? hint['candidates'] : undefined;
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c !== 'object' || c === null) continue;
      const r = c as Record<string, unknown>;
      if (typeof r['citekey'] !== 'string' || r['citekey'].length === 0) continue;
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

/** The Phase-17 text-slug placeholder (unchanged contract: tests and GRND-19 key on it). */
export function textPlaceholder(lastUserContent: string): string {
  return `[PENSMITH_NO_LLM placeholder — ${lastUserContent.slice(0, 80)}]`;
}
