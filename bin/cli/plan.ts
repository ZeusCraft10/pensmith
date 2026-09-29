// bin/cli/plan.ts — `pensmith plan <n>` verb entrypoint (PLAN-01).
//
// Phase 11 (GEN-02 / GEN-06) + Phase 17 (RUN-07, RUN-25):
//   - assertLlmConfigured('plan') runs at the top of run(): with no usable
//     provider it throws the one-line MissingApiKeyError. Never ok:true on a
//     missing key; PENSMITH_NO_LLM=1 skips it.
//   - The normal plan path calls complete() with the STRUCTURED
//     'section-planner' slug (D-12 LOCKED) and renders PLAN.md from the
//     validated {frontmatter, body} object (renderPlanMd): section identity
//     and depends_on come from OUTLINE.md, assigned_sources is limited to
//     citekeys in the library (PRD §7.6).
//   - The --revise path imports the shared proposeSwap from bin/lib/revise-swap.ts
//     (ONE implementation; no duplication with revise.ts — GEN-02).
//   - The --research <query> path is bin/lib/section-research.ts
//     runSectionResearch (GRND-17): real hits, added to section <n> only.
//
// D-12 LOCKED prompt slug: 'section-planner'.
// D-06 LOCKED chokepoint: --revise delegates to runRevise (bin/lib/revise.ts).
// T-11-09: runRevise's membership guard rejects replacement_citekey ∉ assigned_sources.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { paperDir, sectionPlan, projectRoot } from '../lib/paths.js';
import { updatePlanFrontmatter } from '../lib/plan-status.js';
import { runRevise } from '../lib/revise.js';
import { runSectionResearch } from '../lib/section-research.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { complete, assertLlmConfigured } from '../lib/anthropic.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { parseOutline, parseOutlineAssignedSources, type ParsedOutlineSection } from '../lib/outline-parse.js';
import { parseIntakeMd, escapeTemplateTokens } from '../lib/intake-parse.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { PlanFrontmatterSchema } from '../lib/schemas/plan-frontmatter.js';
import type { SectionPlan } from '../lib/llm-contracts.js';

/** The CLI's output sink for the section research pass (section-research.ts never writes the streams itself). */
const CLI_IO = {
  out: (line: string): void => void process.stdout.write(`${line}\n`),
  err: (line: string): void => void process.stderr.write(`${line}\n`),
};

