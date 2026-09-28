// bin/cli/write.ts — `pensmith write [<n>]` verb entrypoint (WRTE-01, WRTE-04;
// Phase 18 FEED-02, FEED-04, GRND-15, GRND-16).
//
// Tier-2 orchestrator. In Tier 1 the workflow body delegates to the model with
// the `section-drafter` prompt (D-12 LOCKED slug); here the verb calls
// complete() through the Phase 11 transport (GEN-02).
//
//   - The drafter request is built ONLY from the validated DrafterInput
//     (drafter-input.ts buildDrafterRequest, WRTE-04 / T-3-10 / FEED-02): the
//     PLAN.md body and entry, the paper brief, the resolved voice (+ the
//     STYLE.json profile when style-match is on) and — fenced — the LIBRARY
//     records of EXACTLY the PLAN.md assigned_sources. `write N` and every node
//     of a wave write go through the same writeOneSection, so both send
//     byte-identical requests.
//   - A section with no sources is drafted without citations, with a WARN
//     naming `plan N --research` and `add` — no citekey is ever invented.
//   - Containment (FEED-04, D-18-25): every citation in the draft must be one
//     of the section's assigned sources (draft-containment.ts). One corrective
//     turn names the offending keys; a persistent violation keeps no draft
//     (DRAFT.rejected.md), sets PLAN.md `status: failed` + `failure_reason`,
//     touches no other section and exits EXIT_BLOCKED.
//   - write → verify (GRND-15, D-18-26): after each successful draft the
//     section is verified (verify.ts verifySection) and its verify status is
//     printed; the command exits with verify's code. `--no-verify` leaves the
//     section `written`.
//   - Wave mode (no <n>, GRND-16, D-18-27): the sections are scheduled into
//     waves from depends_on (+ `wave:` overrides) and drafted up to
//     --max-parallel at a time (default 5). A malformed PLAN.md is one line
//     naming the file and the field, the outline's stubs are skipped with a
//     note, independent sections still draft, and any failure exits non-zero.
//
// Phase 17 wiring (RUN-07): run() calls assertLlmConfigured('write') before
// any section is touched, in both modes. Under PENSMITH_NO_LLM=1 the probe is a
// no-op and complete() returns the deterministic stub.

import { defineCommand } from 'citty';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { readGoalFromConfig } from './goal.js';
import { sectionDraft, sectionPlan, paperDir, projectRoot } from '../lib/paths.js';
import { updatePlanFrontmatter } from '../lib/plan-status.js';
import { assembleDrafterInput, buildDrafterRequest } from '../lib/drafter-input.js';
import { checkDraft, containmentCorrection, failureReason } from '../lib/draft-containment.js';
import { runAllSections, type SectionSkip } from '../lib/write-orchestrator.js';
import { parseOutline } from '../lib/outline-parse.js';
import type { SectionNode } from '../lib/schemas/wave-graph.js';
import { TutorialSubscriber } from '../lib/tutorial.js';
import { isReplayActive } from '../lib/replay.js';
import { complete, assertLlmConfigured, correctiveMessages, isFatalLlmError, type ChatMessage } from '../lib/anthropic.js';
import { requestHints } from '../lib/prompt-request.js';
import { tryLoadLibrary } from '../lib/library.js';
import type { SourceContextInput } from '../lib/source-context.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { formatSectionId, sectionIdOf } from '../lib/section-id.js';
import { EXIT_BLOCKED, EXIT_COST_CAP, EXIT_ERROR, EXIT_OK, PensmithError, type ExitCode } from '../lib/exit-codes.js';
import { classifyFailure, exitCodeForResult, failureLine } from '../lib/verb-outcome.js';
import { verifySection } from './verify.js';

// STYL-03 voice precedence lives with the drafter contract (drafter-input.ts);
// re-exported here for the write-style-integration contract test.
export { resolveVoiceHint } from '../lib/drafter-input.js';

/** Wave mode's default --max-parallel (workflows/write.md documents the same number). */
export const DEFAULT_MAX_PARALLEL = 5;

/** The drafter kept citing sources outside the section after one corrective turn (FEED-04): EXIT_BLOCKED. */
export class DraftContainmentError extends PensmithError {
  constructor(reason: string, id: string, rejected: string) {
    super(
      `section ${id} failed: ${reason} — the draft was not kept (it is in ${rejected}); ` +
        `adjust the plan or sources, then run \`pensmith write ${id}\``,
      EXIT_BLOCKED,
    );
    this.name = 'DraftContainmentError';
  }
}

/**
 * Construct the educator-mode subscriber in the CLI tier (the SOLE goal-aware
 * seam — Foundation never imports this). Returns `undefined` for goal=draft (the
 * zero-activation contract) and on any construction error (non-fatal, mirrors
 * runStyleProducerNonFatal): a bad subscriber must never break `write`.
 *
 * goal is read via the SHARED readGoalFromConfig from bin/cli/goal.ts (L5 dedup —
 * one helper, two consumers: this file + the four goal-aware router callers).
 */
