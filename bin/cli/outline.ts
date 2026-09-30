// bin/cli/outline.ts — `pensmith outline` verb entrypoint (OUTL-01, GRND-07..10,
// FEED-03).
//
// Tier-2 orchestrator. In Tier 1 the workflow body delegates to the model with
// the `outline-author` prompt (D-12 LOCKED slug); here the verb calls complete()
// through the Phase 11 transport (GEN-02).
//
//   1. An existing OUTLINE.md and no --force: apply it as written — no model
//      call (audit #1/#4; review round 2). The table is checked structurally
//      (unique ids and slugs, depends_on known and acyclic, citekeys in
//      LIBRARY.json); sections match STATE.json by slug; a registered section
//      the table no longer lists is archived (through the `reoutline` gate in a
//      paper with drafts); a renumbered section is refused; every section
//      without a PLAN.md gets its stub. This is how a hand-edited OUTLINE.md is
//      registered (the router reports the divergence and names this command).
//   2. A paper with drafts needs --force plus the `reoutline` gate to be
//      re-outlined (D-18-18; --yolo answers it only together with --force).
//      No terminal and no --yolo: the outline-approval gate refuses BEFORE the
//      model call (EXIT_APPROVAL; nothing sent, billed or written).
//   3. The request (FEED-03, D-18-14) is fixed instructions plus data blocks
//      (prompt-request.ts): the paper brief (intake topic, thesis, discipline
//      and its sectioning convention, paper type, length target, sectioning
//      notes, whether a counterargument is required), the existing sections on
//      a re-outline, and every LIBRARY.json source, fenced (FEED-05).
//   4. The reply is validated (GRND-08): the structured contract, then
//      outline-validate.ts (slugs, depends_on, cycles, citekeys in the library,
//      the ±20% word budget, zero-source sections, the counterargument rule —
//      D-18-19). One corrective turn quotes every error; still invalid →
//      `.paper/OUTLINE.rejected.md` holds the replies, the command exits
//      EXIT_ERROR naming the errors, and OUTLINE.md, STATE.json and every
//      section stay byte-identical — even under --yolo. The router then reports
//      attention instead of re-billing (router.ts).
//   5. The approval gate (`outline-approval`, default-ON; --yolo skips it).
//   6. OUTLINE.md is rendered from the validated object (the canonical
//      8-column table), sections are registered with stub PLAN.md files
//      (GRND-09), a re-outline archives dropped sections to
//      `sections/_archive/` and never touches a kept one, and
//      OUTLINE.rejected.md is deleted.

import { defineCommand } from 'citty';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { parseSectionDirName, projectRoot, sectionDraft, sectionPlan, sectionsDir } from '../lib/paths.js';
import { runGate, declineGate, canPrompt } from '../lib/gates.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from '../lib/exit-codes.js';
import { complete, assertLlmConfigured, correctiveMessages, StructuredOutputError, type ChatMessage } from '../lib/anthropic.js';
import { buildPromptRequest, requestHints, type PromptRequest } from '../lib/prompt-request.js';
import { renderOutlineMd, type OutlineRow } from '../lib/outline-parse.js';
import { outlinePath, outlineRejectedPath, readOutlineChecked } from '../lib/outline.js';
import { outlineProblem } from '../lib/section-registry.js';
import { readPaperBrief, type PaperBrief } from '../lib/paper-brief.js';
import { tryLoadLibrary } from '../lib/library.js';
import { buildOutlineSources, describeExcluded, excludedRemedy, libraryCitekeys, partitionCheckable, type SourceContextInput } from '../lib/source-context.js';
import { resolveCounterargument, type CounterargumentDecision } from '../lib/counterargument.js';
import { canonicalSectioningNotes } from '../lib/intake-overrides.js';
import { formatOutlineIssues, outlineCorrection, validateOutline, validateOutlineStructure, type OutlineIssue } from '../lib/outline-validate.js';
import {
  archiveSection,
  numberFreshOutline,
  planReoutline,
  registerSections,
  type ExistingSection,
  type OutlineSectionEntry,
  type ReoutlinePlan,
} from '../lib/section-stubs.js';
import { loadState, StateNotFoundError } from '../lib/state.js';
import { loadFrontmatterDocSync } from '../lib/frontmatter.js';
import { networkMode, offlineMarkerLine } from '../lib/http-mock.js';
import { readLlmRecords } from '../lib/replay.js';
import { closeSessionLog, currentSessionId } from '../lib/session-log.js';
import { formatSectionId, sectionIdOf, sortBySectionId } from '../lib/section-id.js';
import type { OutlineContract } from '../lib/llm-contracts.js';
import { out } from '../lib/output-sink.js';

