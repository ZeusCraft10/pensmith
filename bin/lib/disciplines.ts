// bin/lib/disciplines.ts — the ONE discipline-preset loader and resolver
// (GRND-06, PRD §8, D-18-09).
//
// SEAM FILE (Phase 18 plan, S-A). Every stream copies it byte-identically from
// .planning/phases/18-ground/seams/; no stream edits it during Phase 18.
//
// templates/presets/disciplines.json holds the PRD §8 table (plus `sociology`,
// an extra preset PRD §8 now lists). This module is the only one that reads it
// and the only one that maps a discipline to its citation style, source
// preference, sectioning convention, counterargument default, citation density
// band or tone (chokepoint row `discipline-literals`, GRND-06). Everything else
// asks it.
//
// Precedence for every preset-backed value (GRND-06): preset < intake answer <
// config.toml < CLI flag — resolveLayered() takes the four layers and reports
// which one won, for `status --config`.
//
// The module is pure apart from reading the packaged JSON once (lazily, so
// importing it costs nothing): callers pass the layer values they read through
// intake-brief.ts / config.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Source-preference ids a preset may name (PRD §8; adapters for some land in Phase 19). */
export const SOURCE_PREFERENCE_IDS = [
  'arxiv',
  'semanticscholar',
  'openalex',
  'pubmed',
  'crossref',
  'books',
  'jstor',
  'psycnet',
  'nber',
  'philpapers',
] as const;
export type SourcePreferenceId = (typeof SOURCE_PREFERENCE_IDS)[number];

/** The eight CSL style keys pensmith ships (templates/citation-styles/). */
export const CSL_STYLE_KEYS = [
  'apa',
  'mla',
  'chicago-notes-bib',
  'chicago-author-date',
  'ieee',
  'ama',
  'vancouver',
  'harvard',
] as const;
export type CslStyleKey = (typeof CSL_STYLE_KEYS)[number];

/** A preset's counterargument default: required, not required, or asked at intake (PRD §8 "mixed"). */
export const COUNTERARGUMENT_DEFAULTS = ['on', 'off', 'ask'] as const;
export type CounterargumentDefault = (typeof COUNTERARGUMENT_DEFAULTS)[number];

/** The fallback preset for an unknown or unset discipline. */
export const FALLBACK_DISCIPLINE = 'other';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DensityBandSchema = z
  .object({ min: z.number().nonnegative(), max: z.number().positive() })
  .strict()
  .refine((b) => b.min <= b.max, { message: 'densityPerParagraph.min must be <= max' });

const PresetSchema = z
  .object({
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    defaultTone: z.string().min(1),
    defaultCitationStyle: z.enum(CSL_STYLE_KEYS),
    alternateCitationStyles: z.array(z.enum(CSL_STYLE_KEYS)),
    sourcePreference: z.array(z.enum(SOURCE_PREFERENCE_IDS)).min(1),
    sectioningConvention: z.array(z.string().min(1)),
    counterargDefault: z.enum(COUNTERARGUMENT_DEFAULTS),
    densityPerParagraph: DensityBandSchema,
  })
  .strict();

export const PresetsFileSchema = z
  .object({
    $schemaVersion: z.literal(1),
    presets: z.record(z.string().regex(SLUG_RE), PresetSchema),
  })
  .strict()
  .refine((f) => FALLBACK_DISCIPLINE in f.presets, { message: `the "${FALLBACK_DISCIPLINE}" preset is required` });

export type PresetFile = z.infer<typeof PresetsFileSchema>;

/** One resolved preset (the JSON entry plus its slug). */
export interface DisciplinePreset {
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly defaultTone: string;
  readonly defaultCitationStyle: CslStyleKey;
  readonly alternateCitationStyles: readonly CslStyleKey[];
  readonly sourcePreference: readonly SourcePreferenceId[];
  readonly sectioningConvention: readonly string[];
  readonly counterargDefault: CounterargumentDefault;
  readonly densityPerParagraph: { readonly min: number; readonly max: number };
}

// ---------------------------------------------------------------------------
// Loading
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

/** The packaged preset file (shipped through package.json `files` → templates/). */
export const DISCIPLINES_PATH = path.join(
  findPkgRoot(path.dirname(fileURLToPath(import.meta.url))),
  'templates',
  'presets',
  'disciplines.json',
);

let cache: Readonly<Record<string, DisciplinePreset>> | null = null;

/** Validate a parsed preset file and freeze it into slug → preset. */
export function parsePresetFile(raw: unknown): Readonly<Record<string, DisciplinePreset>> {
  const file = PresetsFileSchema.parse(raw);
  const out: Record<string, DisciplinePreset> = {};
  for (const [slug, p] of Object.entries(file.presets)) {
    out[slug] = Object.freeze({
      slug,
      name: p.name,
      aliases: Object.freeze([...p.aliases]),
      defaultTone: p.defaultTone,
      defaultCitationStyle: p.defaultCitationStyle,
      alternateCitationStyles: Object.freeze([...p.alternateCitationStyles]),
      sourcePreference: Object.freeze([...p.sourcePreference]),
      sectioningConvention: Object.freeze([...p.sectioningConvention]),
      counterargDefault: p.counterargDefault,
      densityPerParagraph: Object.freeze({ min: p.densityPerParagraph.min, max: p.densityPerParagraph.max }),
    });
  }
  return Object.freeze(out);
}

/** Every preset, by slug (read and validated once per process). */
export function loadDisciplinePresets(): Readonly<Record<string, DisciplinePreset>> {
  if (cache === null) cache = parsePresetFile(JSON.parse(readFileSync(DISCIPLINES_PATH, 'utf8')) as unknown);
  return cache;
}

