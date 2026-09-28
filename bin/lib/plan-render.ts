// bin/lib/plan-render.ts — PLAN.md rendering and body parsing (GRND-09,
// GRND-13, D-18-17, D-18-23).
//
// A section's PLAN.md is written in two shapes, both rendered here and never
// copied from model text:
//
//   - the STUB outline approval writes (section-stubs.ts): the v2 frontmatter
//     with the section's outline entry, `stub: true`, `status: planned`, and a
//     body `## Outline entry` holding the purpose. The router sends a stub to
//     `plan`.
//   - the PLANNED file `plan` writes from the validated section-planner object:
//     the same frontmatter without `stub` (the outline entry kept,
//     `assigned_sources` = the validated subset) and a body `## Claims`
//     (numbered; per claim its sources, the evidence required and the
//     counterexamples), `## Structure` (numbered paragraphs with their purpose
//     and claim numbers), `## Word target` and `## Voice`. The router sends a
//     planned section to `write`.
//
// parsePlanBody / parsePlanClaims read the planned body back (LF and CRLF),
// so the claims can be summarised for downstream planners (GRND-12) and the
// template's own example is provably consumable (tests/plan-contract.test.ts).
// PURE: no fs, no network.

import { serializeFrontmatter } from './frontmatter.js';
import { CURRENT_PLAN_FRONTMATTER_VERSION, PlanFrontmatterSchema } from './schemas/plan-frontmatter.js';

/** One claim of a planned section. */
export interface PlanClaim {
  claim: string;
  sources: string[];
  evidence: string;
  counterexamples: string;
}

/** One paragraph of a planned section's structure. */
export interface PlanParagraph {
  paragraph: number;
  purpose: string;
  claims: number[];
}

/** The parsed body of a planned PLAN.md. */
export interface PlanBody {
  claims: PlanClaim[];
  structure: PlanParagraph[];
  wordTarget: number | null;
  voice: string;
}

/** The frontmatter fields a section's PLAN.md carries (v2). */
export interface PlanEntryFields {
  section: number;
  suffix?: string | undefined;
  slug: string;
  title: string;
  purpose?: string | undefined;
  role?: string | undefined;
  depends_on: readonly string[];
  word_target?: number | undefined;
  voice?: string | undefined;
  assigned_sources: readonly string[];
  /** A per-section `wave:` override carried over from an earlier PLAN.md. */
  wave?: number | undefined;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The v2 frontmatter object in its canonical key order. Validated through
 * PlanFrontmatterSchema, so a renderer can never write a file the loader
 * refuses.
 */
function frontmatterObject(fields: PlanEntryFields, extra: { stub?: true; status: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema_version: CURRENT_PLAN_FRONTMATTER_VERSION,
    section: fields.section,
  };
  if (fields.suffix !== undefined) out['suffix'] = fields.suffix;
  out['slug'] = fields.slug;
  out['title'] = oneLine(fields.title) || fields.slug;
  if (fields.purpose !== undefined && oneLine(fields.purpose).length > 0) out['purpose'] = oneLine(fields.purpose);
  if (fields.role !== undefined) out['role'] = fields.role;
  out['depends_on'] = [...fields.depends_on];
  if (fields.word_target !== undefined && fields.word_target > 0) out['word_target'] = fields.word_target;
  if (fields.voice !== undefined && oneLine(fields.voice).length > 0) out['voice'] = oneLine(fields.voice);
  out['assigned_sources'] = [...new Set(fields.assigned_sources)];
  if (fields.wave !== undefined) out['wave'] = fields.wave;
  if (extra.stub === true) out['stub'] = true;
  out['status'] = extra.status;
  out['verified_against_draft_hash'] = null;
  PlanFrontmatterSchema.parse(out);
  return out;
}

/** Insert the --dry-run marker line after the body's first heading. */
function withMarker(heading: string, marker: string | null | undefined): string[] {
  return marker ? [heading, '', marker, ''] : [heading, ''];
}

/**
 * The stub PLAN.md outline approval writes for one section (D-18-17): the
 * outline entry, `stub: true`, `status: planned`, and a `## Outline entry`
 * body with the purpose.
 */
export function renderStubPlanMd(fields: PlanEntryFields, opts: { marker?: string | null } = {}): string {
  const fm = frontmatterObject(fields, { stub: true, status: 'planned' });
  const body = [
    ...withMarker('## Outline entry', opts.marker),
    oneLine(fields.purpose ?? '') || '(the outline gave no purpose for this section)',
    '',
  ];
  return `${serializeFrontmatter(fm)}\n${body.join('\n')}`;
}

/** The validated planner output as plan-render needs it. */
export interface PlannedSection {
  claims: ReadonlyArray<{ claim: string; sources: readonly string[]; evidence: string; counterexamples: string }>;
  structure: ReadonlyArray<{ paragraph: number; purpose: string; claims: readonly number[] }>;
  voice: string;
}

/** The planned PLAN.md body (Claims, Structure, Word target, Voice). */
export function renderPlanBody(plan: PlannedSection, wordTarget: number | undefined, opts: { marker?: string | null } = {}): string {
  const lines: string[] = [...withMarker('## Claims', opts.marker)];
  plan.claims.forEach((c, i) => {
    lines.push(`${i + 1}. ${oneLine(c.claim)}`);
    lines.push(`   - Sources: ${c.sources.length > 0 ? [...new Set(c.sources)].join(', ') : '(none)'}`);
    lines.push(`   - Evidence: ${oneLine(c.evidence) || '(none)'}`);
    lines.push(`   - Counterexamples: ${oneLine(c.counterexamples) || '(none)'}`);
  });
  lines.push('', '## Structure', '');
  const paragraphs = [...plan.structure].sort((a, b) => a.paragraph - b.paragraph);
  paragraphs.forEach((p, i) => {
    const claims = p.claims.length > 0 ? `claims ${[...new Set(p.claims)].join(', ')}` : 'claims none';
    lines.push(`${i + 1}. ${oneLine(p.purpose)} — ${claims}`);
  });
  lines.push('', '## Word target', '');
  lines.push(wordTarget !== undefined && wordTarget > 0 ? `${wordTarget} words` : '(not set)');
  lines.push('', '## Voice', '');
  lines.push(oneLine(plan.voice) || '(no voice direction)');
  lines.push('');
  return lines.join('\n');
}

/**
 * The planned PLAN.md `plan` writes (D-18-23): the outline entry kept, `stub`
 * dropped, `status: planned`, the validated `assigned_sources`, and the body.
 */
export function renderPlannedPlanMd(
  fields: PlanEntryFields,
  plan: PlannedSection,
  opts: { marker?: string | null } = {},
): string {
  const fm = frontmatterObject(fields, { status: 'planned' });
  return `${serializeFrontmatter(fm)}\n${renderPlanBody(plan, fields.word_target, opts)}`;
}

// ---------------------------------------------------------------------------
// Parsing the planned body back
// ---------------------------------------------------------------------------

const MARKER_PREFIX = '> OFFLINE MODE (';

/** The body split into `## ` sections (heading text lower-cased → lines). */
function bodySections(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) {
      const key = (h[1] as string).toLowerCase();
      current = [];
      if (!out.has(key)) out.set(key, current);
      continue;
    }
    if (current !== null && !raw.startsWith(MARKER_PREFIX)) current.push(raw);
  }
  return out;
}

