// bin/cli/compile.ts — `pensmith compile` verb entrypoint (COMP-01..07, ARCH-20;
// Phase 21 EXP-05, EXP-10..13).
//
// THIN ORCHESTRATOR: this verb delegates to bin/lib/compile.ts::runCompile (the
// keystone pipeline). It resolves args and supplies the production seams:
//   - the staleness re-verify (verify.ts verifySection with the advisory passes
//     off — deterministic Pass 1 + Pass 3, NEVER Pass 2/4, D-08; it rewrites
//     only that section's VERIFICATION.md and PLAN.md, and never LIBRARY.json,
//     CITATIONS.bib or last_verified — D-20-23);
//   - the boundary smoother (EXP-10, D-21-14): one complete() call per boundary
//     through buildPromptRequest('smoother', …) — the cost cap is checked
//     before each call — on the masked window rewrite-guard.ts builds; compile
//     validates every reply through the same guard;
//   - the contradiction judge (EXP-11, D-21-15): one complete() call through
//     buildPromptRequest('claim-consistency', …) over the capped pairs.
// Smoothing is skipped, with the reason in COMPILE-REPORT.md and on stdout, by
// --no-smooth, --raw, `[compile] smooth_transitions = false`, PENSMITH_NO_LLM
// (`no LLM`), --dry-run (`dry-run`) and a sources-offline run whose model
// endpoint is not loopback (`offline`); the contradiction judge by the same
// modes (the deterministic heuristic always runs). runCompile recomputes every
// section through the gate core itself (VRFY-25), whatever the seams answer.
//
// `compile` IS one of the locked UX-02 16 verbs (bin/lib/verbs.ts). Every
// terminal line goes through the output sink (PLUG-13).

import { defineCommand } from 'citty';
import { runCompile, type ReVerifyInput, type ReVerifyResult, type SmoothBoundaryInput } from '../lib/compile.js';
import { EXIT_BLOCKED } from '../lib/exit-codes.js';
import { readFileSync } from 'node:fs';
import { projectRoot, sectionVerification } from '../lib/paths.js';
import { gateRefusals, rowBlocks } from '../lib/verify/gate.js';
import { formatSectionId, sectionIdOf } from '../lib/section-id.js';
import { verifySection } from './verify.js';
import { out } from '../lib/output-sink.js';
import { assertLlmConfigured, complete, isFatalLlmError, MissingApiKeyError, RuntimeConfigError } from '../lib/anthropic.js';
import { buildPromptRequest, requestHints } from '../lib/prompt-request.js';
import { consistencyRequest, type ConsistencyPair, type ConsistencyVerdict } from '../lib/claim-consistency.js';
import { modelStepSkipReason } from '../lib/rewrite-guard.js';
import { tryReadPaperConfigSync } from '../lib/config.js';
import type { ClaimConsistency } from '../lib/llm-contracts.js';

/**
 * Production staleness re-verify seam (D-08, D-20-23): the section verifier
 * itself with the advisory passes off — Pass 1 + Pass 3 and the draft checks
 * through the gate core, never Pass 2/4 — which rewrites that section's
 * VERIFICATION.md (Pass 2 / Pass 4 marked "not run — compile staleness
 * re-verify" for an edited draft; an unverifiable section whose draft has not
 * changed keeps the advisory sections its record judged on that draft) and its
 * PLAN.md status and hash, and never a DRAFT.md, the bibliography or
 * last_verified.
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

/** The smoother seam: one `smoother` call per boundary through complete() (the cost cap is checked before it). */
async function productionSmoother(input: SmoothBoundaryInput): Promise<string> {
  const req = buildPromptRequest('smoother', {
    boundary: { section_a_title: input.sectionATitle, section_b_title: input.sectionBTitle },
    tail: input.tail,
    head: input.head,
  });
  const res = await complete({ slug: 'smoother', system: req.system, messages: req.messages, stubHint: requestHints(req) });
  return res.text;
}

/** The contradiction judge seam: one `claim-consistency` call over the capped pairs. */
async function productionJudge(pairs: readonly ConsistencyPair[]): Promise<readonly ConsistencyVerdict[]> {
  const req = consistencyRequest(pairs);
  const res = await complete<ClaimConsistency>({ slug: 'claim-consistency', system: req.system, messages: req.messages, stubHint: requestHints(req) });
  return (res.data?.pairs ?? []).map((p) => ({ id: p.id, verdict: p.verdict, rationale: p.rationale }));
}

