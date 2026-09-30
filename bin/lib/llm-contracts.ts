// bin/lib/llm-contracts.ts — structured-output contracts (RUN-25, D-17-23).
//
// ONE zod schema per structured prompt slug (object roots only). From that one
// schema this module derives:
//   - the Anthropic native constraint  output_config.format = {type:'json_schema', schema}
//   - the OpenAI strict variant        response_format json_schema (strict: every
//     property required, optional → nullable, additionalProperties:false)
//   - the local (Ollama / vLLM) variant response_format json_schema, non-strict
// and the reply is validated with the SAME schema. Where a provider or model has
// no native structured output, the tolerant parser accepts bare, fenced or
// prose-wrapped JSON and YAML (plus a per-slug text fallback for the prompts
// that still ask for Markdown), and bin/lib/anthropic.ts sends ONE corrective
// retry after a structural failure.
//
// The converter is in-repo (no new dependency) and covers the zod subset these
// schemas use. Constraints the providers do not support (string lengths,
// numeric bounds, array sizes, regex patterns) stay zod-only: they are not
// emitted into the JSON schema and are enforced by validation.
//
// Phase 18 made the outline-author and section-planner templates ask for
// exactly these objects (GRND-07 / GRND-13, re-pinned in both hash maps). The
// schemas check shape only; the relational rules (known slugs and citekeys,
// cycles, the word budget, the counterargument rule, the planner's allowed
// sources) live in outline-validate.ts and plan-validate.ts, which the verbs
// run on the parsed object before one corrective turn.

import { z, type ZodTypeAny } from 'zod';
import { parse as parseYaml } from 'yaml';
import { SECTION_ROLES } from './schemas/plan-frontmatter.js';
import { SourceTierSchema } from './schemas/source-types.js';
import { parseFrontmatter } from './frontmatter.js';
import { PAPER_TYPES } from './intake-brief.js';
import { normalizePaperType } from './intake-overrides.js';
import { parsePlanBody } from './plan-render.js';
import { lookupTable } from './lookup-table.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * topic-disambiguator (SRC-08, D-19-15): whether the topic is ambiguous and 1–3
 * candidate scopes, most likely first, each with a label, a one-line
 * description and its search queries. The schema accepts 1–20 queries per
 * scope; research normalises them and clamps each scope to 5–10
 * (bin/lib/query-expansion.ts clampQueries).
 */
export const TopicDisambiguatorSchema = z.object({
  ambiguous: z.boolean().describe('true when the topic plausibly names more than one research area'),
  scopes: z.array(z.object({
    label: z.string().min(1).describe('short kebab-case scope label'),
    description: z.string().min(1).describe('one sentence: what this reading of the topic covers'),
    queries: z.array(z.string().min(1)).min(1).max(20).describe('5 to 10 search queries, at most 8 words each'),
  })).min(1).max(3).describe('candidate scopes, most likely first'),
});

/** Longest evaluator reason kept (it becomes the source's why-relevant note). */
export const EVALUATOR_REASON_MAX = 200;

/**
 * source-evaluator (SRC-09, D-19-16): one verdict per candidate — keep or
 * reject, a short reason (the why-relevant note of a kept source), a relevance
 * score and a tier. The deterministic tier (bin/lib/source-tier.ts) wins over
 * the model's where the metadata decides it.
 */
export const SourceEvaluatorSchema = z.object({
  verdicts: z.array(z.object({
    citekey: z.string().min(1).describe('the candidate citekey, copied exactly'),
    keep: z.boolean(),
    reason: z.string().max(EVALUATOR_REASON_MAX).describe('why keep or reject, at most 200 characters'),
    relevance: z.number().min(0).max(1).describe('relevance to the topic and scope, 0 to 1'),
    tier: SourceTierSchema.describe('peer-reviewed, preprint, book, gov-report or other'),
  })).describe('one verdict per candidate, in candidate order'),
});

/**
 * intake-clarifier v2 (GRND-02, D-18-10): the clarifier only SUGGESTS — a
 * topic phrase, a discipline preset, the paper type, a working thesis, the
 * stated length and citation style, sectioning notes and at most three
 * assignment-specific follow-up questions. Intake builds INTAKE.md from the
 * user's answers; this reply is never persisted as INTAKE.md. Tolerant where a
 * model is sloppy but the meaning is clear: a free-text paper type is mapped
 * onto PAPER_TYPES, a null or numeric-string length becomes a number, and more
 * than three follow-ups are cut to three.
 */