function noneToEmpty(v: string): string {
  const t = v.trim();
  return t === '(none)' ? '' : t;
}

function listOf(v: string): string[] {
  const t = noneToEmpty(v);
  return t.length === 0 ? [] : t.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}

/** Read `## Claims` back (LF or CRLF). */
export function parsePlanClaims(body: string): PlanClaim[] {
  const lines = bodySections(body).get('claims') ?? [];
  const claims: PlanClaim[] = [];
  let cur: PlanClaim | null = null;
  for (const line of lines) {
    const start = /^(\d+)\.\s+(.*)$/.exec(line);
    if (start) {
      cur = { claim: (start[2] as string).trim(), sources: [], evidence: '', counterexamples: '' };
      claims.push(cur);
      continue;
    }
    if (cur === null) continue;
    const field = /^\s+-\s+(Sources|Evidence|Counterexamples):\s*(.*)$/i.exec(line);
    if (!field) continue;
    const key = (field[1] as string).toLowerCase();
    const value = field[2] as string;
    if (key === 'sources') cur.sources = listOf(value);
    else if (key === 'evidence') cur.evidence = noneToEmpty(value);
    else cur.counterexamples = noneToEmpty(value);
  }
  return claims;
}

/** Read `## Structure` back. */
export function parsePlanStructure(body: string): PlanParagraph[] {
  const lines = bodySections(body).get('structure') ?? [];
  const out: PlanParagraph[] = [];
  for (const line of lines) {
    const m = /^(\d+)\.\s+(.*?)(?:\s+—\s+claims?\s+(none|[\d,\s]+))?\s*$/.exec(line);
    if (!m) continue;
    const claims = m[3] === undefined || m[3] === 'none'
      ? []
      : (m[3] as string).split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 1);
    out.push({ paragraph: Number(m[1]), purpose: (m[2] as string).trim(), claims });
  }
  return out;
}

/** Read the whole planned body back. */
export function parsePlanBody(body: string): PlanBody {
  const sections = bodySections(body);
  const wordLines = (sections.get('word target') ?? []).join('\n');
  const wm = /(\d+)\s+words?/i.exec(wordLines);
  const voice = oneLine((sections.get('voice') ?? []).join(' '));
  return {
    claims: parsePlanClaims(body),
    structure: parsePlanStructure(body),
    wordTarget: wm ? Number(wm[1]) : null,
    voice: voice === '(no voice direction)' ? '' : voice,
  };
}

/**
 * A short summary of a planned section's claims for a downstream planner
 * (GRND-12): `1. claim 2. claim …`, at most `max` characters. The claims' citekeys
 * are left out — a planner sees only its own section's sources (FEED-01).
 * '' when the body has no claims (a stub, or a legacy PLAN.md).
 */
export function summarizePlanClaims(body: string, max = 600): string {
  const parts = parsePlanClaims(body).map((c, i) => `${i + 1}. ${c.claim}`);
  const text = parts.join(' ');
  if (text.length <= max) return text;
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}
