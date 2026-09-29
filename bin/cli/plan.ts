// bin/cli/plan.ts — `pensmith plan <n>` verb entrypoint (PLAN-01, GRND-12,
// GRND-13, FEED-01).
//
//   - assertLlmConfigured('plan') runs at the top of run(): with no usable
//     provider it throws the one-line MissingApiKeyError. Never ok:true on a
//     missing key; PENSMITH_NO_LLM=1 skips it.
//   - The normal plan path calls complete() with the STRUCTURED
//     'section-planner' slug (D-12 LOCKED). The request (prompt-request.ts) is
//     the fixed template plus data blocks (GRND-12, D-18-22): the paper brief
//     (intake topic, the effective thesis, the discipline and its tone, the
//     paper type), the section (from its OUTLINE row, the stub's values where
//     the row lacks them), summaries of the claims of its planned depends_on
//     sections, and — fenced (FEED-05) — the source records of the section's
//     allowed set ONLY (FEED-01: source-context.ts; the outline allocation ∪
//     its current PLAN.md `assigned_sources` ∪ its `plan --research`
//     additions). A source assigned only to another section never appears.
//   - The reply is validated (plan-validate.ts): the echoed section, slug and
//     depends_on equal the OUTLINE row; assigned_sources ⊆ the allowed set ⊆
//     LIBRARY.json; every claim's sources ⊆ assigned_sources. One corrective
//     turn names the problems; still invalid → EXIT_ERROR "planner output
//     invalid: …", nothing written, the previous PLAN.md (the stub) intact.
//   - PLAN.md is rendered from the validated object (plan-render.ts): the v2
//     frontmatter with the outline entry, `stub` dropped, `status: planned`,
//     and the body ## Claims / ## Structure / ## Word target / ## Voice. The
//     router sends a planned section to write; only write sets `writing`.
//   - The --revise path imports the shared proposeSwap from bin/lib/revise-swap.ts
//     (ONE implementation; no duplication with revise.ts — GEN-02).
//
// D-12 LOCKED prompt slug: 'section-planner'.
// D-06 LOCKED chokepoint: --revise delegates to runRevise (bin/lib/revise.ts).
// T-11-09: runRevise's membership guard rejects replacement_citekey ∉ assigned_sources.
// T-11-12: key value never logged here — complete() owns the no-leak header path.

import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionPlan, projectRoot } from '../lib/paths.js';
import { isPlanResearchFor, runRevise } from '../lib/revise.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { complete, assertLlmConfigured, correctiveMessages, StructuredOutputError, type ChatMessage } from '../lib/anthropic.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { loggedSectionId, sectionIdOf } from '../lib/section-id.js';
import { readOutlineSync } from '../lib/outline.js';
import { readPaperBrief } from '../lib/paper-brief.js';
import { tryLoadLibrary } from '../lib/library.js';
import { buildSourceContext, describeExcluded, excludedRemedy, libraryCitekeys, partitionCheckable, type SourceContextInput } from '../lib/source-context.js';
import { buildPromptRequest, requestHints } from '../lib/prompt-request.js';
import { formatPlanIssues, planCorrection, validatePlan } from '../lib/plan-validate.js';
import { renderPlannedPlanMd, summarizePlanClaims } from '../lib/plan-render.js';
import { loadFrontmatterDocSync } from '../lib/frontmatter.js';
import { withLock } from '../lib/lock.js';
import { networkMode, offlineMarkerLine } from '../lib/http-mock.js';
import { EXIT_ERROR, PensmithError } from '../lib/exit-codes.js';
import type { SectionPlan } from '../lib/llm-contracts.js';

/** The planner's output failed validation after the one corrective turn (GRND-13): one line, EXIT_ERROR. */
export class PlannerInvalidError extends PensmithError {
  constructor(problems: string, planPath: string) {
    super(`planner output invalid: ${problems} — nothing was written; ${planPath} is unchanged`, EXIT_ERROR);
    this.name = 'PlannerInvalidError';
  }
}