export const IntakeClarifierSchema = z.object({
  topic: z.string().describe('the paper topic as one short noun phrase (not an instruction or a question)'),
  discipline: z.string().describe('the best-fitting discipline preset slug from the <disciplines> input'),
  paper_type: z.preprocess(
    (v) => (typeof v === 'string' ? normalizePaperType(v) : v),
    z.enum(PAPER_TYPES),
  ).describe('the kind of paper the assignment asks for'),
  thesis: z.string().describe('a working thesis the assignment states or clearly implies, else ""'),
  length_target_words: z.preprocess(
    (v) => (v === null || v === undefined ? 0 : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v),
    z.number().int().min(0),
  ).describe('the length the assignment states, in words (pages × 300); 0 when it states none'),
  citation_style: z.string().describe('the citation style the assignment asks for (e.g. "APA", "Chicago"), else ""'),
  sectioning_notes: z.array(z.string()).describe('explicit sectioning instructions from the assignment, verbatim and short; [] when none'),
  follow_ups: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, 3) : v),
    z.array(z.object({
      id: z.string().min(1).describe('short kebab-case id, e.g. audience, scope, case-study'),
      question: z.string().min(1).describe('one assignment-specific question the fixed intake questions do not cover'),
      suggested_answer: z.string().describe('the answer you would suggest ("" when none)'),
    })).max(3),
  ).describe('at most three assignment-specific follow-up questions; [] when none are needed'),
});

/**
 * An outline section's role (GRND-07 / GRND-10): the one list, owned by the
 * PLAN.md frontmatter schema (SECTION_ROLES). The counterargument rule (PRD
 * §7.4) is met by a `counterargument` plus a `rebuttal` section, or by one
 * `counterargument-rebuttal` section (outline-validate.ts).
 */
export const OUTLINE_ROLES = SECTION_ROLES;

/**
 * A slug the model prefixed with its section folder number → the bare slug
 * (D-18-14): `01-introduction` / `01a-background` / `1-introduction` for
 * section `n` 1 → `introduction` / `background`. Only the folder shape is
 * stripped — two digits (optionally a letter), or one digit with no letter —
 * and only when the number IS the section's `n`, so a topical slug keeps its
 * digits: `3d-printing`, `5g-networks`, `2d-materials`, `90s-music`,
 * `9-11-attacks` as any section but §9, `2024-review`.
 */
export function bareOutlineSlug(slug: string, n: number): string {
  const m = /^(\d{1,2})([a-z]?)-(?=[a-z0-9])/.exec(slug);
  if (!m) return slug;
  const digits = m[1] as string;
  const letter = m[2] as string;
  if (Number(digits) !== n || (digits.length === 1 && letter !== '')) return slug;
  const bare = slug.slice(m[0].length);
  return bare.length > 0 ? bare : slug;
}

/**
 * A depends_on entry → the slug it names: an entry equal to a section's slug as
 * the model wrote it maps to that section's bare slug (`01-introduction` →
 * `introduction`); an entry that is a section's bare slug behind a folder
 * number (`01-introduction` when the section was written `introduction`) maps
 * to it; any other entry is kept as written (outline-validate.ts reports one
 * that names no section).
 */
function resolveDependsOn(entry: string, bareByRaw: ReadonlyMap<string, string>, bare: ReadonlySet<string>): string {
  const mapped = bareByRaw.get(entry);
  if (mapped !== undefined) return mapped;
  if (bare.has(entry)) return entry;
  const m = /^\d{1,2}[a-z]?-(.+)$/.exec(entry);
  return m && bare.has(m[1] as string) ? (m[1] as string) : entry;
}

/**
 * GRND-07 outline contract: sections plus a paper-level thesis (D-18-14).
 *
 * The schema checks SHAPE only. The relational rules — unique slugs,
 * depends_on names another section, no self-reference, no cycle, citekeys in
 * LIBRARY.json, the word budget, zero-source sections and the counterargument
 * rule — belong to outline-validate.ts, which reports every violation at once
 * for the one corrective turn (GRND-08). A slug (or depends_on entry) arriving
 * with an `NN-` prefix is normalised to the bare slug here, so
 * `01-introduction` never becomes the folder `01-01-introduction/` (GRND-09).
 * The model's `n` is only its reading order: outline.ts numbers a fresh outline
 * 1..N in the order the sections are listed, and a re-outline per D-18-18.
 */
