// bin/cli/plan.ts — `pensmith plan <n>`: plan one section.
//
// The section planner returns the plan's content as JSON to a schema
// (structured output): the sources the section cites, its claims, a brief for
// the drafter and a voice line. Code checks it (every source is one
// LIBRARY.json holds, every claim's sources are among them, the brief is not
// empty), sends a failing answer back once with the problems, and refuses
// (exit 2, nothing written) if it still fails. Code then writes PLAN.md: its
// frontmatter (section, slug, title and depends_on from the outline, status
// 'planned') and a body made of the brief, the voice line and the claims.
//
// A section that already has a finished plan is refused unless --force is
// given. `--revise` (and `--research`) repair a flagged citation through
// bin/lib/revise.ts instead.

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionPlan } from '../lib/paths.js';
import { runRevise } from '../lib/revise.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { resolveSectionSlug } from '../lib/section-slug.js';
import { isPlaceholderText } from '../lib/placeholder.js';
import { readSectionState } from '../lib/router.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { escapeTemplateTokens } from '../lib/intake-parse.js';
import { readIntake } from '../lib/intake-record.js';
import { readLibrarySync } from '../lib/library.js';
import { libraryCatalogJson } from '../lib/library-catalog.js';
import { readOutline } from '../lib/outline-read.js';
import { checkModelJson, modelJsonSchema } from '../lib/schemas/model-json.js';
import { PlanFrontmatterSchema } from '../lib/schemas/plan-frontmatter.js';

/** What the section planner returns. */
export const SectionPlanSchema = z.object({
  assigned_sources: z.array(z.string()),
  claims: z.array(z.object({ claim: z.string(), sources: z.array(z.string()) }).strict()),
  brief: z.string(),
  voice: z.string(),
}).strict();
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

/** Every reason `plan` cannot be the section's plan; empty when it can. */
export function planProblems(plan: SectionPlan, libraryKeys: ReadonlySet<string> | null): string[] {
  const problems: string[] = [];
  if (libraryKeys) {
    const unknown = plan.assigned_sources.filter((k) => !libraryKeys.has(k));
    if (unknown.length > 0) problems.push(`assigned_sources names ${unknown.join(', ')}, which LIBRARY.json does not hold`);
  } else {
    problems.push('.paper/LIBRARY.json cannot be read, so the assigned sources cannot be checked');
  }
  const assigned = new Set(plan.assigned_sources);
  for (const c of plan.claims) {
    const outside = c.sources.filter((k) => !assigned.has(k));
    if (outside.length > 0) problems.push(`the claim "${c.claim.slice(0, 60)}" cites ${outside.join(', ')}, which is not in assigned_sources`);
  }
  if (plan.brief.trim().split(/\s+/).filter(Boolean).length < 20) problems.push('the brief is shorter than 20 words');
  return problems;
}

interface SectionEntry {
  n: number;
  slug: string;
  title: string;
  depends_on: string[];
  purpose: string;
  word_target: number | null;
  assigned_sources: string[];
}

/** Section `n` as the outline has it, or the bare minimum when there is no outline entry. */
function sectionEntry(root: string, n: number, slug: string): SectionEntry {
  const read = readOutline(root);
  const s = read.ok ? read.outline.sections.find((x) => x.n === n && x.slug === slug) : undefined;
  const stored = read.ok ? read.outline.stored?.sections.find((x) => x.n === n) : undefined;
  return {
    n,
    slug,
    title: s?.title ?? slug,
    depends_on: s?.depends_on ?? [],
    purpose: stored?.purpose ?? '',
    word_target: s?.estimated_word_count ?? null,
    assigned_sources: s?.assigned_sources ?? [],
  };
}

/** The briefs of the planned sections `entry` depends on, as data for the prompt. */
function upstreamPlans(root: string, entry: SectionEntry): string {
  const read = readOutline(root);
  if (!read.ok) return '[]';
  const out: Array<{ slug: string; brief: string }> = [];
  for (const dep of entry.depends_on) {
    const s = read.outline.sections.find((x) => x.slug === dep);
    if (!s) continue;
    try {
      const { body, frontmatter } = parseFrontmatter(readFileSync(sectionPlan(s.n, s.slug, root), 'utf8'));
      if (frontmatter['status'] !== 'stub' && frontmatter['placeholder'] !== true) out.push({ slug: s.slug, brief: body.trim().slice(0, 2000) });
    } catch {
      // not planned yet
    }
  }
  return escapeTemplateTokens(JSON.stringify(out, null, 2));
}