/** The outline could not be used after the one corrective turn (GRND-08): one line, EXIT_ERROR. */
export class OutlineRejectedError extends PensmithError {
  constructor(problems: string) {
    super(
      `outline rejected: ${problems} — OUTLINE.md and the sections are unchanged; ` +
        'the replies are in .paper/OUTLINE.rejected.md',
      EXIT_ERROR,
    );
    this.name = 'OutlineRejectedError';
  }
}

/** The --dry-run marker line for OUTLINE.md and the stub PLAN.md bodies (D-18-29). */
function dryRunMarker(): string | null {
  return networkMode().dryRun ? offlineMarkerLine() : null;
}

/** A parsed OUTLINE row as a renderable/registrable entry. */
function entryFromRow(s: OutlineRow): OutlineSectionEntry {
  return {
    n: s.n,
    ...(s.suffix !== undefined ? { suffix: s.suffix } : {}),
    slug: s.slug,
    title: s.title,
    purpose: s.purpose ?? '',
    depends_on: [...s.depends_on],
    estimated_word_count: s.estimated_word_count ?? 0,
    assigned_sources: [...s.assigned_sources],
    role: s.role ?? 'body',
    ...(s.voice !== undefined ? { voice: s.voice } : {}),
  };
}

/** The registered sections of the paper (empty when STATE.json is absent). */
async function registeredSections(root: string): Promise<Array<{ n: number; suffix?: string | undefined; slug: string }>> {
  try {
    return sortBySectionId((await loadState(root)).sections ?? []);
  } catch (e) {
    if (e instanceof StateNotFoundError) return [];
    throw e;
  }
}

/** `§1a slug`. */
function sectionLabel(s: { n: number; suffix?: string | undefined; slug: string }): string {
  return `§${formatSectionId(sectionIdOf(s.n, s.suffix))} ${s.slug}`;
}

/**
 * Apply an existing OUTLINE.md — hand-edited or legacy — without a model call
 * (review round 2; D-18-16, D-18-18, GRND-08):
 *   - the table must be structurally sound (validateOutlineStructure: unique
 *     ids and slugs, depends_on known and acyclic, every assigned citekey in
 *     LIBRARY.json) — else a named refusal, EXIT_ERROR, nothing changed;
 *   - sections match STATE.json BY SLUG. A kept section keeps its number (its
 *     folder is never renamed): a row that renumbers one is refused;
 *   - a registered section the table no longer lists (a deleted or renamed
 *     row) is archived to `sections/_archive/` — in a paper with drafts only
 *     through the `reoutline` gate (a terminal confirms; --yolo answers it for
 *     the user's own edit; without either: EXIT_APPROVAL, nothing changed);
 *   - every row is registered, and a section with no PLAN.md gets its stub.
 */
