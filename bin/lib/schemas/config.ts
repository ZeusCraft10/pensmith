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
import { lookupTable } from '../lookup-table.js';

/**
 * v2 (Phase 19, review round 3): `[verification] send_byo_passages` and the
 * `[sources] allowed_databases` values `books` / `nber` (migrations/config/v1_to_v2.ts).
 * v3 (Phase 20, VRFY-18): `[verification] quote_min_words` (migrations/config/v2_to_v3.ts).
 * v4 (Phase 21, D-21-26): `[humanizer] honesty_consent`, the `[compile]` table
 * (`smooth_transitions`, `contradiction_pairs`), `[verification]
 * plagiarism_max_phrases`, and `[project] citation_style` as a path to a local
 * `.csl` file (migrations/config/v3_to_v4.ts).
 */
export const CURRENT_CONFIG_VERSION = 4;

/** The default `[compile] contradiction_pairs` (EXP-11, RUN-26): claim pairs one compile sends to the claim-consistency judge. */
export const DEFAULT_CONTRADICTION_PAIRS = 20;

/** The default `[verification] plagiarism_max_phrases` (EXP-19, D-21-22): distinctive phrases one done probes. */
export const DEFAULT_PLAGIARISM_MAX_PHRASES = 30;

/**
 * `[verification] quote_min_words` (VRFY-18, D-20-17): a direct quote of at
 * least this many words is checked by Pass 3. The default is also the most a
 * paper may ask for: a config.toml travels with a shared paper, and a higher
 * floor would leave longer quotes unchecked (PRD §14; D-20-04 — a local file
 * can add refusals, never remove them). A lower value checks more quotes.
 */
export const DEFAULT_QUOTE_MIN_WORDS = 5;

/** The default `[verification] recheck_after_days` (PRD §7.12, §10; VRFY-28): how old a citation's last check may be before verify and done re-fetch it. */
export const DEFAULT_RECHECK_AFTER_DAYS = 30;

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

/**
 * The citation-style alias table (GRND-04, D-18-11): every accepted spelling,
 * as normalizeStyleName() leaves it, → its CSL key (templates/citation-styles/).
 * Brackets, dashes and a trailing "style" / "format" / "citation(s)" /
 * "referencing" / "edition" collapse first, so "APA 7th edition", "Chicago
 * (Author-Date)", "chicago-notes-bib" and "MLA style" all resolve. A bare
 * "Chicago" is notes-bibliography (the Chicago Manual's default system).
 * A null-prototype table (lookup-table.ts): it is looked up by config text.
 */
export const CITATION_STYLE_KEYS: Readonly<Record<string, string>> = lookupTable({
  apa: 'apa',
  'apa 7': 'apa',
  apa7: 'apa',
  'apa 7th': 'apa',
  'apa 6': 'apa',
  'apa 6th': 'apa',
  mla: 'mla',
  'mla 9': 'mla',
  mla9: 'mla',
  'mla 9th': 'mla',
  'mla 8': 'mla',
  'mla 8th': 'mla',
  chicago: 'chicago-notes-bib',
  'chicago 17': 'chicago-notes-bib',
  'chicago 17th': 'chicago-notes-bib',
  'chicago notes bibliography': 'chicago-notes-bib',
  'chicago notes and bibliography': 'chicago-notes-bib',
  'chicago notes bib': 'chicago-notes-bib',
  'chicago notes': 'chicago-notes-bib',
  'chicago nb': 'chicago-notes-bib',
  'notes bibliography': 'chicago-notes-bib',
  turabian: 'chicago-notes-bib',
  'chicago author date': 'chicago-author-date',
  'chicago ad': 'chicago-author-date',
  'author date': 'chicago-author-date',
  ieee: 'ieee',
  ama: 'ama',
  'ama 11': 'ama',
  'ama 11th': 'ama',
  vancouver: 'vancouver',
  harvard: 'harvard',
});

/**
 * Normalise a style name for the alias table: NFKC, lowercase, brackets,
 * quotes and dashes to spaces, a trailing "style" / "format" / "citation(s)" /
 * "referencing" / "reference(s)" / "edition" / "ed" / "manual" dropped,
 * whitespace collapsed.
 */
