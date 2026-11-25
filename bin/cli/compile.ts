// bin/cli/compile.ts — `pensmith compile` verb entrypoint (COMP-01..07, ARCH-20).
//
// THIN ORCHESTRATOR: this verb delegates 100% to bin/lib/compile.ts::runCompile
// (the keystone pipeline). No business logic lives here — it only resolves args,
// supplies the production re-verify seam (deterministic Pass 1 + Pass 3 — NEVER
// Pass 2/4, D-08), and emits the COMPILE-REPORT path + outcome to stdout.
//
// `compile` IS one of the locked UX-02 16 verbs (bin/lib/verbs.ts) — this file
// promotes the Phase-2 dispatcher stub to a real loader (bin/pensmith.ts
// REAL_VERB_LOADERS). No new verb is added.
//
// stdout-only (no console.* — keeps a future stdio/MCP frame clean, same
// Pitfall-7 stance as the other verbs).
//
// LLM seam: bin/lib has no model-transport client yet (Tier-2 placeholder era).
// In Tier 2 the boundary smoother is OMITTED (raw concat) — smoothing is
// best-effort prose and never blocks compile; a later phase wires
// loadPrompt('smoother') + interpolate + the model call. The deterministic
// refuse-gate, staleness re-verify, consistency scan, citation density and
// report emission all run in Tier 2.

import { defineCommand } from 'citty';
import { runCompile, type ReVerifyInput, type ReVerifyResult } from '../lib/compile.js';
import { pass1CitedKeys } from '../lib/verify/pass1.js';
import { checkCitationsAndQuotes } from '../lib/verify/check-text.js';
import { buildVerificationRecord, decideStatus, verificationGate } from '../lib/verify/verification-record.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';

/**
 * Production staleness re-verify seam (D-08 — Pass 1 + Pass 3 ONLY). Runs the
 * deterministic verifiers on the section as compile read it (the text it is
 * about to use, its assigned sources, the bibliography and acknowledgements),
 * decides its status as verify does, and refuses it the way the gate refuses
 * a recorded verdict. NEVER wires Pass 2/4 (advisory). Nothing is written:
 * compile never writes into a section folder.
 */
async function productionReVerify(input: ReVerifyInput): Promise<ReVerifyResult> {
  // No CITATIONS.bib: a re-verify failure (fail-safe: never let a stale
  // section escape unverified). An empty one is an empty library: every cited
  // key is FABRICATED.
  if (input.bib === null) return { passed: false, failingCitekeys: [] };
  const { n, slug, draft, assignedSources, bib } = input;
  const { pass1, pass3 } = await checkCitationsAndQuotes(draft, { bib, acknowledgements: input.acknowledgements, section: n });
  const decided = decideStatus({
    section: n, pass1, pass3, citedKeys: pass1CitedKeys(draft), assignedSources, bibIsEmpty: input.bibIsEmpty,
  });
  const record = buildVerificationRecord({
    section: n, slug, status: decided.status, checked: true,
    ...(decided.reason ? { reason: decided.reason } : {}),
    draftBytes: Buffer.from(draft, 'utf8'), assignedSources, pass1, pass3,
  });
  const gate = verificationGate(record, `section ${n} (${slug}), re-verified since it changed`);
  // The gate names every blocking verdict, so the reasons replace the citekey list.
  return { passed: gate.reasons.length === 0, failingCitekeys: [], reasons: gate.reasons, warnings: gate.warnings };
}

export const compileCommand = defineCommand({
  meta: {
    name: 'compile',
    description: 'Assemble all verified section drafts into .paper/DRAFT.md + COMPILE-REPORT.md.',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
    lintHeadings: {
      type: 'boolean',
      description: 'Enable the opt-in heading-tense consistency heuristic (COMP-04).',
      default: false,
    },
    discipline: {
      type: 'string',
      description: 'Discipline preset for the citation-density target (COMP-05; defaults to a documented fallback).',
    },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const discipline = typeof args.discipline === 'string' && args.discipline.length > 0 ? args.discipline : undefined;

    const result = await runCompile({
      paperRoot,
      yolo: args.yolo === true,
      lintHeadings: args.lintHeadings === true,
      ...(discipline ? { discipline } : {}),
      reVerify: productionReVerify,
      // Tier-2: no boundary smoother wired (raw concat — best-effort prose).
    });

    if (result.refused) {
      process.stdout.write(
        `pensmith compile: REFUSED — ${(result.refuseReasons ?? []).length} blocking issue(s). No DRAFT.md written.\n`,
      );
      for (const r of result.refuseReasons ?? []) process.stdout.write(`  - ${r}\n`);
      if (result.staleDraftPath) {
        process.stdout.write(
          `  The draft from an earlier compile no longer matches the sections; it was moved to ${result.staleDraftPath} so it cannot be exported.\n`,
        );
      }
      process.exitCode = EXIT_REFUSED;
      return { ok: false, ...result };
    }

    process.stdout.write(
      `pensmith compile: wrote ${result.draftPath} and ${result.reportPath} (${result.sectionsCount} sections, ${result.staleResolvedCount} stale resolved).\n`,
    );
    return { ok: true, ...result };
  },
});

export default compileCommand;
