// bin/lib/hooks/pre-compact.ts — the PreCompact hook's work (PLUG-14,
// D-23a-15, D-23a-16).
//
// Before Claude Code compacts the conversation, write `.paper/HANDOFF.json` v2
// so the next context (and SessionStart) knows where the paper stands: the
// router's decision gives the phase, the section id and the plan/write/verify
// position (handoff.ts handoffPositionOf); the section pointers come from the
// sections STATE.json registers (the one authority on section identity,
// D-18-38), each with its PLAN.md status; breadcrumbs from
// `.paper/BREADCRUMBS.jsonl` as in v1.
//
// Read-only except for HANDOFF.json itself. No model call (D-12). Bounded by
// PRECOMPACT_DEADLINE_MS, inside the 10 s timeout hooks.json gives the hook.
// Returns what happened and never writes stdout (the entry, hooks/
// pre-compact.ts, prints nothing — PreCompact has no output protocol).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assembleHandoff, writeHandoff, type Handoff, type HandoffBreadcrumb, type HandoffSectionPointer } from '../handoff.js';
import { SectionStateSchema } from '../schemas/state.js';
import { loadState } from '../state.js';
import { paperDir, sectionDraft, sectionPlan, sectionVerification } from '../paths.js';
import { readSectionInfo, resolveNextAction, type ResolveOptions } from '../router.js';
import { sortBySectionId } from '../section-id.js';

/** The hook's own deadline, inside the 10 s timeout hooks.json declares. */
export const PRECOMPACT_DEADLINE_MS = 8_000;

export interface PreCompactOptions {
  /** The router's stop flags for this paper (the entry derives them like the CLI). */
  readonly routeOptions?: ResolveOptions;
  readonly deadlineMs?: number;
  readonly now?: Date;
}

export type PreCompactResult =
  | { readonly written: true; readonly handoff: Handoff; readonly file: string }
  | { readonly written: false; readonly error: string };

/** The last 5 well-formed `.paper/BREADCRUMBS.jsonl` records (v1 behaviour). */
export function readBreadcrumbs(pDir: string): HandoffBreadcrumb[] {
  const file = path.join(pDir, 'BREADCRUMBS.jsonl');
  if (!existsSync(file)) return [];
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-5);
  } catch {
    return [];
  }
  const out: HandoffBreadcrumb[] = [];
  for (const line of lines) {
    try {
      const p = JSON.parse(line) as { ts?: unknown; verb?: unknown; section?: unknown; ok?: unknown };
      if (
        typeof p.ts === 'string' && !Number.isNaN(Date.parse(p.ts))
        && typeof p.verb === 'string' && p.verb.length <= 40
        && (p.section === null || (typeof p.section === 'string' && p.section.length <= 40))
        && typeof p.ok === 'boolean'
      ) {
        out.push({ ts: new Date(p.ts).toISOString(), verb: p.verb, section: p.section, ok: p.ok });
      }
    } catch {
      /* a malformed line is skipped */
    }
  }
  return out;
}

/** A path under the project root, POSIX-spelled and relative (a synced `.paper/` stays portable). */
function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** One pointer per section STATE.json registers, in outline order. */
export async function collectSectionPointers(root: string): Promise<HandoffSectionPointer[]> {
  let sections: ReadonlyArray<{ n: number; slug: string; suffix?: string | undefined }>;
  try {
    sections = sortBySectionId((await loadState(root)).sections ?? []);
  } catch {
    return [];
  }
  const out: HandoffSectionPointer[] = [];
  for (const { n, slug } of sections) {
    try {
      const plan = sectionPlan(n, slug, root);
      const draft = sectionDraft(n, slug, root);
      const verification = sectionVerification(n, slug, root);
      const info = readSectionInfo(plan);
      const state = SectionStateSchema.safeParse(info.status);
      out.push({
        slug,
        plan_path: rel(root, plan),
        draft_path: existsSync(draft) ? rel(root, draft) : null,
        verification_path: existsSync(verification) ? rel(root, verification) : null,
        state: !info.absent && !info.corrupt && state.success ? state.data : 'planned',
      });
    } catch {
      /* a slug the path helpers refuse is not a section we can point at */
    }
  }
  return out;
}

/** Build and write `.paper/HANDOFF.json` v2 for the paper at `root` (never throws). */
export async function writePreCompactHandoff(root: string, opts: PreCompactOptions = {}): Promise<PreCompactResult> {
  const deadlineMs = opts.deadlineMs ?? PRECOMPACT_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async (): Promise<PreCompactResult> => {
    const decision = await resolveNextAction(root, opts.routeOptions ?? {});
    const pDir = paperDir(root);
    const handoff = assembleHandoff({
      decision,
      breadcrumbs: readBreadcrumbs(pDir),
      sectionPointers: await collectSectionPointers(root),
      ...(opts.now ? { now: opts.now } : {}),
    });
    await writeHandoff(handoff, pDir);
    return { written: true, handoff, file: path.join(pDir, 'HANDOFF.json') };
  })();
  const deadline = new Promise<PreCompactResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ written: false, error: `the HANDOFF.json write did not finish within ${deadlineMs / 1000}s` }),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([
      work.catch((e: unknown): PreCompactResult => ({ written: false, error: e instanceof Error ? e.message : String(e) })),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
