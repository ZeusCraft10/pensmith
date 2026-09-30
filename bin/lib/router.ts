// bin/lib/router.ts — Phase 7 Plan 07-02. The bare `/pensmith` state-aware
// next-WORK-verb resolver (UX-01).
//
// resolveNextAction is a READ-ONLY function of the paper's files: STATE.json,
// per-section PLAN.md frontmatter, each section's DRAFT.md hash (against
// verified_against_draft_hash), OUTLINE.md's rows (section-registry.ts: they must
// list the sections STATE.json registers), OUTLINE.rejected.md,
// COMPILE-INPUTS.json (compile-inputs.ts: the content the compiled draft was made
// from) and the compiled DRAFT.md / FINAL.md mtimes. It IGNORES HANDOFF.json entirely (H4 — see the PINNED ORDERING
// in 07-RESEARCH): a non-done HANDOFF must NOT trap bare /pensmith in a resume
// loop, so the resolver always returns a concrete next WORK verb (plan / write /
// verify / compile / done) or a status terminus, NEVER { verb:'resume' }. The
// resume verb (bin/cli/resume.ts) owns the { verb:'resume' } typing and
// dispatches into THIS function so it always advances.
//
// NEVER-THROW INVARIANT (C3-HIGH-1 + C4-HIGH + C5-HIGH — load-bearing):
// resolveNextAction is TOTAL over its ENTIRE input surface and NEVER throws /
// NEVER returns undefined. Every fs/parse op is guarded:
//   - loadState (C4-HIGH): catch-all → StateNotFoundError (ENOENT, file ABSENT)
//     routes to { verb:'new' }; any OTHER load/parse error (invalid JSON
//     SyntaxError, SchemaValidationError, ForwardIncompatError, EACCES/EPERM —
//     the file is PRESENT but corrupt/schema-invalid) routes to
//     { verb:'status', reason:'attention' } + a stderr diagnostic, never re-thrown.
//   - state.sections ?? [] (C4-HIGH): guarded before any .sort()/iteration.
//   - per-section PLAN.md (C5-HIGH): read through the SHARED guarded
//     readSectionState helper — absent → plan, present-but-corrupt → status/
//     attention+section, never throwing.
//   - existsSync probes: existsSync does not throw (returns false on any error).
//   - an OUTER try/catch backstop wraps the whole resolver body as
//     defense-in-depth so even a future un-audited op cannot break totality.
//
// readSectionState is the SINGLE guarded per-section PLAN.md read path (C6-HIGH):
// the section walk uses it AND bin/cli/status.ts imports + reuses it, so NO
// component does a raw unguarded parseFrontmatter(readFileSync(planPath)).
//
// SECTION-STATE → VERB MAP (Phase 18: GRND-08, GRND-13, FEED-04). Sections are
// walked in (n, suffix) order (§1 < §1a < §2); the first one that is not
// `verified` with its DRAFT.md in place decides:
//   PLAN.md absent                        → plan
//   planned + `stub: true` (the outline's) → plan
//   planned (a planner-written PLAN.md)   → write
//   writing                               → write
//   written / verifying                   → verify (a crashed verify left `verifying`)
//   verified / written / verifying / unverifiable WITHOUT a DRAFT.md → write (VRFY-16)
//   unverifiable, draft changed           → verify
//   unverifiable, the draft verify judged → continue (S-13: the other sections
//     go on; compile recomputes it and refuses with its options — never a
//     paid verify loop; `status` names them, unverifiableSectionDetail) —
//     except stub text (PLACEHOLDER) outside --dry-run: once the walk is past
//     every section, status/attention naming `pensmith write N` (compile
//     could only refuse it again, run after run)
//   failed WITH a DRAFT.md, draft changed → verify (re-attempt verification)
//   failed, the draft verify judged       → status/attention naming the repair
//   failed WITHOUT a DRAFT.md or with a failure_reason → status/attention,
//                                           detail naming `pensmith write N`
//   corrupt PLAN.md / unknown status      → status/attention + detail
// Before the walk: OUTLINE.rejected.md with no registered section → status/
// attention naming `pensmith outline` (a failed outline is never re-billed);
// an OUTLINE.md that is present but unreadable, or missing while sections are
// registered → status/attention naming the fix (section-registry.ts
// outlineProblem); OUTLINE.md rows that disagree with STATE.json's
// registrations → status/attention naming the divergence and `pensmith
// outline` (D-18-38).
// After the walk: a compiled DRAFT.md whose bytes differ from the sha256
// COMPILE-INPUTS.json recorded (a hand edit, VRFY-27) → status/attention
// (recompiling would replace the edit); else compile when the compiled draft
// is stale, done when FINAL.md is, status/done otherwise.
//
// Imports: loadState/StateNotFoundError (state.ts), existsSync (node:fs), join
// (node:path), paperDir/sectionPlan (paths.ts), loadFrontmatterDocSync
// (frontmatter.ts — the CONF-04 versioned reader, used without write-back), and
// the Handoff type (schemas/handoff.ts — type-only; the router does NOT read
// HANDOFF.json per H4).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadState, StateNotFoundError } from './state.js';
import { dryRunWorkspaceActive, paperDir, sectionDraft, sectionPlan, sectionVerification } from './paths.js';
import { loadFrontmatterDocSync } from './frontmatter.js';
import { formatSectionId, sectionIdOf, sortBySectionId } from './section-id.js';
import { computeDraftHash } from './draft-hash.js';
import { compiledInputsCurrent } from './compile-inputs.js';
import { outlineProblem, sectionRegistryProblem } from './section-registry.js';
import { parseBlockingVerdictRows, sectionVerificationReasons } from './verify/verdict-rows.js';
import { RETRY_ONLINE_VERDICTS } from './verify/verdicts.js';
import { isResearchDone } from './research-sentinel.js';
import { ACCEPTABLE_QUOTE_VERDICT } from './verify/verdicts.js';
import { readCompileInputs, fileSha256 } from './compile-inputs.js';
import type { Handoff } from './schemas/handoff.js';