/**
 * Why this compile's model steps cannot run: the invocation's mode (S-15), or
 * a runtime with no usable model (no key, no endpoint, no model) — compile
 * then still writes the deterministic paper and says so. null when they can run.
 */
async function modelSkip(paperRoot: string): Promise<string | null> {
  const mode = await modelStepSkipReason(paperRoot);
  if (mode !== null) return mode;
  try {
    await assertLlmConfigured('compile');
    return null;
  } catch (e) {
    if (e instanceof MissingApiKeyError || e instanceof RuntimeConfigError) return 'no model configured';
    throw e;
  }
}

export const compileCommand = defineCommand({
  meta: {
    name: 'compile',
    description: 'Assemble the verified sections into .paper/DRAFT.md (title, section headings, smoothed boundaries) + COMPILE-REPORT.md.',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
    smooth: {
      type: 'boolean',
      description: 'Smooth the N-1 section boundaries through the model (default); --no-smooth keeps the section text as verified.',
      default: true,
    },
    raw: {
      type: 'boolean',
      description: 'No model rewrite of the verified prose: skips the boundary smoother (like --no-smooth).',
      default: false,
    },
    lintHeadings: {
      type: 'boolean',
      description: 'Enable the opt-in heading-tense consistency heuristic (COMP-04).',
      default: false,
    },
    discipline: {
      type: 'string',
      description: "Discipline for the citation-density band (EXP-12; overrides the paper's discipline and [verification] citation_density_min/max).",
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const discipline = typeof args.discipline === 'string' && args.discipline.length > 0 ? args.discipline : undefined;
    const config = tryReadPaperConfigSync(paperRoot);

    // EXP-10 / S-15: why the boundary smoother and the contradiction judge cannot run, if they cannot.
    const mode = await modelSkip(paperRoot);
    let smoothSkip: string | null = null;
    if (args.smooth === false) smoothSkip = '--no-smooth';
    else if (args.raw === true) smoothSkip = '--raw';
    else if (config?.compile?.smooth_transitions === false) smoothSkip = 'config';
    else smoothSkip = mode;

    const result = await runCompile({
      paperRoot,
      yolo: args.yolo === true,
      lintHeadings: args.lintHeadings === true,
      ...(discipline ? { discipline } : {}),
      reVerify: (input: ReVerifyInput) => productionReVerify(input),
      ...(smoothSkip === null ? { smoothBoundary: productionSmoother } : { smoothSkip }),
      ...(mode === null ? { judgeConsistency: productionJudge } : { consistencySkip: mode }),
      isFatal: isFatalLlmError,
    });

    if (result.refused) {
      out(
        `pensmith compile: REFUSED — ${(result.refuseReasons ?? []).length} blocking issue(s). No DRAFT.md written.\n`,
      );
      for (const r of result.refuseReasons ?? []) out(`  - ${r}\n`);
      // RUN-09: a verifier refusal is EXIT_BLOCKED (result.refused → 4).
      return { ok: false, ...result, exitCode: EXIT_BLOCKED };
    }

    out(
      `pensmith compile: wrote ${result.draftPath} and ${result.reportPath} (${result.sectionsCount} sections, ${result.staleResolvedCount} stale resolved).\n`,
    );
    if (result.smoothingSkipped !== undefined) {
      out(`pensmith compile: smoothing skipped (${result.smoothingSkipped}) — the section boundaries are the verified text.\n`);
    } else {
      for (const t of result.transitions ?? []) {
        out(`pensmith compile: boundary ${t.boundary}: ${t.status === 'smoothed' ? 'smoothed' : `${t.status} (${t.reason ?? ''})`}\n`);
      }
    }
    const c = result.contradictions;
    if (c !== undefined) {
      out(`pensmith compile: Contradictions flagged: ${c.flagged.length} (target 0)${c.skipped.length > 0 ? ` — model check ${c.skipped}, heuristic only` : ''}\n`);
      for (const f of c.flagged.slice(0, 5)) {
        out(`  - §${f.pair.a.section} "${f.pair.a.text.slice(0, 120)}" ↔ §${f.pair.b.section} "${f.pair.b.text.slice(0, 120)}" (${f.by})\n`);
      }
    }
    return { ok: true, ...result };
  },
});

export default compileCommand;