async function applyExistingOutline(
  paperRoot: string,
  entries: OutlineSectionEntry[],
  opts: { yolo: boolean; marker: string | null },
): Promise<{ registered: number; stubsWritten: number; archived: string[] }> {
  const library: SourceContextInput[] = (await tryLoadLibrary(paperRoot))?.entries ?? [];
  const issues = validateOutlineStructure(
    entries.map((e) => ({ id: formatSectionId(sectionIdOf(e.n, e.suffix)), slug: e.slug, depends_on: e.depends_on, assigned_sources: e.assigned_sources, estimated_word_count: e.estimated_word_count, role: e.role })),
    libraryCitekeys(library),
  );
  if (issues.length > 0) {
    throw new PensmithError(
      `pensmith outline: .paper/OUTLINE.md cannot be registered: ${formatOutlineIssues(issues)} — ` +
        'fix the table, or re-outline with `pensmith outline --force`; nothing was changed',
      EXIT_ERROR,
    );
  }
  const registered = await registeredSections(paperRoot);
  const bySlug = new Map(registered.map((s) => [s.slug, s]));
  const renumbered = entries.filter((e) => {
    const reg = bySlug.get(e.slug);
    return reg !== undefined && formatSectionId(sectionIdOf(reg.n, reg.suffix)) !== formatSectionId(sectionIdOf(e.n, e.suffix));
  });
  if (renumbered.length > 0) {
    const what = renumbered.map((e) => {
      const reg = bySlug.get(e.slug) as { n: number; suffix?: string | undefined };
      return `"${e.slug}" as §${formatSectionId(sectionIdOf(e.n, e.suffix))} (it is §${formatSectionId(sectionIdOf(reg.n, reg.suffix))})`;
    });
    throw new PensmithError(
      `pensmith outline: .paper/OUTLINE.md renumbers ${what.join(', ')} — a section keeps its number and folder for good ` +
        '(D-18-18); restore the number in OUTLINE.md (to move a section, re-outline with `pensmith outline --force`); nothing was changed',
      EXIT_ERROR,
    );
  }
  const rowSlugs = new Set(entries.map((e) => e.slug));
  const dropped = registered.filter((s) => !rowSlugs.has(s.slug));
  if (dropped.length > 0 && paperHasDrafts(paperRoot)) {
    const names = dropped.map(sectionLabel).join(', ');
    const outcome = await runGate('reoutline', {
      yolo: opts.yolo,
      detail: `applying the edited OUTLINE.md moves ${names} to sections/_archive/; nothing was changed`,
      question: {
        id: 'reoutline',
        kind: 'confirm',
        label: `Apply the edited OUTLINE.md? It no longer lists ${names}; ${dropped.length === 1 ? 'its folder moves' : 'their folders move'} to sections/_archive/.`,
        default: false,
      },
    });
    if (outcome.kind === 'answered' && !(outcome.answer.kind === 'confirm' && outcome.answer.value === true)) {
      declineGate('reoutline', 'the edited OUTLINE.md was not applied — nothing changed');
    }
  }
  const archived: string[] = [];
  for (const d of dropped) {
    const where = await archiveSection(paperRoot, d.slug);
    archived.push(`${sectionLabel(d)}${where ? ` → ${path.relative(paperRoot, where).split(path.sep).join('/')}` : ''}`);
  }
  const r = await registerSections(paperRoot, entries, { marker: opts.marker });
  return { registered: r.registered, stubsWritten: r.stubsWritten, archived };
}

/** Does any section folder hold a DRAFT.md? (`sections/_archive/` is not a section.) */
function paperHasDrafts(root: string): boolean {
  let names: string[];
  try {
    names = readdirSync(sectionsDir(root));
  } catch {
    return false;
  }
  return names.some((name) => parseSectionDirName(name) !== null && existsSync(path.join(sectionsDir(root), name, 'DRAFT.md')));
}

/** A kept section's PLAN.md allocation (the authoritative map, FEED-04), when readable. */
function planAssignedSources(root: string, n: number, slug: string): string[] | undefined {
  const file = sectionPlan(n, slug, root);
  if (!existsSync(file)) return undefined;
  try {
    const fm = loadFrontmatterDocSync('plan', file).frontmatter;
    return Array.isArray(fm['assigned_sources']) ? (fm['assigned_sources'] as unknown[]).map(String) : undefined;
  } catch {
    return undefined;
  }
}

/** The replies of this session's last `count` outline-author calls, from SESSION.log. */
async function loggedReplies(root: string, count: number): Promise<string[]> {
  try {
    await closeSessionLog(); // drain the async log queue (nothing is closed)
    const session = currentSessionId();
    return readLlmRecords(root)
      .filter((r) => r.slug === 'outline-author' && r.run_id === session)
      .slice(-count)
      .map((r) => (typeof r.response?.text === 'string' ? r.response.text : ''));
  } catch {
    return [];
  }
}

/** Save the rejected replies (GRND-08) — the only file a failed outline writes. */
async function writeRejection(root: string, problems: readonly string[], replies: readonly string[]): Promise<void> {
  const fence = (text: string): string => {
    const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}text\n${text.replace(/\r\n/g, '\n').trimEnd()}\n${ticks}`;
  };
  const lines = [
    '# Rejected outline',
    '',
    `\`pensmith outline\` could not use the model's outline after one corrective turn (${new Date().toISOString()}).`,
    'OUTLINE.md, STATE.json and the section folders were not changed. Fix the problem below',
    '(for example the length target, the sources, or `--no-counter`), then run `pensmith outline`;',
    'a successful run deletes this file.',
    '',
    '## Problems',
    '',
    ...problems.map((p) => `- ${p}`),
    '',
  ];
  replies.forEach((r, i) => {
    lines.push(`## Reply ${i + 1}${i === 1 ? ' (after the corrective turn)' : ''}`, '', r.trim() ? fence(r) : '(empty reply)', '');
  });
  if (replies.length === 0) lines.push('The replies are in .paper/SESSION.log (kind "llm", slug "outline-author").', '');
  await atomicWriteFile(outlineRejectedPath(root), lines.join('\n'));
}

