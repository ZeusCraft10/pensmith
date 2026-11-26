// bin/cli/outline.ts — `pensmith outline`: propose the paper's sections.
//
// The outline author returns the outline as JSON to a schema (structured
// output). Code checks it (bin/lib/outline-store.ts outlineProblems): slugs,
// dependencies that exist and form no cycle, the counterargument section when
// the paper needs one, assigned sources that LIBRARY.json holds, and headings
// that hold no citation. An outline that fails is sent back once with the
// problems; if it still fails, nothing is written and outline exits 2. The
// user then approves it (default-on; only --yolo skips it, and without a
// terminal the gate exits 3). Code renders OUTLINE.md and writes OUTLINE.json,
// the one list of sections, from which STATE.json and the section folders
// follow.
//
// An existing outline is never regenerated without --force. A hand-written
// OUTLINE.md, or a hand edit of the rendered one, is checked the same way and
// taken in as the list; one that cannot be read is refused, not overwritten.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile, removePath } from '../lib/atomic-write.js';
import { paperDir, paperOutlineFile } from '../lib/paths.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { complete, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { artifactText } from '../lib/placeholder.js';
import { EXIT_NEEDS_ANSWER, EXIT_REFUSED } from '../lib/exit-codes.js';
import { escapeTemplateTokens } from '../lib/intake-parse.js';
import { readIntake } from '../lib/intake-record.js';
import { readLibrarySync } from '../lib/library.js';
import { libraryCatalogJson } from '../lib/library-catalog.js';
import { parseOutline } from '../lib/outline-parse.js';
import { checkModelJson, modelJsonSchema } from '../lib/schemas/model-json.js';
import { readOutline, type StoredOutline } from '../lib/outline-read.js';
import {
  numberOutline,
  outlineProblems,
  ProposedOutlineSchema,
  renderOutlineMd,
  writeOutline,
  type Outline,
  type OutlineRules,
} from '../lib/outline-store.js';

/** Thrown by the approval gate when there is no terminal and --yolo was not given (exit 3). */
class ApprovalUnavailableError extends Error {
  exitCode = EXIT_NEEDS_ANSWER;
}

/**
 * The outline approval gate: --yolo approves; on a terminal the user confirms;
 * without one, ApprovalUnavailableError.
 */
async function runApprovalGate(outlineMd: string, yolo: boolean): Promise<boolean> {
  if (yolo) return true;
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new ApprovalUnavailableError(
      'outline: approval gate requires an interactive terminal. ' +
      'Use --yolo to auto-accept (CLAUDE.md non-negotiable: approval-gates default-on).',
    );
  }
  const clack = await import('@clack/prompts');
  clack.note(outlineMd, 'Proposed outline');
  const ok = await clack.confirm({ message: 'Accept this outline and write OUTLINE.md?' });
  return ok === true && !clack.isCancel(ok);
}

/** A heading that names an objection, for an outline whose table cannot mark the counterargument section. */
const COUNTER_TITLE = /\b(counter[- ]?arguments?|objections?|rebuttals?|replies|reply|critiques?|limitations)\b/i;

/** The checks an outline of this paper must pass. */
function rulesFor(root: string, noCounter: boolean): OutlineRules & { problems: string[] } {
  const library = readLibrarySync(root);
  const intake = readIntake(root)?.intake ?? null;
  return {
    libraryKeys: library ? new Set(library.entries.map((e) => e.id)) : null,
    counterargumentRequired: !noCounter && intake?.counterargument === 'required',
    problems: library ? [] : ['.paper/LIBRARY.json cannot be read, so the assigned sources cannot be checked'],
  };
}

function refuse(why: string[], hint: string): { ok: false; mode: 'refused'; problems: string[] } {
  process.stderr.write(`pensmith outline: the outline cannot be used:\n${why.map((p) => `  - ${p}\n`).join('')}${hint}\n`);
  process.exitCode = EXIT_REFUSED;
  return { ok: false, mode: 'refused', problems: why };
}

/** OUTLINE.md's table taken in as the list, keeping what the table cannot hold (thesis, purposes) from `prior`. */
function outlineFromTable(md: string, prior: StoredOutline | null): Outline {
  const parsed = parseOutline(md);
  const before = new Map((prior?.sections ?? []).map((s) => [s.slug, s]));
  return {
    title: parsed.paper_title || prior?.title || 'Untitled',
    thesis: prior?.thesis ?? '',
    sections: parsed.sections.map((s) => {
      const was = before.get(s.slug);
      return {
        n: s.n,
        slug: s.slug,
        title: s.title,
        purpose: was?.purpose ?? '',
        depends_on: s.depends_on,
        word_target: s.estimated_word_count ?? was?.word_target ?? 0,
        assigned_sources: s.assigned_sources ?? [],
        counterargument: was?.counterargument ?? COUNTER_TITLE.test(s.title),
      };
    }),
  };
}

async function save(root: string, outline: Outline, keepMd?: string): Promise<number> {
  const warnings = await writeOutline(root, outline, keepMd === undefined ? {} : { keepMd });
  for (const w of warnings) process.stderr.write(`pensmith outline: WARN — ${w}.\n`);
  return outline.sections.length;
}

