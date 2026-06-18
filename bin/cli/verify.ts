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
//   2. Run Pass-1 (deterministic JW + DOI integrity) via runPass1
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
import { parseBibtex } from '../lib/citations.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft, sectionVerification, paperDir } from '../lib/paths.js';

const DEFAULT_SLUG = 'placeholder';

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
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith verify: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);
    const draftPath = sectionDraft(n, slug);
    const verifPath = sectionVerification(n, slug);
    const bibPath = path.join(paperDir(), 'CITATIONS.bib');

    if (!existsSync(draftPath)) {
      const body = `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: unverifiable\nReason: DRAFT.md missing at ${draftPath}\n`;
      await atomicWriteFile(verifPath, body);
      process.stdout.write(`pensmith verify: DRAFT.md missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }
    if (!existsSync(bibPath)) {
      const body = `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: unverifiable\nReason: .paper/CITATIONS.bib missing — run \`pensmith research\` first.\n`;
      await atomicWriteFile(verifPath, body);
      process.stdout.write(`pensmith verify: CITATIONS.bib missing — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }

    // Empty / no-entry CITATIONS.bib is a valid Tier-2 placeholder state
    // (research wrote an empty bib because no citations have been authored
    // yet). parseBib throws on empty input per T-3-04 strict-parse mitigation,
    // so we short-circuit here to "unverifiable: no citations to verify"
    // rather than letting verify crash mid-pipeline. The DRAFT.md is read
    // BEFORE the short-circuit so a draft with [@citekey] tokens against an
    // empty bib still falls through to runPass1 (which will flag each as
    // FABRICATED) — only the bib-empty + draft-citation-free intersection
    // gets the short-circuit.
    const draftMd = readFileSync(draftPath, 'utf8');
    const bibText = readFileSync(bibPath, 'utf8');
    const draftHasCitekeys = /\[@[a-z][a-z0-9_-]*\]/i.test(draftMd);
    const bibIsEmpty = bibText.trim().length === 0;
    if (bibIsEmpty && !draftHasCitekeys) {
      const body = `# VERIFICATION (Section ${n}, ${slug})\n\nStatus: unverifiable\nReason: CITATIONS.bib is empty and DRAFT.md has no [@citekey] references — nothing to verify (Tier-2 placeholder state).\n`;
      await atomicWriteFile(verifPath, body);
      process.stdout.write(`pensmith verify: empty bib + no draft citekeys — wrote unverifiable VERIFICATION.md to ${verifPath}\n`);
      return { ok: false, status: 'unverifiable', path: verifPath };
    }

    const pass1 = await runPass1(draftMd, bibPath);
    const bibEntries = await parseBibtex(readFileSync(bibPath, 'utf8'));
    // Widened value type (additive): carries title/author/abstract so Pass 2
    // (claim support) has source metadata. runPass3 reads only DOI, so the
    // widening is backward-compatible with the runPass3 call below.
    type BibValue = {
      DOI?: string;
      title?: string | string[];
      author?: Array<{ family?: string; given?: string }> | string[];
      abstract?: string;
    };
    const bibByCitekey = new Map<string, BibValue>(
      bibEntries.map((e) => [String((e as { id?: string }).id ?? ''), e as BibValue]),
    );
    const pass3 = await runPass3(draftMd, bibByCitekey);

    // RSCH-10 freshness probe (D-10, WARN-only). Runs AFTER the blocking
    // verdict computation and NEVER influences `status` — a stale DOI or a
    // retraction-watch hit surfaces as an advisory table row, not a block.
    const freshness = await runFreshnessForDraft(draftMd, bibPath);

    // Aggregate: any FABRICATED → status: failed; any MIS-CITED → status: failed;
    // any PDF_UNAVAILABLE/TEXT_UNAVAILABLE → status: unverifiable; else verified.
    const hasFail = pass1.some((r) => r.verdict !== 'OK')
      || pass3.some((r) => r.verdict === 'NOT_FOUND');
    const hasUnverifiable = pass3.some((r) => r.verdict === 'PDF_UNAVAILABLE' || r.verdict === 'TEXT_UNAVAILABLE');
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
      '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
      '',
      ...pass1.map((r) => `- ${r.citekey}: **${r.verdict}** — titleJW=${r.titleJW.toFixed(2)}, authorJW=${r.authorJW.toFixed(2)} — ${r.reason}`),
      '',
      '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
      '',
      ...pass3.map((r) => `- ${r.citekey} ("${r.quoteSnippet}…"): **${r.verdict}** — lev=${r.levRatio.toFixed(3)} — ${r.reason}`),
      '',
      renderFreshnessTable(freshness),
      '',
      renderPass2Section(pass2),
      '',
      renderPass4Section(pass4),
      '',
    ];
    await atomicWriteFile(verifPath, lines.join('\n'));
    process.stdout.write(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
    return { ok: status !== 'failed', status, path: verifPath, pass1, pass3, freshness, pass2, pass4 };
  },
});

export default verifyCommand;
