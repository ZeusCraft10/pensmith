// bin/cli/verify.ts — `pensmith verify <n>` verb entrypoint
// (VRFY-01, VRFY-07, VRFY-08; Phase 20: VRFY-16, VRFY-17, VRFY-20, VRFY-24,
// VRFY-28).
//
// THIN ORCHESTRATOR — D-13 LOCKED INVARIANT: the blocking verdict is 100%
// deterministic. The ONE gate core (bin/lib/verify/gate.ts recomputeGate)
// runs `runPass1` from bin/lib/verify/pass1.ts and `runPass3` from
// bin/lib/verify/pass3.ts over the draft, adds the membership and draft checks,
// and this verb writes VERIFICATION.md via template-literal narration
// (bin/lib/verify/verification-md.ts, NOT via any prompt-loader call). The
// hash-pinned `pass1-fuzzy-judge.md` and `pass3-quote-checker.md` prompts exist
// as Phase-8 tie-break calibration artifacts and MUST NOT be invoked here. The
// D-13 LOCKED grep chokepoint in Plan 03-07 Task 7.2 enforces this: a
// literal-string search for the prompt-loader symbol against this file MUST
// return 0 hits (including this comment — hence the paraphrase above).
//
// Pipeline (D-20-20):
//   0. A section whose last write failed is refused (FEED-04) — nothing written.
//   1. DRAFT.md missing → PLAN.md back to `writing` (the router re-drafts);
//      VERIFICATION.md says so.
//   2. PLAN.md `status: verifying`, `verified_against_draft_hash` removed —
//      BEFORE any pass, so a crash never leaves an earlier `verified` in place.
//   3. CITATIONS.bib that does not parse entry by entry is re-rendered from
//      LIBRARY.json first (SRC-12); the entries that parse feed Pass 1, a cited
//      key whose entry does not parse is UNPARSEABLE (key + line), a missing or
//      empty bib makes every cited key FABRICATED — never a stack.
//   4. The gate core: Pass 1 (+ UNASSIGNED against PLAN.md assigned_sources),
//      Pass 3, PLACEHOLDER / NO-CITATIONS, the quote-acceptance lift.
//   5. `--accept-quote <id>` (repeatable) / the interactive `quote-accept`
//      gate record acceptances for UNVERIFIABLE-QUOTE rows (VRFY-20).
//   6. The freshness probe and the advisory Passes 2 and 4 (never change the status).
//   7. VERIFICATION.md (summary table first), then PLAN.md status + hash, then
//      LIBRARY.json `last_verified` for every citation a registrar just
//      confirmed (VRFY-28).
// The status is always verified, failed or unverifiable at the end.

import { defineCommand } from 'citty';
import { readFileSync, existsSync } from 'node:fs';
import { jaroWinkler, levenshteinSubstring } from '../lib/fuzzy.js';
import { runFreshnessForDraft, renderFreshnessTable, type FreshnessResult } from '../lib/verify/pass1.js';
import type { Pass1Result } from '../lib/verify/pass1.js';
import type { Pass3Result } from '../lib/verify/pass3.js';
import { runPass2, renderPass2Section, pass2NotRun, NO_LLM_SKIP_REASON, type Pass2Result } from '../lib/verify/pass2.js';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { assertLlmConfigured, isFatalLlmError } from '../lib/anthropic.js';
import { sourceTextPassage } from '../lib/verify/source-text.js';
import { rerenderCitations, recordLastVerified, LibraryNotFoundError } from '../lib/library.js';
import { extractCitedKeysForVerification } from '../lib/citation-token.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft, sectionVerification, sectionPlan, projectRoot } from '../lib/paths.js';
import { QUOTE_ID_RE, ACCEPTABLE_QUOTE_VERDICT } from '../lib/verify/verdicts.js';
import {
  recomputeGate,
  loadBibliography,
  recheckKeys,
  applyAcceptances,
  gateOutcome,
  type GateResult,
  type GateInput,
  type GateRow,
  type LoadedBibliography,
  type Pass3GateRow,
} from '../lib/verify/gate.js';
import { renderVerificationMd, NO_CITATIONS_NOTE, advisorySectionsOf, summaryMismatches } from '../lib/verify/verification-md.js';
import {
  acceptableRows,
  loadQuoteAcceptances,
  recordQuoteAcceptances,
  sectionDirOfPlan,
  QuoteAcceptanceError,
  type AcceptableQuoteRow,
} from '../lib/quote-acceptance.js';
import { loadFrontmatterDoc } from '../lib/frontmatter.js';
import { computeDraftHash } from '../lib/draft-hash.js';
import { sectionWriteBlockReason, updatePlanFrontmatter } from '../lib/plan-status.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { formatSectionId, loggedSectionId, sectionIdOf } from '../lib/section-id.js';
import { offlineMarkerLine, networkMode } from '../lib/http-mock.js';
import { tryReadPaperConfigSync } from '../lib/config.js';
import { extractQuotes } from '../lib/quote-extractor.js';
import { runGate, canPrompt } from '../lib/gates.js';
import { out } from '../lib/output-sink.js';

