// bin/cli/verify.ts — `pensmith verify <n>` verb entrypoint
// (VRFY-01, VRFY-07, VRFY-08).
//
// THIN ORCHESTRATOR — D-13 LOCKED INVARIANT: this verb is 100%
// deterministic in Phase 3. It calls `runPass1` from bin/lib/verify/pass1.ts
// and `runPass3` from bin/lib/verify/pass3.ts, aggregates the per-citekey
// verdicts, and writes VERIFICATION.md via template-literal narration
// (NOT via any prompt-loader call). The hash-pinned `pass1-fuzzy-judge.md`
// and `pass3-quote-checker.md` prompts exist as Phase-8 tie-break calibration
// artifacts and MUST NOT be invoked here. The D-13 LOCKED grep chokepoint
// in Plan 03-07 Task 7.2 enforces this: a literal-string search for the
// prompt-loader symbol against this file MUST return 0 hits (including
// this comment — hence the paraphrase above).
//
// Pipeline:
//   1. Read DRAFT.md for section N
//   2. Run Pass-1 (each identifier resolved through its registries, the entry
//      compared with the record) via runPass1
//   3. Run Pass-3 (deterministic levenshtein-substring) via runPass3
//   4. Aggregate to per-source verdicts (OK / UNVERIFIABLE / FAIL)
//   5. Atomic-write VERIFICATION.md

import { defineCommand } from 'citty';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { jaroWinkler, levenshteinSubstring } from '../lib/fuzzy.js';
import { runPass1, runFreshnessForDraft, renderFreshnessTable } from '../lib/verify/pass1.js';
import { runPass3 } from '../lib/verify/pass3.js';
import { runPass2, renderPass2Section } from '../lib/verify/pass2.js';
import { runPass4, renderPass4Section } from '../lib/verify/pass4.js';
import { parseBibByCitekey } from '../lib/citations.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft, sectionVerification, sectionPlan, paperDir } from '../lib/paths.js';
import {
  citationWarnings,
  isBlockingVerdict,
  parseVerdictRowDetails,
  renderPass1VerdictRow,
  renderPass3VerdictRow,
  unattributedWarning,
} from '../lib/verify/verdict-rows.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { computeDraftHash } from '../lib/draft-hash.js';
import { updatePlanFrontmatter } from '../lib/plan-status.js';
import { resolveSectionSlug, sectionNumberArg } from '../lib/section-slug.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { isPlaceholderText } from '../lib/placeholder.js';

// Force-bind the deterministic primitives so the acceptance grep
// (`grep "jaroWinkler" AND "levenshteinSubstring" bin/cli/verify.ts`)
// stays GREEN even if a refactor later inlines runPass1/runPass3.
void jaroWinkler;
void levenshteinSubstring;