/** PLAN.md: frontmatter written by code, the planner's content as the body. */
export function renderPlan(entry: SectionEntry, plan: SectionPlan | null, placeholderText?: string): string {
  const fm: Record<string, unknown> = {
    section: entry.n,
    slug: entry.slug,
    title: entry.title,
    depends_on: entry.depends_on,
    assigned_sources: plan ? plan.assigned_sources : entry.assigned_sources,
    status: 'planned',
    verified_against_draft_hash: null,
  };
  if (placeholderText !== undefined) fm['placeholder'] = true;
  PlanFrontmatterSchema.parse(fm);
  if (!plan) return `${serializeFrontmatter(fm)}\n${placeholderText ?? ''}\n`;
  const claims = plan.claims.map((c) => `- ${c.claim} (sources: ${c.sources.join(', ') || 'none'})`);
  return [
    serializeFrontmatter(fm),
    '## Brief',
    '',
    plan.brief.trim(),
    '',
    `Voice: ${plan.voice.trim() || 'formal academic tone'}`,
    '',
    '## Claims',
    '',
    ...(claims.length > 0 ? claims : ['(none)']),
    '',
  ].join('\n');
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
      description: 'Section slug (defaults to the one in the outline).',
    },
    revise: {
      type: 'boolean',
      description: 'Repair a verifier-flagged citation (delegates to bin/lib/revise.ts runRevise).',
      default: false,
    },
    research: {
      type: 'string',
      description: 'Section-scoped additional research query.',
    },
    force: {
      type: 'boolean',
      description: 'Plan again, replacing a finished PLAN.md.',
      default: false,
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const root = process.cwd();
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith plan: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = resolveSectionSlug(root, n, args.slug);

    // Without a key there is no planner to ask, and plan says so.
    if (process.env['PENSMITH_NO_LLM'] !== '1') {
      try {
        await getProviderApiKey(await resolveProviderId());
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          process.stderr.write(
            `pensmith plan: ERROR — no LLM key configured.\n` +
            `Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n` +
            `Run inside Claude Code (Tier 1) for key-free operation.\n`,
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

    // `plan <N> --revise` (and `--research`) repair a citation through runRevise,
    // whose membership guard refuses a replacement outside assigned_sources.
    const research = typeof args.research === 'string' && args.research.length > 0 ? args.research : undefined;
    if (args.revise === true || research) {
      const result = await runRevise({
        paperRoot: root,
        n,
        slug,
        yolo: args.yolo === true,
        ...(research ? { research } : {}),
        proposeSwap,
      });
      process.stdout.write(`pensmith plan --revise: ${result.message}\n`);
      return { ok: !result.retryExhausted, mode: 'revise', ...result };
    }

    // A finished plan is the user's work: replace it only when asked to. An
    // outline stub, and a placeholder no model wrote, are not finished plans.
    const targetPath = sectionPlan(n, slug, root);
    const existing = readSectionState(targetPath);
    if (!existing.absent && !existing.corrupt && existing.status !== 'stub' && args.force !== true) {
      if (!isPlaceholderText(readFileSync(targetPath, 'utf8'))) {
        process.stderr.write(
          `pensmith plan: section ${n} (${slug}) already has a plan (status ${existing.status}); nothing was changed. ` +
            `Run \`pensmith plan ${n} --force\` to plan it again, or \`pensmith plan ${n} --revise\` to repair a flagged citation.\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return { ok: false, mode: 'already-planned' };
      }
    }

    const entry = sectionEntry(root, n, slug);
    const intake = readIntake(root);
    const library = readLibrarySync(root);
    const libraryKeys = library ? new Set(library.entries.map((e) => e.id)) : null;
    const system = interpolate(loadPrompt('section-planner'), {
      section: escapeTemplateTokens(JSON.stringify({
        number: entry.n, slug: entry.slug, title: entry.title, purpose: entry.purpose, depends_on: entry.depends_on,
        word_target: entry.word_target, outline_sources: entry.assigned_sources,
      })),
      topic: escapeTemplateTokens(intake?.topic || '(no topic recorded)'),
      discipline: escapeTemplateTokens(intake?.discipline ?? 'other'),
      upstreamPlans: upstreamPlans(root, entry),
      candidateSources: libraryCatalogJson(root),
    });
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: `Plan section ${entry.n}, "${entry.title}".` },
    ];

    let plan: SectionPlan | null = null;
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2 && plan === null; attempt += 1) {
      const result = await complete({
        system,
        messages,
        role: 'plan',
        scope: 'section',
        scopeId: `plan-${n}`,
        jsonSchema: modelJsonSchema(SectionPlanSchema),
      });
      if (result.placeholder) {
        // No model ran (PENSMITH_NO_LLM): code still writes the frontmatter; the
        // body is the flagged placeholder, which verify, compile and done refuse.
        await atomicWriteFile(targetPath, renderPlan(entry, null, result.text));
        process.stdout.write(`pensmith plan: wrote placeholder PLAN.md to ${targetPath}\n`);
        return { ok: true, path: targetPath, mode: 'placeholder' };
      }
      const checked = checkModelJson(SectionPlanSchema, result.json);
      problems = checked.ok ? planProblems(checked.value, libraryKeys) : checked.problems;
      if (checked.ok && problems.length === 0) {
        plan = checked.value;
        break;
      }
      messages.push(
        { role: 'assistant', content: result.text },
        { role: 'user', content: `This plan cannot be used:\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn the corrected plan.` },
      );
    }
    if (plan === null) {
      process.stderr.write(`pensmith plan: the plan for section ${n} (${slug}) cannot be used; nothing was written:\n${problems.map((p) => `  - ${p}\n`).join('')}`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false, mode: 'refused', problems };
    }

    await atomicWriteFile(targetPath, renderPlan(entry, plan));
    process.stdout.write(`pensmith plan: wrote PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath };
  },
});

export default planCommand;
