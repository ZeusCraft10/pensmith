// bin/lib/schemas/config.ts — `.paper/config.toml` schema (CONF-01, D-17-31, PRD §10).
//
// schema_version = 1 is written by `pensmith new` and validated on every read.
// Every table and key PRD §10 documents is declared here (tests/config-drift.test.ts
// parses the §10 TOML block against this schema, so the two cannot drift).
// All keys are optional: a missing key takes its documented default at the
// point of use. Unknown keys are warned about (once each) and ignored by
// bin/lib/config.ts before validation.
//
// Deliberate exclusions (errors, not warnings — bin/lib/config.ts):
//   - [verification] verify_quotes: Pass 3 quote verification is a BLOCKING
//     pass (PRD §14); turning it off would let quote-NOT_FOUND escape.
//   - [runtime] endpoint / api_key_env: a paper's files cannot choose where
//     prompts and keys are sent (S-18); they live in the global runtime.json.
//
// The educator-mode [project] keys come from an opaque fragment exported by
// bin/lib/tutorial.ts (the only goal-aware module) and are spread in unnamed.

import { z } from 'zod';
import { PROJECT_CONFIG_FRAGMENT } from '../tutorial.js';
import { EffortSchema, ProviderNameSchema, RefusalFallbacksSchema } from './runtime-config.js';

export const CURRENT_CONFIG_VERSION = 1;

/** The 8 citation styles (display names from PRD §10 / the intake clarifier, plus their CSL keys). */
export const CITATION_STYLE_NAMES = [
  'APA',
  'MLA',
  'Chicago (Notes-Bibliography)',
  'Chicago (Author-Date)',
  'IEEE',
  'AMA',
  'Vancouver',
  'Harvard',
] as const;

export const CITATION_STYLE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  apa: 'apa',
  mla: 'mla',
  'chicago (notes-bibliography)': 'chicago-notes-bib',
  'chicago-notes-bib': 'chicago-notes-bib',
  'chicago nb': 'chicago-notes-bib',
  'chicago (author-date)': 'chicago-author-date',
  'chicago-author-date': 'chicago-author-date',
  'chicago ad': 'chicago-author-date',
  ieee: 'ieee',
  ama: 'ama',
  vancouver: 'vancouver',
  harvard: 'harvard',
});

/** Canonical CSL key for a configured style name, or null when unknown. */
export function citationStyleKey(name: string): string | null {
  return CITATION_STYLE_KEYS[name.trim().toLowerCase()] ?? null;
}

const CitationStyleSchema = z.string().refine((v) => citationStyleKey(v) !== null, {
  message: `citation_style must be one of: ${CITATION_STYLE_NAMES.join(', ')}`,
});

const PositiveInt = z.number().int().positive();
const NonNegInt = z.number().int().nonnegative();
const NonNegNumber = z.number().nonnegative().finite();

export const ProjectSchema = z.object({
  title: z.string().optional(),
  class: z.string().optional(),
  assignment_prompt: z.string().optional(),
  mode: z.enum(['draft', 'outline']).optional(),
  ...PROJECT_CONFIG_FRAGMENT,
  length_target_words: PositiveInt.optional(),
  citation_style: CitationStyleSchema.optional(),
  discipline_preset: z.string().min(1).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD').optional(),
  counterargument_required: z.boolean().optional(),
  pii_redaction: z.boolean().optional(),
});

/**
 * `[sources] allowed_databases` values (SRC-10, SRC-11): the registry adapters
 * research can query, plus `nber` (Crossref restricted to NBER's DOI prefix
 * 10.3386) and `books` (Open Library / Google Books). bin/lib/adapter-plan.ts
 * maps each to the adapter it searches.
 */
export const SOURCE_DATABASES = ['openalex', 'semanticscholar', 'crossref', 'arxiv', 'pubmed', 'zotero', 'books', 'nber'] as const;

export const SourcesSchema = z.object({
  require_doi: z.boolean().optional(),
  allow_preprints: z.boolean().optional(),
  allow_books: z.boolean().optional(),
  allow_gov_reports: z.boolean().optional(),
  allow_news: z.boolean().optional(),
  allowed_databases: z.array(z.enum(SOURCE_DATABASES)).optional(),
  byo_pdf_dir: z.string().optional(),
  zotero_collection: z.string().optional(),
  min_year: z.number().int().min(1000).max(9999).optional(),
  peer_reviewed_only: z.boolean().optional(),
});

export const VerificationSchema = z.object({
  fetch_full_text: z.boolean().optional(),
  flag_threshold: z.enum(['low', 'medium', 'high']).optional(),
  recheck_after_days: NonNegInt.optional(),
  plagiarism_check: z.boolean().optional(),
  citation_density_min: NonNegNumber.optional(),
  citation_density_max: NonNegNumber.optional(),
});

export const HumanizerSchema = z.object({
  enabled: z.boolean().optional(),
  preserve_voice: z.enum(['academic', 'formal', 'casual']).optional(),
  honesty_score: z.boolean().optional(),
  honesty_backend: z.enum(['gptzero', 'originality', 'sapling']).optional(),
});

export const StyleSchema = z.object({
  match_past_writing: z.boolean().optional(),
  samples_dir: z.string().optional(),
});

export const PaperSlugOverrideSchema = z.object({
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
});

/** Paper-level [runtime]: provider, model, effort, price overrides, fallbacks and per-slug overrides only (S-18). */
export const PaperRuntimeSchema = z.object({
  provider: ProviderNameSchema.optional(),
  model: z.string().min(1).optional(),
  effort: EffortSchema.optional(),
  price_in_per_mtok: NonNegNumber.optional(),
  price_out_per_mtok: NonNegNumber.optional(),
  refusal_fallbacks: RefusalFallbacksSchema.optional(),
  slugs: z.record(z.string(), PaperSlugOverrideSchema).optional(),
});

export const BudgetSchema = z.object({
  cost_cap_usd: z.number().positive().finite().optional(),
  warn_at_usd: NonNegNumber.optional(),
});

export const NetworkSchema = z.object({
  contact_email_env: z.string().min(1).optional(),
  http_cache_ttl_seconds: NonNegInt.optional(),
  http_search_cache_ttl_seconds: NonNegInt.optional(),
  http_max_retries: NonNegInt.optional(),
  http_backoff_base_ms: NonNegInt.optional(),
});

export const LoggingSchema = z.object({
  session_bodies: z.enum(['full', 'redacted']).optional(),
});

export const PaperConfigSchema = z.object({
  schema_version: z.literal(CURRENT_CONFIG_VERSION),
  project: ProjectSchema.optional(),
  sources: SourcesSchema.optional(),
  verification: VerificationSchema.optional(),
  humanizer: HumanizerSchema.optional(),
  style: StyleSchema.optional(),
  runtime: PaperRuntimeSchema.optional(),
  budget: BudgetSchema.optional(),
  network: NetworkSchema.optional(),
  logging: LoggingSchema.optional(),
});

export type PaperConfig = z.infer<typeof PaperConfigSchema>;
export type PaperRuntimeConfig = z.infer<typeof PaperRuntimeSchema>;

/** Top-level tables and their object schemas (used for unknown-key detection). */
export const CONFIG_TABLES: Readonly<Record<string, z.AnyZodObject>> = Object.freeze({
  project: ProjectSchema,
  sources: SourcesSchema,
  verification: VerificationSchema,
  humanizer: HumanizerSchema,
  style: StyleSchema,
  runtime: PaperRuntimeSchema,
  budget: BudgetSchema,
  network: NetworkSchema,
  logging: LoggingSchema,
});