/** A readable PLAN.md's frontmatter, or null (absent or unreadable). */
function readPlanFrontmatter(planPath: string): Record<string, unknown> | null {
  if (!existsSync(planPath)) return null;
  try {
    return loadFrontmatterDocSync('plan', planPath).frontmatter;
  } catch (e) {
    process.stderr.write(`pensmith plan: WARN — ${planPath} is unreadable (${(e as Error).message}); planning from OUTLINE.md\n`);
    return null;
  }
}

function strings(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

export const planCommand = defineCommand({
  meta: {
    name: 'plan',
    description: 'Generate a per-section PLAN.md (one section at a time). --revise repairs a verifier-flagged citation.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based; a letter for an inserted section, e.g. 1a).',
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
      description: 'Section-scoped additional research query (PLAN-03 / D-09).',
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
    const { n, slug, suffix, id } = resolveSectionArg('plan', projectRoot(), args.n, args.slug);

    // GEN-06 / RUN-07 fail-loud probe: assert an LLM is configured before any LLM work.
    await assertLlmConfigured('plan');

    // PLAN-02 / D-05: `pensmith plan <N> --revise` (and `--research`) is the
    // canonical revise surface. Both route through the single runRevise
    // chokepoint (D-06) — identical to bin/cli/revise.ts. This keeps the locked
    // UX-02 16-verb set intact (no new top-level verb) while shipping WRTE-02.
    const research = typeof args.research === 'string' && args.research.length > 0 ? args.research : undefined;
    if (args.revise === true || research) {
      const result = await runRevise({
        paperRoot: projectRoot(),
        n,
        suffix,
        slug,
        yolo: args.yolo === true,
        ...(research ? { research } : {}),
        // Real shared proposeSwap from bin/lib/revise-swap.ts (GEN-02).
        // runRevise owns parsing the returned JSON + the membership guard that
        // rejects any replacement_citekey ∉ assigned_sources (T-04-14 / T-11-09).
        proposeSwap,
      });
      process.stdout.write(`pensmith plan --revise: ${result.message}\n`);
      return { ok: !result.retryExhausted, mode: 'revise', ...result };
    }

    // ── Normal plan path (GRND-12, GRND-13, FEED-01) ──
    const paperRoot = projectRoot();
    const planPath = sectionPlan(n, slug, paperRoot);
    const outline = readOutlineSync(paperRoot);
    const row = outline?.sections.find((s) => s.slug === slug) ?? null;
    const fm = readPlanFrontmatter(planPath);
    const brief = readPaperBrief(paperRoot);
    const library: Array<SourceContextInput & { readonly provenance?: readonly string[] }> = (await tryLoadLibrary(paperRoot))?.entries ?? [];
    // GRND-18: the planner may only pick sources the citation verifier can
    // check (source-context.ts verifierBlindSpot).
    const { checkable: entries, excluded } = partitionCheckable(library, networkMode().dryRun);
    const blind = new Map(excluded.map((x) => [x.citekey, x.reason]));

    // The section: its OUTLINE row, the stub's values where the row lacks them.
    const title = row?.title ?? str(fm?.['title']) ?? slug;
    const purpose = row?.purpose ?? str(fm?.['purpose']) ?? '';
    const role = row?.role ?? str(fm?.['role']);
    const dependsOn = row?.depends_on ?? strings(fm?.['depends_on']) ?? [];
    const wordTarget = row?.estimated_word_count ?? num(fm?.['word_target']);
    const voice = row?.voice ?? str(fm?.['voice']);
    // GRND-13 / FEED-04: the section's allowed set is the outline allocation ∪
    // its current PLAN.md assigned_sources (`add --remap` additions) ∪ the
    // sources `plan <N> --research` added for it (LIBRARY provenance
    // `plan-research:§<N>`). Never only the previous plan's pick: a planner
    // that used a subset last time must not shrink what a re-plan may use.
    const sectionId = sectionIdOf(n, suffix);
    const researched = entries
      .filter((e) => (e.provenance ?? []).some((t) => isPlanResearchFor(t, sectionId)))
      .map((e) => e.citekey);
    const candidates = [...new Set([...(row?.assigned_sources ?? []), ...(strings(fm?.['assigned_sources']) ?? []), ...researched])];
    const unusable = candidates.filter((k) => blind.has(k));
    if (unusable.length > 0) {
      process.stderr.write(
        `pensmith plan: WARN — section ${id} leaves out ${describeExcluded(unusable.map((k) => ({ citekey: k, reason: blind.get(k) as string })))}: ` +
          `the citation verifier would not pass a citation of them (${excludedRemedy(unusable.map((k) => ({ citekey: k, reason: blind.get(k) as string })))})\n`,
      );
    }
    const allowed = candidates.filter((k) => !blind.has(k));
    const sources = buildSourceContext(entries, allowed);
    if (sources.length === 0) {
      process.stderr.write(
        `pensmith plan: WARN — section ${id} has no assigned sources, so its plan and draft will cite nothing; ` +
          `add some with \`pensmith plan ${id} --research "<query>"\` or \`pensmith add <doi> --section ${id} --slug ${slug}\`\n`,
      );
    }

    // GRND-12: brief summaries of the depends_on sections' planned claims.
    const upstream: Array<{ slug: string; title: string; claims_summary: string }> = [];
    for (const dep of dependsOn) {
      const depRow = outline?.sections.find((s) => s.slug === dep);
      if (!depRow) continue;
      const depPath = sectionPlan(depRow.n, dep, paperRoot);
      if (!existsSync(depPath)) continue;
      try {
        const doc = loadFrontmatterDocSync('plan', depPath);
        if (doc.frontmatter['stub'] === true) continue;
        const summary = summarizePlanClaims(doc.body);
        if (summary.length > 0) upstream.push({ slug: dep, title: depRow.title, claims_summary: summary });
      } catch {
        /* an unreadable upstream plan is simply not summarised */
      }
    }

    const req = buildPromptRequest('section-planner', {
      brief: {
        topic: brief.topic,
        thesis: brief.thesis,
        discipline: brief.discipline.slug.value,
        tone: brief.discipline.tone,
        paper_type: brief.paperType,
      },
      section: {
        n,
        suffix: suffix ?? null,
        slug,
        title,
        purpose,
        role: role ?? null,
        depends_on: dependsOn,
        word_target: wordTarget ?? null,
        voice: voice ?? null,
      },
      ...(upstream.length > 0 ? { upstream } : {}),
      sources,
    });

    const known = libraryCitekeys(entries);
    const call = async (messages: ChatMessage[]): Promise<{ data: SectionPlan; text: string }> => {
      try {
        const r = await complete<SectionPlan>({ slug: 'section-planner', section: loggedSectionId(n, suffix), system: req.system, messages, stubHint: requestHints(req) });
        return { data: r.data as SectionPlan, text: r.text };
      } catch (e) {
        // GRND-13: a reply that never parses (after complete()'s one corrective
        // retry) is the same outcome as one that fails validation — one
        // `planner output invalid` line, nothing written.
        if (e instanceof StructuredOutputError) throw new PlannerInvalidError(`the reply did not match the plan contract (${e.detail})`, planPath);
        throw e;
      }
    };
    const check = (data: SectionPlan) =>
      validatePlan({ plan: data, section: { n, slug, depends_on: dependsOn }, allowed, libraryCitekeys: known });

    let attempt = await call(req.messages);
    let issues = check(attempt.data);
    if (issues.length > 0) {
      attempt = await call(correctiveMessages(req.messages, attempt.text, planCorrection(issues)));
      issues = check(attempt.data);
      if (issues.length > 0) throw new PlannerInvalidError(formatPlanIssues(issues), planPath);
    }

    const plan = attempt.data;
    const wave = num(fm?.['wave']);
    const md = renderPlannedPlanMd(
      {
        section: n,
        suffix,
        slug,
        title,
        purpose,
        role,
        depends_on: dependsOn,
        word_target: wordTarget,
        voice,
        assigned_sources: plan.frontmatter.assigned_sources,
        wave,
      },
      plan,
      { marker: networkMode().dryRun ? offlineMarkerLine() : null },
    );
    await withLock(planPath, () => atomicWriteFile(planPath, md));
    process.stdout.write(
      `pensmith plan: wrote PLAN.md to ${planPath} (${plan.claims.length} claim(s), ` +
        `${new Set(plan.frontmatter.assigned_sources).size} source(s))\n`,
    );
    return { ok: true, path: planPath };
  },
});

export default planCommand;
