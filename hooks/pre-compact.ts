#!/usr/bin/env node
// hooks/pre-compact.ts — Phase 3 Plan 03-08.
//
// Claude Code PreCompact hook. Writes .paper/HANDOFF.json (D-17 LOCKED
// shape) before context compaction so the next session can resume.
//
// CYCLE-2 H-3 REVIEWS CONVERGENCE: emits D-17 canonical shape via
// assembleHandoff. parseFrontmatter (Plan 03 Task 3.4) projects PLAN.md
// `status` into section_pointers[].state.
//
// D-12 LOCKED gate: no LLM invocation here. `next_action` is a pure
// template-literal construction. pre-compact runs synchronously and offline.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { assembleHandoff, writeHandoff } from '../bin/lib/handoff.js';
import { parseFrontmatter } from '../bin/lib/frontmatter.js';
import type { Handoff } from '../bin/lib/schemas/handoff.js';

type Phase = Handoff['phase'];
type SectionState = Handoff['section_pointers'][number]['state'];

// HOOK-01 (T-07-11): self-imposed deadline so a hung HANDOFF write can never
// block a context compaction indefinitely. writeHandoff owns its own
// proper-lockfile with stale:10_000, which auto-clears a timed-out write
// (Pitfall 2) — so the timeout applies OUTSIDE lock ownership and the rejected
// race is routed to stderr by the existing catch (never stdout).
const PRECOMPACT_TIMEOUT_MS = 10_000;

const VALID_PHASES: ReadonlyArray<Phase> = [
  'intake', 'research', 'outline', 'plan',
  'write', 'verify', 'compile', 'done',
];

const VALID_SECTION_STATES: ReadonlyArray<SectionState> = [
  'planned', 'writing', 'written', 'verifying',
  'verified', 'failed', 'unverifiable',
];

interface PreCompactInput {
  paperDir?: string;
}

export async function onPreCompact(input: PreCompactInput = {}): Promise<void> {
  const paperDir = input.paperDir ?? '.paper';
  try {
    const { phase, sectionsFromState } = readState(paperDir);
    const breadcrumbs = readBreadcrumbs(paperDir);
    const { sectionPointers, currentSection } = collectSectionPointers(
      paperDir,
      sectionsFromState,
    );

    const lastVerb = breadcrumbs.length
      ? breadcrumbs[breadcrumbs.length - 1]!.verb
      : 'unknown';
    const nextAction =
      `Resume ${phase} on section ${currentSection ?? '(none)'}. ` +
      `Last verb: ${lastVerb}.`;

    const handoff = assembleHandoff({
      phase,
      currentSection,
      nextAction,
      breadcrumbs,
      sectionPointers,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        writeHandoff(handoff, paperDir),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('pre-compact: HANDOFF write timed out after 10s'),
              ),
            PRECOMPACT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      // Clear the deadline timer so a fast write leaves no dangling timeout.
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pre-compact] HANDOFF write failed: ${msg}\n`);
  }
}

export default onPreCompact;

function readState(paperDir: string): {
  phase: Phase;
  sectionsFromState: ReadonlyArray<{ n: number; slug: string }>;
} {
  // Prefer STATE.json (canonical in Phase 3+); fall back to STATE.md scan
  // (legacy markdown). Phase defaults to 'intake' when undeclared.
  const jsonPath = join(paperDir, 'STATE.json');
  if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        phase?: unknown;
        sections?: Array<{ n?: unknown; slug?: unknown }>;
      };
      const phase = isPhase(raw.phase) ? raw.phase : 'intake';
      const sections = Array.isArray(raw.sections)
        ? raw.sections.flatMap((s) => {
            if (typeof s?.n === 'number' && typeof s?.slug === 'string') {
              return [{ n: s.n, slug: s.slug }];
            }
            return [];
          })
        : [];
      return { phase, sectionsFromState: sections };
    } catch {
      // Malformed STATE.json — fall through to defaults.
    }
  }

  const mdPath = join(paperDir, 'STATE.md');
  if (existsSync(mdPath)) {
    const text = readFileSync(mdPath, 'utf8');
    const match = /(?:^|\n)phase:\s*(intake|research|outline|plan|write|verify|compile|done)/.exec(text);
    if (match && isPhase(match[1])) {
      return { phase: match[1], sectionsFromState: [] };
    }
  }
  return { phase: 'intake', sectionsFromState: [] };
}

function readBreadcrumbs(paperDir: string): Handoff['breadcrumbs'] {
  const path = join(paperDir, 'BREADCRUMBS.jsonl');
  if (!existsSync(path)) return [];
  const out: Handoff['breadcrumbs'] = [];
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(-5);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        ts?: unknown;
        verb?: unknown;
        section?: unknown;
        ok?: unknown;
      };
      if (
        typeof parsed.ts === 'string' &&
        typeof parsed.verb === 'string' &&
        (parsed.section === null || typeof parsed.section === 'string') &&
        typeof parsed.ok === 'boolean'
      ) {
        out.push({
          ts: parsed.ts,
          verb: parsed.verb,
          section: parsed.section,
          ok: parsed.ok,
        });
      }
    } catch {
      /* malformed line — skip */
    }
  }
  return out;
}

function collectSectionPointers(
  paperDir: string,
  fromState: ReadonlyArray<{ n: number; slug: string }>,
): {
  sectionPointers: Handoff['section_pointers'];
  currentSection: string | null;
} {
  const pointers: Handoff['section_pointers'] = [];
  const sectionsDir = join(paperDir, 'sections');

  // Source A: filesystem dirs under .paper/sections/<NN-slug>/
  const dirEntries = existsSync(sectionsDir)
    ? readdirSync(sectionsDir)
        .map((d) => join(sectionsDir, d))
        .filter((d) => safeIsDir(d))
    : [];

  let currentSection: string | null = null;
  let latestMtime = 0;

  for (const dir of dirEntries) {
    const basename = dir.split(/[/\\]/).pop()!;
    const slug = basename.replace(/^\d+-/, '');
    const planPath = join(dir, 'PLAN.md');
    const draftPath = existsSync(join(dir, 'DRAFT.md'))
      ? join(dir, 'DRAFT.md')
      : null;
    const verificationPath = existsSync(join(dir, 'VERIFICATION.md'))
      ? join(dir, 'VERIFICATION.md')
      : null;
    let state: SectionState = 'planned';
    if (existsSync(planPath)) {
      try {
        const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
        const fmState = (frontmatter as { status?: unknown }).status;
        if (typeof fmState === 'string' && isSectionState(fmState)) {
          state = fmState;
        }
      } catch {
        /* leave default */
      }
      try {
        const mtime = statSync(planPath).mtimeMs;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          currentSection = slug;
        }
      } catch {
        /* ignore */
      }
    }
    pointers.push({
      slug,
      plan_path: planPath,
      draft_path: draftPath,
      verification_path: verificationPath,
      state,
    });
  }

  // Source B: STATE.json sections[] entries that don't have a dir yet.
  const seen = new Set(pointers.map((p) => p.slug));
  for (const s of fromState) {
    const bare = s.slug.replace(/^\d+-/, '');
    if (seen.has(bare)) continue;
    pointers.push({
      slug: bare,
      plan_path: join(sectionsDir, s.slug, 'PLAN.md'),
      draft_path: null,
      verification_path: null,
      state: 'planned',
    });
    seen.add(bare);
  }

  return { sectionPointers: pointers, currentSection };
}

function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (VALID_PHASES as ReadonlyArray<string>).includes(value);
}

function isSectionState(value: string): value is SectionState {
  return (VALID_SECTION_STATES as ReadonlyArray<string>).includes(value);
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
