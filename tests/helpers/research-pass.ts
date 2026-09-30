// tests/helpers/research-pass.ts — one research pass plus its RESEARCH.md log,
// for tests that exercise the discovery half of research without the verb's
// questions, retraction cross-check and library write.
//
// It composes the SAME exported pieces `pensmith research` runs
// (bin/cli/research.ts): researchAdapterPlan → runResearchPass (adapters →
// dedup → tiers → policy → evaluator) → renderResearchLog / writeResearchLog.
// Production has no such wrapper (the verb calls those pieces itself); this one
// lives here so no test-only entry point ships in bin/lib (Phase 19 review
// round 1). `registry` injects fake adapters (the order is the plan's order).

import {
  researchRegistry,
  researchAdapterPlan,
  runResearchPass,
  renderResearchLog,
  writeResearchLog,
  tierSummary,
  evaluatorNotes,
  logExclusions,
  type AdapterRegistry,
  type ResearchItem,
} from '../../bin/lib/research-orchestrator.js';
import { tryReadPaperConfigSync } from '../../bin/lib/config.js';
import { networkMode } from '../../bin/lib/http-mock.js';
import { DEFAULT_SOURCE_POLICY, sourcePolicyFrom } from '../../bin/lib/source-policy.js';
import { renderSourcesBlock } from '../../bin/lib/research-md.js';
import { candidateToEntry } from '../../bin/lib/migrations/library/shape.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';
import type { LibraryEntry } from '../../bin/lib/schemas/library.js';

/** The kept items as LIBRARY entries carrying their evaluation (a preview of what research would add). */
function asEntries(items: readonly ResearchItem[]): LibraryEntry[] {
  const now = new Date().toISOString();
  return items.map((k) =>
    candidateToEntry({ ...k.candidate, tier: k.tier, relevance: k.relevance, why_relevant: k.reason }, [`research:${k.candidate.source}`], now),
  );
}

/**
 * Run one research pass for `queries` and, with `paperRoot`, write its log to
 * the paper's RESEARCH.md. Returns the kept candidates. The library is NOT
 * written.
 */
export async function runResearchPassWithLog(
  queries: string[],
  opts: {
    topic: string;
    discipline: string;
    scopeLabel?: string;
    paperRoot?: string;
    registry?: AdapterRegistry;
  },
): Promise<SourceCandidate[]> {
  const registry = opts.registry ?? researchRegistry();
  const root = opts.paperRoot ?? null;
  const cfg = root !== null ? tryReadPaperConfigSync(root) : null;
  const plan = researchAdapterPlan({
    registry,
    byPreference: opts.registry === undefined && !networkMode().dryRun,
    discipline: opts.discipline,
    configDiscipline: cfg?.project?.discipline_preset,
    allowed: cfg?.sources?.allowed_databases,
  });
  const scope = opts.scopeLabel ?? 'auto';
  const pass = await runResearchPass({
    queries,
    plan,
    registry,
    policy: root === null ? DEFAULT_SOURCE_POLICY : sourcePolicyFrom(cfg?.sources),
    topic: opts.topic,
    discipline: opts.discipline,
    scope,
  });
  if (root !== null) {
    await writeResearchLog(
      root,
      renderResearchLog({
        scope,
        topic: opts.topic,
        discipline: opts.discipline,
        generated: new Date().toISOString(),
        queries,
        queryNote: null,
        summary: `${tierSummary(pass.kept)}; ${pass.excluded.length} excluded by [sources] policy; ${pass.rejected.length} rejected by the evaluator (not yet in LIBRARY.json)`,
        notes: evaluatorNotes(pass),
        adapters: pass.adapters,
        perQuery: pass.perQuery,
        excluded: logExclusions(pass.excluded, pass.rejected),
        retracted: [],
        retractionUnknown: [],
        sourcesBlock: renderSourcesBlock(asEntries(pass.kept)),
      }),
    );
  }
  return pass.kept.map((k) => k.candidate);
}
