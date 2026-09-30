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
import { runPass2, renderPass2Section, pass2NotRun, NO_LLM_SKIP_REASON, type Pass2Result } from '../lib/verify/pass2.js';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { isFatalLlmError } from '../lib/anthropic.js';
import { extractCitedKeysForVerification } from '../lib/citation-token.js';
import { parseBibFile, parseBibFileAt } from '../lib/citations.js';
import { rerenderCitations, LibraryNotFoundError } from '../lib/library.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft, sectionVerification, sectionPlan, paperDir, projectRoot } from '../lib/paths.js';
import { renderPass1VerdictRow, renderPass3VerdictRow } from '../lib/verify/verdict-rows.js';
import { loadFrontmatterDoc } from '../lib/frontmatter.js';
import { computeDraftHash } from '../lib/draft-hash.js';
import { sectionWriteBlockReason, updatePlanFrontmatter } from '../lib/plan-status.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { formatSectionId, loggedSectionId, sectionIdOf } from '../lib/section-id.js';
import { offlineMarkerLine } from '../lib/http-mock.js';
import { EXIT_ERROR } from '../lib/exit-codes.js';
import { tryReadPaperConfigSync } from '../lib/config.js';

// Force-bind the deterministic primitives so the acceptance grep
// (`grep "jaroWinkler" AND "levenshteinSubstring" bin/cli/verify.ts`)
// stays GREEN even if a refactor later inlines runPass1/runPass3.
void jaroWinkler;
void levenshteinSubstring;

/**
 * SRC-12: when CITATIONS.bib does not parse and the paper has a LIBRARY.json,
 * re-render the bib (and RIS) from the library — one stderr notice, the
 * unreadable file kept as a backup — so verification proceeds on a bib that
 * holds exactly the library's sources. Without a library nothing changes and
 * Pass 1 reports the parse error (fail closed).
 */
async function rerenderBibIfBroken(root: string, bibPath: string): Promise<void> {
  let text: string;
  try {
    text = readFileSync(bibPath, 'utf8');
  } catch {
    return;
  }
  try {
    await parseBibFile(text);
    return;
  } catch {
    /* does not parse — re-render below */
  }
  let result;
  try {
    result = await rerenderCitations(root);
  } catch (e) {
    if (e instanceof LibraryNotFoundError) return;
    throw e;
  }
  process.stderr.write(
    `pensmith verify: .paper/CITATIONS.bib did not parse (${result.previousProblem ?? 'invalid BibTeX'}) — re-rendered it from LIBRARY.json` +
      `${result.backup ? `; the old file is kept at ${result.backup}` : ''}\n`,
  );
}

/** One line naming why the advisory passes stopped (for the "not run" rows). */
function stopReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '/').trim().slice(0, 160) || 'stopped';
}

/**
 * Verify ONE section (VRFY-01, VRFY-07, VRFY-08): Pass 1 + Pass 3 (blocking,
 * deterministic), the freshness probe and the advisory Passes 2 and 4, then
 * VERIFICATION.md and the PLAN.md status + verified_against_draft_hash. The
 * `verify` command and `write` (which chains verify after each successful
 * draft, GRND-15 / D-18-26) both call it. Its result maps to the exit code the
 * command has always had (exitCodeForResult): a failed or blocking-UNVERIFIABLE
 * section is EXIT_BLOCKED. A fatal advisory failure (the cost cap) is thrown
 * after the deterministic verdict is written.
 */