function makeSubscriberNonFatal(paperRoot: string): TutorialSubscriber | undefined {
  const goal = readGoalFromConfig(paperRoot);
  if (goal !== 'learning' && goal !== 'both') return undefined;
  try {
    return new TutorialSubscriber({
      tutorialPath: path.join(paperDir(paperRoot), 'TUTORIAL.md'),
      goal,
    });
  } catch (e) {
    process.stderr.write(
      `pensmith write: WARN — tutorial subscriber construction failed (non-fatal): ${(e as Error).message}\n`,
    );
    return undefined;
  }
}

/** What writeOneSection produced. */
interface WrittenSection {
  readonly draftPath: string;
  readonly id: string;
  readonly assignedSources: string[];
}

/** The library entries every drafter input is built from (none before research). */
async function libraryEntries(paperRoot: string): Promise<SourceContextInput[]> {
  return (await tryLoadLibrary(paperRoot))?.entries ?? [];
}

/**
 * Write ONE section's DRAFT.md. This is the single-section drafter path, shared
 * verbatim by `pensmith write <n>` and the wave orchestrator's per-node
 * callback. The drafter input is assembled and validated (WRTE-04) BEFORE the
 * section is touched or any model call is made.
 */
async function writeOneSection(
  paperRoot: string,
  section: { n: number; slug: string },
  entries: readonly SourceContextInput[],
): Promise<WrittenSection> {
  // Throws SectionNotPlannedError (EXIT_USAGE) for the outline's stub and
  // PlanUnreadableError (file + field) for a malformed PLAN.md.
  const { input, missingRecords } = assembleDrafterInput(paperRoot, section, entries);
  const id = formatSectionId(sectionIdOf(input.section.n, input.section.suffix));
  if (input.sources.length === 0) {
    process.stderr.write(
      `pensmith write: WARN — section ${id} has no assigned sources; drafting it without citations. ` +
        `Add sources with \`pensmith plan ${id} --research "<query>"\` or \`pensmith add <doi> --section ${input.section.n} --slug ${input.section.slug}\`, then re-plan.\n`,
    );
  } else if (missingRecords.length > 0) {
    process.stderr.write(
      `pensmith write: WARN — section ${id} assigns ${missingRecords.join(', ')}, which LIBRARY.json does not hold; ` +
        'the drafter sees no record for them.\n',
    );
  }
  const req = buildDrafterRequest(input);
  const planPath = sectionPlan(section.n, section.slug, paperRoot);

  // Audit #9: mark the section 'writing' BEFORE drafting (D-08-AMENDED). If the
  // drafter throws, PLAN.md is left 'writing' so the router routes back to write
  // (retry), never silently stranding the section. A `resume --replay` serving
  // logged responses does not: a replay that finds no matching response must
  // leave the paper exactly as it was (RUN-17), and a hit goes straight to
  // 'written' below.
  if (!isReplayActive()) {
    await updatePlanFrontmatter(planPath, (fm) => {
      fm.status = 'writing';
    });
  }

  const call = async (messages: ChatMessage[]): Promise<string> =>
    (await complete({ slug: 'section-drafter', section: section.n, system: req.system, messages, stubHint: requestHints(req) })).text;

  // FEED-04 containment: one corrective turn, then fail the section.
  let draft = await call(req.messages);
  let violations = checkDraft(draft, { assigned: input.sources, section: id });
  if (violations.length > 0) {
    draft = await call(correctiveMessages(req.messages, draft, containmentCorrection(violations, input.sources)));
    violations = checkDraft(draft, { assigned: input.sources, section: id });
  }
  const draftPath = sectionDraft(section.n, section.slug, paperRoot);
  const rejectedPath = path.join(path.dirname(draftPath), 'DRAFT.rejected.md');
  if (violations.length > 0) {
    const reason = failureReason(violations, id);
    await atomicWriteFile(rejectedPath, draft);
    await updatePlanFrontmatter(planPath, (fm) => {
      fm.status = 'failed';
      fm.failure_reason = reason;
    });
    throw new DraftContainmentError(reason, id, path.relative(paperRoot, rejectedPath).split(path.sep).join('/'));
  }

  await atomicWriteFile(draftPath, draft);
  if (existsSync(rejectedPath)) rmSync(rejectedPath, { force: true });

  // Audit #9: mark the section 'written' so the router advances to verify.
  // verify owns verified_against_draft_hash — write deliberately does NOT set
  // it, so a re-write leaves the old hash stale and compile's staleness check
  // forces re-verification (the write<->verify cycle-break).
  if (!(await updatePlanFrontmatter(planPath, (fm) => {
    fm.status = 'written';
    delete fm.failure_reason;
  }))) {
    process.stderr.write(
      `pensmith write: WARN — could not set status:'written' on ${planPath} ` +
      `(PLAN.md absent/unwritable); the router may not advance this section to verify.\n`,
    );
  }
  return { draftPath, id, assignedSources: input.sources };
}