export function normalizeStyleName(name: string): string {
  let t = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{}"'`’]/g, ' ')
    .replace(/[-–—_/,:;.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i += 1) {
    const next = t.replace(/\s*\b(?:style|format|formatting|citations?|referencing|references?|edition|ed|manual)$/, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Canonical CSL key for a configured style name, or null when unknown. */
export function citationStyleKey(name: string): string | null {
  const t = normalizeStyleName(name);
  if (t.length === 0) return null;
  return Object.prototype.hasOwnProperty.call(CITATION_STYLE_KEYS, t) ? (CITATION_STYLE_KEYS[t] as string) : null;
}

/** Every accepted style spelling, longest first (intake-overrides.ts scans free text with them). */
export function citationStyleAliases(): string[] {
  return Object.keys(CITATION_STYLE_KEYS).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** The eight styles, for the one-line refusal of an unknown style name (GRND-04). */
export function citationStyleChoices(): string {
  const keys = [...new Set(Object.values(CITATION_STYLE_KEYS))];
  return `${CITATION_STYLE_NAMES.join(', ')} (or their CSL keys: ${keys.join(', ')})`;
}

/**
 * A `citation_style` value that names a local CSL file (EXP-03, D-21-07): a
 * path ending in `.csl`, relative to the project root or absolute. Only its
 * spelling is checked here; bin/lib/export-style.ts `validateCslFile` checks
 * the file itself when done resolves the export style.
 */
export function isCslPathSpelling(v: string): boolean {
  const t = v.trim();
  return t.length > 4 && /\.csl$/i.test(t) && !/[\0\r\n]/.test(t);
}

const CitationStyleSchema = z.string().refine((v) => citationStyleKey(v) !== null || isCslPathSpelling(v), {
  message: `citation_style must be one of: ${CITATION_STYLE_NAMES.join(', ')} — or a path to a local .csl file`,
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
  // Pass 2 (advisory claim support) may send the passages of the user's own
  // PDFs nearest each claim to the configured model provider; off by default
  // (PRD §9: a bring-your-own PDF's contents stay local). Phase 19 review round 2.
  send_byo_passages: z.boolean().optional(),
  // Pass 3 checks every direct quote of at least this many words (VRFY-18):
  // 1..DEFAULT_QUOTE_MIN_WORDS — a paper may only ask for a stricter floor.
  quote_min_words: z
    .number()
    .int()
    .min(1, { message: `quote_min_words must be between 1 and ${DEFAULT_QUOTE_MIN_WORDS}` })
    .max(DEFAULT_QUOTE_MIN_WORDS, {
      message:
        `quote_min_words must be between 1 and ${DEFAULT_QUOTE_MIN_WORDS}: a higher floor would leave longer ` +
        'direct quotes unchecked by Pass 3 (PRD §14) — lower it to check shorter quotes too',
    })
    .optional(),
  flag_threshold: z.enum(['low', 'medium', 'high']).optional(),
  recheck_after_days: NonNegInt.optional(),
  plagiarism_check: z.boolean().optional(),
  // EXP-19 (D-21-22): how many distinctive phrases done sends to the search (at least one per body paragraph, up to this).
  plagiarism_max_phrases: PositiveInt.optional(),
  citation_density_min: NonNegNumber.optional(),
  citation_density_max: NonNegNumber.optional(),
});

/** The AI-detection backends (EXP-18): `[humanizer] honesty_backend`. */
export const HONESTY_BACKENDS = ['gptzero', 'originality', 'sapling'] as const;

export const HumanizerSchema = z.object({
  enabled: z.boolean().optional(),
  preserve_voice: z.enum(['academic', 'formal', 'casual']).optional(),
  honesty_score: z.boolean().optional(),
  honesty_backend: z.enum(HONESTY_BACKENDS, {
    errorMap: () => ({ message: `honesty_backend must be one of: ${HONESTY_BACKENDS.join(', ')}` }),
  }).optional(),
  // EXP-17 (D-21-20): the answer to the detector-consent question, asked once
  // in a terminal and recorded here (true: send the paper to the detector;
  // false: never). Unset means not asked yet; --yolo never answers it.
  honesty_consent: z.boolean().optional(),
});

/**
 * `[compile]` (EXP-10, EXP-11; D-21-14, D-21-15): the boundary smoother and the
 * cross-section contradiction check.
 */
export const CompileSchema = z.object({
  smooth_transitions: z.boolean().optional(),
  contradiction_pairs: NonNegInt.optional(),
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
  compile: CompileSchema.optional(),
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
  compile: CompileSchema,
  style: StyleSchema,
  runtime: PaperRuntimeSchema,
  budget: BudgetSchema,
  network: NetworkSchema,
  logging: LoggingSchema,
});
