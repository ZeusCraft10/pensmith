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
import { paperDir, paperIntakeFile, paperOutlineFile } from '../lib/paths.js';
import { closeGate, gateStillApplies, openGate, readGate, stopForAnswer, type GateRecord } from '../lib/gates.js';
import { fileSha256 } from '../lib/verify/verification-record.js';
import { canAskInTerminal } from '../lib/prompts.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { artifactText } from '../lib/placeholder.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { escapeTemplateTokens } from '../lib/intake-parse.js';
import { readIntake, type IntakeRead } from '../lib/intake-record.js';
import { readLibrarySync, type Library } from '../lib/library.js';
import { renderLibraryContext } from '../lib/source-context.js';
import { parseOutline } from '../lib/outline-parse.js';
import { completeChecked } from '../lib/structured-call.js';
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

/** Ask the person at the terminal whether to accept the outline. */
async function confirmAtTerminal(outlineMd: string): Promise<boolean> {
  const clack = await import('@clack/prompts');
  clack.note(outlineMd, 'Proposed outline');
  const ok = await clack.confirm({ message: 'Accept this outline and write OUTLINE.md?' });
  return ok === true && !clack.isCancel(ok);
}

/** The outline approval's options; approving needs an explicit yes. */
const APPROVE = 'approve';
const REJECT = 'reject';

/**
 * What an outline proposal is about: the intake it was written for, and the
 * outline it would replace (none, or the one `--force` asked to redo). An
 * approval is applied only while both are as they were.
 */
function outlineBinding(root: string): Record<string, string | null> {
  return {
    intake_sha256: fileSha256(paperIntakeFile(root)),
    outline_json_sha256: fileSha256(paperOutlineFile(root)),
    outline_md_sha256: fileSha256(path.join(paperDir(root), 'OUTLINE.md')),
  };
}

/** The flags a proposal was made under, kept so that the answer is applied under them too. */
type OutlineFlags = { force: boolean; 'no-counter': boolean };

/** Keep the checked proposal for the person to approve, print the decision, and stop (exit 3). */
async function awaitApproval(root: string, flags: OutlineFlags, proposal: unknown, outlineMd: string, sections: number): Promise<Record<string, unknown>> {
  const record = await openGate(root, {
    gate: 'outline',
    args: flags,
    summary: flags.force
      ? `Replace the paper's outline with this one of ${sections} section(s)?`
      : `Approve this outline of ${sections} section(s) and write OUTLINE.md?`,
    options: [APPROVE, REJECT],
    default: [REJECT],
    binding: outlineBinding(root),
    payload: { proposal },
    shown: { pending: OUTLINE_PENDING, extra: { outline: outlineMd } },
  });
  return showPending(record, outlineMd);
}

const OUTLINE_PENDING = 'outline-approval';

/** Print the kept proposal (`outlineMd`, rendered from the proposal an approval applies) and stop for the user's approval (exit 3). */
function showPending(record: GateRecord, outlineMd: string): Record<string, unknown> {
  return stopForAnswer(
    'pensmith outline: the outline needs the user\'s approval and there is no terminal to ask in; it is kept until they answer.',
    record,
    OUTLINE_PENDING,
    { outline: outlineMd },
  );
}

/** A heading that names an objection, for an outline whose table cannot mark the counterargument section. */
const COUNTER_TITLE = /\b(counter[- ]?arguments?|objections?|rebuttals?|replies|reply|critiques?|limitations)\b/i;