export const OutlineSchema = z.object({
  thesis: z.string().default('').describe('the paper-level thesis in one sentence'),
  sections: z.array(z.object({
    n: z.number().int().min(1).describe('1-based section number in reading order'),
    slug: z.string().regex(SLUG_RE, 'slug must be lowercase kebab-case').describe('bare kebab-case slug without a number prefix, unique in the outline'),
    title: z.string().min(1),
    purpose: z.string().default('').describe('one sentence on what the section must establish'),
    depends_on: z.array(z.string().regex(SLUG_RE)).default([]).describe('slugs of OTHER sections this one must read first'),
    estimated_word_count: z.number().int().min(1),
    assigned_sources: z.array(z.string().min(1)).default([]).describe('citekeys from the sources block'),
    role: z.enum(OUTLINE_ROLES).default('body'),
    voice: z.string().optional().describe('optional voice hint (PRD §7.18)'),
  })).min(1),
}).transform((o) => {
  const bareByRaw = new Map(o.sections.map((s) => [s.slug, bareOutlineSlug(s.slug, s.n)] as const));
  const bare = new Set(bareByRaw.values());
  return {
    thesis: o.thesis,
    sections: o.sections.map((s) => {
      const out = {
        ...s,
        slug: bareByRaw.get(s.slug) ?? s.slug,
        depends_on: s.depends_on.map((d) => resolveDependsOn(d, bareByRaw, bare)),
      };
      if (out.voice !== undefined && out.voice.trim().length === 0) delete out.voice;
      return out;
    }),
  };
});

/**
 * section-planner contract (GRND-13, D-18-23): the frontmatter the model echoes
 * (the section's identity and its source subset), the claim map, the
 * paragraph structure and the voice. plan-validate.ts checks the echoed
 * identity against the OUTLINE row and every source against the section's
 * allowed set; plan-render.ts renders PLAN.md from the validated object.
 */
export const SectionPlannerSchema = z.object({
  frontmatter: z.object({
    section: z.number().int().min(1).describe('the section number n from the section block'),
    slug: z.string().regex(SLUG_RE).describe('the slug from the section block, copied exactly'),
    title: z.string().min(1),
    depends_on: z.array(z.string().regex(SLUG_RE)).default([]).describe('the depends_on list from the section block, copied exactly'),
    assigned_sources: z.array(z.string().min(1)).default([]).describe('the citekeys, from the sources block only, this section will use'),
  }),
  claims: z.array(z.object({
    claim: z.string().min(1).describe('one claim the section makes, in one sentence'),
    sources: z.array(z.string().min(1)).default([]).describe('citekeys from assigned_sources that support it ([] for an uncited claim)'),
    evidence: z.string().default('').describe('what the sources must show for the claim to hold'),
    counterexamples: z.string().default('').describe('counterexamples or limits the draft should acknowledge ("" when none)'),
  })).min(1),
  structure: z.array(z.object({
    paragraph: z.number().int().min(1).describe('1-based paragraph number'),
    purpose: z.string().min(1).describe('what the paragraph does'),
    claims: z.array(z.number().int().min(1)).default([]).describe('the 1-based numbers of the claims it develops'),
  })).min(1),
  voice: z.string().default('').describe('one line of voice direction for the drafter'),
});