/** Verify a freshly drafted section (GRND-15) and report its status. */
async function verifyWritten(section: { n: number; slug: string }, id: string): Promise<{ status: string; code: ExitCode }> {
  const v = await verifySection(section.n, section.slug);
  const code = exitCodeForResult(v);
  process.stdout.write(`pensmith write: section ${id} verify: ${String(v.status)}\n`);
  return { status: String(v.status), code };
}

/**
 * The wave's exit code from its failures' classified codes: EXIT_COST_CAP when
 * the session cap refused a call; else the code every failure shares (e.g. a
 * session-lock refusal); else EXIT_ERROR.
 */
function waveExitCode(codes: readonly ExitCode[]): ExitCode {
  if (codes.includes(EXIT_COST_CAP)) return EXIT_COST_CAP;
  const first = codes[0];
  if (first !== undefined && codes.every((c) => c === first)) return first;
  return EXIT_ERROR;
}

export const writeCommand = defineCommand({
  meta: {
    name: 'write',
    description:
      'Draft DRAFT.md for one section, or (no <n>) schedule all planned sections into waves; each draft is then verified.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based; a letter for an inserted section, e.g. 1a). Omit to write ALL planned sections wave-by-wave.',
      required: false,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to the outline\'s slug for <n>).',
    },
    'max-parallel': {
      type: 'string',
      description: `Wave mode: how many sections of one wave are drafted at the same time (default ${DEFAULT_MAX_PARALLEL}).`,
    },
    verify: {
      type: 'boolean',
      description: 'Verify each section right after drafting it (default); --no-verify leaves it `written`.',
      default: true,
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const chainVerify = args.verify !== false;

    // ---- Wave mode: no positional <n> ----
    if (args.n === undefined || args.n === null || args.n === '') {
      // CR-02 / RUN-07: GEN-06 fail-loud probe for wave mode, before any
      // section is dispatched (a per-section failure could not stop the wave).
      await assertLlmConfigured('write');

      const rawMax = typeof args['max-parallel'] === 'string' ? Number(args['max-parallel']) : DEFAULT_MAX_PARALLEL;
      const maxParallel = Number.isInteger(rawMax) && rawMax >= 1 ? rawMax : DEFAULT_MAX_PARALLEL;

      const paperRoot = projectRoot();

      // Audit M2: a missing or section-less OUTLINE.md must yield a friendly
      // diagnostic, not a raw parseOutline stack trace from the wave orchestrator.
      const outlinePath = path.join(paperDir(paperRoot), 'OUTLINE.md');
      let outlineSectionCount = 0;
      try {
        outlineSectionCount = parseOutline(readFileSync(outlinePath, 'utf8')).sections.length;
      } catch {
        outlineSectionCount = 0;
      }
      if (outlineSectionCount === 0) {
        process.stderr.write(
          `pensmith write: no usable outline at ${outlinePath} — run \`pensmith outline\` ` +
          `to create the section table first.\n`,
        );
        process.exitCode = 1;
        return { ok: false, mode: 'no-outline' };
      }

      const entries = await libraryEntries(paperRoot);
      const invalid: SectionSkip[] = [];
      const unplanned: SectionSkip[] = [];
      const verifyCodes: ExitCode[] = [];
      const verified: Record<string, string> = {};

      // Goal awareness is confined to the CLI tier. goal=draft yields undefined,
      // so the `subscriber ? … : undefined` below makes the Foundation callback a
      // no-op — the zero-branch mechanism. Foundation never imports tutorial.ts.
      const subscriber = makeSubscriberNonFatal(paperRoot);
      const results = await runAllSections(paperRoot, {
        maxParallel,
        writeSection: async (node: SectionNode) => {
          process.stdout.write(
            JSON.stringify({ event: 'section_start', wave: node.computed_wave, section: node.slug }) + '\n',
          );
          const written = await writeOneSection(paperRoot, { n: node.n, slug: node.slug }, entries);
          let verify = 'not run (--no-verify)';
          if (chainVerify) {
            const v = await verifyWritten({ n: node.n, slug: node.slug }, written.id);
            verify = v.status;
            if (v.code !== EXIT_OK) verifyCodes.push(v.code);
          }
          verified[node.slug] = verify;
          process.stdout.write(
            JSON.stringify({ event: 'section_done', wave: node.computed_wave, section: node.slug, status: 'done', verify }) + '\n',
          );
        },
        // RUN-09: a failure every later section would repeat (the session cost
        // cap, a missing key, an invalid runtime config, a replay miss) stops
        // the run — sections not yet started are reported `skipped`.
        stopOn: isFatalLlmError,
        onInvalidPlan: (skip) => {
          invalid.push(skip);
          process.stderr.write(`pensmith write: section ${skip.id} (${skip.slug}) skipped — ${skip.planPath}: ${skip.reason}\n`);
        },
        onUnplanned: (skip) => {
          unplanned.push(skip);
          process.stderr.write(`pensmith write: section ${skip.id} (${skip.slug}) is not planned yet — skipped; run \`pensmith plan ${skip.id}\`\n`);
        },
        // Additive observer: the key is present ONLY when a subscriber was
        // constructed (goal ∈ {learning, both}). goal=draft omits it entirely →
        // the Foundation guard is a no-op (zero-branch). The conditional spread
        // satisfies exactOptionalPropertyTypes (never pass an explicit undefined).
        ...(subscriber
          ? {
              onSectionWritten: (evt: {
                n: number;
                slug: string;
                planPath: string;
                assignedSources: string[];
              }) => subscriber.emit({ kind: 'section.written', payload: evt }),
            }
          : {}),
      });

      // Drain the subscriber so TUTORIAL.md is complete before returning. No-op
      // when no subscriber was constructed (goal=draft).
      await subscriber?.flush();

      for (const wave of results) {
        const counts = wave.sections.reduce<Record<string, number>>((acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        }, {});
        process.stdout.write(
          JSON.stringify({ event: 'wave_complete', wave: wave.wave, results: counts }) + '\n',
        );
      }

      // RUN-09 / RUN-12: every failed section gets ONE stderr line naming it and
      // the failure (classified exactly as the dispatcher would classify a
      // single-section run), and the run exits with the failures' documented
      // code — EXIT_COST_CAP when the session cap stopped it.
      const failures = results.flatMap((w) => w.sections.filter((s) => s.status === 'failed'));
      const codes: ExitCode[] = [];
      for (const f of failures) {
        const c = classifyFailure(f.cause ?? new Error(f.error ?? 'unknown error'));
        codes.push(c.code);
        process.stderr.write(`${failureLine(`pensmith write: section ${f.n} (${f.slug}) failed: ${c.message}`)}\n`);
      }
      codes.push(...invalid.map((): ExitCode => EXIT_ERROR));
      codes.push(...verifyCodes);
      const skipped = results.reduce((acc, w) => acc + w.sections.filter((s) => s.status === 'skipped').length, 0);
      if (skipped > 0) {
        process.stderr.write(`pensmith write: stopped — ${skipped} section(s) not attempted; fix the failure above and re-run \`pensmith write\`.\n`);
      }
      const summary = { mode: 'wave', waves: results, verified, invalid, unplanned };
      if (codes.length === 0) return { ok: true, ...summary };
      return { ok: false, ...summary, exitCode: waveExitCode(codes) };
    }

    // ---- Single-section mode: positional <n> present ----
    // RUN-09: <n> must name one of the paper's sections (EXIT_USAGE otherwise —
    // before any model call, and no placeholder folder for a registered paper).
    const paperRoot = projectRoot();
    const { n, slug } = resolveSectionArg('write', paperRoot, args.n, args.slug);
    // GEN-06 / RUN-07 fail-loud probe: an LLM must be configured before the
    // section is touched (writeOneSection marks it 'writing' first).
    await assertLlmConfigured('write');
    const entries = await libraryEntries(paperRoot);
    // Construct the goal-aware subscriber for a single-section re-do too, so a
    // re-write in learning/both mode still re-annotates TUTORIAL.md. goal=draft
    // yields undefined → the emit/flush below are no-ops and DRAFT.md is
    // byte-unchanged for every goal (the writer never sees the subscriber).
    const subscriber = makeSubscriberNonFatal(paperRoot);

    const written = await writeOneSection(paperRoot, { n, slug }, entries);

    if (subscriber) {
      subscriber.emit({
        kind: 'section.written',
        payload: { n, slug, planPath: sectionPlan(n, slug, paperRoot), assignedSources: written.assignedSources },
      });
      await subscriber.flush();
    }

    process.stdout.write(`pensmith write: wrote DRAFT.md to ${written.draftPath}\n`);
    if (!chainVerify) {
      process.stdout.write(`pensmith write: section ${written.id} left written (--no-verify); run \`pensmith verify ${written.id}\` next\n`);
      return { ok: true, path: written.draftPath, mode: 'real', verify: 'not run' };
    }
    const v = await verifyWritten({ n, slug }, written.id);
    return { ok: v.code === EXIT_OK, path: written.draftPath, mode: 'real', verify: v.status, exitCode: v.code };
  },
});

export default writeCommand;