export type RouterDecision =
  | { verb: 'new' }
  | { verb: 'research' }
  | { verb: 'outline' }
  // GRND-09 (D-18-16): `suffix` is the section's letter (§1a), absent for §1.
  // `n` + `slug` stay the dispatch arguments: the section verbs find a
  // lettered section by its slug.
  | { verb: 'plan'; n: number; slug: string; suffix?: string }
  | { verb: 'write'; n: number; slug: string; suffix?: string }
  | { verb: 'verify'; n: number; slug: string; suffix?: string }
  | { verb: 'compile' }
  | { verb: 'done' }
  // C3-HIGH-1 / C4-HIGH: status.reason is widened so the resolver is TOTAL.
  //   reason:'done'      → DRAFT.md + FINAL.md both present (nothing left to do)
  //   reason:'attention' → a section is in an unrecognized state, a corrupt
  //                        STATE.json / PLAN.md was reclassified here, the last
  //                        outline was rejected (GRND-08), a section failed
  //                        without a draft (FEED-04), or the guaranteed
  //                        terminal fallback fired (proves totality)
  // `detail` (GRND-08, GRND-13, FEED-04) says what needs attention and names
  // the command that fixes it; `status` prints it.
  | { verb: 'status'; reason: 'done' | 'attention'; section?: { n: number; slug: string; suffix?: string }; detail?: string }
  // NOTE (H4): resolveNextAction NEVER emits this member. It exists ONLY for the
  // explicit `resume` verb's own return typing (bin/cli/resume.ts).
  | { verb: 'resume'; handoff: Handoff };

/**
 * Normalized, NEVER-THROWS result of reading a per-section PLAN.md (C6-HIGH).
 */
export interface SectionStateRead {
  /** parsed `status` frontmatter, defaulted to 'planned' when absent. */
  status: string;
  /** true if the file was PRESENT but readFileSync/parseFrontmatter threw. */
  corrupt: boolean;
  /** true if the file does not exist on disk (existsSync === false). */
  absent: boolean;
}

/**
 * readSectionState plus the two Phase 18 fields the router and the status view
 * need (readSectionInfo). readSectionState keeps its three-field shape.
 */