export const ClaimSupportSchema = z.object({
  verdict: z.enum(['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'UNCLEAR']),
  rationale: z.string().describe('at most 200 characters, no markdown'),
  evidence: z.string().describe('a verbatim substring of the source abstract, or ""'),
});

export const OrphanLabelSchema = z.object({
  label: z.enum(['claim', 'definition', 'UNCLEAR']),
});

export type TopicDisambiguation = z.infer<typeof TopicDisambiguatorSchema>;
export type SourceEvaluation = z.infer<typeof SourceEvaluatorSchema>;
export type IntakeClarification = z.infer<typeof IntakeClarifierSchema>;
export type OutlineContract = z.infer<typeof OutlineSchema>;
export type SectionPlan = z.infer<typeof SectionPlannerSchema>;
export type ClaimSupport = z.infer<typeof ClaimSupportSchema>;
export type OrphanLabel = z.infer<typeof OrphanLabelSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface Contract {
  readonly slug: string;
  readonly schema: ZodTypeAny;
  /** Normalize a parsed value toward the schema (e.g. a bare array root the old prompt asks for). */
  readonly coerce?: (value: unknown) => unknown;
  /** Parse a non-JSON reply the unchanged prompt asks for (Markdown); undefined when it does not apply. */
  readonly fromText?: (text: string) => unknown;
}

function wrapArray(key: string): (v: unknown) => unknown {
  return (v) => (Array.isArray(v) ? { [key]: v } : v);
}

function coerceOutline(v: unknown): unknown {
  const obj = Array.isArray(v) ? { sections: v } : v;
  if (typeof obj !== 'object' || obj === null) return obj;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o['sections'])) return o;
  return {
    ...o,
    sections: (o['sections'] as unknown[]).map((s, i) => {
      if (typeof s !== 'object' || s === null) return s;
      const r = { ...(s as Record<string, unknown>) };
      if (r['n'] === undefined && typeof r['number'] === 'number') r['n'] = r['number'];
      if (r['n'] === undefined) r['n'] = i + 1; // only the reading order counts (D-18-14)
      delete r['number'];
      if (r['estimated_word_count'] === undefined && typeof r['word_target'] === 'number') r['estimated_word_count'] = r['word_target'];
      delete r['word_target'];
      return r;
    }),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * topic-disambiguator replies without the newer fields (a bare `scopes` object,
 * or an array of scopes): a missing `ambiguous` is true exactly when more than
 * one scope was proposed, and a missing or empty `description` repeats the
 * label. Nothing is invented beyond that; queries are validated as sent.
 */
export function coerceDisambiguation(v: unknown): unknown {
  const obj = wrapArray('scopes')(v);
  if (!isRecord(obj) || !Array.isArray(obj['scopes'])) return obj;
  const scopes = (obj['scopes'] as unknown[]).map((s) => {
    if (!isRecord(s)) return s;
    const label = typeof s['label'] === 'string' ? s['label'].trim() : s['label'];
    const description = typeof s['description'] === 'string' && s['description'].trim().length > 0
      ? s['description'].trim()
      : label;
    return { ...s, label, description };
  });
  const ambiguous = typeof obj['ambiguous'] === 'boolean' ? obj['ambiguous'] : scopes.length > 1;
  return { ...obj, ambiguous, scopes };
}

const TIER_SYNONYMS: Readonly<Record<string, string>> = lookupTable({
  'peer-reviewed': 'peer-reviewed',
  peerreviewed: 'peer-reviewed',
  'peer-review': 'peer-reviewed',
  journal: 'peer-reviewed',
  preprint: 'preprint',
  'pre-print': 'preprint',
  book: 'book',
  'book-chapter': 'book',
  chapter: 'book',
  'gov-report': 'gov-report',
  'government-report': 'gov-report',
  'gov-reports': 'gov-report',
  other: 'other',
});

/**
 * source-evaluator replies: a bare array root becomes `{verdicts}`; a tier is
 * matched case- and spacing-insensitively (`Peer reviewed` → peer-reviewed); a
 * numeric string relevance becomes a number; an over-long reason is cut at a
 * word boundary to EVALUATOR_REASON_MAX. A missing tier, relevance or keep is
 * NOT filled in — such a verdict fails the schema and the one corrective retry
 * asks for it.
 */
export function coerceEvaluation(v: unknown): unknown {
  const obj = wrapArray('verdicts')(v);
  if (!isRecord(obj) || !Array.isArray(obj['verdicts'])) return obj;
  const verdicts = (obj['verdicts'] as unknown[]).map((raw) => {
    if (!isRecord(raw)) return raw;
    const r: Record<string, unknown> = { ...raw };
    if (typeof r['tier'] === 'string') {
      const key = r['tier'].trim().toLowerCase().replace(/[\s_]+/g, '-');
      r['tier'] = TIER_SYNONYMS[key] ?? TIER_SYNONYMS[key.replace(/-/g, '')] ?? r['tier'];
    }
    if (typeof r['relevance'] === 'string' && r['relevance'].trim() !== '' && Number.isFinite(Number(r['relevance']))) {
      r['relevance'] = Number(r['relevance']);
    }
    if (typeof r['reason'] === 'string') {
      const reason = r['reason'].replace(/\s+/g, ' ').trim();
      if (reason.length <= EVALUATOR_REASON_MAX) r['reason'] = reason;
      else {
        const cut = reason.slice(0, EVALUATOR_REASON_MAX - 1);
        const at = cut.lastIndexOf(' ');
        r['reason'] = `${(at > EVALUATOR_REASON_MAX * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`;
      }
    }
    return r;
  });
  return { ...obj, verdicts };
}

/**
 * A planner reply written as a PLAN.md document (frontmatter plus `## Claims`,
 * `## Structure` and `## Voice`) instead of JSON — the tolerant text path for a
 * provider without native structured output. undefined when it is not one.
 */
function plannerFromText(text: string): unknown {
  const doc = /^\s*```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)?.[1] ?? text;
  const trimmed = doc.replace(/^\s+/, '');
  if (!trimmed.startsWith('---')) return undefined;
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter(trimmed);
  } catch {
    return undefined;
  }
  if (Object.keys(parsed.frontmatter).length === 0) return undefined;
  const fm: Record<string, unknown> = { ...parsed.frontmatter };
  if (fm['section'] === undefined && typeof fm['number'] === 'number') fm['section'] = fm['number'];
  const picked: Record<string, unknown> = {};
  for (const k of ['section', 'slug', 'title', 'depends_on', 'assigned_sources']) if (fm[k] !== undefined) picked[k] = fm[k];
  const body = parsePlanBody(parsed.body);
  return { frontmatter: picked, claims: body.claims, structure: body.structure, voice: body.voice };
}

/**
 * The tolerant fallback for a clarifier that answered in labelled Markdown
 * instead of JSON: `Topic:`, `Discipline:`, `Paper type:`, `Thesis:`,
 * `Length:`, `Citation style:` lines, `- ` bullets under a sectioning heading,
 * and numbered questions (with an optional `Suggested:` answer) as the ≤ 3
 * follow-ups. undefined when the reply holds neither a topic line nor a
 * numbered question.
 */
function intakeFromText(text: string): unknown {
  const lines = text.split(/\r?\n/);
  const label = (name: RegExp): string => {
    for (const line of lines) {
      const m = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${name.source})(?:\\*\\*)?\\s*:\\s*(.*?)\\s*$`, 'i').exec(line);
      if (m) return (m[1] ?? '').replace(/^\*+|\*+$/g, '').trim();
    }
    return '';
  };
  const followUps: Array<{ id: string; question: string; suggested_answer: string }> = [];
  for (const line of lines) {
    const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (!m) continue;
    const q = (m[2] ?? '').trim();
    const suggested = /Suggested(?:\s+answer)?:\s*(.+)$/i.exec(q)?.[1]?.trim() ?? '';
    followUps.push({ id: `q${m[1]}`, question: q.replace(/\s*Suggested(?:\s+answer)?:.*$/i, '').trim() || q, suggested_answer: suggested });
  }
  const topic = label(/topic/);
  if (topic === '' && followUps.length === 0) return undefined;
  const notes: string[] = [];
  const notesLine = label(/sectioning(?:\s+notes)?/);
  if (notesLine && !/^(?:none|n\/a|-)$/i.test(notesLine)) notes.push(notesLine);
  const length = /(\d[\d,]*)/.exec(label(/length(?:\s+target)?(?:\s+words)?/))?.[1];
  return {
    topic,
    discipline: label(/discipline/),
    paper_type: label(/paper\s+type|type/) || 'other',
    thesis: label(/(?:working\s+)?thesis/),
    length_target_words: length ? Number(length.replace(/,/g, '')) : 0,
    citation_style: label(/citation\s+style|style/),
    sectioning_notes: notes,
    follow_ups: followUps.slice(0, 3),
  };
}

