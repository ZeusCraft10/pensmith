// bin/cli/goal.ts — Phase 9 educator-mode CLI-tier helpers (ERGO-07 / H1).
//
// THE GOAL-AWARE TIER. This file is the SINGLE place the educator `goal` is read
// and the SINGLE place the goal→behavior mapping lives. Foundation (bin/lib/**,
// router.ts included) stays goal-UNAWARE: the goal→stopAfterResearch mapping
// (stopAfterResearchFor) is here in the CLI tier, NOT in the router. The
// zero-branch invariant (tests/lint-tutorial-no-branch.test.ts) scans
// bin/lib/** + workflows/**, NOT bin/cli/**, so this mapping living here is
// correct-by-architecture — not an exclusion.
//
// Three exports:
//   - readGoalFromConfig(paperRoot): the SINGLE shared goal-read helper (config
//     .toml [project] goal, default 'draft'). write.ts (09-02) imports this one
//     instead of keeping its own copy (resolves L5 duplication).
//   - stopAfterResearchFor(goal): the ONLY goal→behavior mapping (learning ⇒
//     true). The goal-aware callers feed its result to resolveNextAction's
//     goal-AGNOSTIC stopAfterResearch param.
//   - renderLearningEndState(paperRoot): the H2 learning END-STATE — at the
//     research hard-stop, build a research.done payload from LIBRARY.json +
//     RESEARCH.md and render per-claim provenance into TUTORIAL.md via the
//     TutorialSubscriber, with NO section ever written. Non-fatal (mirrors
//     runStyleProducerNonFatal): a bad render must never break the verb.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { paperDir } from '../lib/paths.js';
import { TutorialSubscriber } from '../lib/tutorial.js';

/** The educator-mode goal enum (resolved Open-Q2). */
export type Goal = 'draft' | 'learning' | 'both';

/**
 * Read the educator-mode `goal` from config.toml `[project] goal`. Best-effort:
 * a missing/malformed config.toml or an unrecognized value defaults to 'draft'.
 * NEVER throws (existsSync + try/catch). This is the SINGLE shared goal-read
 * helper — write.ts + the four goal-aware callers all import it (L5).
 */
export function readGoalFromConfig(paperRoot: string): Goal {
  try {
    const cfgPath = path.join(paperRoot, 'config.toml');
    if (!existsSync(cfgPath)) return 'draft';
    const cfg = parseToml(readFileSync(cfgPath, 'utf8')) as {
      project?: { goal?: unknown };
    };
    const g = cfg.project?.goal;
    if (g === 'learning' || g === 'both' || g === 'draft') return g;
    return 'draft';
  } catch {
    return 'draft';
  }
}

/**
 * The ONLY goal→behavior mapping (H1 — lives in the CLI tier, never Foundation).
 * goal=learning hard-stops after research (PRD §7.13); draft/both route through
 * outline unchanged (no regression). The result is fed to resolveNextAction's
 * goal-AGNOSTIC `stopAfterResearch` param — the router never sees `goal`.
 */
export function stopAfterResearchFor(goal: Goal): boolean {
  return goal === 'learning';
}

/** One curated source in the research.done payload. */
interface ResearchDoneSource {
  citekey: string;
  title?: string;
  year?: number;
}

/**
 * Parse a RESEARCH.md curated-sources block into per-citekey supported-claim
 * lines. Mirrors the tutorial-paper fixture shape: one `### <citekey>` block
 * carrying a `supports:` claim line. Returns a citekey→claim map. Pure + total
 * (returns an empty map on a malformed/empty document) — never throws.
 *
 * This is the EXECUTION-level RESEARCH.md→payload parse glue (cycle-2 MEDIUM):
 * the per-claim provenance the learning end-state renders comes from REAL
 * research-stage data, not a structurally-asserted stub.
 */
export function parseResearchClaims(researchMd: string): Map<string, string> {
  const claims = new Map<string, string>();
  if (typeof researchMd !== 'string' || researchMd.length === 0) return claims;
  const blocks = researchMd.split(/^### /m).slice(1);
  for (const block of blocks) {
    const citekey = block.split(/\s|\n/)[0]?.trim() ?? '';
    const m = /supports:\s*([\s\S]+?)(?:\n\n|\n###|$)/.exec(block);
    const claim = m?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    if (citekey && claim) claims.set(citekey, claim);
  }
  return claims;
}

/**
 * Build the research.done payload from LIBRARY.json (SourceCandidate[]) +
 * RESEARCH.md (per-source `supports:` claim lines). The shape matches the
 * TutorialSubscriber's research.done reader: `{ sources: [{citekey,title,year}],
 * claims: [{citekey,claim}] }`. Best-effort — a missing/malformed file yields an
 * empty contribution rather than throwing.
 */
export function buildResearchDonePayload(
  paperRoot: string,
): { sources: ResearchDoneSource[]; claims: Array<{ citekey: string; claim: string }> } {
  const pDir = paperDir(paperRoot);

  // LIBRARY.json → the curated source list (citekey + light metadata).
  let sources: ResearchDoneSource[] = [];
  try {
    const libPath = path.join(pDir, 'LIBRARY.json');
    if (existsSync(libPath)) {
      const raw = JSON.parse(readFileSync(libPath, 'utf8'));
      if (Array.isArray(raw)) {
        sources = raw
          .map((s): ResearchDoneSource | null => {
            const rec = s as Record<string, unknown>;
            const citekey = typeof rec.citekey === 'string' ? rec.citekey : '';
            if (!citekey) return null;
            const out: ResearchDoneSource = { citekey };
            if (typeof rec.title === 'string') out.title = rec.title;
            if (typeof rec.year === 'number') out.year = rec.year;
            return out;
          })
          .filter((s): s is ResearchDoneSource => s !== null);
      }
    }
  } catch {
    sources = [];
  }

  // RESEARCH.md → the per-citekey supported claim.
  let researchMd = '';
  try {
    const rPath = path.join(pDir, 'RESEARCH.md');
    if (existsSync(rPath)) researchMd = readFileSync(rPath, 'utf8');
  } catch {
    researchMd = '';
  }
  const claimMap = parseResearchClaims(researchMd);
  const claims = [...claimMap.entries()].map(([citekey, claim]) => ({ citekey, claim }));

  return { sources, claims };
}

/**
 * The H2 learning END-STATE. At the research hard-stop (goal=learning), render
 * per-claim source provenance into TUTORIAL.md from LIBRARY.json + RESEARCH.md —
 * BEFORE any section exists, so the learning artifact is produced at the
 * hard-stop. Then print a learning-appropriate end-state message that REPLACES
 * the router's generic "ready to export" status line.
 *
 * NON-FATAL (mirrors runStyleProducerNonFatal): wrapped in try/catch so a bad
 * render (malformed fixtures, a write failure) WARNs but never breaks the verb.
 */
export async function renderLearningEndState(paperRoot: string): Promise<void> {
  try {
    const payload = buildResearchDonePayload(paperRoot);
    const subscriber = new TutorialSubscriber({
      tutorialPath: path.join(paperDir(paperRoot), 'TUTORIAL.md'),
      goal: 'learning',
    });
    subscriber.emit({ kind: 'research.done', payload });
    await subscriber.flush();
    process.stdout.write(
      'pensmith: Learning mode — wrote per-claim source provenance to TUTORIAL.md; ' +
        'stopping after research per your goal=learning (no section drafted).\n',
    );
  } catch (e) {
    process.stderr.write(
      `pensmith: WARN — learning end-state render failed (non-fatal): ${(e as Error).message}\n`,
    );
  }
}