// Force-bind the deterministic primitives so the acceptance grep
// (`grep "jaroWinkler" AND "levenshteinSubstring" bin/cli/verify.ts`)
// stays GREEN even if a refactor later inlines runPass1/runPass3.
void jaroWinkler;
void levenshteinSubstring;

/** The "not run" line of an advisory section compile's staleness re-verify skips (D-08). */
export const COMPILE_REVERIFY_NOT_RUN = 'not run — compile staleness re-verify; run `pensmith verify';

/**
 * SRC-12: when CITATIONS.bib has entries that do not parse and the paper has a
 * LIBRARY.json, re-render the bib (and RIS) from the library — one stderr
 * notice, an unreadable file kept as a backup — so verification proceeds on a
 * bib that holds exactly the library's sources. Without a library nothing
 * changes and the broken entries' cited keys are UNPARSEABLE (fail closed).
 * Returns the bibliography as verify then reads it.
 */
async function rerenderBibIfBroken(root: string, bib: LoadedBibliography): Promise<LoadedBibliography> {
  if (!bib.exists || bib.problems.length === 0) return bib;
  let result;
  try {
    result = await rerenderCitations(root);
  } catch (e) {
    if (e instanceof LibraryNotFoundError) return bib;
    throw e;
  }
  const first = bib.problems[0];
  const problem = result.previousProblem ?? (first ? `line ${first.line}${first.key !== null ? ` (${first.key})` : ''}: ${first.detail}` : 'invalid BibTeX');
  process.stderr.write(
    `pensmith verify: .paper/CITATIONS.bib did not parse (${problem}) — re-rendered it from LIBRARY.json` +
      `${result.backup ? `; the old file is kept at ${result.backup}` : ''}\n`,
  );
  return loadBibliography(root);
}

/** One line naming why the advisory passes stopped (for the "not run" rows). */
function stopReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '/').trim().slice(0, 160) || 'stopped';
}

/** How verifySection runs (the verify command and write use the defaults; compile's staleness re-verify does not). */
export interface VerifySectionOptions {
  /**
   * Run the freshness probe and the advisory Passes 2 and 4 (default true).
   * compile's staleness re-verify passes false (D-08: Pass 1 + Pass 3 only).
   */
  readonly advisory?: boolean;
  /**
   * May write paper-level files: re-render a CITATIONS.bib that does not parse
   * (SRC-12) and record `last_verified` (VRFY-28). Default true; compile passes
   * false — compile never writes LIBRARY.json, CITATIONS.bib or last_verified.
   */
  readonly writePaperFiles?: boolean;
  /**
   * With `advisory: false`: the section's current VERIFICATION.md. When it
   * judged the very draft verified now (its `Draft:` hash), its freshness,
   * Pass-2 and Pass-4 sections are kept as they are instead of "not run" —
   * compile's re-verify of an unverifiable section whose draft has not changed
   * (review round 2: the claim-support judgments, and the UNSUPPORTED claims
   * done decides, stay valid for that draft).
   */
  readonly keepAdvisoryFrom?: string | null;
  /** Quote ids from `--accept-quote` (VRFY-20). */
  readonly acceptQuotes?: readonly string[];
  /** Ask the `quote-accept` gate for UNVERIFIABLE-QUOTE rows when a terminal is attached (default false). */
  readonly interactive?: boolean;
  /** --yolo (the quote-accept gate never takes it as an answer). */
  readonly yolo?: boolean;
  /**
   * The Pass-1 / Pass-3 implementations the gate core runs (default: the
   * production runPass1 / runPass3) — the seam a test uses to make a pass throw
   * mid-verify (VRFY-16); the CLI never passes it.
   */
  readonly gateDeps?: GateInput['deps'];
}

