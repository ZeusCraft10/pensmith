// bin/cli/compile.ts — `pensmith compile` verb entrypoint (COMP-01..07, ARCH-20).
//
// THIN ORCHESTRATOR: this verb delegates 100% to bin/lib/compile.ts::runCompile
// (the keystone pipeline). No business logic lives here — it only resolves args,
// supplies the production re-verify seam (verify.ts verifySection with the
// advisory passes off — deterministic Pass 1 + Pass 3, NEVER Pass 2/4, D-08;
// it rewrites only that section's VERIFICATION.md and PLAN.md, and never
// LIBRARY.json, CITATIONS.bib or last_verified — D-20-23), and emits the
// COMPILE-REPORT path + outcome to stdout. runCompile recomputes every section
// through the gate core itself (VRFY-25), whatever the seam answers.
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
// buildPromptRequest('smoother', …) + the model call. The deterministic
// refuse-gate, staleness re-verify, consistency scan, citation density, bib
// regen, and report emission all run in Tier 2.

import { defineCommand } from 'citty';
import { runCompile, type ReVerifyInput, type ReVerifyResult } from '../lib/compile.js';
import { EXIT_BLOCKED } from '../lib/exit-codes.js';
import { readFileSync } from 'node:fs';
import { projectRoot, sectionVerification } from '../lib/paths.js';
import { readPaperBrief } from '../lib/paper-brief.js';
import { gateRefusals, rowBlocks } from '../lib/verify/gate.js';
import { formatSectionId, sectionIdOf } from '../lib/section-id.js';
import { verifySection } from './verify.js';

/**
 * Production staleness re-verify seam (D-08, D-20-23): the section verifier
 * itself with the advisory passes off — Pass 1 + Pass 3 and the draft checks
 * through the gate core, never Pass 2/4 — which rewrites that section's
 * VERIFICATION.md (Pass 2 / Pass 4 marked "not run — compile staleness
 * re-verify" for an edited draft; an unverifiable section whose draft has not
 * changed keeps the advisory sections its record judged on that draft) and its
 * PLAN.md status and hash, and never a DRAFT.md, the bibliography or
 * last_verified. Reuses the same cassette-backed paths as `pensmith verify` in
 * offline CI.
 */
async function productionReVerify(input: ReVerifyInput): Promise<ReVerifyResult> {
  const id = formatSectionId(sectionIdOf(input.n, input.suffix));
  // An unverifiable section whose draft has not changed keeps its advisory
  // sections (verifySection keeps them only when the record judged this draft).
  let keepAdvisoryFrom: string | null = null;
  if (input.keepAdvisory === true) {
    try {
      keepAdvisoryFrom = readFileSync(sectionVerification(input.n, input.slug), 'utf8');
    } catch {
      keepAdvisoryFrom = null;
    }
  }
  const v = await verifySection(input.n, input.slug, input.suffix ?? null, { advisory: false, writePaperFiles: false, keepAdvisoryFrom });
  if (v.gate === undefined) {
    // An early return: the draft is missing, or the section's last write failed.
    return { passed: false, failingCitekeys: [], reasons: [v.status === 'failed' ? `its last write failed — run \`pensmith write ${id}\`` : `DRAFT.md missing — run \`pensmith write ${id}\``] };
  }
  const failing = v.gate.rows.filter(rowBlocks).flatMap((r) => (r.kind === 'draft' || r.kind === 'text' ? [] : [r.key]));
  return {
    passed: v.ok && !v.gate.outcome.blocked,
    failingCitekeys: [...new Set(failing)],
    reasons: gateRefusals(v.gate, { kind: 'section', id }),
  };
}

/**
 * The paper's discipline for the density band (GRND-06, D-18-13: preset <
 * INTAKE.md < config.toml; `--discipline` wins over all). Undefined when the
 * brief cannot be read — compile never fails over the density advisory.
 */
function paperDiscipline(paperRoot: string): string | undefined {
  try {
    return readPaperBrief(paperRoot).discipline.slug.value;
  } catch {
    return undefined;
  }
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
      description: "Discipline preset for the citation-density band (COMP-05; defaults to the paper's discipline: config.toml, else INTAKE.md).",
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const discipline = typeof args.discipline === 'string' && args.discipline.length > 0 ? args.discipline : paperDiscipline(paperRoot);

    const result = await runCompile({
      paperRoot,
      yolo: args.yolo === true,
      lintHeadings: args.lintHeadings === true,
      ...(discipline ? { discipline } : {}),
      reVerify: (input: ReVerifyInput) => productionReVerify(input),
      // Tier-2: no boundary smoother wired (raw concat — best-effort prose).
    });

    if (result.refused) {
      process.stdout.write(
        `pensmith compile: REFUSED — ${(result.refuseReasons ?? []).length} blocking citation issue(s). No DRAFT.md written.\n`,
      );
      for (const r of result.refuseReasons ?? []) process.stdout.write(`  - ${r}\n`);
      // RUN-09: a verifier refusal is EXIT_BLOCKED (result.refused → 4).
      return { ok: false, ...result, exitCode: EXIT_BLOCKED };
    }

    process.stdout.write(
      `pensmith compile: wrote ${result.draftPath} and ${result.reportPath} (${result.sectionsCount} sections, ${result.staleResolvedCount} stale resolved).\n`,
    );
    return { ok: true, ...result };
  },
});

export default compileCommand;
