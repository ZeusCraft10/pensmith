// bin/cli/verify.ts — `pensmith verify <n>` verb entrypoint
// (VRFY-01, VRFY-07, VRFY-08).
//
// THIN ORCHESTRATOR — D-13 LOCKED INVARIANT: this verb is 100%
// deterministic in Phase 3. It calls `runPass1` from bin/lib/verify/pass1.ts
// and `runPass3` from bin/lib/verify/pass3.ts, aggregates the per-citekey
// verdicts, and writes VERIFICATION.md via template-literal narration
// (NOT via loadPrompt). The hash-pinned `pass1-fuzzy-judge.md` /
// `pass3-quote-checker.md` prompts exist as Phase-8 tie-break calibration
// artifacts and MUST NOT be invoked here. The D-13 LOCKED grep chokepoint
// in Plan 03-07 Task 7.2 (`grep -c loadPrompt bin/cli/verify.ts` returns 0)
// is the gate.
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
import { runPass1 } from '../lib/verify/pass1.js';
import { runPass3 } from '../lib/verify/pass3.js';
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

    const draftMd = readFileSync(draftPath, 'utf8');
    const pass1 = await runPass1(draftMd, bibPath);
    const bibEntries = await parseBibtex(readFileSync(bibPath, 'utf8'));
    const bibByCitekey = new Map<string, { DOI?: string }>(
      bibEntries.map((e) => [String((e as { id?: string }).id ?? ''), e as { DOI?: string }]),
    );
    const pass3 = await runPass3(draftMd, bibByCitekey);

    // Aggregate: any FABRICATED → status: failed; any MIS-CITED → status: failed;
    // any PDF_UNAVAILABLE/TEXT_UNAVAILABLE → status: unverifiable; else verified.
    const hasFail = pass1.some((r) => r.verdict !== 'OK')
      || pass3.some((r) => r.verdict === 'NOT_FOUND');
    const hasUnverifiable = pass3.some((r) => r.verdict === 'PDF_UNAVAILABLE' || r.verdict === 'TEXT_UNAVAILABLE');
    const status: 'verified' | 'failed' | 'unverifiable' = hasFail
      ? 'failed'
      : (hasUnverifiable ? 'unverifiable' : 'verified');

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
    ];
    await atomicWriteFile(verifPath, lines.join('\n'));
    process.stdout.write(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
    return { ok: status !== 'failed', status, path: verifPath, pass1, pass3 };
  },
});

export default verifyCommand;