export const CONTRACTS: Readonly<Record<string, Contract>> = Object.freeze({
  'topic-disambiguator': { slug: 'topic-disambiguator', schema: TopicDisambiguatorSchema, coerce: coerceDisambiguation },
  'source-evaluator': { slug: 'source-evaluator', schema: SourceEvaluatorSchema, coerce: coerceEvaluation },
  'intake-clarifier': { slug: 'intake-clarifier', schema: IntakeClarifierSchema, fromText: intakeFromText },
  'outline-author': { slug: 'outline-author', schema: OutlineSchema, coerce: coerceOutline },
  'section-planner': { slug: 'section-planner', schema: SectionPlannerSchema, fromText: plannerFromText },
  'claim-support': { slug: 'claim-support', schema: ClaimSupportSchema },
  'orphan-label': { slug: 'orphan-label', schema: OrphanLabelSchema },
});

export function contractFor(slug: string): Contract | null {
  return CONTRACTS[slug] ?? null;
}

// ---------------------------------------------------------------------------
// zod (v3 subset) → JSON Schema
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;
export type SchemaVariant = 'standard' | 'openai-strict';

type Def = { typeName: string; [k: string]: unknown };

function defOf(t: ZodTypeAny): Def {
  return (t as unknown as { _def: Def })._def;
}

