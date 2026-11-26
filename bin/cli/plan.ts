// bin/cli/plan.ts — `pensmith plan <n>`: plan one section.
//
// The section planner returns the plan's content as JSON to a schema
// (structured output): the sources the section cites, its claims, a brief for
// the drafter and a voice line. Code checks it (bin/lib/plan-store.ts: every
// source is one LIBRARY.json holds, every claim's sources are among them, the
// brief is not empty), sends a failing answer back once with the problems, and refuses
// (exit 2, nothing written) if it still fails. Code then writes PLAN.md: its
// frontmatter (section, slug, title and depends_on from the outline, status
// 'planned') and a body made of the brief, the voice line and the claims.
//
// A section that already has a finished plan is refused unless --force is
// given. `--revise` (and `--research`) repair a flagged citation through
// bin/lib/revise.ts instead.

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionPlan } from '../lib/paths.js';
import { runRevise } from '../lib/revise.js';
import { proposeSwap } from '../lib/revise-swap.js';
import { MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { resolveSectionSlug } from '../lib/section-slug.js';
import { isPlaceholderText } from '../lib/placeholder.js';
import { readSectionState } from '../lib/router.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { frontmatterProblem, parseFrontmatter } from '../lib/frontmatter.js';
import { escapeTemplateTokens } from '../lib/intake-parse.js';
import { readIntake } from '../lib/intake-record.js';
import { readLibrarySync } from '../lib/library.js';
import { renderLibraryContext } from '../lib/source-context.js';
import { lastCheckedOutline } from '../lib/outline-read.js';
import { planProblems, renderPlan, SectionPlanSchema, type SectionEntry } from '../lib/plan-store.js';
import { completeChecked } from '../lib/structured-call.js';

/** The list `plan` reads the section from: the outline, as last checked. */
type CheckedOutline = ReturnType<typeof lastCheckedOutline>;

/**
 * Section `n` as the outline has it (as last checked, while a hand edit of
 * OUTLINE.md waits), or the bare minimum when there is no outline entry.
 */
function sectionEntry(outline: CheckedOutline, n: number, slug: string): SectionEntry {
  const s = outline?.sections.find((x) => x.n === n && x.slug === slug);
  const stored = outline?.stored?.sections.find((x) => x.n === n);
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
function upstreamPlans(root: string, outline: CheckedOutline, entry: SectionEntry): string {
  if (!outline) return '[]';
  const out: Array<{ slug: string; brief: string }> = [];
  for (const dep of entry.depends_on) {
    const s = outline.sections.find((x) => x.slug === dep);
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
    const outline = lastCheckedOutline(root);
    const slug = resolveSectionSlug(root, n, args.slug, outline);

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

    // A finished plan is the user's work, and so is a PLAN.md they broke while
    // editing it: replace either only when asked to. An outline stub, and a
    // placeholder no model wrote, are not finished plans.
    const targetPath = sectionPlan(n, slug, root);
    const existing = readSectionState(targetPath);
    if (!existing.absent && args.force !== true) {
      let text = '';
      try {
        text = readFileSync(targetPath, 'utf8');
      } catch {
        // unreadable: refused below, as corrupt
      }
      const broken = existing.corrupt ? 'it cannot be read' : frontmatterProblem(text);
      if (!isPlaceholderText(text) && (broken !== null || existing.status !== 'stub')) {
        process.stderr.write(
          broken !== null
            ? `pensmith plan: section ${n} (${slug}) has a PLAN.md whose frontmatter cannot be read (${broken}); nothing was changed. ` +
                `Fix it, or run \`pensmith plan ${n} --force\` to replace it with a new plan.\n`
            : `pensmith plan: section ${n} (${slug}) already has a plan (status ${existing.status}); nothing was changed. ` +
                `Run \`pensmith plan ${n} --force\` to plan it again, or \`pensmith plan ${n} --revise\` to repair a flagged citation.\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return { ok: false, mode: broken !== null ? 'plan-unreadable' : 'already-planned' };
      }
    }

    // The planner's sources are checked against LIBRARY.json; without it no
    // plan could pass, so nothing is asked (or billed).
    const library = readLibrarySync(root);
    if (!library) {
      process.stderr.write(
        `pensmith plan: .paper/LIBRARY.json cannot be read, so a plan's sources cannot be checked; nothing was asked or written. ` +
          `Run \`pensmith research\`, or repair .paper/LIBRARY.json.\n`,
      );
      process.exitCode = EXIT_REFUSED;
      return { ok: false, mode: 'no-library' };
    }
    const libraryKeys = new Set(library.entries.map((e) => e.id));
    const entry = sectionEntry(outline, n, slug);
    const intake = readIntake(root);
    const system = interpolate(loadPrompt('section-planner'), {
      section: escapeTemplateTokens(JSON.stringify({
        number: entry.n, slug: entry.slug, title: entry.title, purpose: entry.purpose, depends_on: entry.depends_on,
        word_target: entry.word_target, outline_sources: entry.assigned_sources,
      })),
      topic: escapeTemplateTokens(intake?.topic || '(no topic recorded)'),
      discipline: escapeTemplateTokens(intake?.discipline ?? 'other'),
      upstreamPlans: upstreamPlans(root, outline, entry),
      candidateSources: renderLibraryContext(library),
    });
    const answer = await completeChecked({
      system,
      messages: [{ role: 'user', content: `Plan section ${entry.n}, "${entry.title}".` }],
      role: 'plan',
      scope: 'section',
      scopeId: `plan-${n}`,
      schema: SectionPlanSchema,
      problemsOf: (plan) => planProblems(plan, libraryKeys),
      noun: 'plan',
    });
    if ('placeholder' in answer) {
      // No model ran (PENSMITH_NO_LLM): code still writes the frontmatter; the
      // body is the flagged placeholder, which verify, compile and done refuse.
      await atomicWriteFile(targetPath, renderPlan(entry, null, answer.placeholder.text));
      process.stdout.write(`pensmith plan: wrote placeholder PLAN.md to ${targetPath}\n`);
      return { ok: true, path: targetPath, mode: 'placeholder' };
    }
    if ('problems' in answer) {
      const { problems } = answer;
      process.stderr.write(`pensmith plan: the plan for section ${n} (${slug}) cannot be used; nothing was written:\n${problems.map((p) => `  - ${p}\n`).join('')}`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false, mode: 'refused', problems };
    }

    await atomicWriteFile(targetPath, renderPlan(entry, answer.value));
    process.stdout.write(`pensmith plan: wrote PLAN.md to ${targetPath}\n`);
    return { ok: true, path: targetPath };
  },
});

export default planCommand;