export interface SectionInfoRead extends SectionStateRead {
  /** true for the stub outline approval wrote (`stub: true`, GRND-09): not planned yet. */
  stub: boolean;
  /** `failure_reason` (FEED-04: why write failed the section), or null. */
  failureReason: string | null;
  /** `verified_against_draft_hash` — the draft hash the last verify judged (null when never verified). */
  verifiedHash: string | null;
  /** `assigned_sources` (an input of the draft hash, D-07). */
  assignedSources: string[];
}

/**
 * The SINGLE guarded per-section PLAN.md read helper (C6-HIGH). resolveNextAction's
 * section walk uses it, AND bin/cli/status.ts imports + reuses it — so there is
 * ONE guarded read path and NO component does a raw unguarded
 * parseFrontmatter(readFileSync(planPath)) on a per-section PLAN.md.
 *
 * NEVER throws:
 *   - absent file (existsSync false)                    → { status:'planned', corrupt:false, absent:true }
 *   - present-but-corrupt/unreadable (C5-HIGH —          → { status:'planned', corrupt:true,  absent:false }
 *     readFileSync EACCES/EISDIR/TOCTOU after the          + one-line stderr diagnostic
 *     existsSync probe, OR parseFrontmatter on
 *     malformed YAML / alias-to-missing-anchor)
 *   - well-formed                                        → { status:<fm.status ?? 'planned'>, corrupt:false, absent:false }
 *
 * Mirrors the repo's own hooks/pre-compact.ts:178-187 guard around the IDENTICAL
 * parseFrontmatter(readFileSync(planPath,'utf8')) call. This is the ONLY
 * component permitted to emit the per-section corrupt-PLAN.md stderr diagnostic.
 */
export function readSectionState(planPath: string): SectionStateRead {
  const { status, corrupt, absent } = readSectionInfo(planPath);
  return { status, corrupt, absent };
}

/**
 * The same guarded read (never throws, one stderr diagnostic for a corrupt
 * file), also returning `stub` and `failure_reason` (GRND-13, FEED-04).
 */
export function readSectionInfo(planPath: string): SectionInfoRead {
  const none = { stub: false, failureReason: null, verifiedHash: null, assignedSources: [] };
  if (!existsSync(planPath)) {
    return { status: 'planned', corrupt: false, absent: true, ...none };
  }
  try {
    // CONF-04: the versioned loader, WITHOUT write-back (the router stays pure).
    // A PLAN.md newer than this build throws "upgrade pensmith" → corrupt below.
    const { frontmatter } = loadFrontmatterDocSync('plan', planPath);
    const fm = frontmatter as {
      status?: unknown;
      stub?: unknown;
      failure_reason?: unknown;
      verified_against_draft_hash?: unknown;
      assigned_sources?: unknown;
    };
    return {
      status: typeof fm.status === 'string' ? fm.status : 'planned',
      corrupt: false,
      absent: false,
      stub: fm.stub === true,
      failureReason: typeof fm.failure_reason === 'string' && fm.failure_reason.trim() ? fm.failure_reason.trim() : null,
      verifiedHash: typeof fm.verified_against_draft_hash === 'string' ? fm.verified_against_draft_hash : null,
      assignedSources: Array.isArray(fm.assigned_sources) ? fm.assigned_sources.map(String) : [],
    };
  } catch (e) {
    process.stderr.write(
      `[pensmith] PLAN.md at ${planPath} is unreadable/corrupt: ${(e as Error).message}\n`,
    );
    return { status: 'planned', corrupt: true, absent: false, ...none };
  }
}

/** The D-07 draft hash of a section's DRAFT.md (null when it cannot be read). Never throws. */
function draftHashOf(draftPath: string, assignedSources: readonly string[]): string | null {
  try {
    return computeDraftHash(readFileSync(draftPath), [...assignedSources]);
  } catch {
    return null;
  }
}

/**
 * Why a section's VERIFICATION.md may not compile (verdict-rows.ts
 * sectionVerificationReasons); a missing or unreadable file is one reason.
 * Never throws.
 */