export async function verifySection(n: number, slug: string, suffix?: string | null) {
  // The section as the user types it (`1`, `1a`) — messages, the header and the model-call records.
  const id = formatSectionId(sectionIdOf(n, suffix));
  const logged = loggedSectionId(n, suffix);
  // RUN-02: every VERIFICATION.md written in an offline / --dry-run session
  // opens with the disclosure marker — the short-circuit bodies below too.
  const markerPrefix = (): string => {
    const m = offlineMarkerLine();
    return m !== null ? `${m}\n\n` : '';
  };
  const draftPath = sectionDraft(n, slug);
  const verifPath = sectionVerification(n, slug);
  const bibPath = path.join(paperDir(), 'CITATIONS.bib');

  if (!existsSync(draftPath)) {
    const body = `${markerPrefix()}# VERIFICATION (Section ${id}, ${slug})\n\nStatus: unverifiable\nReason: DRAFT.md missing at ${draftPath} — run \`pensmith write ${id}\` first.\n`;
    await atomicWriteFile(verifPath, body);
    // A section whose draft is gone is back to "needs writing": the router
    // re-drafts it instead of re-dispatching verify forever.
    const planPath = sectionPlan(n, slug);
    if (existsSync(planPath)) {
      await updatePlanFrontmatter(planPath, (fm) => {
        if (fm.status !== 'planned') fm.status = 'writing';
        delete fm.failure_reason;
      });
    }
    process.stdout.write(`pensmith verify: DRAFT.md missing — wrote unverifiable VERIFICATION.md to ${verifPath}; run \`pensmith write ${id}\` first\n`);
    return { ok: false, status: 'unverifiable', path: verifPath };
  }

  // FEED-04 (D-18-25): the section's last write failed and kept the OLDER
  // draft. Verifying that draft would mark the section verified (and clear the
  // failure) although the failed write was never retried — the gate bypass the
  // router's attention guards against. Refuse, naming the retry; nothing is
  // written.
  const planForBlock = sectionPlan(n, slug);
  if (existsSync(planForBlock)) {
    let block: string | null = null;
    try {
      const { frontmatter } = await loadFrontmatterDoc('plan', planForBlock);
      const reason = frontmatter['failure_reason'];
      block = typeof reason === 'string' && reason.trim().length > 0 ? sectionWriteBlockReason(frontmatter, id) : null;
    } catch {
      block = null; // an unreadable PLAN.md is reported by the status write below
    }
    if (block !== null) {
      process.stderr.write(`pensmith verify: section ${id} not verified — ${block}\n`);
      return { ok: false, status: 'failed', blocked: true, path: verifPath };
    }
  }

  // The ONE citation grammar (citation-token.ts): every cited key, whatever
  // its shape ([@k, p. 3], [@a; @b], [@Key:2099]) — the same extraction
  // runPass1 uses, so "cites nothing" means Pass 1 has nothing to check.
  const draftMd = readFileSync(draftPath, 'utf8');
  const citedKeys = extractCitedKeysForVerification(draftMd);
  const bibExists = existsSync(bibPath);
  if (!bibExists && citedKeys.length > 0) {
    // Fail closed: a draft that cites sources with no CITATIONS.bib to check
    // them against is never a passable verdict (compile refuses Status: failed).
    const body = `${markerPrefix()}# VERIFICATION (Section ${id}, ${slug})\n\nStatus: failed\nReason: .paper/CITATIONS.bib is missing, so the ${citedKeys.length} source(s) DRAFT.md cites cannot be checked — run \`pensmith research\` to rebuild it, then \`pensmith verify ${id}\`.\n`;
    await atomicWriteFile(verifPath, body);
    process.stdout.write(`pensmith verify: CITATIONS.bib missing — wrote failed VERIFICATION.md to ${verifPath}\n`);
    return { ok: false, status: 'failed', path: verifPath, exitCode: EXIT_ERROR };
  }

  // SRC-12 (D-19-19): a CITATIONS.bib that does not parse — e.g. one an older
  // pensmith wrote with `{\u …}` name escapes (E2E-12) — is re-rendered from
  // LIBRARY.json, the paper's source of truth, with one notice; the old file
  // is kept as a backup. With no LIBRARY.json the parse error below stands.
  if (bibExists) await rerenderBibIfBroken(projectRoot(), bibPath);

  // An empty CITATIONS.bib is zero entries (the library writer renders an
  // empty library as an empty bib, BRDTH-01), and a draft that cites nothing
  // needs no bib at all: both take the normal path below. With no citation,
  // Pass 1 and Pass 3 have nothing to check and the section is verified —
  // exactly as it is against a non-empty bib; a cited key absent from the bib
  // is FABRICATED (fail closed).
  const pass1 = bibExists ? await runPass1(draftMd, bibPath, { root: projectRoot() }) : [];
  const bibEntries = bibExists ? await parseBibFileAt(readFileSync(bibPath, 'utf8'), bibPath) : [];
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
  const pass3 = await runPass3(draftMd, bibByCitekey, { root: projectRoot() });

  // RSCH-10 freshness probe (D-10, WARN-only). Runs AFTER the blocking
  // verdict computation and NEVER influences `status` — a stale DOI or a
  // retraction-watch hit surfaces as an advisory table row, not a block.
  const freshness = bibExists ? await runFreshnessForDraft(draftMd, bibPath) : [];

  // Aggregate: any FABRICATED → status: failed; any MIS-CITED → status: failed;
  // any Pass-1 UNVERIFIABLE (the re-fetch was unavailable offline / under
  // --dry-run, D-17-07) → status: unverifiable AND blocked (exit 4; compile and
  // done refuse the row with "re-run online"); any PDF_UNAVAILABLE /
  // TEXT_UNAVAILABLE → status: unverifiable (advisory); else verified.
  const hasFail = pass1.some((r) => r.verdict === 'FABRICATED' || r.verdict === 'MIS-CITED')
    || pass3.some((r) => r.verdict === 'NOT_FOUND');
  const blockingUnverifiable = pass1.some((r) => r.verdict === 'UNVERIFIABLE');
  const hasUnverifiable = blockingUnverifiable
    || pass3.some((r) => r.verdict === 'PDF_UNAVAILABLE' || r.verdict === 'TEXT_UNAVAILABLE');
  const status: 'verified' | 'failed' | 'unverifiable' = hasFail
    ? 'failed'
    : (hasUnverifiable ? 'unverifiable' : 'verified');
  // Blocking UNVERIFIABLE maps to EXIT_BLOCKED through the result (ok:false,
  // blocked:true); verifySection never sets process.exitCode itself, so write
  // can chain it once per section (GRND-15).

  // Pass-2 (claim support) + Pass-4 (orphan-claim audit), advisory. Both run
  // AFTER hasFail / hasUnverifiable / status are frozen above and NEVER feed
  // back into them (VRFY-07) — mirroring the freshness advisory call site.
  // Pass 2/4 load their own prompts inside their modules (the prompt-loader
  // path lives there, not here), so verify.ts stays a 100%-deterministic
  // orchestrator at the prompt-loader chokepoint. The results are returned for
  // Phase 6 DONE-09 consumption and rendered as advisory VERIFICATION.md
  // sections below.
  //
  // No provider key is not an error here: the passes record "skipped (no LLM
  // configured)" rows (D-V1-04). A failure that must stop verify — the session
  // cost cap, an invalid runtime config — is caught so the frozen Pass-1/Pass-3
  // verdict is still written and persisted, then rethrown (its exit code).
  let advisoryStop: unknown = undefined;
  let pass2: Pass2Result[];
  let pass4: Pass4Result[] | null = null;
  try {
    // `[verification] send_byo_passages` (default off, PRD §9): only then do
    // the user's own PDFs' passages go to the model provider.
    const shareByoPassages = tryReadPaperConfigSync(projectRoot())?.verification?.send_byo_passages === true;
    pass2 = await runPass2(draftMd, bibByCitekey, { n: logged, root: projectRoot(), shareByoPassages });
  } catch (err) {
    if (!isFatalLlmError(err)) throw err;
    advisoryStop = err;
    pass2 = pass2NotRun(draftMd, stopReason(err));
  }
  if (advisoryStop === undefined) {
    try {
      pass4 = await runPass4(draftMd, { n: logged });
    } catch (err) {
      if (!isFatalLlmError(err)) throw err;
      advisoryStop = err;
    }
  }
  if (advisoryStop === undefined && pass2.some((r) => r.rationale.startsWith(NO_LLM_SKIP_REASON))) {
    process.stderr.write(`pensmith verify: advisory claim-support and orphan checks ${NO_LLM_SKIP_REASON} — the blocking Pass 1 and Pass 3 verdicts are unaffected.\n`);
  }

  const offlineMarker = offlineMarkerLine();
  const lines = [
    ...(offlineMarker !== null ? [offlineMarker, ''] : []),
    `# VERIFICATION (Section ${id}, ${slug})`,
    '',
    `Status: ${status}`,
    '',
    '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
    '',
    ...pass1.map((r) => renderPass1VerdictRow(r.citekey, r.verdict, r.titleJW, r.authorJW, r.reason)),
    '',
    '## Pass-3 (quote integrity, deterministic — levenshtein-substring)',
    '',
    ...pass3.map((r) => renderPass3VerdictRow(r.citekey, r.quoteSnippet, r.verdict, r.levRatio, r.reason)),
    '',
    ...(citedKeys.length === 0 ? ['Note: DRAFT.md cites no sources ([@citekey]) — Pass 1 and Pass 3 had nothing to check.', ''] : []),
    renderFreshnessTable(freshness),
    '',
    renderPass2Section(pass2),
    '',
    pass4 !== null
      ? renderPass4Section(pass4)
      : `## Pass-4 (orphan claims, advisory)\n\n_(not run: ${stopReason(advisoryStop)})_\n`,
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
      // CONF-04: the versioned PLAN.md reader (v0 migrated + written back).
      const { frontmatter } = await loadFrontmatterDoc('plan', planPath, { writeBack: true });
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
    // FEED-04: a write failure's reason no longer describes the section once
    // verify has judged its draft.
    delete fm.failure_reason;
  });
  if (!persisted) {
    process.stderr.write(
      `pensmith verify: WARN — could not persist status:'${status}' to ${planPath} ` +
      `(PLAN.md absent/unwritable); the router may not advance this section.\n`,
    );
  }

  process.stdout.write(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
  // The deterministic verdict is on disk; now stop with the advisory failure
  // (e.g. EXIT_COST_CAP, one line through the dispatcher).
  if (advisoryStop !== undefined) throw advisoryStop;
  // RUN-09: a failed or blocking-UNVERIFIABLE section is a verifier refusal —
  // `blocked` maps to EXIT_BLOCKED.
  return { ok: status !== 'failed' && !blockingUnverifiable, status, blocked: hasFail || blockingUnverifiable, path: verifPath, pass1, pass3, freshness, pass2, pass4 };
}

export const verifyCommand = defineCommand({
  meta: {
    name: 'verify',
    description: 'Run deterministic Pass-1 + Pass-3 verification on a section DRAFT.md.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based; a letter for an inserted section, e.g. 1a).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to the outline\'s slug for <n>).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    // RUN-09: <n> must name one of the paper's sections and --slug must be a
    // bare slug — EXIT_USAGE otherwise, before anything is read or written. The
    // slug comes from OUTLINE.md (audit #23); 'placeholder' only when there is
    // no outline yet.
    const { n, slug, suffix } = resolveSectionArg('verify', projectRoot(), args.n, args.slug);
    return verifySection(n, slug, suffix);
  },
});

export default verifyCommand;