/** Peel wrappers that do not change the JSON shape (refinements, defaults, descriptions). */
function peel(t: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean; hasDefault: boolean } {
  let cur = t;
  let optional = false;
  let nullable = false;
  let hasDefault = false;
  for (let i = 0; i < 20; i += 1) {
    const d = defOf(cur);
    if (d.typeName === 'ZodOptional') { optional = true; cur = d['innerType'] as ZodTypeAny; continue; }
    if (d.typeName === 'ZodNullable') { nullable = true; cur = d['innerType'] as ZodTypeAny; continue; }
    if (d.typeName === 'ZodDefault') { hasDefault = true; cur = d['innerType'] as ZodTypeAny; continue; }
    if (d.typeName === 'ZodEffects') { cur = d['schema'] as ZodTypeAny; continue; }
    if (d.typeName === 'ZodBranded' || d.typeName === 'ZodReadonly' || d.typeName === 'ZodCatch') {
      cur = (d['type'] ?? d['innerType']) as ZodTypeAny;
      continue;
    }
    break;
  }
  return { inner: cur, optional, nullable, hasDefault };
}

function withDescription(t: ZodTypeAny, js: JsonSchema): JsonSchema {
  const desc = (t as unknown as { description?: string }).description;
  return desc ? { ...js, description: desc } : js;
}

function convertInner(t: ZodTypeAny, variant: SchemaVariant): JsonSchema {
  const d = defOf(t);
  switch (d.typeName) {
    case 'ZodString':
      return withDescription(t, { type: 'string' });
    case 'ZodNumber': {
      const checks = (d['checks'] as Array<{ kind: string }> | undefined) ?? [];
      return withDescription(t, { type: checks.some((c) => c.kind === 'int') ? 'integer' : 'number' });
    }
    case 'ZodBoolean':
      return withDescription(t, { type: 'boolean' });
    case 'ZodEnum':
      return withDescription(t, { type: 'string', enum: [...(d['values'] as string[])] });
    case 'ZodLiteral': {
      const v = d['value'];
      const type = typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v === 'boolean' ? 'boolean' : 'string';
      return withDescription(t, { type, enum: [v] });
    }
    case 'ZodArray':
      return withDescription(t, { type: 'array', items: toJsonSchema(d['type'] as ZodTypeAny, variant) });
    case 'ZodUnion':
      return withDescription(t, { anyOf: (d['options'] as ZodTypeAny[]).map((o) => toJsonSchema(o, variant)) });
    case 'ZodObject': {
      const shape = (t as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const p = peel(value);
        let js = convertInner(p.inner, variant);
        js = withDescription(value, withDescription(p.inner, js));
        if (variant === 'openai-strict') {
          if (p.optional || p.nullable) js = { anyOf: [js, { type: 'null' }] };
          required.push(key);
        } else {
          if (p.nullable) js = { anyOf: [js, { type: 'null' }] };
          // Defaults are required in the native schema so the model always fills them;
          // only zod-optional fields may be omitted.
          if (!p.optional) required.push(key);
        }
        properties[key] = js;
      }
      return withDescription(t, { type: 'object', properties, required, additionalProperties: false });
    }
    default:
      throw new Error(`llm-contracts: zod type ${d.typeName} is not supported by the JSON-schema converter`);
  }
}

/** Convert a zod schema to JSON Schema (object roots get additionalProperties:false at every level). */
export function toJsonSchema(schema: ZodTypeAny, variant: SchemaVariant = 'standard'): JsonSchema {
  const p = peel(schema);
  const js = withDescription(schema, convertInner(p.inner, variant));
  if (p.nullable || (variant === 'openai-strict' && p.optional)) return { anyOf: [js, { type: 'null' }] };
  return js;
}