function verificationBlockers(verificationPath: string): string[] {
  let md: string;
  try {
    md = readFileSync(verificationPath, 'utf8');
  } catch {
    return ['its VERIFICATION.md is missing or unreadable'];
  }
  const reasons = sectionVerificationReasons(md, dryRunWorkspaceActive());
  // One line for the usual case — every blocker an UNVERIFIABLE row.
  const unverifiable = parseBlockingVerdictRows(md).filter((r) => r.verdict === 'UNVERIFIABLE' || RETRY_ONLINE_VERDICTS.has(r.verdict));
  if (reasons.length > 1 && unverifiable.length === reasons.length) {
    const keys = unverifiable.map((r) => `[@${r.citekey}]`);
    const list = `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1] as string}`;
    return [`${list} are UNVERIFIABLE (their sources could not be checked: offline, --dry-run or a failed lookup)`];
  }
  return reasons;
}

/** True when a section's VERIFICATION.md holds a PLACEHOLDER row (stub text). Never throws. */
function recordHasPlaceholder(verificationPath: string): boolean {
  try {
    return parseBlockingVerdictRows(readFileSync(verificationPath, 'utf8')).some((r) => r.verdict === 'PLACEHOLDER');
  } catch {
    return false;
  }
}

/**
 * What an `unverifiable` section needs, in one line naming the remedies
 * (S-13, VRFY-20, VRFY-24): a quote no source text could be checked against
 * (UNVERIFIABLE-QUOTE) — add the source's PDF, paraphrase it, or accept that
 * one quote; stub text (PLACEHOLDER) — re-draft with a model configured; a
 * source that could not be reached — re-run the check online. Null when the
 * section's VERIFICATION.md names no blocking row. The walk goes on past such
 * a section (compile refuses it with the same options); `status` shows this
 * line. Never throws.
 */
export function unverifiableSectionDetail(verificationPath: string, label: string): string | null {
  let md: string;
  try {
    md = readFileSync(verificationPath, 'utf8');
  } catch {
    return `section ${label} could not be verified: its VERIFICATION.md is missing or unreadable — run \`pensmith verify ${label}\``;
  }
  const rows = parseBlockingVerdictRows(md);
  if (rows.length === 0) return null;
  const parts: string[] = [];
  const quotes = rows.filter((r) => r.verdict === ACCEPTABLE_QUOTE_VERDICT);
  if (quotes.length > 0) {
    const ids = [...new Set(quotes.map((q) => q.quoteId ?? '?'))];
    parts.push(
      `${ids.length} quote(s) (${ids.join(', ')}) could not be checked against any source text — add the source's PDF (\`pensmith add <pdf>\`), ` +
        `paraphrase (\`pensmith plan ${label} --revise\`), or accept a quote (\`pensmith verify ${label} --accept-quote ${ids[0] as string}\`)`,
    );
  }
  if (rows.some((r) => r.verdict === 'PLACEHOLDER')) {
    parts.push(`its draft is stub text written with no model configured (PLACEHOLDER) — re-draft it with a model: \`pensmith write ${label}\``);
  }
  const network = rows.filter((r) => RETRY_ONLINE_VERDICTS.has(r.verdict));
  if (network.length > 0) {
    parts.push(`${network.map((r) => `[@${r.citekey}]`).join(', ')} could not be checked (offline or a failed lookup) — re-run \`pensmith verify ${label}\` online`);
  }
  // An UNVERIFIABLE row is an answer that cannot be compared (D-20-10): its
  // reason names the agency and the remedy — re-running online changes nothing.
  for (const r of rows.filter((x) => x.verdict === 'UNVERIFIABLE')) {
    parts.push(`[@${r.citekey}] cannot be checked by its registrar${r.reason !== undefined ? ` — ${r.reason}` : ''}`);
  }
  if (parts.length === 0) parts.push(verificationBlockers(verificationPath).join('; '));
  return `section ${label} could not be verified: ${parts.join('; ')}`;
}