export const outlineCommand = defineCommand({
  meta: {
    name: 'outline',
    description: 'Propose a section outline (approval-gated unless --yolo).',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate.',
      default: false,
    },
    force: {
      type: 'boolean',
      description: 'Propose a new outline, replacing the existing one.',
      default: false,
    },
    'no-counter': {
      type: 'boolean',
      description: 'Do not require a counterargument and rebuttal section for this paper.',
      default: false,
    },
  },
  async run({ args }) {
    const root = process.cwd();
    const outlinePath = path.join(paperDir(root), 'OUTLINE.md');
    const rules = rulesFor(root, args['no-counter'] === true);

    // An existing outline is kept, and a hand-written or edited one checked and taken in.
    if (args.force !== true) {
      const existing = readOutline(root);
      if (existing.ok && existing.source === 'json') {
        const stored = existing.outline.stored!;
        // A deleted OUTLINE.md is rendered again from the list.
        const count = await save(root, stored, existsSync(outlinePath) ? readFileSync(outlinePath, 'utf8') : undefined);
        process.stdout.write(`pensmith outline: OUTLINE.json already has ${count} section(s); not regenerating — pass --force to redo.\n`);
        return { ok: true, path: outlinePath, mode: 'existing', sections: count };
      }
      if ((existing.ok && existing.source === 'md') || (!existing.ok && existing.problem === 'edited')) {
        const md = readFileSync(outlinePath, 'utf8');
        let prior: StoredOutline | null = null;
        try {
          prior = JSON.parse(readFileSync(paperOutlineFile(root), 'utf8')) as StoredOutline;
        } catch {
          prior = null;
        }
        let outline: Outline;
        try {
          outline = outlineFromTable(md, prior);
        } catch (e) {
          return refuse([(e as Error).message], 'Fix the table in .paper/OUTLINE.md, or run `pensmith outline --force` for a new outline.');
        }
        const problems = [...rules.problems, ...outlineProblems(outline, rules)];
        if (outline.sections.length === 0) problems.push('the table has no sections');
        if (problems.length > 0) {
          return refuse(problems, 'Fix .paper/OUTLINE.md, or run `pensmith outline --force` for a new outline.');
        }
        const count = await save(root, outline, md);
        process.stdout.write(`pensmith outline: took in the ${count} section(s) of OUTLINE.md as the paper's outline.\n`);
        return { ok: true, path: outlinePath, mode: 'existing', sections: count };
      }
      if (!existing.ok && existing.problem === 'invalid') {
        return refuse([existing.detail], 'Fix it, or run `pensmith outline --force` for a new outline.');
      }
      // missing, or a placeholder no model wrote: propose one.
    }

    // The outline's sources are checked against LIBRARY.json; without it no
    // outline could pass, so nothing is asked (or billed).
    if (rules.problems.length > 0) {
      return refuse(rules.problems, 'Nothing was asked or written. Run `pensmith research`, or repair .paper/LIBRARY.json.');
    }

    const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
    if (!noLlm) {
      try {
        await getProviderApiKey(await resolveProviderId());
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          process.stderr.write(
            'pensmith outline: ERROR — no LLM key configured.\n' +
            'Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n' +
            'Run inside Claude Code (Tier 1) for key-free operation.\n',
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

    const intake = readIntake(root);
    const length = intake?.intake?.length_words ?? 2000;
    const system = interpolate(loadPrompt('outline-author'), {
      topic: escapeTemplateTokens(intake?.topic || '(no topic recorded; run `pensmith new`)'),
      discipline: escapeTemplateTokens(intake?.discipline ?? 'other'),
      length: String(length),
      counterargument: rules.counterargumentRequired ? 'required' : 'optional',
      candidateSources: libraryCatalogJson(root),
    });
    const user = intake?.assignment || intake?.topic || 'Propose an outline for the paper.';
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: user }];
    const schema = modelJsonSchema(ProposedOutlineSchema);

    let outline: Outline | null = null;
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2 && outline === null; attempt += 1) {
      const result = await complete({ system, messages, role: 'outline', scope: 'task', scopeId: 'outline', jsonSchema: schema });
      if (result.placeholder) {
        // No model ran (PENSMITH_NO_LLM): the placeholder is flagged and is no
        // section list, so OUTLINE.json is removed rather than left to disagree.
        await atomicWriteFile(outlinePath, artifactText(result));
        await removePath(paperOutlineFile(root));
        process.stdout.write(`pensmith outline: wrote placeholder OUTLINE.md to ${outlinePath} (PENSMITH_NO_LLM: no model wrote an outline).\n`);
        return { ok: true, path: outlinePath, mode: 'placeholder', sections: 0 };
      }
      const checked = checkModelJson(ProposedOutlineSchema, result.json);
      problems = checked.ok ? outlineProblems(numberOutline(checked.value), rules) : checked.problems;
      if (problems.length === 0 && checked.ok) {
        outline = numberOutline(checked.value);
        break;
      }
      messages.push(
        { role: 'assistant', content: result.text },
        { role: 'user', content: `This outline cannot be used:\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn the corrected outline.` },
      );
    }
    if (outline === null) return refuse(problems, 'Nothing was written. Run `pensmith outline` again, or write .paper/OUTLINE.md yourself.');

    const md = renderOutlineMd(outline);
    let approved: boolean;
    try {
      approved = await runApprovalGate(md, args.yolo === true);
    } catch (e) {
      if (e instanceof ApprovalUnavailableError) {
        process.stderr.write(`pensmith outline: ${e.message}\n`);
        process.exitCode = e.exitCode;
        return { ok: false, mode: 'approval-unavailable' };
      }
      throw e;
    }
    if (!approved) {
      process.stdout.write('pensmith outline: outline rejected — no OUTLINE.md written.\n');
      return { ok: false, mode: 'rejected' };
    }

    const count = await save(root, outline);
    process.stdout.write(`pensmith outline: wrote OUTLINE.md and OUTLINE.json to ${paperDir(root)} (${count} section(s)).\n`);
    return { ok: true, path: outlinePath, mode: 'real', sections: count };
  },
});

export default outlineCommand;
