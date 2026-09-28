// bin/lib/drafter-input.ts — the drafter's input contract and its ONE request
// builder (WRTE-01, WRTE-04, T-3-10; Phase 18 FEED-02, D-18-24).
//
// The section-drafter request is built ONLY from a validated DrafterInput
// (buildDrafterRequest), for `write N` and every node of a wave write alike, so
// both send byte-identical requests for the same section. The input is
// assembled from exactly one section's files (assembleDrafterInput):
//   - PLAN.md: its frontmatter (identity, word target, voice, assigned_sources)
//     and its body (the claim map, structure, word target and voice the
//     planner wrote — lifecycle keys never reach the model, so a replayed write
//     still matches after status moves, RUN-17);
//   - LIBRARY.json records of EXACTLY that PLAN.md's `assigned_sources`, as
//     source-context.ts records (fenced in the request, FEED-05) — the drafter
//     never sees another section's sources (PRD §7.6);
//   - the paper brief (topic, effective thesis, discipline and its tone);
//   - the resolved voice (resolveVoiceHint) and, when style-match is on, the
//     STYLE.json render as `style_profile` (PRD §7.18).
// `.strict()` is the WRTE-04 chokepoint: a caller-injected field outside the
// contract throws, and the source records must be exactly the citekeys in
// `sources`, in order.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FrontmatterVersionError, loadFrontmatterDocSync } from './frontmatter.js';
import { paperDir, sectionPlan } from './paths.js';
import { PlanFrontmatterSchema, type PlanFrontmatter } from './schemas/plan-frontmatter.js';
import { StyleProfileSchema, type StyleProfile } from './schemas/style.js';
import { styleMatchToVoiceHint } from './style-match.js';
import { buildSourceContext, type SourceContextInput } from './source-context.js';
import { buildPromptRequest, type PromptRequest } from './prompt-request.js';
import { readOutlineSync } from './outline.js';
import { readPaperBrief } from './paper-brief.js';
import { tryReadPaperConfigSync } from './config.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from './exit-codes.js';
import { formatSectionId, sectionIdOf } from './section-id.js';

const SLUG = /^[a-z0-9-]+$/;

/** A SourceContextRecord (source-context.ts) as the contract validates it. */
export const SourceContextRecordSchema = z.object({
  citekey: z.string().min(1),
  title: z.string(),
  authors: z.array(z.string()).max(5),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  abstract: z.string().max(800).nullable(),
  tier: z.string().nullable(),
  full_text: z.boolean(),
}).strict();

/**
 * Strict drafter-input schema (FEED-02, D-18-24). Every other field throws.
 *
 *   - planPath:      the section's PLAN.md (relative to the project root)
 *   - paper:         the brief — topic, effective thesis, discipline, tone
 *   - section:       n, letter (§1a) or null, slug, title, role, word target
 *   - sources:       the citekeys of EXACTLY the PLAN.md assigned_sources
 *   - sourceRecords: their LIBRARY.json records, in that order
 *   - plan:          the PLAN.md body (the planner's claim map and structure)
 *   - voiceHint:     the resolved voice direction (never empty)
 *   - styleProfile:  the STYLE.json render, only when style-match is on
 */