/** Section context from OUTLINE.md, the library and upstream plans (all best-effort reads). */
interface PlanContext {
  section: ParsedOutlineSection | null;
  outlineSources: string[];
  library: Array<{ citekey: string; title?: string; authors?: string[]; year?: number; doi?: string; abstract?: string }>;
  upstream: Array<{ slug: string; brief: string }>;
  topic: string;
  discipline: string;
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function loadPlanContext(paperRoot: string, n: number): PlanContext {
  const pDir = paperDir(paperRoot);
  const outlineRaw = readText(path.join(pDir, 'OUTLINE.md')) ?? '';
  let sections: ParsedOutlineSection[] = [];
  try {
    sections = parseOutline(outlineRaw).sections;
  } catch {
    sections = [];
  }
  const section = sections.find((s) => s.n === n) ?? null;
  const outlineSources = parseOutlineAssignedSources(outlineRaw).get(n) ?? [];

  const library: PlanContext['library'] = [];
  const libRaw = readText(path.join(pDir, 'LIBRARY.json'));
  if (libRaw !== null) {
    try {
      const raw = JSON.parse(libRaw) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
          ? (raw as { entries: unknown[] }).entries
          : [];
      for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const r = e as Record<string, unknown>;
        if (typeof r['citekey'] !== 'string' || !r['citekey']) continue;
        const c: PlanContext['library'][number] = { citekey: r['citekey'] as string };
        if (typeof r['title'] === 'string') c.title = r['title'];
        if (Array.isArray(r['authors'])) c.authors = (r['authors'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 3);
        if (typeof r['year'] === 'number') c.year = r['year'];
        if (typeof r['doi'] === 'string') c.doi = r['doi'];
        // WR-03 precedent: cap abstracts so the prompt stays bounded.
        if (typeof r['abstract'] === 'string') c.abstract = (r['abstract'] as string).slice(0, 500);
        library.push(c);
      }
    } catch {
      /* malformed LIBRARY.json → no candidates */
    }
  }

  const upstream: PlanContext['upstream'] = [];
  for (const dep of section?.depends_on ?? []) {
    const depSection = sections.find((s) => s.slug === dep);
    if (!depSection) continue;
    const text = readText(sectionPlan(depSection.n, dep, paperRoot));
    if (text === null) continue;
    upstream.push({ slug: dep, brief: parseFrontmatter(text).body.trim().slice(0, 2000) });
  }

  const intake = parseIntakeMd(readText(path.join(pDir, 'INTAKE.md')) ?? '');
  return { section, outlineSources, library, upstream, topic: intake.topic, discipline: intake.discipline };
}

/**
 * Render PLAN.md from the validated section-planner object (RUN-25). The
 * section identity (number, slug) and depends_on come from OUTLINE.md — the
 * roadmap is authoritative — and assigned_sources is filtered to citekeys that
 * exist in the library (PRD §7.6: the drafter may only see real sources).
 */
function renderPlanMd(data: SectionPlan, n: number, slug: string, ctx: PlanContext): string {
  const known = new Set(ctx.library.map((c) => c.citekey));
  const assigned = known.size > 0
    ? data.frontmatter.assigned_sources.filter((c) => known.has(c))
    : data.frontmatter.assigned_sources;
  const fm = PlanFrontmatterSchema.parse({
    section: n,
    slug,
    title: (ctx.section?.title ?? data.frontmatter.title ?? slug).trim() || slug,
    depends_on: ctx.section ? ctx.section.depends_on : data.frontmatter.depends_on.filter((d) => d !== slug),
    assigned_sources: [...new Set(assigned)],
    status: 'planned',
    verified_against_draft_hash: null,
  });
  // CONF-04: every PLAN.md the CLI writes carries the current frontmatter
  // version first, exactly where the v0 → v1 migration inserts it.
  const ordered: Record<string, unknown> = {
    schema_version: fm.schema_version,
    section: fm.section,
    slug: fm.slug,
    title: fm.title,
    depends_on: fm.depends_on,
    assigned_sources: fm.assigned_sources,
    status: fm.status,
    verified_against_draft_hash: fm.verified_against_draft_hash,
  };
  const body = data.body.trim().startsWith('#') ? data.body.trim() : `## Brief\n\n${data.body.trim()}`;
  return `${serializeFrontmatter(ordered)}\n${body}\n`;
}

export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'Generate a per-section PLAN.md (one section at a time). --revise repairs a verifier-flagged citation.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to the outline\'s slug for <n>).',
    },
    revise: {
      type: 'boolean',
      description: 'Repair a verifier-flagged citation (PLAN-02 — delegates to bin/lib/revise.ts::runRevise).',
      default: false,
    },
    research: {
      type: 'string',
      description: 'Search for more sources for this section and add the ones you approve to its assigned sources (GRND-17).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    // RUN-09: <n> must name one of the paper's sections and --slug must be a
    // bare slug — EXIT_USAGE otherwise, before any model call or write. The
    // slug comes from OUTLINE.md (audit #23); 'placeholder' only when there is
    // no outline yet.
    const { n, slug } = resolveSectionArg('plan', projectRoot(), args.n, args.slug);

    // GRND-17 / D-19-18: `plan <N> --research <query>` is a real section-scoped
    // research pass that adds hits to section N only (bin/lib/section-research.ts;
    // `revise --research` runs the same function). It refuses a run that could
    // never answer its approval question before anything else happens.
    const research = typeof args.research === 'string' && args.research.trim().length > 0 ? args.research : undefined;
    let researched: Awaited<ReturnType<typeof runSectionResearch>> | null = null;
    if (research) {
      researched = await runSectionResearch({ root: projectRoot(), n, slug, query: research, yolo: args.yolo === true, verb: 'plan', io: CLI_IO });
      if (args.revise !== true) return { mode: 'research', ...researched };
    }

    // GEN-06 / RUN-07 fail-loud probe: assert an LLM is configured before any LLM work.
    await assertLlmConfigured('plan');

    // PLAN-02 / D-05: `pensmith plan <N> --revise` is the canonical revise
    // surface. It routes through the single runRevise chokepoint (D-06) —
    // identical to bin/cli/revise.ts. This keeps the locked UX-02 16-verb set
    // intact (no new top-level verb) while shipping WRTE-02.
    if (args.revise === true) {
      const result = await runRevise({
        paperRoot: projectRoot(),
        n,
        slug,
        yolo: args.yolo === true,
        // Real shared proposeSwap from bin/lib/revise-swap.ts (GEN-02).
        // runRevise owns parsing the returned JSON + the membership guard that
        // rejects any replacement_citekey ∉ assigned_sources (T-04-14 / T-11-09).
        proposeSwap,
      });
      process.stdout.write(`pensmith plan --revise: ${result.message}\n`);
      return { ok: !result.retryExhausted, mode: 'revise', ...result, ...(researched ? { research: researched } : {}) };
    }

    // Normal plan path: the 'section-planner' prompt (D-12 LOCKED slug) with the
    // section's outline row, the library candidates (the outline's assigned
    // subset when present), the INTAKE topic/discipline and the upstream briefs.
    // section-planner is STRUCTURED (RUN-25): complete() returns
    // {frontmatter, body} and PLAN.md is rendered from it.
    const paperRoot = projectRoot();
    const ctx = loadPlanContext(paperRoot, n);
    const title = ctx.section?.title ?? slug;
    const candidateList = ctx.outlineSources.length > 0
      ? ctx.library.filter((c) => ctx.outlineSources.includes(c.citekey))
      : ctx.library;
    const planPrompt = loadPrompt('section-planner');
    const interpolatedPlan = interpolate(planPrompt, {
      section: JSON.stringify({
        number: n,
        slug,
        title,
        depends_on: ctx.section?.depends_on ?? [],
        estimated_word_count: ctx.section?.estimated_word_count ?? 400,
      }),
      candidateSources: JSON.stringify(candidateList.length > 0 ? candidateList : ctx.library, null, 2),
      topic: escapeTemplateTokens(ctx.topic || 'the assigned topic'),
      discipline: escapeTemplateTokens(ctx.discipline),
      upstreamPlans: JSON.stringify(ctx.upstream),
    });
    const targetPath = sectionPlan(n, slug, paperRoot);
    const result = await complete<SectionPlan>({
      slug: 'section-planner',
      section: n,
      system:
        'You are an academic section planner. Produce the section plan exactly as the prompt ' +
        'specifies: the frontmatter fields and the ## Brief body.',
      messages: [{ role: 'user', content: interpolatedPlan }],
      stubHint: {
        section: n,
        slug,
        title,
        depends_on: ctx.section?.depends_on ?? [],
        sources: (candidateList.length > 0 ? candidateList : ctx.library).map((c) => c.citekey),
      },
    });
    await atomicWriteFile(targetPath, renderPlanMd(result.data as SectionPlan, n, slug, ctx));

    // Second-loop finding (Theme A): authoritatively mark the section 'writing'
    // so the router (router.ts:201) advances plan -> write instead of looping on
    // plan forever. The CLI owns this transition — it must NOT depend on the
    // model emitting `status:` in the PLAN.md frontmatter (the offline placeholder
    // has none, and the section-planner prompt does not mandate it). Mirrors how
    // write sets 'written' (#9) and verify sets 'verified' (#8).
    await updatePlanFrontmatter(targetPath, (fm) => {
      fm.status = 'writing';
    });
    process.stdout.write(`pensmith plan: wrote PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath };
  },
});

export default planCommand;