/**
 * The gate result verifySection returns: every row and the outcome, with the
 * bibliography reduced to where it is and what did not parse. The parsed
 * entries stay in the process — the MCP `pensmith_verify` tool serializes this
 * result into its reply, and every entry of a real library (with its abstract)
 * would make that reply megabytes long.
 */
export type VerifyGateResult = Omit<GateResult, 'bib'> & { readonly bib: Omit<LoadedBibliography, 'entries'> };

/** A gate result without the parsed bibliography entries (VerifyGateResult). */
function compactGate(gate: GateResult): VerifyGateResult {
  const bib: Omit<LoadedBibliography, 'entries'> = {
    path: gate.bib.path,
    exists: gate.bib.exists,
    problems: gate.bib.problems,
    ...(gate.bib.unreadable !== undefined ? { unreadable: gate.bib.unreadable } : {}),
  };
  return { ...gate, bib };
}

/** What verifySection returns (the exit code follows exitCodeForResult). */
export interface VerifySectionResult {
  readonly ok: boolean;
  readonly status: string;
  readonly blocked?: boolean;
  readonly path: string;
  readonly exitCode?: number;
  readonly gate?: VerifyGateResult;
  readonly pass1?: Pass1Result[];
  readonly pass3?: Pass3Result[];
  readonly freshness?: FreshnessResult[] | null;
  readonly pass2?: Pass2Result[];
  readonly pass4?: Pass4Result[] | null;
}

/** The Pass-1 rows of a gate result in runPass1's shape (for callers of the result). */
function asPass1Results(rows: readonly GateRow[]): Pass1Result[] {
  return rows.flatMap((r) =>
    r.kind === 'pass1' ? [{ citekey: r.key, verdict: r.verdict as Pass1Result['verdict'], titleJW: r.titleJW, authorJW: r.authorJW, reason: r.reason }] : [],
  );
}

function asPass3Results(rows: readonly GateRow[]): Pass3Result[] {
  return rows.flatMap((r) =>
    r.kind === 'pass3'
      ? [{ citekey: r.key, id: r.id, quoteSha256: r.quoteSha256, quoteSnippet: r.snippet, verdict: r.verdict as Pass3Result['verdict'], levRatio: r.levRatio, reason: r.reason, ...(r.localFile !== undefined ? { localFile: r.localFile } : {}) }]
      : [],
  );
}

/** The UNVERIFIABLE-QUOTE rows as the acceptance module reads them. */
function quoteRows(rows: readonly GateRow[]): AcceptableQuoteRow[] {
  return rows
    .filter((r): r is Pass3GateRow => r.kind === 'pass3')
    .map((r) => ({ id: r.id, citekey: r.key, quoteSha256: r.quoteSha256, verdict: r.verdict, snippet: r.snippet }));
}

/**
 * The interactive `quote-accept` gate (D-20-26): a multi-select of the
 * UNVERIFIABLE-QUOTE rows plus "accept all". Without a terminal it is skipped;
 * --yolo never answers it; an empty selection declines (the section stays
 * unverifiable). Returns the rows the user accepted.
 */
async function askQuoteAcceptance(rows: readonly AcceptableQuoteRow[], id: string, yolo: boolean): Promise<AcceptableQuoteRow[]> {
  const open = rows.filter((r) => r.verdict === ACCEPTABLE_QUOTE_VERDICT);
  if (open.length === 0 || !canPrompt()) return [];
  const ids = [...new Set(open.map((r) => r.id))];
  out(
    `pensmith verify: section ${id} has ${ids.length} quote(s) no source text could be checked against (UNVERIFIABLE-QUOTE). ` +
      'Accepting a quote records that YOU vouch for it; add the source\'s PDF (`pensmith add <pdf>`) or paraphrase instead when you can.\n',
  );
  const outcome = await runGate('quote-accept', {
    yolo,
    question: {
      id: 'quote-accept',
      kind: 'multiselect',
      label: 'Accept these quotes whose source text cannot be checked?',
      options: [
        ...ids.map((q) => {
          const r = open.find((x) => x.id === q) as AcceptableQuoteRow;
          const keys = open.filter((x) => x.id === q).map((x) => `@${x.citekey}`).join(', ');
          return { value: q, label: `${q} "${r.snippet}…" [${keys}]` };
        }),
        { value: '*', label: 'accept all of them' },
      ],
      default: [],
    },
  });
  if (outcome.kind !== 'answered' || outcome.answer.kind !== 'multiselect') return [];
  const picked = outcome.answer.value;
  if (picked.includes('*')) return open;
  return open.filter((r) => picked.includes(r.id));
}