/** A file's mtime (ms), or null when it is absent or unreadable. Never throws. */
function mtimeOf(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/** `sections_count` from COMPILE-REPORT.md's frontmatter, or null. Never throws. */
function compiledSectionCount(pDir: string): number | null {
  try {
    const m = /^sections_count:\s*(\d+)\s*$/m.exec(readFileSync(join(pDir, 'COMPILE-REPORT.md'), 'utf8'));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * True when `.paper/DRAFT.md` must be compiled (again): it is absent, or
 * COMPILE-INPUTS.json (compile-inputs.ts) says it was compiled from other
 * sections or other section DRAFT.md / VERIFICATION.md bytes than the paper has
 * now. Decided from CONTENT, so a git checkout, a sync client or the --dry-run
 * seed that reorders mtimes never re-sends a finished paper to compile. A v1
 * record (migrated with null hashes) cannot show done the compiled draft is the
 * one compile wrote (VRFY-27), so it is compiled again. A paper compiled before
 * that record existed falls back to the mtimes and COMPILE-REPORT.md
 * `sections_count`; when it still needs done, the walk sends it to compile
 * first (done would refuse a draft with no record). Never throws.
 */
function compiledDraftStale(
  pDir: string,
  sections: ReadonlyArray<{ n: number; suffix?: string | undefined; slug: string }>,
  paperRoot: string,
): boolean {
  const compiledAt = mtimeOf(join(pDir, 'DRAFT.md'));
  if (compiledAt === null) return true;
  const record = readCompileInputs(paperRoot);
  if (record !== null && (record.compiled_draft_sha256 === null || record.sections.some((s) => s.verified_against_draft_hash === null))) return true;
  const current = compiledInputsCurrent(paperRoot, sections);
  if (current !== null) return !current;
  for (const { n, slug } of sections) {
    for (const file of [sectionDraft(n, slug, paperRoot), sectionVerification(n, slug, paperRoot)]) {
      const at = mtimeOf(file);
      if (at !== null && at > compiledAt) return true;
    }
  }
  const count = compiledSectionCount(pDir);
  return count !== null && count !== sections.length;
}

/**
 * Behavior options for resolveNextAction. opts is a plain, FEATURE-AGNOSTIC
 * behavior surface — NOT a workflow-mode token. `stopAfterResearch` is a
 * dependency-injected flag the CLI caller sets; the router never reads any
 * config and never knows WHY the caller wants to stop. Keeping the router
 * unaware of the caller's intent is what keeps Foundation free of the
 * educator-mode vocabulary the zero-branch invariant forbids (H1).
 */
export interface ResolveOptions {
  /**
   * When true AND RESEARCH.md exists, halt at the research stage and return the
   * existing `{ verb:'status', reason:'done' }` terminal instead of advancing to
   * outline. The CLI caller decides when to set this; the router stays agnostic.
   */
  stopAfterResearch?: boolean;
  /**
   * When true AND the outline is approved (OUTLINE.md lists the sections
   * STATE.json registers), halt there with `{ verb:'status', reason:'done' }`
   * instead of planning section 1 (GRND-02 outline-only mode, set by the CLI
   * tier from `[project] mode`; review round 3). Explicit verbs still run.
   */
  stopAfterOutline?: boolean;
}

/** What a paper routed with `stopAfterOutline` reports once its outline is approved. */
export const OUTLINE_ONLY_DONE =
  'outline only: the approved outline is .paper/OUTLINE.md (its sources in .paper/LIBRARY.json and CITATIONS.bib) — ' +
  'to draft the paper, set mode = "draft" under [project] in .paper/config.toml, or run a section yourself (`pensmith plan 1`)';

/**
 * Resolve the next WORK action for the active paper at `paperRoot`.
 *
 * TOTAL and NEVER-THROWS over its ENTIRE input surface (STATE.json AND each
 * per-section PLAN.md). NEVER returns undefined. NEVER returns { verb:'resume' }
 * (H4). See the file header for the full invariant and the COMPLETE
 * SECTION-STATE → VERB MAP (C3-HIGH-1).
 *
 * `opts.stopAfterResearch` is a FEATURE-AGNOSTIC behavior flag (DI) — the router
 * never reads config and never knows the caller's intent. Default `{}` (no stop)
 * is byte-identical to the prior no-arg behavior (back-compat — no regression).
 */
export async function resolveNextAction(
  paperRoot: string,
  opts: ResolveOptions = {},
): Promise<RouterDecision> {
  // C5-HIGH OUTER BACKSTOP (defense-in-depth): wrap the WHOLE resolver body so
  // even an unforeseen throw from any fs/parse op resolves to a valid
  // RouterDecision rather than escaping. The per-read guards below keep the
  // diagnostics specific; this backstop guarantees the never-throw invariant.
  try {
    // --- LOAD-ERROR CLASSIFICATION (C4-HIGH, FIRST step) ---
    // loadState translates ONLY ENOENT → StateNotFoundError. CATCH-ALL then
    // reclassify: absent → new; present-but-corrupt/schema-invalid/forward-
    // incompat/permission-denied → status/attention. NEVER re-throw.
    let state;
    try {
      state = await loadState(paperRoot);
    } catch (e) {
      if (e instanceof StateNotFoundError) return { verb: 'new' };
      process.stderr.write(
        `[pensmith] STATE.json at ${paperRoot} is unreadable/corrupt: ${(e as Error).message}\n`,
      );
      return { verb: 'status', reason: 'attention' };
    }

    const pDir = paperDir(paperRoot);

    // "Research done" sentinel (audit M1, D-19-16): a LIBRARY.json with at
    // least one entry — the research verb's canonical output per
    // workflows/research.md §Outputs — or, without one, a legacy / curated
    // RESEARCH.md that is not the log of a failed research run (a run that
    // found nothing usable writes its log and leaves LIBRARY.json untouched).
    // bin/lib/research-sentinel.ts; never throws.
    const researchDone = isResearchDone(pDir);

    // H4 PINNED ORDERING: HANDOFF.json is NOT read here. existsSync never throws.
    if (!researchDone) return { verb: 'research' };

    // DI HARD-STOP (feature-agnostic): once research is done, a caller that
    // requested stopAfterResearch halts here — reuse the existing status/done
    // terminal rather than widening RouterDecision. The caller is responsible
    // for any stage-appropriate end-state message it wants to print.
    if (opts.stopAfterResearch && researchDone) {
      return { verb: 'status', reason: 'done' };
    }

    // C4-HIGH SECTIONS-NULL GUARD: schema makes sections .optional().
    const sections = state.sections ?? [];

    // GRND-08 (D-18-15): the last `outline` was rejected and no section is
    // registered — report attention naming the command instead of
    // re-dispatching (and re-billing) a failed outline on every bare run.
    // A successful `pensmith outline` deletes the rejection file.
    if (sections.length === 0 && existsSync(join(pDir, 'OUTLINE.rejected.md'))) {
      return {
        verb: 'status',
        reason: 'attention',
        detail:
          'the last outline was rejected (the replies are in .paper/OUTLINE.rejected.md) — ' +
          'fix the problem it names, then run `pensmith outline`',
      };
    }

    // Review round 3: an OUTLINE.md that is present but unreadable (a hand
    // edit with one bad row), or missing while STATE.json registers sections,
    // is attention naming the fix — never an `outline` dispatch, which would
    // refuse (drafts, no --force) on every run or re-outline over the edit.
    const outlineIssue = outlineProblem(paperRoot);
    if (outlineIssue !== null) return { verb: 'status', reason: 'attention', detail: outlineIssue };
    if (!existsSync(join(pDir, 'OUTLINE.md'))) return { verb: 'outline' };
    if (sections.length === 0) return { verb: 'outline' };

    // One authority for section identity (section-registry.ts): when the
    // user's OUTLINE.md and STATE.json list different sections (a renamed,
    // renumbered, deleted or added row), no step can succeed as dispatched —
    // plan would refuse, compile would compile a different set — so report it
    // and name `pensmith outline`, which applies the edited outline.
    const registry = sectionRegistryProblem(paperRoot);
    if (registry !== null) return { verb: 'status', reason: 'attention', detail: registry };

    // DI HARD-STOP (GRND-02 outline-only mode): the outline is approved and
    // registered — nothing more is routed, so no section is planned, drafted
    // or verified (and billed) unless the user runs one explicitly.
    if (opts.stopAfterOutline) return { verb: 'status', reason: 'done', detail: OUTLINE_ONLY_DONE };

    // Walk sections in (n, suffix) order (GRND-09: 1 < 1a < 2); the FIRST
    // section still to do decides the verb (C3-HIGH-1: TOTAL over
    // SectionStateSchema). The walk goes on only past a 'verified' section
    // whose DRAFT.md is in place, and past an 'unverifiable' one on the draft
    // verify judged (S-13).
    // The unverifiable sections the walk went past (S-13), for the stub-text check after it.
    const unverifiablePast: Array<{ id: { n: number; slug: string; suffix?: string }; label: string; verificationPath: string }> = [];
    for (const { n, slug, suffix } of sortBySectionId(sections)) {
      const id = suffix !== undefined ? { n, slug, suffix } : { n, slug };
      const label = formatSectionId(sectionIdOf(n, suffix));
      const r = readSectionInfo(sectionPlan(n, slug, paperRoot));
      // C5-HIGH: distinguish a GENUINELY-ABSENT PLAN.md (→ plan) from a
      // PRESENT-but-corrupt/unreadable one (→ status/attention+section).
      if (r.absent) return { verb: 'plan', ...id };
      if (r.corrupt) {
        return {
          verb: 'status',
          reason: 'attention',
          section: id,
          detail: `section ${label}'s PLAN.md is unreadable — fix it, or re-plan with \`pensmith plan ${label}\``,
        };
      }

      switch (r.status) {
        case 'verified':
          // VRFY-16: a verified section whose DRAFT.md is gone (deleted, or lost
          // to a sync conflict) is re-drafted — compile could only refuse it,
          // and a bare run would then name compile again on every run.
          if (!existsSync(sectionDraft(n, slug, paperRoot))) return { verb: 'write', ...id };
          continue;
        case 'planned':
          // GRND-13: the outline's stub still needs its plan; a planned
          // section (no `stub`) is ready to draft. Only write sets 'writing'.
          return r.stub ? { verb: 'plan', ...id } : { verb: 'write', ...id };
        case 'writing':
          return { verb: 'write', ...id };
        case 'failed':
          // FEED-04 (D-18-25): write failed the section (`failure_reason`,
          // e.g. the drafter cited a source outside its assignment twice) and
          // kept no new draft. Never a paid loop: report it and name the
          // retry — also when an OLDER DRAFT.md is still there, because that
          // draft is not the one the failed write was asked to produce, and
          // verifying it would silently hide the failure. A failed section
          // with a draft and no failure_reason is verify's own verdict:
          // re-attempt verification.
          if (r.failureReason !== null || !existsSync(sectionDraft(n, slug, paperRoot))) {
            return {
              verb: 'status',
              reason: 'attention',
              section: id,
              detail:
                `section ${label} failed${r.failureReason ? `: ${r.failureReason}` : ''} — ` +
                `adjust its plan or sources if needed, then run \`pensmith write ${label}\``,
            };
          }
          // GRND-18 / PRD §5.1: verify already judged THIS draft (its hash is
          // the one the failed verdict recorded) and a blocking verdict
          // (FABRICATED, MIS-CITED, NOT_FOUND) is deterministic — re-running
          // it would re-bill the advisory passes and change nothing. Name the
          // fix instead; an explicit `pensmith verify N` still runs.
          if (r.verifiedHash !== null && draftHashOf(sectionDraft(n, slug, paperRoot), r.assignedSources) === r.verifiedHash) {
            return {
              verb: 'status',
              reason: 'attention',
              section: id,
              detail:
                `section ${label} failed verification (see its VERIFICATION.md) and its draft has not changed since — ` +
                `repair the flagged citations with \`pensmith plan ${label} --revise\` (one per run; then \`pensmith\` re-verifies the section), or re-draft with \`pensmith write ${label}\` ` +
                `(\`pensmith verify ${label}\` re-checks it as it is)`,
            };
          }
          return { verb: 'verify', ...id }; // the draft changed: re-attempt verification — NOT continue
        case 'unverifiable': {
          // `unverifiable` is verify's verdict when a check could not run (a
          // lookup failed or ran offline, a quote's source text is unavailable
          // — UNVERIFIABLE-QUOTE — or the draft is stub text — PLACEHOLDER).
          // S-13 (Phase 20): when verify judged THIS draft (unchanged since),
          // the section does not stop the others and is never re-verified in a
          // loop — the walk goes on; when it is the last open item the walk
          // reaches compile, which recomputes it and refuses with the
          // section's options (sectionAttention words them for `status`).
          if (!existsSync(sectionDraft(n, slug, paperRoot))) return { verb: 'write', ...id }; // VRFY-16: the draft is gone — re-draft
          if (r.verifiedHash === null || draftHashOf(sectionDraft(n, slug, paperRoot), r.assignedSources) !== r.verifiedHash) {
            return { verb: 'verify', ...id }; // the draft changed (or was never judged): verify it
          }
          unverifiablePast.push({ id, label, verificationPath: sectionVerification(n, slug, paperRoot) });
          continue;
        }
        case 'written':
        case 'verifying': // re-attempt verification (a verify that crashed) — NOT continue
          // VRFY-16: a section whose draft is gone is re-drafted, never
          // re-verified (verify would only report the missing draft again).
          if (!existsSync(sectionDraft(n, slug, paperRoot))) return { verb: 'write', ...id };
          return { verb: 'verify', ...id };
        default:
          // Unrecognized status (hand-edited PLAN.md): surface a stuck-section
          // status instead of falling through to undefined.
          return {
            verb: 'status',
            reason: 'attention',
            section: id,
            detail: `section ${label}'s PLAN.md has an unknown status "${r.status}"`,
          };
      }
    }

    // All sections verified (the walk fell through ONLY because every section
    // was 'verified', or 'unverifiable' on the draft verify judged — S-13:
    // compile recomputes such a section and refuses it with its options).
    //
    // Stub text (PLACEHOLDER — a draft written with no model configured) is
    // one thing compile's recomputation can never pass outside --dry-run: the
    // draft has to be written again. Routing to compile would refuse the same
    // way on every run (VRFY-16, VRFY-24; review round 2), so it is attention
    // naming `pensmith write N` — never a compile loop.
    if (!dryRunWorkspaceActive()) {
      const stub = unverifiablePast.filter((u) => recordHasPlaceholder(u.verificationPath));
      if (stub.length > 0) {
        return {
          verb: 'status',
          reason: 'attention',
          section: (stub[0] as (typeof stub)[number]).id,
          detail: stub.map((u) => unverifiableSectionDetail(u.verificationPath, u.label) ?? `section ${u.label}'s draft is stub text — \`pensmith write ${u.label}\``).join('; '),
        };
      }
    }
    //
    // VRFY-27: a compiled DRAFT.md edited by hand after compile is not the
    // paper done may export — and recompiling would silently replace the
    // edit. Name it instead of dispatching either.
    const record = readCompileInputs(paperRoot);
    if (record !== null && record.compiled_draft_sha256 !== null && existsSync(join(pDir, 'DRAFT.md')) && fileSha256(join(pDir, 'DRAFT.md')) !== record.compiled_draft_sha256) {
      return {
        verb: 'status',
        reason: 'attention',
        detail:
          `${basename(pDir)}/DRAFT.md was edited after compile — make the edit in the section drafts (then \`pensmith\` re-verifies them) ` +
          'and run `pensmith compile`, which replaces the edited file',
      };
    }
    // The compiled DRAFT.md is current only when no section's draft or
    // verification changed after it and it covers the registered sections: a
    // section redone, re-verified or added by a re-outline (GRND-09/10) since
    // the last compile is compiled again, never reported as done.
    if (compiledDraftStale(pDir, sections, paperRoot)) return { verb: 'compile' };
    // FINAL.md is current only when it is not older than the compiled draft
    // (done writes it after reading DRAFT.md, on every run that finds it absent
    // or older — so this never loops).
    const finalAt = mtimeOf(join(pDir, 'FINAL.md'));
    if (finalAt === null || finalAt < (mtimeOf(join(pDir, 'DRAFT.md')) ?? 0)) {
      // VRFY-27: done exports only a compiled draft whose COMPILE-INPUTS.json
      // proves it is the one compile wrote. With no usable record (a draft an
      // older pensmith compiled, or a record that does not parse) done could
      // only refuse, run after run — compile it again first.
      return record === null ? { verb: 'compile' } : { verb: 'done' };
    }
    return { verb: 'status', reason: 'done' };
  } catch (e) {
    // C5-HIGH BACKSTOP: any fs/parse op that throws despite the per-read guards
    // lands here. Never let it escape — status/attention keeps the never-throw
    // invariant total. (Unreachable by construction.)
    process.stderr.write(
      `[pensmith] router resolveNextAction hit an unexpected error: ${(e as Error).message}\n`,
    );
    return { verb: 'status', reason: 'attention' };
  }
}
