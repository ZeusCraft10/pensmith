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
// refuse-gate, staleness re-verify, consistency scan, citation density, bib
// regen, and report emission all run in Tier 2.

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCompile, type ReVerifyInput, type ReVerifyResult } from '../lib/compile.js';
import { runPass1 } from '../lib/verify/pass1.js';
import { runPass3 } from '../lib/verify/pass3.js';
import { parseBibtex } from '../lib/citations.js';
import { sectionDraft, paperDir } from '../lib/paths.js';

/**
 * Production staleness re-verify seam (D-08 — Pass 1 + Pass 3 ONLY). Runs the
 * deterministic verifiers for the stale section and reports whether any blocking
 * verdict surfaced. NEVER wires Pass 2/4 (advisory, Phase 5). Reuses the same
 * cassette-backed paths as `pensmith verify` in offline CI.
 */
async function productionReVerify(paperRoot: string, input: ReVerifyInput): Promise<ReVerifyResult> {
  const draftPath = sectionDraft(input.n, input.slug, paperRoot);
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  let draftMd: string;
  let bibText: string;
  try {
    draftMd = readFileSync(draftPath, 'utf8');
    bibText = readFileSync(bibPath, 'utf8');
  } catch {
    // Missing inputs → treat as a re-verify failure (fail-safe: never let a
    // stale section escape unverified).
    return { passed: false, failingCitekeys: [] };
  }
  const pass1 = await runPass1(draftMd, bibPath);
  const bibEntries = await parseBibtex(bibText);
  const bibByCitekey = new Map<string, { DOI?: string }>(
    bibEntries.map((e) => [String((e as { id?: string }).id ?? ''), e as { DOI?: string }]),
  );
  const pass3 = await runPass3(draftMd, bibByCitekey);

  const failing: string[] = [];
  for (const r of pass1) if (r.verdict !== 'OK') failing.push(r.citekey);
  for (const r of pass3) if (r.verdict === 'NOT_FOUND') failing.push(r.citekey);
  return { passed: failing.length === 0, failingCitekeys: [...new Set(failing)] };
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
      reVerify: (input: ReVerifyInput) => productionReVerify(paperRoot, input),
      // Tier-2: no boundary smoother wired (raw concat — best-effort prose).
    });

    if (result.refused) {
      process.stdout.write(
        `pensmith compile: REFUSED — ${(result.refuseReasons ?? []).length} blocking citation issue(s). No DRAFT.md written.\n`,
      );
      for (const r of result.refuseReasons ?? []) process.stdout.write(`  - ${r}\n`);
      return { ok: false, ...result };
    }

    process.stdout.write(
      `pensmith compile: wrote ${result.draftPath} and ${result.reportPath} (${result.sectionsCount} sections, ${result.staleResolvedCount} stale resolved).\n`,
    );
    return { ok: true, ...result };
  },
});

export default compileCommand;