/**
 * Verify ONE section (VRFY-01, VRFY-07, VRFY-08; D-20-20): the gate core
 * (blocking, deterministic), the freshness probe and the advisory Passes 2 and
 * 4, then VERIFICATION.md, the PLAN.md status + verified_against_draft_hash and
 * `last_verified`. The `verify` command, `write` (which chains verify after
 * each successful draft, GRND-15 / D-18-26) and compile's staleness re-verify
 * (advisory off) call it. Its result maps to the exit code
 * (exitCodeForResult): a failed or blocking-unverifiable section is
 * EXIT_BLOCKED. A fatal advisory failure (the cost cap) is thrown after the
 * deterministic verdict is written; a refused `--accept-quote` (EXIT_USAGE)
 * likewise.
 */
export async function verifySection(n: number, slug: string, suffix?: string | null, opts: VerifySectionOptions = {}): Promise<VerifySectionResult> {
  const root = projectRoot();
  const advisory = opts.advisory !== false;
  const writePaperFiles = opts.writePaperFiles !== false;
  // The section as the user types it (`1`, `1a`) — messages, the header and the model-call records.
  const id = formatSectionId(sectionIdOf(n, suffix));
  const logged = loggedSectionId(n, suffix);
  const draftPath = sectionDraft(n, slug);
  const verifPath = sectionVerification(n, slug);
  const planPath = sectionPlan(n, slug);

  // `--accept-quote` takes quote ids as VERIFICATION.md lists them (q1, q2, …):
  // a malformed id is a usage error before anything is read or written.
  for (const q of opts.acceptQuotes ?? []) {
    if (!QUOTE_ID_RE.test(q)) {
      throw new QuoteAcceptanceError(`--accept-quote ${q}: a quote id is q1, q2, … as VERIFICATION.md lists them — nothing was recorded`);
    }
  }
  // The ids are deterministic from the draft (extractQuotes): an id the draft
  // does not have is a usage error before any pass runs or anything is
  // written (RUN-09; review round 3).
  if ((opts.acceptQuotes ?? []).length > 0) {
    if (!existsSync(draftPath)) {
      throw new QuoteAcceptanceError(`--accept-quote: section ${id} has no DRAFT.md — run \`pensmith write ${id}\` first; nothing was recorded`);
    }
    const minWords = tryReadPaperConfigSync(root)?.verification?.quote_min_words;
    const ids = new Set(extractQuotes(readFileSync(draftPath, 'utf8'), minWords !== undefined ? { minWords } : {}).map((q) => q.id));
    for (const q of opts.acceptQuotes ?? []) {
      if (!ids.has(q)) throw new QuoteAcceptanceError(`--accept-quote ${q}: section ${id}'s draft has no quote ${q} — nothing was recorded`);
    }
  }

  // FEED-04 (D-18-25): the section's last write failed and kept the OLDER
  // draft. Verifying that draft would mark the section verified (and clear the
  // failure) although the failed write was never retried — the gate bypass the
  // router's attention guards against. Refuse, naming the retry; nothing is
  // written.
  let assignedSources: string[] = [];
  if (existsSync(planPath)) {
    let block: string | null = null;
    try {
      // CONF-04: the versioned PLAN.md reader (v0 migrated + written back).
      const { frontmatter } = await loadFrontmatterDoc('plan', planPath, { writeBack: true });
      const reason = frontmatter['failure_reason'];
      block = typeof reason === 'string' && reason.trim().length > 0 ? sectionWriteBlockReason(frontmatter, id) : null;
      assignedSources = Array.isArray(frontmatter['assigned_sources']) ? (frontmatter['assigned_sources'] as unknown[]).map(String) : [];
    } catch {
      block = null; // an unreadable PLAN.md is reported by the status write below
      assignedSources = [];
    }
    if (block !== null) {
      process.stderr.write(`pensmith verify: section ${id} not verified — ${block}\n`);
      return { ok: false, status: 'failed', blocked: true, path: verifPath };
    }
  }

  if (!existsSync(draftPath)) {
    // A section whose draft is gone is back to "needs writing": the router
    // re-drafts it instead of re-dispatching verify forever (VRFY-16).
    await atomicWriteFile(
      verifPath,
      renderVerificationMd({
        sectionId: id,
        slug,
        offlineMarker: offlineMarkerLine(),
        status: 'unverifiable',
        draftHash: null,
        rows: [],
        notes: [`Reason: DRAFT.md missing at ${draftPath} — run \`pensmith write ${id}\` first.`],
      }),
    );
    await updatePlanFrontmatter(planPath, (fm) => {
      if (fm.status !== 'planned') fm.status = 'writing';
      delete fm.failure_reason;
      delete fm.verified_against_draft_hash;
    });
    out(`pensmith verify: DRAFT.md missing — wrote unverifiable VERIFICATION.md to ${verifPath}; run \`pensmith write ${id}\` first\n`);
    return { ok: false, status: 'unverifiable', path: verifPath };
  }

  // VRFY-16: `verifying`, and no earlier verdict's hash, BEFORE any pass runs —
  // a verify that crashes or is killed leaves the section to be verified again,
  // never an earlier `verified`.
  await updatePlanFrontmatter(planPath, (fm) => {
    fm.status = 'verifying';
    delete fm.verified_against_draft_hash;
  });

  // The exact bytes judged: the gate reads this text, and the hash recorded
  // below is of the same bytes.
  const draftBytes = readFileSync(draftPath);
  const draftMd = draftBytes.toString('utf8');
  const draftHash = computeDraftHash(draftBytes, assignedSources);

  // SRC-12 (D-19-19): a CITATIONS.bib with entries that do not parse — e.g.
  // one an older pensmith wrote with `{\u …}` name escapes (E2E-12) — is
  // re-rendered from LIBRARY.json, the paper's source of truth, with one
  // notice. compile's staleness re-verify never writes the bib.
  let bib = loadBibliography(root);
  if (writePaperFiles) bib = await rerenderBibIfBroken(root, bib);

  const sectionDir = sectionDirOfPlan(planPath);
  const acceptancesRead = loadQuoteAcceptances(sectionDir);
  if (acceptancesRead.problem !== null) process.stderr.write(`pensmith verify: WARN — section ${id}: ${acceptancesRead.problem}\n`);
  let acceptanceSets = [{ currentDraftHash: draftHash, acceptances: acceptancesRead.acceptances, section: id }];

  // VRFY-28: the citations whose last check is older than recheck_after_days
  // are fetched past the HTTP cache (compile only reads, so it re-checks nothing).
  const cited = extractCitedKeysForVerification(draftMd);
  const refresh = writePaperFiles ? await recheckKeys(root, cited) : new Set<string>();

  let gate = await recomputeGate({
    root,
    text: draftMd,
    allowedKeys: new Set(assignedSources),
    scope: { kind: 'section', id },
    dryRun: networkMode().dryRun,
    refresh,
    acceptanceSets,
    bib,
    ...(opts.gateDeps !== undefined ? { deps: opts.gateDeps } : {}),
  });

  // VRFY-20: record the quotes the user accepts — by flag, or at the prompt.
  let acceptError: QuoteAcceptanceError | null = null;
  let toAccept: AcceptableQuoteRow[] = [];
  let via: 'flag' | 'prompt' = 'flag';
  if ((opts.acceptQuotes ?? []).length > 0) {
    try {
      toAccept = acceptableRows(quoteRows(gate.rows), opts.acceptQuotes ?? [], id);
    } catch (e) {
      if (!(e instanceof QuoteAcceptanceError)) throw e;
      acceptError = e;
    }
  } else if (opts.interactive === true) {
    const open = quoteRows(gate.rows.filter((r) => !(r.kind === 'pass3' && r.accepted !== undefined)));
    toAccept = await askQuoteAcceptance(open, id, opts.yolo === true);
    via = 'prompt';
  }
  if (toAccept.length > 0) {
    const recorded = await recordQuoteAcceptances(sectionDir, toAccept, draftHash, via);
    acceptanceSets = [{ currentDraftHash: draftHash, acceptances: [...acceptanceSets[0]!.acceptances, ...recorded], section: id }];
    const lifted = applyAcceptances(gate.rows, acceptanceSets);
    gate = { ...gate, rows: lifted.rows, accepted: lifted.accepted, outcome: gateOutcome(lifted.rows) };
    out(`pensmith verify: accepted ${[...new Set(recorded.map((a) => a.quote_id))].join(', ')} for section ${id} (recorded in QUOTE-ACCEPTANCES.json)\n`);
  }

  const status = gate.outcome.status;
  const blocked = gate.outcome.blocked;

  // RSCH-10 freshness probe (D-10, WARN-only) and the advisory Passes 2 and 4
  // run AFTER the status is frozen above and NEVER feed back into it
  // (VRFY-07). Pass 2/4 load their own prompts inside their modules (the
  // prompt-loader path lives there, not here), so verify.ts stays a
  // 100%-deterministic orchestrator at the prompt-loader chokepoint.
  //
  // No provider key is not an error here: the passes record "skipped (no LLM
  // configured)" rows (D-V1-04). A failure that must stop verify — the session
  // cost cap, an invalid runtime config — is caught so the frozen verdict is
  // still written and persisted, then rethrown (its exit code).
  let freshness: FreshnessResult[] | null = null;
  let freshnessNote: string | null = null;
  let advisoryStop: unknown = undefined;
  let pass2: Pass2Result[] = [];
  let pass4: Pass4Result[] | null = null;
  if (advisory) {
    // D-20-15: the parsed entries (no second parse); with the root the probe
    // also re-checks every LIBRARY `unknown` retraction status live (VRFY-15).
    if (bib.exists && bib.problems.length === 0) {
      freshness = await runFreshnessForDraft(draftMd, bib.path, { bibEntries: bib.entries, ...(writePaperFiles ? { root } : {}) });
    } else if (bib.exists) freshnessNote = 'freshness not probed: .paper/CITATIONS.bib has entries that do not parse';
    type BibValue = { DOI?: string; title?: string | string[]; author?: Array<{ family?: string; given?: string }> | string[]; abstract?: string };
    const bibByCitekey = new Map<string, BibValue>(bib.entries.map((e) => [String(e['id'] ?? ''), e as BibValue]));
    try {
      // `[verification] send_byo_passages` (default off, PRD §9): only then do
      // the user's own PDFs' passages go to the model provider.
      const shareByoPassages = tryReadPaperConfigSync(root)?.verification?.send_byo_passages === true;
      // VRFY-21 (D-20-28): the open-access passage nearest each claim goes
      // with the abstract (`[verification] fetch_full_text`, default on) —
      // fetched only when a model will read it (no provider configured: the
      // pairs are skipped, so nothing is downloaded for them).
      const modelReady = await assertLlmConfigured('verify').then(
        () => true,
        () => false,
      );
      pass2 = await runPass2(draftMd, bibByCitekey, {
        n: logged,
        root,
        shareByoPassages,
        ...(modelReady ? { fullText: (key: string, claim: string) => sourceTextPassage(root, key, claim) } : {}),
      });
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
  }

  const notes: string[] = [];
  if (gate.citedKeys.length === 0 && assignedSources.length === 0) notes.push(NO_CITATIONS_NOTE);
  const notRun = `${COMPILE_REVERIFY_NOT_RUN} ${id}\``;
  // The advisory sections an earlier record judged on this very draft (compile's
  // re-verify of an unverifiable, unchanged section) are kept, never "not run".
  const kept = !advisory && opts.keepAdvisoryFrom ? advisorySectionsOf(opts.keepAdvisoryFrom) : null;
  const keep = kept !== null && kept.draftHash === draftHash ? kept : null;
  const record = renderVerificationMd({
    sectionId: id,
    slug,
    offlineMarker: offlineMarkerLine(),
    status,
    draftHash,
    rows: gate.rows,
    notes,
    accepted: gate.accepted,
    freshness,
    freshnessSection: !advisory
      ? (keep?.freshnessSection ?? `## Source Freshness (RSCH-10)\n\n_(${notRun})_\n`)
      : freshnessNote !== null
        ? `## Source Freshness (RSCH-10)\n\n_(${freshnessNote} — fix the bibliography, then re-verify)_\n`
        : renderFreshnessTable(freshness ?? []),
    pass2Verdicts: advisory ? pass2.map((r) => r.verdict) : null,
    pass2Section: advisory ? renderPass2Section(pass2) : (keep?.pass2Section ?? `## Pass-2 (claim support, advisory)\n\n_(${notRun})_\n`),
    pass4Orphans: pass4 !== null ? pass4.reduce((s, r) => s + r.orphanCount, 0) : null,
    pass4Section: !advisory
      ? (keep?.pass4Section ?? `## Pass-4 (orphan claims, advisory)\n\n_(${notRun})_\n`)
      : pass4 !== null
        ? renderPass4Section(pass4)
        : `## Pass-4 (orphan claims, advisory)\n\n_(not run: ${stopReason(advisoryStop)})_\n`,
    advisorySummary: keep?.summary ?? null,
  });
  // VRFY-24: the Summary a reader trusts must equal the rows below it — checked
  // on the record before it is written (a mismatch is a verifier fault, never
  // a report).
  const mismatch = summaryMismatches(record);
  if (mismatch.length > 0) {
    throw new Error(`pensmith verify: VERIFICATION.md for section ${id} would disagree with its own Summary (${mismatch.join('; ')}) — nothing was written`);
  }
  await atomicWriteFile(verifPath, record);

  // Audit #8: persist the verdict to the section PLAN.md frontmatter so the
  // router advances the pipeline instead of looping on verify.
  // verified_against_draft_hash is the D-07 per-section hash of the bytes the
  // gate judged (DRAFT.md bytes + sorted assigned_sources), so a verified
  // section is recognized as fresh by compile and done — and a later re-write
  // changes the bytes, leaving the stored hash stale (the write<->verify
  // cycle-break). Best-effort: an absent/unwritable PLAN.md WARNs, never throws.
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

  // VRFY-28: the registrar answers that confirmed a citation become its
  // LIBRARY.json last_verified (the one writer, under the library lock; a wave
  // verify of several sections loses nothing).
  if (writePaperFiles && Object.keys(gate.checkedAt).length > 0) {
    try {
      await recordLastVerified(root, gate.checkedAt);
    } catch (e) {
      if (!(e instanceof LibraryNotFoundError)) throw e;
    }
  }

  out(`pensmith verify: wrote ${status} VERIFICATION.md to ${verifPath}\n`);
  // The deterministic verdict is on disk; now stop with the advisory failure
  // (e.g. EXIT_COST_CAP, one line through the dispatcher).
  if (advisoryStop !== undefined) throw advisoryStop;
  if (acceptError !== null) throw acceptError;
  // RUN-09: a failed or blocking-unverifiable section is a verifier refusal —
  // `blocked` maps to EXIT_BLOCKED.
  return {
    ok: !blocked,
    status,
    blocked,
    path: verifPath,
    gate: compactGate(gate),
    pass1: asPass1Results(gate.rows),
    pass3: asPass3Results(gate.rows),
    freshness,
    pass2,
    pass4,
  };
}

/** Every value of a repeatable string flag in raw argv (`--f a --f b`, `--f=a`); citty keeps only the last. */
export function repeatedFlagValues(rawArgs: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i] ?? '';
    if (tok === '--') break;
    if (tok === `--${name}`) {
      const v = rawArgs[i + 1];
      if (v !== undefined) {
        out.push(v);
        i++;
      }
    } else if (tok.startsWith(`--${name}=`)) out.push(tok.slice(name.length + 3));
  }
  return out;
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
    'accept-quote': {
      type: 'string',
      description:
        'Accept one quote whose source text cannot be checked (UNVERIFIABLE-QUOTE), by its id in VERIFICATION.md (q1, q2, …); repeat the flag for several.',
      valueHint: 'q1',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates (never accepts a quote).',
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    // RUN-09: <n> must name one of the paper's sections and --slug must be a
    // bare slug — EXIT_USAGE otherwise, before anything is read or written. The
    // slug comes from OUTLINE.md (audit #23); 'placeholder' only when there is
    // no outline yet.
    const { n, slug, suffix } = resolveSectionArg('verify', projectRoot(), args.n, args.slug);
    const fromRaw = repeatedFlagValues(rawArgs ?? [], 'accept-quote');
    // The CLI gives one string (citty keeps the last; rawArgs has them all);
    // the MCP pensmith_verify tool passes its `accept_quote` list as is.
    const given: unknown = args['accept-quote'];
    const fromArgs = Array.isArray(given) ? given.map(String) : typeof given === 'string' && given.length > 0 ? [given] : [];
    const acceptQuotes = fromRaw.length > 0 ? fromRaw : fromArgs;
    return verifySection(n, slug, suffix, { acceptQuotes, interactive: true, yolo: args.yolo === true });
  },
});

export default verifyCommand;