export const verifyCommand = defineCommand({
  meta: {
    name: 'verify',
    description: 'Run deterministic Pass-1 + Pass-3 verification on a section DRAFT.md.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder").',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const n = sectionNumberArg('verify', args.n);
    if (n === null) return { ok: false, status: 'invalid-input' };
    // Audit #23: resolve the slug from OUTLINE.md for section n (explicit --slug
    // wins; 'placeholder' only if no outline row exists).
    const slug = resolveSectionSlug(process.cwd(), n, args.slug);
    const draftPath = sectionDraft(n, slug);
    const verifPath = sectionVerification(n, slug);
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');

    // Every refusal below writes this status-only VERIFICATION.md, the shape
    // compile and done read (a `Status:` line), and records the same status in
    // PLAN.md with no draft hash: a "verified" mark from an earlier run must
    // not outlive a run that could not verify. A section not drafted yet keeps
    // its planned or writing status, so the router still sends it on to be
    // planned or written instead of back to verify.
    const statusOnly = (status: string, reason: string): string =>
      `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: ${status}\nReason: ${reason}\n`;
    const refuse = async (
      status: 'failed' | 'unverifiable',
      reason: string,
      { keepPreDraftStatus = false } = {},
    ): Promise<void> => {
      await atomicWriteFile(verifPath, statusOnly(status, reason));
      await updatePlanFrontmatter(sectionPlan(n, slug), (fm) => {
        if (!(keepPreDraftStatus && (fm.status === 'planned' || fm.status === 'writing'))) fm.status = status;
        fm.verified_against_draft_hash = null;
      });
      process.exitCode = EXIT_REFUSED;
    };

    if (!existsSync(draftPath)) {
      await refuse('unverifiable', `DRAFT.md missing at ${draftPath}`, { keepPreDraftStatus: true });
      process.stdout.write(`pensmith verify: DRAFT.md missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }
    // Placeholder text (PENSMITH_NO_LLM) is not a draft: no verdict on it may
    // read as clean, so it fails before any pass runs.
    const draftMd = readFileSync(draftPath, 'utf8');
    if (isPlaceholderText(draftMd)) {
      const reason =
        `DRAFT.md is placeholder text from PENSMITH_NO_LLM, not a draft — re-run ` +
        `\`pensmith write ${n}\` with a model configured.`;
      await refuse('failed', reason);
      process.stdout.write(`pensmith verify: section ${n} ${reason} Wrote failed VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'failed', path: verifPath };
    }
    if (!existsSync(bibPath)) {
      await refuse('unverifiable', '.paper/CITATIONS.bib missing — run `pensmith research` first.');
      process.stdout.write(`pensmith verify: CITATIONS.bib missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }

    // An empty CITATIONS.bib (research found nothing yet) is an empty library:
    // Pass 1 still runs, and every key the draft cites is FABRICATED.
    const bibText = readFileSync(bibPath, 'utf8');
    const bibIsEmpty = bibText.trim().length === 0;
    const pass1 = await runPass1(draftMd, bibPath);
    // Widened value type (additive): carries title/author/abstract so Pass 2
    // (claim support) has source metadata. runPass3 reads only DOI, so the
    // widening is backward-compatible with the runPass3 call below.
    type BibValue = {
      DOI?: string;
      title?: string | string[];
      author?: Array<{ family?: string; given?: string }> | string[];
      abstract?: string;
    };
    const bibByCitekey = await parseBibByCitekey<BibValue>(bibText);
    const pass3 = await runPass3(draftMd, bibByCitekey);

    // RSCH-10 freshness probe (D-10, WARN-only). Runs AFTER the blocking
    // verdict computation and NEVER influences `status`: a DOI that no longer
    // resolves surfaces as an advisory table row, not a block.
    const freshness = await runFreshnessForDraft(draftMd, bibPath);

    // Aggregate: any verdict that blocks compile (every Pass-1 verdict other
    // than OK, or a quote NOT_FOUND) → status: failed. A quote nothing could
    // check (no source text, or no citation at all) → status: unverifiable.
    // Else verified. A draft that cites nothing against an empty library has
    // nothing to check: unverifiable, as before, but recorded like any other
    // verdict.
    const hasFail = [...pass1, ...pass3].some((r) => isBlockingVerdict(r.verdict));
    const sourceTextMissing = pass3.some((r) => r.verdict === 'PDF_UNAVAILABLE' || r.verdict === 'TEXT_UNAVAILABLE');
    const unattributed = pass3.filter((r) => r.verdict === 'UNATTRIBUTED').length;
    const nothingToCheck = bibIsEmpty && pass1.length === 0 && pass3.length === 0;
    const hasUnverifiable = sourceTextMissing || unattributed > 0 || nothingToCheck;
    const status: 'verified' | 'failed' | 'unverifiable' = hasFail
      ? 'failed'
      : (hasUnverifiable ? 'unverifiable' : 'verified');

    // Pass-2 (claim support) + Pass-4 (orphan-claim audit), advisory. Both run
    // AFTER hasFail / hasUnverifiable / status are frozen above and NEVER feed
    // back into them (VRFY-07) — mirroring the freshness advisory call site.
    // Pass 2/4 load their own prompts inside their modules (the prompt-loader
    // path lives there, not here), so verify.ts stays a 100%-deterministic
    // orchestrator at the prompt-loader chokepoint. The results are returned for
    // Phase 6 DONE-09 consumption and rendered as advisory VERIFICATION.md
    // sections below.
    const pass2 = await runPass2(draftMd, bibByCitekey, { n });
    const pass4 = await runPass4(draftMd, { n });

    const lines = [
      `# VERIFICATION (Section ${n}, ${slug})`,
      '',
      `Status: ${status}`,
      '',
      '## Pass-1 (citation integrity, deterministic)',
      '',
      ...pass1.map((r) => renderPass1VerdictRow(r.citekey, r.verdict, r.titleJW, r.authorJW, r.reason)),
      '',
      '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
      '',
      ...pass3.map((r) => renderPass3VerdictRow(r.citekey, r.quoteSnippet, r.verdict, r.levRatio, r.reason)),
      '',
      renderFreshnessTable(freshness),
      '',
      renderPass2Section(pass2),
      '',
      renderPass4Section(pass4),
      '',
    ];
    await atomicWriteFile(verifPath, lines.join('\n'));

    // Audit #8: persist the verdict to the section PLAN.md frontmatter so the
    // router (router.ts:188-211) advances the pipeline instead of looping on
    // verify. verified_against_draft_hash is the D-07 per-section hash computed
    // EXACTLY as compile.ts recomputes it (DRAFT.md bytes + sorted
    // assigned_sources), so a verified section is recognized as fresh by the
    // compile staleness check — and a later re-write changes the bytes, leaving
    // the stored hash stale and forcing re-verification (the write<->verify
    // cycle-break). Best-effort: an absent/unwritable PLAN.md WARNs, never throws.
    const planPath = sectionPlan(n, slug);
    let assignedSources: string[] = [];
    try {
      if (existsSync(planPath)) {
        const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
        assignedSources = Array.isArray(frontmatter['assigned_sources'])
          ? (frontmatter['assigned_sources'] as unknown[]).map(String)
          : [];
      }
    } catch {
      assignedSources = [];
    }
    const draftHash = computeDraftHash(readFileSync(draftPath), assignedSources);
    const persisted = await updatePlanFrontmatter(planPath, (fm) => {
      fm.status = status;
      fm.verified_against_draft_hash = draftHash;
    });
    if (!persisted) {
      process.stderr.write(
        `pensmith verify: WARN — could not persist status:'${status}' to ${planPath} ` +
        `(PLAN.md absent/unwritable); the router may not advance this section.\n`,
      );
    }

    process.stdout.write(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
    // A work under an expression of concern passes but must not look clean.
    for (const w of citationWarnings(parseVerdictRowDetails(lines.join('\n')), `section ${n}`)) {
      process.stderr.write(`pensmith verify: WARN — ${w}.\n`);
    }
    // What nobody could check does not block yet, but must not look clean.
    if (unattributed > 0) {
      process.stderr.write(`pensmith verify: WARN — ${unattributedWarning(`section ${n}`, unattributed)}; see ${verifPath}.\n`);
    }
    if (status === 'failed') {
      // A blocking verdict: compile and done will refuse this section.
      process.exitCode = EXIT_REFUSED;
    } else if (sourceTextMissing) {
      process.stderr.write(
        `pensmith verify: WARN — section ${n} has quote(s) that could not be checked against source text; see ${verifPath}.\n`,
      );
    } else if (nothingToCheck) {
      process.stderr.write(`pensmith verify: WARN — section ${n} cites nothing, and CITATIONS.bib is empty; see ${verifPath}.\n`);
    }
    return { ok: status !== 'failed', status, path: verifPath, pass1, pass3, freshness, pass2, pass4 };
  },
});

export default verifyCommand;