/** The preset slugs, in file order. */
export function disciplineSlugs(): string[] {
  return Object.keys(loadDisciplinePresets());
}

/** True when `slug` names a preset. */
export function isDisciplineSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(loadDisciplinePresets(), slug);
}

/** The preset for `slug`; an unknown slug gets the fallback preset. */
export function presetFor(slug: string): DisciplinePreset {
  const presets = loadDisciplinePresets();
  const hit = Object.prototype.hasOwnProperty.call(presets, slug) ? presets[slug] : undefined;
  return hit ?? (presets[FALLBACK_DISCIPLINE] as DisciplinePreset);
}

function normalizeText(raw: string): string {
  return raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Map free text ("CS", "History", "Biology / Life Sci", "econ, micro") to a
 * preset slug: an exact slug, name or alias first, then the first slug, name
 * or alias found as a whole word run in the text; otherwise the fallback.
 */
export function normalizeDisciplineSlug(raw: string): string {
  const text = normalizeText(raw);
  if (text.length === 0) return FALLBACK_DISCIPLINE;
  const presets = Object.values(loadDisciplinePresets());
  const names = (p: DisciplinePreset): string[] => [p.slug, p.name, ...p.aliases].map(normalizeText).filter((s) => s.length > 0);
  for (const p of presets) if (names(p).includes(text)) return p.slug;
  const padded = ` ${text} `;
  let best: { slug: string; at: number; len: number } | null = null;
  for (const p of presets) {
    for (const n of names(p)) {
      const at = padded.indexOf(` ${n} `);
      if (at < 0) continue;
      if (best === null || at < best.at || (at === best.at && n.length > best.len)) best = { slug: p.slug, at, len: n.length };
    }
  }
  return best?.slug ?? FALLBACK_DISCIPLINE;
}

// ---------------------------------------------------------------------------
// Layered resolution (preset < intake answer < config.toml < CLI flag)
// ---------------------------------------------------------------------------

export type PresetLayer = 'preset' | 'intake' | 'config' | 'flag';

export interface Layered<T> {
  readonly value: T;
  readonly source: PresetLayer;
}

export interface LayerValues<T> {
  readonly preset: T;
  readonly intake?: T | undefined;
  readonly config?: T | undefined;
  readonly flag?: T | undefined;
}

/** The highest-precedence defined layer (flag > config > intake > preset). */
export function resolveLayered<T>(layers: LayerValues<T>): Layered<T> {
  if (layers.flag !== undefined) return { value: layers.flag, source: 'flag' };
  if (layers.config !== undefined) return { value: layers.config, source: 'config' };
  if (layers.intake !== undefined) return { value: layers.intake, source: 'intake' };
  return { value: layers.preset, source: 'preset' };
}

/** Per-layer overrides of the preset-backed values a paper can change. */
export interface DisciplineOverrides {
  readonly citationStyle?: CslStyleKey | undefined;
  readonly counterargument?: CounterargumentDefault | undefined;
}

export interface ResolveDisciplineInput {
  /** The discipline slug for each layer (free text is normalised). */
  readonly discipline: {
    readonly intake?: string | undefined;
    readonly config?: string | undefined;
    readonly flag?: string | undefined;
  };
  readonly intake?: DisciplineOverrides;
  readonly config?: DisciplineOverrides;
  readonly flag?: DisciplineOverrides;
}

export interface ResolvedDiscipline {
  readonly slug: Layered<string>;
  readonly preset: DisciplinePreset;
  readonly citationStyle: Layered<CslStyleKey>;
  readonly counterargument: Layered<CounterargumentDefault>;
  readonly sourcePreference: readonly SourcePreferenceId[];
  readonly sectioningConvention: readonly string[];
  readonly densityPerParagraph: { readonly min: number; readonly max: number };
  readonly tone: string;
}

function norm(v: string | undefined): string | undefined {
  return v === undefined || v.trim().length === 0 ? undefined : normalizeDisciplineSlug(v);
}

/**
 * Resolve a paper's discipline and every preset-backed value with the GRND-06
 * precedence. The discipline itself is layered first (its preset supplies the
 * defaults), then each value is layered over that preset.
 */
export function resolveDiscipline(input: ResolveDisciplineInput): ResolvedDiscipline {
  const slug = resolveLayered<string>({
    preset: FALLBACK_DISCIPLINE,
    intake: norm(input.discipline.intake),
    config: norm(input.discipline.config),
    flag: norm(input.discipline.flag),
  });
  const preset = presetFor(slug.value);
  const citationStyle = resolveLayered<CslStyleKey>({
    preset: preset.defaultCitationStyle,
    intake: input.intake?.citationStyle,
    config: input.config?.citationStyle,
    flag: input.flag?.citationStyle,
  });
  const counterargument = resolveLayered<CounterargumentDefault>({
    preset: preset.counterargDefault,
    intake: input.intake?.counterargument,
    config: input.config?.counterargument,
    flag: input.flag?.counterargument,
  });
  return {
    slug,
    preset,
    citationStyle,
    counterargument,
    sourcePreference: preset.sourcePreference,
    sectioningConvention: preset.sectioningConvention,
    densityPerParagraph: preset.densityPerParagraph,
    tone: preset.defaultTone,
  };
}

/** The default CSL style of a discipline (free text is normalised). */
export function defaultCitationStyleFor(discipline: string): CslStyleKey {
  return presetFor(normalizeDisciplineSlug(discipline)).defaultCitationStyle;
}

/** The citation-density band (citations per paragraph) of a discipline. */
export function densityBandFor(discipline: string): { readonly min: number; readonly max: number } {
  return presetFor(normalizeDisciplineSlug(discipline)).densityPerParagraph;
}

/** Test seam: forget the cached preset file. */
export function __resetDisciplineCacheForTest(): void {
  cache = null;
}