export function jsonSchemaForSlug(slug: string, variant: SchemaVariant = 'standard'): JsonSchema {
  const c = contractFor(slug);
  if (!c) throw new Error(`llm-contracts: "${slug}" is not a structured slug`);
  return toJsonSchema(c.schema, variant);
}

/**
 * OpenAI strict replies send `null` for every optional property; zod optional
 * does not accept null, so drop null where the schema field is optional.
 */
export function stripNullOptionals(schema: ZodTypeAny, value: unknown): unknown {
  const p = peel(schema);
  if (value === null) return value;
  const d = defOf(p.inner);
  if (d.typeName === 'ZodArray' && Array.isArray(value)) {
    return value.map((v) => stripNullOptionals(d['type'] as ZodTypeAny, v));
  }
  if (d.typeName === 'ZodObject' && typeof value === 'object' && !Array.isArray(value)) {
    const shape = (p.inner as unknown as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const field = shape[k];
      if (!field) {
        out[k] = v;
        continue;
      }
      const fp = peel(field);
      if (v === null && (fp.optional || fp.hasDefault) && !fp.nullable) continue;
      out[k] = stripNullOptionals(field, v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tolerant parser
// ---------------------------------------------------------------------------

/** Find the balanced JSON value starting at `start` (a '{' or '['), respecting strings. */
function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Every plausible structured value in a reply, most specific first. */
export function candidateValues(text: string): unknown[] {
  const out: unknown[] = [];
  const tryJson = (s: string): void => {
    try {
      out.push(JSON.parse(s));
    } catch {
      /* not JSON */
    }
  };
  const tryYaml = (s: string): void => {
    try {
      // logLevel 'error': a reply that is not YAML ("%%% garbage") must not print
      // a multi-line YAMLWarning before the one-line refusal (RUN-12); a real
      // parse error still throws and is ignored here.
      const v = parseYaml(s, { logLevel: 'error' }) as unknown;
      if (v !== null && typeof v === 'object') out.push(v);
    } catch {
      /* not YAML */
    }
  };
  const trimmed = text.trim();
  tryJson(trimmed);
  const fenceRe = /```([a-zA-Z]*)\s*\n([\s\S]*?)```/g;
  for (let m = fenceRe.exec(text); m !== null; m = fenceRe.exec(text)) {
    const lang = (m[1] ?? '').toLowerCase();
    const body = (m[2] ?? '').trim();
    if (lang === 'yaml' || lang === 'yml') tryYaml(body);
    else {
      tryJson(body);
      if (lang === '' ) tryYaml(body);
    }
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const slice = balancedSlice(text, i);
    if (slice) {
      const before = out.length;
      tryJson(slice);
      if (out.length > before) break;
    }
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) tryYaml(trimmed);
  return out;
}

export type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function firstIssue(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parse and validate a reply for `slug`. `strictNulls` strips the nulls an
 * OpenAI strict schema produces for optional fields before validation.
 */
export function parseStructured(slug: string, text: string, opts: { strictNulls?: boolean } = {}): ParseOutcome<unknown> {
  const c = contractFor(slug);
  if (!c) return { ok: false, error: `"${slug}" is not a structured slug` };
  const values = candidateValues(text);
  if (c.fromText) {
    const v = c.fromText(text);
    if (v !== undefined) values.push(v);
  }
  if (values.length === 0) return { ok: false, error: 'the reply contains no JSON or YAML value' };
  let lastError = 'no candidate value matched the schema';
  for (const raw of values) {
    let v = opts.strictNulls ? stripNullOptionals(c.schema, raw) : raw;
    if (c.coerce) v = c.coerce(v);
    const r = c.schema.safeParse(v);
    if (r.success) return { ok: true, data: r.data };
    lastError = firstIssue(r.error);
  }
  return { ok: false, error: lastError };
}

/** The corrective-retry instruction sent after a structural failure. */
export function correctiveInstruction(slug: string, error: string): string {
  return (
    `Your previous reply did not match the required output schema (${error}). ` +
    'Reply again with ONLY one JSON value that matches this JSON Schema — no prose, no code fence:\n' +
    JSON.stringify(jsonSchemaForSlug(slug, 'standard'))
  );
}
