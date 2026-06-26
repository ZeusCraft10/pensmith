// bin/lib/router.ts — Phase 7 Plan 07-02. The bare `/pensmith` state-aware
// next-WORK-verb resolver (UX-01).
//
// resolveNextAction is a PURE FUNCTION over STATE.json + per-section PLAN.md
// frontmatter. It IGNORES HANDOFF.json entirely (H4 — see the PINNED ORDERING
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
// Imports: loadState/StateNotFoundError (state.ts), existsSync/readFileSync
// (node:fs), join (node:path), paperDir/sectionPlan (paths.ts), parseFrontmatter
// (frontmatter.ts), and the Handoff type (schemas/handoff.ts — type-only; the
// router does NOT read HANDOFF.json per H4).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, StateNotFoundError } from './state.js';
import { paperDir, sectionPlan } from './paths.js';
import { parseFrontmatter } from './frontmatter.js';
import type { Handoff } from './schemas/handoff.js';

export type RouterDecision =
  | { verb: 'new' }
  | { verb: 'research' }
  | { verb: 'outline' }
  | { verb: 'plan'; n: number; slug: string }
  | { verb: 'write'; n: number; slug: string }
  | { verb: 'verify'; n: number; slug: string }
  | { verb: 'compile' }
  | { verb: 'done' }
  // C3-HIGH-1 / C4-HIGH: status.reason is widened so the resolver is TOTAL.
  //   reason:'done'      → DRAFT.md + FINAL.md both present (nothing left to do)
  //   reason:'attention' → a section is in an unrecognized state, a corrupt
  //                        STATE.json / PLAN.md was reclassified here, or the
  //                        guaranteed terminal fallback fired (proves totality)
  | { verb: 'status'; reason: 'done' | 'attention'; section?: { n: number; slug: string } }
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
  if (!existsSync(planPath)) {
    return { status: 'planned', corrupt: false, absent: true };
  }
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
    const status = (frontmatter as { status?: unknown }).status;
    return {
      status: typeof status === 'string' ? status : 'planned',
      corrupt: false,
      absent: false,
    };
  } catch (e) {
    process.stderr.write(
      `[pensmith] PLAN.md at ${planPath} is unreadable/corrupt: ${(e as Error).message}\n`,
    );
    return { status: 'planned', corrupt: true, absent: false };
  }
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
}

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

    // "Research done" sentinel (audit M1): the research verb writes LIBRARY.json
    // (+ CITATIONS.bib) — its canonical output per workflows/research.md §Outputs —
    // NOT RESEARCH.md (a later curated-notes artifact written by `revise
    // --research` / learning mode). Gating on RESEARCH.md alone left bare
    // `pensmith`/next/resume looping on `research` forever after a real research
    // run. Accept EITHER so the canonical output advances the pipeline while the
    // legacy RESEARCH.md still counts.
    const researchDone =
      existsSync(join(pDir, 'LIBRARY.json')) || existsSync(join(pDir, 'RESEARCH.md'));

    // H4 PINNED ORDERING: HANDOFF.json is NOT read here. existsSync never throws.
    if (!researchDone) return { verb: 'research' };

    // DI HARD-STOP (feature-agnostic): once research is done, a caller that
    // requested stopAfterResearch halts here — reuse the existing status/done
    // terminal rather than widening RouterDecision. The caller is responsible
    // for any stage-appropriate end-state message it wants to print.
    if (opts.stopAfterResearch && researchDone) {
      return { verb: 'status', reason: 'done' };
    }

    if (!existsSync(join(pDir, 'OUTLINE.md'))) return { verb: 'outline' };

    // C4-HIGH SECTIONS-NULL GUARD: schema makes sections .optional().
    const sections = state.sections ?? [];
    if (sections.length === 0) return { verb: 'outline' };

    // Walk sections ascending by n; the FIRST non-'verified' section decides
    // the verb (C3-HIGH-1: TOTAL over SectionStateSchema; 'verified' is the ONLY
    // continue case; 'failed'/'unverifiable' route BACK to verify).
    for (const { n, slug } of [...sections].sort((a, b) => a.n - b.n)) {
      const r = readSectionState(sectionPlan(n, slug, paperRoot));
      // C5-HIGH: distinguish a GENUINELY-ABSENT PLAN.md (→ plan) from a
      // PRESENT-but-corrupt/unreadable one (→ status/attention+section).
      if (r.absent) return { verb: 'plan', n, slug };
      if (r.corrupt) return { verb: 'status', reason: 'attention', section: { n, slug } };

      switch (r.status) {
        case 'verified':
          continue; // the ONLY continue case
        case 'planned':
          return { verb: 'plan', n, slug };
        case 'writing':
          return { verb: 'write', n, slug };
        case 'written':
        case 'verifying':
        case 'failed': // re-attempt verification — NOT continue
        case 'unverifiable': // re-attempt verification — NOT continue
          return { verb: 'verify', n, slug };
        default:
          // Unrecognized status (hand-edited PLAN.md): surface a stuck-section
          // status instead of falling through to undefined.
          return { verb: 'status', reason: 'attention', section: { n, slug } };
      }
    }

    // All sections verified (the walk fell through ONLY because every section
    // was 'verified' — 'failed'/'unverifiable' would have returned 'verify').
    if (!existsSync(join(pDir, 'DRAFT.md'))) return { verb: 'compile' };
    if (!existsSync(join(pDir, 'FINAL.md'))) return { verb: 'done' };
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