/** The checks an outline of this paper must pass, given its library (null: unreadable) and its intake. */
function rulesFor(
  library: Library | null,
  intake: IntakeRead | null,
  noCounter: boolean,
): OutlineRules & { problems: string[] } {
  return {
    libraryKeys: library ? new Set(library.entries.map((e) => e.id)) : null,
    counterargumentRequired: !noCounter && intake?.intake?.counterargument === 'required',
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
    const flags: OutlineFlags = { force: args.force === true, 'no-counter': args['no-counter'] === true };

    // A proposal kept for the user's approval, still about the intake and the
    // outline it was made to replace: apply their answer, ask at a terminal,
    // or show the same decision again, with no new model call. It is applied
    // under the flags it was proposed with (`--force` replaces the outline,
    // `--no-counter` waives the counterargument section). --yolo, and --force
    // before an answer, ask for a new proposal instead.
    const pending = readGate(root, 'outline');
    if (pending) {
      const parsed = ProposedOutlineSchema.safeParse((pending.payload as { proposal?: unknown } | null)?.proposal);
      const applies = parsed.success && gateStillApplies(pending, outlineBinding(root));
      if (applies && args.yolo !== true && (pending.answer !== undefined || !flags.force)) {
        const kept = numberOutline(parsed.data);
        const keptMd = renderOutlineMd(kept);
        if (!pending.answer && !canAskInTerminal(process.stdout)) return showPending(pending, keptMd);
        const approved = pending.answer ? pending.answer.options[0] === APPROVE : await confirmAtTerminal(keptMd);
        await closeGate(root, 'outline');
        const noCounter = flags['no-counter'] || pending.args['no-counter'] === true;
        // The library and intake as they are after the user answered, not before the question waited.
        return decide(root, kept, approved, rulesFor(readLibrarySync(root), readIntake(root), noCounter), readOutline(root).ok);
      }
      // A proposal for an intake or outline that has changed since is not the user's to approve.
      await closeGate(root, 'outline');
      if (!applies) {
        process.stderr.write('pensmith outline: the outline kept for approval was proposed for an earlier intake or outline, so it was dropped.\n');
        // An answer to it is not a request for a new (paid) proposal.
        if (pending.answer) {
          return refuse(['the answer was for a proposal made before the intake or outline changed'], 'Nothing was written. Run `pensmith outline --force` for a new proposal.');
        }
      }
    }

    // An existing outline is kept, and a hand-written or edited one checked and taken in.
    const existing = flags.force ? null : readOutline(root);
    if (existing?.ok && existing.source === 'json') {
      const stored = existing.outline.stored!;
      // A deleted OUTLINE.md is rendered again from the list.
      const count = await save(root, stored, existsSync(outlinePath) ? readFileSync(outlinePath, 'utf8') : undefined);
      process.stdout.write(`pensmith outline: OUTLINE.json already has ${count} section(s); not regenerating — pass --force to redo.\n`);
      return { ok: true, path: outlinePath, mode: 'existing', sections: count };
    }

    const library = readLibrarySync(root);
    const intake = readIntake(root);
    const rules = rulesFor(library, intake, flags['no-counter']);

    if (existing !== null) {
      if ((existing.ok && existing.source === 'md') || (!existing.ok && existing.problem === 'edited')) {
        const md = readFileSync(outlinePath, 'utf8');
        // The list as last checked, when there is one: an 'md' outline has no OUTLINE.json.
        const prior: StoredOutline | null = existing.ok ? null : existing.stored;
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

    const length = intake?.intake?.length_words ?? 2000;
    const system = interpolate(loadPrompt('outline-author'), {
      topic: escapeTemplateTokens(intake?.topic || '(no topic recorded; run `pensmith new`)'),
      discipline: escapeTemplateTokens(intake?.discipline ?? 'other'),
      length: String(length),
      counterargument: rules.counterargumentRequired ? 'required' : 'optional',
      candidateSources: renderLibraryContext(library),
    });
    const user = intake?.assignment || intake?.topic || 'Propose an outline for the paper.';
    const answer = await completeChecked({
      system,
      messages: [{ role: 'user', content: user }],
      role: 'outline',
      scope: 'task',
      scopeId: 'outline',
      schema: ProposedOutlineSchema,
      problemsOf: (proposed) => outlineProblems(numberOutline(proposed), rules),
      noun: 'outline',
    });
    if ('placeholder' in answer) {
      // No model ran (PENSMITH_NO_LLM): the placeholder is flagged and is no
      // section list, so OUTLINE.json is removed rather than left to disagree.
      await atomicWriteFile(outlinePath, artifactText(answer.placeholder));
      await removePath(paperOutlineFile(root));
      process.stdout.write(`pensmith outline: wrote placeholder OUTLINE.md to ${outlinePath} (PENSMITH_NO_LLM: no model wrote an outline).\n`);
      return { ok: true, path: outlinePath, mode: 'placeholder', sections: 0 };
    }
    if ('problems' in answer) return refuse(answer.problems, 'Nothing was written. Run `pensmith outline` again, or write .paper/OUTLINE.md yourself.');
    const outline = numberOutline(answer.value);

    // The approval gate (default-on): --yolo approves; a person at a terminal
    // is asked; without one the checked proposal is kept for their answer.
    const hadOutline = readOutline(root).ok;
    if (args.yolo === true) return decide(root, outline, true, rules, hadOutline);
    const md = renderOutlineMd(outline);
    if (!canAskInTerminal(process.stdout)) return awaitApproval(root, flags, answer.value, md, outline.sections.length);
    return decide(root, outline, await confirmAtTerminal(md), rules, hadOutline);
  },
});

/**
 * Write the approved outline, checked again against the library and intake
 * as they are now; a rejected one writes nothing and exits 2. `replacing`
 * says whether a usable outline is already there (it is kept on a rejection).
 */
async function decide(
  root: string,
  outline: Outline,
  approved: boolean,
  rules: OutlineRules & { problems: string[] },
  replacing: boolean,
): Promise<Record<string, unknown>> {
  if (!approved) {
    process.stdout.write(replacing
      ? 'pensmith outline: outline rejected — the existing outline is kept. Run `pensmith outline --force` for a new proposal.\n'
      : 'pensmith outline: outline rejected — no OUTLINE.md written. Run `pensmith outline` for a new proposal.\n');
    process.exitCode = EXIT_REFUSED;
    return { ok: false, mode: 'rejected' };
  }
  const problems = [...rules.problems, ...outlineProblems(outline, rules)];
  if (problems.length > 0) return refuse(problems, 'Nothing was written. Run `pensmith outline` again.');
  const count = await save(root, outline);
  process.stdout.write(`pensmith outline: wrote OUTLINE.md and OUTLINE.json to ${paperDir(root)} (${count} section(s)).\n`);
  return { ok: true, path: path.join(paperDir(root), 'OUTLINE.md'), mode: 'real', sections: count };
}

export default outlineCommand;