/** Remove OUTLINE.rejected.md after a successful outline. */
function clearRejection(root: string): void {
  try {
    rmSync(outlineRejectedPath(root), { force: true });
  } catch {
    /* best-effort: a stale file only makes the router report attention while no section is registered */
  }
}

/** `text` with its first letter upper-cased. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Run the outline approval gate — `outline-approval` in the gate registry
 * (RUN-28, bin/lib/gates.ts; CLAUDE.md non-negotiable: default-ON).
 */
async function runApprovalGate(outlineText: string, yolo: boolean, withheld: string | null): Promise<void> {
  if (!yolo && canPrompt()) {
    const preview = outlineText.slice(0, 3000) + (outlineText.length > 3000 ? '\n…(truncated)' : '');
    process.stderr.write(`Proposed outline:\n${preview}\n`);
    // D-18-37: say, where the user decides, which library sources the outline
    // was not offered (the citation verifier cannot check them yet, or they
    // are retracted).
    if (withheld !== null) process.stderr.write(`${withheld}\n`);
  }
  const outcome = await runGate('outline-approval', {
    yolo,
    detail: 'no OUTLINE.md was written',
    question: { id: 'outline-approval', kind: 'confirm', label: 'Accept this outline and write OUTLINE.md?', default: false },
  });
  if (outcome.kind === 'yolo') return;
  if (outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true) return;
  declineGate('outline-approval', 'outline rejected — no OUTLINE.md written');
}

/** The `brief` data block (18-PLAN.md §3.3), built field by field. */
function briefBlock(brief: PaperBrief, counter: CounterargumentDecision): Record<string, string | number | boolean | string[]> {
  return {
    topic: brief.topic,
    thesis: brief.thesis,
    discipline: brief.discipline.slug.value,
    paper_type: brief.paperType,
    length_target_words: brief.lengthTarget,
    sectioning_convention: [...brief.discipline.sectioningConvention],
    // FEED-05 (review round 3): the brief block is not fenced, so the notes —
    // assignment clauses and the clarifier's reading of them — go in rebuilt
    // from a fixed vocabulary and the section names, never verbatim.
    sectioning_notes: canonicalSectioningNotes(brief.sectioningNotes),
    counterargument_required: counter.required,
    min_sections: 3,
    max_sections: 7,
  };
}

interface Attempt {
  data: OutlineContract;
  text: string;
}

/** A validated reply: its issues, thesis and numbered sections (and the re-outline plan). */
interface Checked {
  issues: OutlineIssue[];
  thesis: string;
  numbered: OutlineSectionEntry[];
  plan: ReoutlinePlan | null;
}