export const DrafterInputSchema = z.object({
  planPath: z.string().min(1),
  paper: z.object({
    topic: z.string(),
    thesis: z.string(),
    discipline: z.string().min(1),
    tone: z.string(),
  }).strict(),
  section: z.object({
    n: z.number().int().min(1),
    suffix: z.string().regex(/^[a-z]$/).nullable(),
    slug: z.string().regex(SLUG),
    title: z.string().min(1),
    role: z.string().nullable(),
    word_target: z.number().int().positive(),
  }).strict(),
  sources: z.array(z.string().min(1)),
  sourceRecords: z.array(SourceContextRecordSchema),
  plan: z.string(),
  voiceHint: z.string().min(1),
  styleProfile: z.string().min(1).optional(),
}).strict().superRefine((input, ctx) => {
  const keys = input.sourceRecords.map((r) => r.citekey);
  const seen = new Set<string>();
  for (const [i, k] of keys.entries()) {
    if (!input.sources.includes(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRecords', i, 'citekey'], message: `source record "${k}" is not one of the section's assigned sources` });
    }
    if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRecords', i, 'citekey'], message: `duplicate source record "${k}"` });
    seen.add(k);
  }
});

export type DrafterInput = z.infer<typeof DrafterInputSchema>;

/**
 * Validate a drafter input. THROWS on:
 *   - extra top-level fields (`.strict()` chokepoint — WRTE-04, T-3-10)
 *   - a missing required field or a wrong type
 *   - a source record that is not one of the section's assigned sources
 *
 * @throws {ZodError} with a path that names the offending field.
 */
export function assertDrafterInput(input: unknown): asserts input is DrafterInput {
  DrafterInputSchema.parse(input);
}

/**
 * The section-drafter request (FEED-02), built only from a validated input:
 * the fixed template as the system prompt and the data blocks brief, section,
 * voice, style_profile (when style-match is on), plan and — fenced — the
 * source records. Single and wave writes call this one function.
 */
export function buildDrafterRequest(input: DrafterInput): PromptRequest {
  assertDrafterInput(input);
  const s = input.section;
  return buildPromptRequest('section-drafter', {
    brief: { topic: input.paper.topic, thesis: input.paper.thesis, discipline: input.paper.discipline, tone: input.paper.tone },
    section: { n: s.n, suffix: s.suffix, slug: s.slug, title: s.title, role: s.role, word_target: s.word_target },
    voice: input.voiceHint,
    ...(input.styleProfile !== undefined ? { style_profile: input.styleProfile } : {}),
    plan: input.plan,
    sources: input.sourceRecords.map((r) => ({
      citekey: r.citekey,
      title: r.title,
      authors: [...r.authors],
      year: r.year,
      venue: r.venue,
      abstract: r.abstract,
      tier: r.tier,
      full_text: r.full_text,
    })),
  });
}

// ---------------------------------------------------------------------------
// Voice (STYL-03, PRD §7.18, D-18-24)
// ---------------------------------------------------------------------------

/** A legacy explicit direction in a PLAN.md: frontmatter `voice_hint:` or a body `Voice:` line. */
function legacyVoiceDirection(planMd: string): string {
  if (typeof planMd !== 'string' || planMd.length === 0) return '';
  const fmMatch = /(?:^|\n)voice_hint:\s*(.+)/.exec(planMd);
  if (fmMatch && typeof fmMatch[1] === 'string') {
    const v = fmMatch[1].replace(/^["']|["']$/g, '').trim();
    if (v.length > 0) return v;
  }
  const bodyMatch = /(?:^|\n)\s*Voice:\s*(.+)/.exec(planMd);
  if (bodyMatch && typeof bodyMatch[1] === 'string') {
    const v = bodyMatch[1].trim();
    if (v.length > 0) return v;
  }
  return '';
}

/** The frontmatter `voice:` of a PLAN.md text (the outline's hint, D-18-17). */
function planVoice(planMd: string): string {
  const text = planMd.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return '';
  const end = text.indexOf('\n---', 4);
  const m = /(?:^|\n)voice:\s*(.+)/.exec(end > 0 ? text.slice(0, end) : '');
  return m && typeof m[1] === 'string' ? m[1].replace(/^["']|["']$/g, '').trim() : '';
}

/** The never-empty default when no hint, profile or preset tone is available. */
export const DEFAULT_VOICE_HINT = 'Formal academic prose: precise, measured, and free of filler.';

/** The preset tone default (D-18-24): the discipline's tone as a direction. */
export function presetVoiceHint(tone: string, disciplineName: string): string {
  const t = tone.trim();
  if (t.length === 0) return DEFAULT_VOICE_HINT;
  return `Write in a ${t} register suited to ${disciplineName.trim() || 'the discipline'}.`;
}

/**
 * Resolve the drafter's voice by STRICT priority (STYL-03 / Pitfall 7, D-18-24):
 *   1. the section's own hint — its PLAN.md `voice` (the outline's), else its
 *      OUTLINE row `voice`, else a legacy explicit PLAN.md direction
 *      (`voice_hint:` / a `Voice:` line) — ALWAYS wins over the inferred
 *      style profile (T-08-05-02);
 *   2. the STYLE.json render, when style-match is on (styleMatchToVoiceHint);
 *   3. the discipline preset's tone (`presetHint`), else DEFAULT_VOICE_HINT.
 * PURE — no I/O.
 */
export function resolveVoiceHint(input: {
  planMd: string;
  outlineVoice?: string | undefined;
  styleProfile?: StyleProfile | undefined;
  presetHint?: string | undefined;
}): string {
  const section = planVoice(input.planMd) || (input.outlineVoice ?? '').trim() || legacyVoiceDirection(input.planMd);
  if (section.length > 0) return section;
  if (input.styleProfile) return styleMatchToVoiceHint(input.styleProfile);
  return (input.presetHint ?? '').trim() || DEFAULT_VOICE_HINT;
}

/**
 * The paper's style profile when style-match is on: STYLE.json present and
 * valid, and config.toml `[style] match_past_writing` not false. A malformed
 * STYLE.json degrades to no profile — never throws (T-08-05-05).
 */
export function loadStyleProfile(paperRoot: string): StyleProfile | undefined {
  if (tryReadPaperConfigSync(paperRoot)?.style?.match_past_writing === false) return undefined;
  const stylePath = path.join(paperDir(paperRoot), 'STYLE.json');
  if (!existsSync(stylePath)) return undefined;
  try {
    return StyleProfileSchema.parse(JSON.parse(readFileSync(stylePath, 'utf8')));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Assembling one section's input from its files
// ---------------------------------------------------------------------------

/** A PLAN.md write cannot use (one line naming the file and the field). */
export class PlanUnreadableError extends PensmithError {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail} — fix the file, or re-plan with \`pensmith plan\``, EXIT_ERROR);
    this.name = 'PlanUnreadableError';
  }
}

/** A section whose PLAN.md is still the outline's stub (GRND-16): plan it first. */
export class SectionNotPlannedError extends PensmithError {
  readonly sectionId: string;
  constructor(id: string) {
    super(`section ${id} is not planned yet — run \`pensmith plan ${id}\` first`, EXIT_USAGE);
    this.name = 'SectionNotPlannedError';
    this.sectionId = id;
  }
}

/** The project-relative, forward-slash path of a file (for messages and the contract). */
function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** The first zod issue as `field: message`. */
function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'invalid frontmatter';
  const where = issue.path.length > 0 ? issue.path.join('.') : 'frontmatter';
  return `invalid field "${where}": ${issue.message}`;
}

/**
 * Read and validate a section's PLAN.md (GRND-13/16): throws PlanUnreadableError
 * naming the file and the field for a malformed file — never a raw ZodError and
 * never a silent `[]` of sources.
 */
export function readSectionPlan(paperRoot: string, file: string): { frontmatter: PlanFrontmatter; raw: Record<string, unknown>; body: string; text: string } {
  const name = rel(paperRoot, file);
  if (!existsSync(file)) throw new PlanUnreadableError(name, 'missing');
  let doc;
  try {
    doc = loadFrontmatterDocSync('plan', file);
  } catch (e) {
    // A PLAN.md from a newer pensmith keeps its own one line ("upgrade pensmith", CONF-04).
    if (e instanceof FrontmatterVersionError) throw e;
    throw new PlanUnreadableError(name, (e as Error).message.split('\n')[0] ?? 'unreadable');
  }
  const r = PlanFrontmatterSchema.safeParse(doc.frontmatter);
  if (!r.success) throw new PlanUnreadableError(name, firstIssue(r.error));
  return { frontmatter: r.data, raw: doc.frontmatter, body: doc.body, text: readFileSync(file, 'utf8') };
}

/** One section's assembled drafter input plus what write reports about it. */
export interface AssembledDrafterInput {
  readonly input: DrafterInput;
  /** Citekeys in assigned_sources that LIBRARY.json does not hold (sent without a record). */
  readonly missingRecords: string[];
}

/**
 * Assemble the drafter input of section (n, slug) from its PLAN.md, the
 * library, the brief, the outline row and the style profile. Throws
 * SectionNotPlannedError for a stub and PlanUnreadableError for a malformed
 * PLAN.md.
 */
export function assembleDrafterInput(
  paperRoot: string,
  section: { n: number; slug: string },
  libraryEntries: readonly SourceContextInput[],
): AssembledDrafterInput {
  const planPath = sectionPlan(section.n, section.slug, paperRoot);
  if (!existsSync(planPath)) throw new SectionNotPlannedError(formatSectionId(sectionIdOf(section.n)));
  const plan = readSectionPlan(paperRoot, planPath);
  const fm = plan.frontmatter;
  const id = formatSectionId(sectionIdOf(fm.section, fm.suffix));
  if (fm.stub === true) throw new SectionNotPlannedError(id);
  const brief = readPaperBrief(paperRoot);
  const row = readOutlineSync(paperRoot)?.sections.find((s) => s.slug === section.slug);
  const profile = loadStyleProfile(paperRoot);
  const sources = [...new Set(fm.assigned_sources)];
  const records = buildSourceContext(libraryEntries, sources);
  const held = new Set(records.map((r) => r.citekey));
  const voiceHint = resolveVoiceHint({
    planMd: plan.text,
    outlineVoice: row?.voice,
    styleProfile: profile,
    presetHint: presetVoiceHint(brief.discipline.tone, brief.discipline.preset.name),
  });
  const wordTarget = fm.word_target ?? row?.estimated_word_count ?? 400;
  const input: DrafterInput = {
    planPath: rel(paperRoot, planPath),
    paper: {
      topic: brief.topic,
      thesis: brief.thesis,
      discipline: brief.discipline.slug.value,
      tone: brief.discipline.tone,
    },
    section: {
      n: fm.section,
      suffix: fm.suffix ?? null,
      slug: fm.slug,
      title: row?.title || fm.title || fm.slug,
      role: row?.role ?? fm.role ?? null,
      word_target: wordTarget > 0 ? wordTarget : 400,
    },
    sources,
    sourceRecords: records.map((r) => ({ ...r, authors: [...r.authors] })),
    plan: plan.body.replace(/\r\n/g, '\n').trim(),
    voiceHint,
    ...(profile ? { styleProfile: styleMatchToVoiceHint(profile) } : {}),
  };
  assertDrafterInput(input);
  return { input, missingRecords: sources.filter((k) => !held.has(k)) };
}
