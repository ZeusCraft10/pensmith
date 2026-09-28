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
// No templates/prompts/*.md edit happens in Phase 17 (GRND-07 / GRND-13 re-pin
// the prompts); the schemas here already carry the GRND-07 outline fields.

import { z, type ZodTypeAny } from 'zod';
import { parse as parseYaml } from 'yaml';
import { PlanFrontmatterSchema } from './schemas/plan-frontmatter.js';
import { SourceTierSchema } from './schemas/source-types.js';
import { parseFrontmatter } from './frontmatter.js';

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

export const IntakeClarifierSchema = z.object({
  topic: z.string().describe('the paper topic in one short phrase'),
  discipline: z.string().describe('computer-science, biology, history, literature, psychology, economics, philosophy, sociology or other'),
  questions: z.array(z.object({
    id: z.string().min(1).describe('short kebab-case id, e.g. discipline, length, citation-style, audience, counterargument'),
    question: z.string().min(1),
    suggested_answer: z.string().describe('the suggested default answer ("" when none)'),
  })).min(1).max(5),
});

export const OUTLINE_ROLES = ['intro', 'body', 'counterargument', 'rebuttal', 'conclusion'] as const;

/** GRND-07 outline contract: sections plus a paper-level thesis. */
export const OutlineSchema = z.object({
  thesis: z.string().default('').describe('the paper-level thesis in one sentence'),
  sections: z.array(z.object({
    n: z.number().int().min(1).describe('1-based section number in reading order'),
    slug: z.string().regex(SLUG_RE, 'slug must be lowercase kebab-case').describe('bare kebab-case slug, unique in the outline'),
    title: z.string().min(1),
    purpose: z.string().default('').describe('one sentence on what the section must establish'),
    depends_on: z.array(z.string().regex(SLUG_RE)).default([]).describe('slugs of OTHER sections this one must read first'),
    estimated_word_count: z.number().int().min(1),
    assigned_sources: z.array(z.string().min(1)).default([]).describe('citekeys from the candidate library'),
    role: z.enum(OUTLINE_ROLES).default('body'),
    voice: z.string().optional().describe('optional voice hint (PRD §7.18)'),
  })).min(1),
}).superRefine((o, ctx) => {
  const slugs = new Set<string>();
  for (const [i, s] of o.sections.entries()) {
    if (slugs.has(s.slug)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'slug'], message: `duplicate slug "${s.slug}"` });
    slugs.add(s.slug);
    if (s.depends_on.includes(s.slug)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'depends_on'], message: 'a section cannot depend on itself' });
  }
  for (const [i, s] of o.sections.entries()) {
    for (const d of s.depends_on) {
      if (!slugs.has(d)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'depends_on'], message: `depends_on names unknown slug "${d}"` });
    }
  }
});

const PlanFrontmatterObject = PlanFrontmatterSchema.innerType();

/** section-planner: the PLAN.md frontmatter subset the model authors, plus the brief body. */
export const SectionPlannerSchema = z.object({
  frontmatter: PlanFrontmatterObject.pick({
    section: true,
    slug: true,
    title: true,
    depends_on: true,
    assigned_sources: true,
  }),
  body: z.string().min(1).describe('the Markdown body, starting with "## Brief"'),
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
    sections: (o['sections'] as unknown[]).map((s) => {
      if (typeof s !== 'object' || s === null) return s;
      const r = { ...(s as Record<string, unknown>) };
      if (r['n'] === undefined && typeof r['number'] === 'number') r['n'] = r['number'];
      delete r['number'];
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

const TIER_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
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

function plannerFromText(text: string): unknown {
  const doc = /^\s*```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)?.[1] ?? text;
  const trimmed = doc.replace(/^\s+/, '');
  if (!trimmed.startsWith('---')) return undefined;
  const { frontmatter, body } = parseFrontmatter(trimmed);
  if (Object.keys(frontmatter).length === 0) return undefined;
  const fm: Record<string, unknown> = { ...frontmatter };
  if (fm['section'] === undefined && typeof fm['number'] === 'number') fm['section'] = fm['number'];
  const picked: Record<string, unknown> = {};
  for (const k of ['section', 'slug', 'title', 'depends_on', 'assigned_sources']) if (fm[k] !== undefined) picked[k] = fm[k];
  return { frontmatter: picked, body: body.trim() };
}

function intakeFromText(text: string): unknown {
  const questions: Array<{ id: string; question: string; suggested_answer: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (!m) continue;
    const q = (m[2] ?? '').trim();
    const suggested = /Suggested:\s*(.+)$/i.exec(q)?.[1]?.trim() ?? '';
    questions.push({ id: `q${m[1]}`, question: q, suggested_answer: suggested });
  }
  if (questions.length === 0) return undefined;
  return { topic: '', discipline: 'other', questions: questions.slice(0, 5) };
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
      const v = parseYaml(s) as unknown;
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