export const outlineCommand = defineCommand({
  meta: {
    name: 'outline',
    description: 'Propose a section outline (approval-gated unless --yolo); approval creates each section\'s stub PLAN.md.',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate and the re-outline confirmation (re-outlining a paper with drafts through the model also needs --force).',
      default: false,
    },
    force: {
      type: 'boolean',
      description: 'Re-outline even when OUTLINE.md exists; kept sections are untouched, dropped ones archived.',
      default: false,
    },
    counter: {
      type: 'boolean',
      description: 'Enforce the counterargument + rebuttal rule when the paper needs one (--no-counter disables it, PRD §7.4).',
      default: true,
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const outlineFile = outlinePath(paperRoot);
    const yolo = args.yolo === true;
    const force = args.force === true;
    const marker = dryRunMarker();

    // ── 1. An existing OUTLINE.md and no --force: apply it as written — no model call ──
    // Review round 3: an OUTLINE.md that is present but unreadable (a hand edit
    // with one bad row) is refused by name — never treated as absent, which
    // would re-outline through the model and overwrite the user's edits.
    const read = readOutlineChecked(paperRoot);
    if (!force && read.kind === 'invalid') {
      throw new PensmithError(`pensmith outline: ${outlineProblem(paperRoot) ?? `.paper/OUTLINE.md cannot be read (${read.error})`}`, EXIT_ERROR);
    }
    const existingOutline = read.kind === 'ok' ? read.doc : null;
    if (!force && existingOutline !== null && existingOutline.sections.length > 0) {
      const r = await applyExistingOutline(paperRoot, existingOutline.sections.map(entryFromRow), { yolo, marker });
      clearRejection(paperRoot);
      out(
        `pensmith outline: OUTLINE.md already present (${r.registered} section(s)); registered ${r.registered} section(s) in STATE.json` +
          `${r.stubsWritten > 0 ? `, wrote ${r.stubsWritten} stub PLAN.md` : ''}` +
          `${r.archived.length > 0 ? `; archived ${r.archived.join(', ')}` : ''}. Not regenerating — pass --force to re-outline.\n`,
      );
      return { ok: true, path: outlineFile, mode: 'existing', sections: r.registered, stubs: r.stubsWritten, archived: r.archived };
    }

    // ── 2. Re-outlining a paper with drafts: --force plus the reoutline gate (D-18-18) ──
    // Decided from the section folders alone, so a refusal reads (and
    // migrates) nothing.
    const hasDrafts = paperHasDrafts(paperRoot);
    if (hasDrafts && !force) {
      throw new PensmithError(
        'pensmith outline: this paper already has section drafts — re-outlining it needs --force (kept sections stay untouched; dropped ones move to sections/_archive/)',
        EXIT_USAGE,
      );
    }
    if (hasDrafts) {
      const outcome = await runGate('reoutline', {
        yolo,
        detail: 'no outline was requested and no section was changed',
        question: {
          id: 'reoutline',
          kind: 'confirm',
          label: 'Re-outline this paper? Kept sections stay untouched; dropped sections move to sections/_archive/.',
          default: false,
        },
      });
      if (outcome.kind === 'answered' && !(outcome.answer.kind === 'confirm' && outcome.answer.value === true)) {
        declineGate('reoutline', 're-outline cancelled — nothing changed');
      }
    }

    // ── RUN-28: the approval gate cannot be answered without a terminal ──
    // Known before the paid outline-author call, so refuse NOW (EXIT_APPROVAL).
    if (!yolo && !canPrompt()) {
      await runGate('outline-approval', { yolo: false, detail: 'no outline was requested and no OUTLINE.md was written' });
    }

    // ── GEN-06 / RUN-07 fail-loud probe (BEFORE any prompt/complete() work) ──
    await assertLlmConfigured('outline');

    // ── 3. The request: the brief, the existing sections, every library source (FEED-03) ──
    const registered = await registeredSections(paperRoot);
    const brief = readPaperBrief(paperRoot);
    // GRND-18: only the sources the citation verifier can check are offered
    // (source-context.ts verifierBlindSpot) — citing one it cannot check always
    // fails verify and strands the section. The others are named once.
    const library: SourceContextInput[] = (await tryLoadLibrary(paperRoot))?.entries ?? [];
    const { checkable: entries, excluded } = partitionCheckable(library, networkMode().dryRun);
    const withheld = excluded.length > 0
      ? `Not offered to the outline (${excluded.length} of ${library.length} LIBRARY.json source(s)) because the citation verifier would not pass a citation of them: ` +
        `${describeExcluded(excluded, excluded.length)}. ${capitalise(excludedRemedy(excluded))}.`
      : null;
    if (withheld !== null) {
      process.stderr.write(
        `pensmith outline: WARN — ${excluded.length} of ${library.length} source(s) in LIBRARY.json are not offered to the outline ` +
          `because the citation verifier would not pass a citation of them: ${describeExcluded(excluded)}\n`,
      );
    }
    const counter = resolveCounterargument({
      noCounter: args.counter === false,
      configRequired: brief.configCounterargument,
      intakeAnswer: brief.counterargument,
      paperType: brief.paperType,
      discipline: brief.discipline.slug.value,
    });
    const rowsBySlug = new Map((existingOutline?.sections ?? []).map((s) => [s.slug, s]));
    const existing: ExistingSection[] = registered.map((s) => ({
      n: s.n,
      ...(s.suffix !== undefined ? { suffix: s.suffix } : {}),
      slug: s.slug,
      assignedSources: planAssignedSources(paperRoot, s.n, s.slug) ?? rowsBySlug.get(s.slug)?.assigned_sources,
    }));
    const req: PromptRequest = buildPromptRequest('outline-author', {
      brief: briefBlock(brief, counter),
      ...(existing.length > 0
        ? {
            existing_sections: existing.map((e) => ({
              slug: e.slug,
              title: rowsBySlug.get(e.slug)?.title ?? e.slug,
              role: rowsBySlug.get(e.slug)?.role ?? null,
              has_draft: existsSync(sectionDraft(e.n, e.slug, paperRoot)),
            })),
          }
        : {}),
      sources: buildOutlineSources(entries),
    });
    const known = libraryCitekeys(entries);

    const call = async (messages: ChatMessage[]): Promise<Attempt> => {
      const r = await complete<OutlineContract>({ slug: 'outline-author', system: req.system, messages, stubHint: requestHints(req) });
      return { data: r.data as OutlineContract, text: r.text };
    };
    const check = (data: OutlineContract): Checked => {
      const issues = validateOutline({
        sections: data.sections,
        libraryCitekeys: known,
        lengthTarget: brief.lengthTarget,
        counterargumentRequired: counter.required,
      });
      if (existing.length === 0) return { issues, thesis: data.thesis, numbered: numberFreshOutline(data.sections), plan: null };
      const r = planReoutline(existing, data.sections);
      return { issues: [...issues, ...r.issues], thesis: data.thesis, numbered: r.plan?.sections ?? [], plan: r.plan };
    };

    // ── 4. One reply, one corrective turn, then reject (GRND-08) ──
    const replies: string[] = [];
    let accepted: Checked | null = null;
    try {
      const first = await call(req.messages);
      replies.push(first.text);
      let result = check(first.data);
      if (result.issues.length > 0) {
        const retryMessages = correctiveMessages(req.messages, first.text, outlineCorrection(result.issues));
        const second = await call(retryMessages);
        replies.push(second.text);
        result = check(second.data);
        if (result.issues.length > 0) {
          await writeRejection(paperRoot, result.issues.map((i) => i.message), replies);
          throw new OutlineRejectedError(formatOutlineIssues(result.issues));
        }
      }
      accepted = result;
    } catch (e) {
      if (!(e instanceof StructuredOutputError)) throw e;
      // Both attempts of one call failed the schema: complete() already sent
      // its one corrective retry. Save what the model said and stop.
      const detail = e.message.replace(/^outline-author: /, '').replace(/; nothing was written$/, '');
      const logged = await loggedReplies(paperRoot, 2);
      await writeRejection(paperRoot, [detail], replies.length > 0 ? [...replies, ...logged.slice(-1)] : logged);
      throw new OutlineRejectedError(detail);
    }

    // ── 5. Approval gate (CLAUDE.md non-negotiable: default-ON, skip with --yolo) ──
    const title = brief.title || 'Outline';
    const thesis = accepted.thesis.trim() || brief.thesis;
    const outlineMd = renderOutlineMd({ thesis, sections: accepted.numbered }, title, { marker });
    await runApprovalGate(outlineMd, yolo, withheld);

    // ── 6. Apply: archive dropped sections, register (stubs for new ones), write OUTLINE.md ──
    const archived: string[] = [];
    for (const d of accepted.plan?.dropped ?? []) {
      const where = await archiveSection(paperRoot, d.slug);
      archived.push(`§${formatSectionId(sectionIdOf(d.n, d.suffix))} ${d.slug}${where ? ` → ${path.relative(paperRoot, where).split(path.sep).join('/')}` : ''}`);
    }
    const reg = await registerSections(paperRoot, accepted.numbered, { marker });
    await atomicWriteFile(outlineFile, outlineMd);
    clearRejection(paperRoot);

    out(`pensmith outline: wrote OUTLINE.md to ${outlineFile}\n`);
    out(`pensmith outline: registered ${reg.registered} section(s) in STATE.json.\n`);
    if (accepted.plan !== null) {
      const added = accepted.numbered.filter((s) => accepted.plan?.added.includes(s.slug)).map((s) => `§${formatSectionId(sectionIdOf(s.n, s.suffix))} ${s.slug}`);
      out(
        `pensmith outline: kept ${accepted.plan.kept.length} section(s) untouched` +
          `${added.length > 0 ? `; added ${added.join(', ')}` : ''}` +
          `${archived.length > 0 ? `; archived ${archived.join(', ')}` : ''}.\n`,
      );
      if (accepted.plan.reordered) {
        process.stderr.write('pensmith outline: WARN — kept sections keep their numbers, so they stay in their original order.\n');
      }
    }
    if (counter.required) out(`pensmith outline: counterargument rule applied (${counter.source}).\n`);
    return { ok: true, path: outlineFile, mode: 'real', sections: reg.registered, stubs: reg.stubsWritten };
  },
});

export default outlineCommand;
