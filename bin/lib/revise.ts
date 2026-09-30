// bin/lib/revise.ts — single Tier-1/Tier-2 revise chokepoint (Plan 04-04).
//
// D-05 / D-06 (LOCKED): `pensmith revise` (Tier-1 slash) and the Tier-2 CLI
// BOTH delegate to runRevise — there is NO divergent code path between tiers
// (WRTE-02 satisfied by this single module). The flow follows 04-RESEARCH §I:
//
//   1. Parse sections/<N>/VERIFICATION.md for the FIRST failing citation
//      (FABRICATED / MIS-CITED / RETRACTED / UNASSIGNED / UNPARSEABLE /
//      UNRESOLVABLE / NOT_FOUND — REVISABLE_VERDICTS), in order of appearance, that the
//      current DRAFT.md still cites (an earlier revise may have removed the
//      first ones before the next verify); none left → "nothing to change".
//   2. Load PLAN.md frontmatter → assigned_sources + the section voice hint
//      (WRTE-02 per-section consume point — threaded into the prompt vars).
//   3. Ask the LLM (via the hash-pinned revise-swap prompt) for a citekey swap.
//      Parse the response with a STRICT zod schema. REJECT if action ∉
//      {swap,remove} OR replacement_citekey ∉ assigned_sources (T-04-14
//      LLM-response-injection mitigation — no new citekeys ever enter DRAFT.md).
//   4. Approval gate (default-on, PRD §19): render a before/after diff and
//      prompt. Skipped under --yolo. Non-TTY without --yolo → exit code 3.
//   5. On accept: `swap` substitutes the flagged key via renameCitekey
//      (Plan 01 citation-token helper); `remove` mechanically deletes the
//      bracketed citation clause (NO LLM prose rewrite — 04-RESEARCH §I). Write
//      DRAFT.md via atomicWriteFile; reset PLAN.md verified_against_draft_hash
//      → null via updateFrontmatter under withLock (D-05).
//   6. --yolo auto-loop: re-run the SAME path up to 2 retries; on exhaustion
//      write a RETRY_EXHAUSTED verdict to VERIFICATION.md (D-06).
//
// `--research <query>` is NOT handled here: `plan N --research` and
// `revise N --research` both call bin/lib/section-research.ts
// runSectionResearch (GRND-17, D-19-18) — the real research pass that adds
// hits to section N only, tagged `plan-research:§<id>` (planResearchProvenance
// below, which the planner's allowed set reads through isPlanResearchFor).
// (The old research branch of this module applied the hits of an injected
// adapter that defaulted to none; it is gone.)
//
// ALL writes route through atomicWriteFile (D-07 chokepoint) — never raw fs.

import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteFile } from './atomic-write.js';
import { updateFrontmatter, migrateFrontmatterText, loadFrontmatterDoc, parseFrontmatter } from './frontmatter.js';
import { parsePlanBody } from './plan-render.js';
import { runGate, declineGate, canPrompt } from './gates.js';
import { withLock } from './lock.js';
import { extractCitedKeysForVerification, findCitations, removeCitekey, renameCitekey } from './citation-token.js';
import { sectionDraft, sectionPlan, sectionVerification } from './paths.js';
import { ACCEPTABLE_QUOTE_VERDICT, UNATTRIBUTED_CITEKEY } from './verify/verdicts.js';
import { parseBlockingVerdictRows } from './verify/verdict-rows.js';
import { DRAFT_ROW_KEY } from './verify/verification-md.js';
import { formatSectionId, sectionIdOf, type SectionId } from './section-id.js';

// --yolo retry cap (D-06): 2 retries → 3 total attempts, then RETRY_EXHAUSTED.
const YOLO_RETRY_CAP = 2;

/**
 * The verifier verdicts that --revise repairs by swapping or removing the
 * flagged citation: every failing verdict whose row names a citekey (Phase 20:
 * RETRACTED, UNASSIGNED, UNPARSEABLE and UNRESOLVABLE join FABRICATED,
 * MIS-CITED and NOT_FOUND). The rows without a citekey (a citation form the
 * grammar cannot read, an unattributed quote, NO-CITATIONS) need a re-plan —
 * REV-03 (Phase 22).
 */
export const REVISABLE_VERDICTS = ['FABRICATED', 'MIS-CITED', 'RETRACTED', 'UNASSIGNED', 'UNPARSEABLE', 'UNRESOLVABLE', 'NOT_FOUND'] as const;

/**
 * One verdict row of VERIFICATION.md (D-20-20): a Pass-3 quote row
 * `- <key> [q<N>] ("<snippet>…"): **<VERDICT>** — rest` or a keyed row
 * `- <key>: **<VERDICT>** — rest` (any citekey the grammar accepts). Null for
 * any other line.
 */
function verdictRowOf(line: string): { citekey: string; verdict: string; rest: string } | null {
  const m =
    /^\s*-\s*(\S+?)(?:\s+\[q[1-9]\d*\])?\s+\(".*"\):\s*\*\*([A-Z_-]+)\*\*\s*(.*)$/u.exec(line) ??
    /^\s*-\s*(\S+):\s*\*\*([A-Z_-]+)\*\*\s*(.*)$/u.exec(line);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { citekey: m[1], verdict: m[2], rest: m[3] ?? '' };
}

// Strict-JSON contract for the revise-swap LLM response (04-RESEARCH §I).
const ReviseSwapSchema = z.object({
  action: z.enum(['swap', 'remove']),
  flagged_citekey: z.string(),
  replacement_citekey: z.string().nullable(),
  rationale: z.string(),
  patch: z.object({
    before_excerpt: z.string(),
    after_excerpt: z.string(),
  }),
});
export type ReviseSwapProposal = z.infer<typeof ReviseSwapSchema>;

/** Variables handed to the LLM proposeSwap seam (mirror the prompt's {{vars}}). */
export interface ReviseSwapVars {
  flagged_citekey: string;
  verifier_reason: string;
  claim_context: string;
  available_sources: string;
  voice_hint: string;
}

export interface ReviseOptions {
  paperRoot: string;
  n: number;
  /** The section's letter (GRND-09: §1a); absent for a plain §N. */
  suffix?: string | undefined;
  slug: string;
  yolo: boolean;
  /**
   * LLM call seam. Returns the raw strict-JSON string the revise-swap prompt
   * asks for. Default (production) loads the hash-pinned prompt + invokes the
   * model; tests/CI inject a cassette-backed function (no live LLM).
   */
  proposeSwap?: (vars: ReviseSwapVars) => Promise<string>;
  /**
   * Approval-gate seam (default-on, PRD §19). Default uses @clack/prompts in a
   * TTY (exit code 3 in a non-TTY without --yolo). Tests inject a boolean.
   */
  approve?: (proposal: ReviseSwapProposal) => Promise<boolean>;
}

export interface ReviseResult {
  /** The action the LLM proposed for the accepted/last proposal. */
  action: 'swap' | 'remove' | null;
  /** True iff a patch was applied to DRAFT.md (and the hash reset). */
  accepted: boolean;
  flagged_citekey: string | null;
  replacement_citekey: string | null;
  /** True iff --yolo exhausted its retry budget (D-06). */
  retryExhausted: boolean;
  /** Why a proposal was rejected (membership guard / invalid shape), if any. */
  rejectedReason?: string;
  /** Human-readable summary for the CLI / workflow narration. */
  message: string;
}

// ---------------------------------------------------------------------------
// VERIFICATION.md parsing — first failing citation, in appearance order.
// ---------------------------------------------------------------------------

interface FailingCitation {
  citekey: string;
  reason: string;
}

/**
 * Every failing citation in VERIFICATION.md, in order of appearance (each
 * citekey once). A failing line looks like:
 *   - jones2019: **FABRICATED** — ... — <reason>
 *   - jones2019 [q2] ("…"): **NOT_FOUND** — ... — <reason>
 * i.e. a row whose verdict is one of REVISABLE_VERDICTS.
 */
export function failingCitations(verificationMd: string): FailingCitation[] {
  return failingRows(verificationMd).citations;
}

/**
 * The key slot of a row that names no citation (review round 2): a text
 * finding (`L<line>` — an UNPARSEABLE or UNSUPPORTED-FORM text), an
 * identifier written in the prose (`doi:10.…`, `arXiv:…`, `PMID:…`), a draft
 * check (`draft`) or an unattributed quote. revise cannot swap one: the text
 * needs a hand edit or a re-draft.
 */
function isTextRowKey(key: string, rest: string): boolean {
  if (key === DRAFT_ROW_KEY || key === UNATTRIBUTED_CITEKEY) return true;
  if (/^(?:doi:10\.|arXiv:|PMID:\d)/.test(key)) return true;
  return /^L\d+$/.test(key) && /titleJW=n\/a, authorJW=n\/a/.test(rest);
}

/** The failing rows of VERIFICATION.md: the citations revise can repair, and the text rows it cannot (each once). */
function failingRows(verificationMd: string): { citations: FailingCitation[]; textRows: FailingCitation[] } {
  const citations: FailingCitation[] = [];
  const textRows: FailingCitation[] = [];
  const seen = new Set<string>();
  for (const line of verificationMd.split(/\r?\n/)) {
    const row = verdictRowOf(line);
    if (row === null || seen.has(row.citekey)) continue;
    if (!(REVISABLE_VERDICTS as readonly string[]).includes(row.verdict)) continue;
    seen.add(row.citekey);
    const f = { citekey: row.citekey, reason: `${row.verdict}: ${row.rest.replace(/^—\s*/, '').trim()}` };
    (isTextRowKey(row.citekey, row.rest) ? textRows : citations).push(f);
  }
  return { citations, textRows };
}

/**
 * The sentence for the open UNVERIFIABLE-QUOTE rows of VERIFICATION.md (quotes
 * no source text could be checked against, not accepted), or '' (Phase 20 +
 * 23a merge, review round 2). revise swaps or removes a citekey; it cannot
 * paraphrase, so it names what can: a re-draft (`write N`, whose drafter may
 * quote only a source with full text) or an edit and `verify N`, the source's
 * PDF, or the user's acceptance of that one quote.
 */
function unverifiableQuoteAdvice(verificationMd: string, id: string): string {
  const quotes = [...new Set(parseBlockingVerdictRows(verificationMd).filter((r) => r.verdict === ACCEPTABLE_QUOTE_VERDICT).map((r) => r.quoteId ?? '?'))];
  if (quotes.length === 0) return '';
  return (
    `revise cannot paraphrase quote(s) ${quotes.join(', ')}, which no source text could be checked against: paraphrase (re-draft with ` +
    `\`pensmith write ${id}\`, or edit DRAFT.md and run \`pensmith verify ${id}\`), add the source's PDF (\`pensmith add <pdf>\`), ` +
    `or accept a quote (\`pensmith verify ${id} --accept-quote ${quotes[0] as string}\`).`
  );
}

/** The sentence naming the rows revise cannot repair and what to do instead. */
function textRowsAdvice(textRows: readonly FailingCitation[], id: string): string {
  const named = textRows.map((f) => `${f.citekey} (${f.reason.split(':')[0]})`).join(', ');
  return (
    `VERIFICATION.md also flags text that is not a citation revise can swap — ${named}: edit that text in DRAFT.md ` +
    `(a citation written as [@citekey]) or re-draft the section (\`pensmith write ${id}\`), then \`pensmith verify ${id}\`.`
  );
}

/**
 * Find the FIRST failing citation in VERIFICATION.md (one-at-a-time, in order
 * of appearance — 04-RESEARCH §I): the first row whose verdict is one of
 * REVISABLE_VERDICTS (failingCitations' first). Returns null when the section
 * has no failing citation.
 */
export function firstFailingCitation(verificationMd: string): FailingCitation | null {
  return failingCitations(verificationMd)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Claim-context extraction — the line(s) around the flagged [@citekey] token.
// ---------------------------------------------------------------------------

function claimContext(draftMd: string, citekey: string): string {
  // Bare `[@k]`, inside a cluster (`[@a; @k]`) or narrative (`@k argues`) — the one citation grammar.
  for (const line of draftMd.split(/\r?\n/)) {
    if (findCitations(line).some((c) => c.keys.includes(citekey))) return line.trim();
  }
  return '(token not found in DRAFT.md)';
}

// ---------------------------------------------------------------------------
// Voice-hint extraction — WRTE-02 per-section consume point.
// The section's planned voice, in the order a Phase 18 PLAN.md carries it
// (review round 3): the planner's `## Voice` section (plan-render.ts
// parsePlanBody), else the frontmatter `voice` the outline gave the section,
// else a pre-Phase-18 PLAN.md's one-line `Voice: …` in its ## Brief, else the
// default.
// ---------------------------------------------------------------------------

export function voiceHint(planMd: string): string {
  const { frontmatter, body } = parseFrontmatter(planMd);
  const planned = parsePlanBody(body).voice.trim();
  if (planned) return `Voice: ${planned}`;
  const outlined = typeof frontmatter['voice'] === 'string' ? frontmatter['voice'].trim() : '';
  if (outlined) return `Voice: ${outlined}`;
  const legacy = /(^|\n)\s*Voice:\s*([^\n]+)/i.exec(body);
  return legacy && legacy[2] ? `Voice: ${legacy[2].trim()}` : 'Voice: formal academic tone.';
}

// ---------------------------------------------------------------------------
// Mechanical bracket-clause removal for action: "remove".
// Deletes the flagged citation — a bare [@citekey] token with the space before
// it, or only its `;` segment inside a cluster ([@a; @k] -> [@a]). NO prose
// rewrite (04-RESEARCH §I). citation-token.ts owns the grammar.
// ---------------------------------------------------------------------------

function mechanicalRemove(draftMd: string, citekey: string): string {
  return removeCitekey(draftMd, citekey);
}

// ---------------------------------------------------------------------------
// Default LLM proposeSwap — loads the hash-pinned prompt + (would) call the
// model. Production callers inject a real transport; this default throws so a
// caller that forgot to wire the transport fails loudly instead of silently.
// ---------------------------------------------------------------------------

async function defaultProposeSwap(vars: ReviseSwapVars): Promise<string> {
  // The caller injects proposeSwap (bin/lib/revise-swap.ts builds the request
  // with buildPromptRequest and calls the model). When a caller does not inject
  // one, there is nothing to call.
  void vars;
  await Promise.resolve();
  throw new Error(
    'runRevise: no proposeSwap transport injected. The CLI/MCP caller must ' +
    'supply an LLM seam (buildPromptRequest(\'revise-swap\', …) + model call).',
  );
}

// ---------------------------------------------------------------------------
// Default approval gate — the `revise-swap` gate of the registry (RUN-28,
// bin/lib/gates.ts). --yolo is handled by the caller before this runs. A run
// that cannot prompt refuses with EXIT_APPROVAL (GateRefusedError); an explicit
// "no" is the registry's decline (EXIT_APPROVAL, DRAFT.md unchanged).
// ---------------------------------------------------------------------------

async function defaultApprove(proposal: ReviseSwapProposal): Promise<boolean> {
  if (canPrompt()) {
    process.stderr.write(
      `Proposed ${proposal.action} — ${proposal.rationale}\n` +
        `- ${proposal.patch.before_excerpt}\n+ ${proposal.patch.after_excerpt}\n`,
    );
  }
  const outcome = await runGate('revise-swap', {
    yolo: false,
    detail: `${proposal.action} of [@${proposal.flagged_citekey}]`,
    question: { id: 'revise-swap', kind: 'confirm', label: `Apply this ${proposal.action}?`, default: false },
  });
  const yes = outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
  if (!yes) declineGate('revise-swap', `citation ${proposal.action} declined — DRAFT.md unchanged`);
  return true;
}

// ---------------------------------------------------------------------------
// Validate + parse one LLM proposal against the strict schema + membership.
// ---------------------------------------------------------------------------

function validateProposal(
  raw: string,
  flagged: string,
  assignedSources: readonly string[],
): { ok: true; proposal: ReviseSwapProposal } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'LLM response was not valid JSON' };
  }
  const parsed = ReviseSwapSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `LLM response failed strict schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  }
  const p = parsed.data;
  if (p.flagged_citekey !== flagged) {
    return { ok: false, reason: `LLM flagged_citekey "${p.flagged_citekey}" does not match the verifier-flagged "${flagged}"` };
  }
  if (p.action === 'swap') {
    if (!p.replacement_citekey) {
      return { ok: false, reason: 'swap action requires a non-null replacement_citekey' };
    }
    // T-04-14: replacement MUST be drawn from assigned_sources — no new citekeys.
    if (!assignedSources.includes(p.replacement_citekey)) {
      return { ok: false, reason: `replacement_citekey "${p.replacement_citekey}" is not in assigned_sources (no new citekeys allowed)` };
    }
  } else {
    // remove
    if (p.replacement_citekey !== null) {
      return { ok: false, reason: 'remove action requires replacement_citekey: null' };
    }
  }
  return { ok: true, proposal: p };
}

// ---------------------------------------------------------------------------
// Apply an accepted proposal: patch DRAFT.md + reset the hash under withLock.
// ---------------------------------------------------------------------------

async function applyProposal(
  opts: ReviseOptions,
  proposal: ReviseSwapProposal,
  draftPath: string,
  planPath: string,
  draftMd: string,
): Promise<void> {
  let patched: string;
  if (proposal.action === 'swap') {
    const replacement = proposal.replacement_citekey as string;
    // Locate + swap the flagged key via the citation-token helper (NOT a
    // bespoke regex) — only the flagged citekey is rewritten, bare or inside a
    // cluster, keeping any prefix or locator.
    patched = renameCitekey(draftMd, proposal.flagged_citekey, replacement);
  } else {
    patched = mechanicalRemove(draftMd, proposal.flagged_citekey);
  }
  await atomicWriteFile(draftPath, patched);

  // Reset verified_against_draft_hash → null under a per-PLAN.md lock (D-05).
  await withLock(planPath, async () => {
    // CONF-04: migrate a v0 PLAN.md (stamp schema_version) before mutating it.
    const cur = migrateFrontmatterText('plan', readFileSync(planPath, 'utf8'), planPath).text;
    const next = updateFrontmatter(cur, (fm) => {
      fm['verified_against_draft_hash'] = null;
    });
    await atomicWriteFile(planPath, next);
  });
}

// ---------------------------------------------------------------------------
// The `plan <N> --research` provenance tag (GRND-17, bin/lib/section-research.ts).
// ---------------------------------------------------------------------------

/**
 * The LIBRARY.json provenance tag of a `plan <N> --research` addition
 * (`plan-research:§2`, `plan-research:§1a`; an adapter suffix may follow). The
 * planner's allowed set includes every source tagged for its section (GRND-13).
 */
export function planResearchProvenance(id: SectionId): string {
  return `plan-research:§${formatSectionId(id)}`;
}

/** True when a provenance tag records a `plan --research` addition for section `id`. */
export function isPlanResearchFor(tag: string, id: SectionId): boolean {
  const base = planResearchProvenance(id);
  return tag === base || tag.startsWith(`${base}:`);
}

// ---------------------------------------------------------------------------
// RETRY_EXHAUSTED verdict → VERIFICATION.md (D-06).
// ---------------------------------------------------------------------------

async function writeRetryExhausted(verifPath: string, flagged: string): Promise<void> {
  const cur = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';
  const note = [
    '',
    '## Revise (RETRY_EXHAUSTED — D-06)',
    '',
    `- ${flagged}: **RETRY_EXHAUSTED** — --yolo auto-revise reached the ${YOLO_RETRY_CAP}-retry cap without a valid swap. Human review required.`,
    '',
  ].join('\n');
  await atomicWriteFile(verifPath, cur + note);
}

// ===========================================================================
// runRevise — the single Tier-1/Tier-2 chokepoint.
// ===========================================================================

export async function runRevise(opts: ReviseOptions): Promise<ReviseResult> {
  const draftPath = sectionDraft(opts.n, opts.slug, opts.paperRoot);
  const planPath = sectionPlan(opts.n, opts.slug, opts.paperRoot);
  const verifPath = sectionVerification(opts.n, opts.slug, opts.paperRoot);

  const base: ReviseResult = {
    action: null,
    accepted: false,
    flagged_citekey: null,
    replacement_citekey: null,
    retryExhausted: false,
    message: '',
  };

  if (!existsSync(verifPath)) {
    return { ...base, message: `${base.message} No VERIFICATION.md at section ${opts.n} — nothing to revise.`.trim() };
  }
  const verificationMd = readFileSync(verifPath, 'utf8');
  const { citations: flagged, textRows } = failingRows(verificationMd);
  const sectionId = formatSectionId(sectionIdOf(opts.n, opts.suffix));
  const quoteAdvice = unverifiableQuoteAdvice(verificationMd, sectionId);
  const withQuoteAdvice = (message: string): string => (quoteAdvice === '' ? message : `${message} ${quoteAdvice}`);
  if (flagged.length === 0) {
    if (textRows.length > 0) {
      return { ...base, message: withQuoteAdvice(`No citation in section ${sectionId} for revise to swap. ${textRowsAdvice(textRows, sectionId).replace(/^VERIFICATION\.md also flags/, 'VERIFICATION.md flags')}`) };
    }
    return { ...base, message: withQuoteAdvice(`${base.message} No FABRICATED/MIS-CITED/NOT_FOUND citation (nor RETRACTED, UNASSIGNED, UNPARSEABLE or UNRESOLVABLE) in section ${opts.n}.`.trim()) };
  }

  if (!existsSync(planPath) || !existsSync(draftPath)) {
    base.flagged_citekey = flagged[0]!.citekey;
    return { ...base, message: `${base.message} Section ${opts.n} is missing PLAN.md or DRAFT.md.`.trim() };
  }
  const draftMd = readFileSync(draftPath, 'utf8');
  // VERIFICATION.md is not rewritten until the next verify, so an earlier
  // revise may already have repaired its first rows: repair the first flagged
  // citation the CURRENT draft still carries (review round 1 — re-proposing a
  // citation that is gone was a no-op reported as applied).
  const stillCited = new Set(extractCitedKeysForVerification(draftMd));
  const failing = flagged.find((f) => stillCited.has(f.citekey));
  if (!failing) {
    const id = sectionId;
    return {
      ...base,
      message:
        `Nothing to change: every citation VERIFICATION.md flags in section ${id} (${flagged.map((f) => f.citekey).join(', ')}) ` +
        `is already gone from DRAFT.md — re-check the section with \`pensmith verify ${id}\`.` +
        (textRows.length > 0 ? ` ${textRowsAdvice(textRows, id)}` : '') +
        (quoteAdvice !== '' ? ` ${quoteAdvice}` : ''),
    };
  }
  base.flagged_citekey = failing.citekey;
  // CONF-04: the versioned PLAN.md reader, read-only here: a rejected proposal
  // leaves PLAN.md byte-identical; applyProposal persists the migration.
  const { frontmatter, text: planMd } = await loadFrontmatterDoc('plan', planPath);
  const assignedSources = Array.isArray(frontmatter['assigned_sources'])
    ? (frontmatter['assigned_sources'] as unknown[]).map(String)
    : [];

  const proposeSwap = opts.proposeSwap ?? defaultProposeSwap;
  const approve = opts.approve ?? defaultApprove;

  const vars: ReviseSwapVars = {
    flagged_citekey: failing.citekey,
    verifier_reason: failing.reason,
    claim_context: claimContext(draftMd, failing.citekey),
    available_sources: assignedSources.map((k) => `- ${k}`).join('\n'),
    voice_hint: voiceHint(planMd),
  };

  const maxAttempts = opts.yolo ? YOLO_RETRY_CAP + 1 : 1;
  let lastRejection = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await proposeSwap(vars);
    const validated = validateProposal(raw, failing.citekey, assignedSources);
    if (!validated.ok) {
      lastRejection = validated.reason;
      continue; // --yolo retries; single-attempt mode falls through to reject
    }
    const proposal = validated.proposal;
    base.action = proposal.action;
    base.replacement_citekey = proposal.replacement_citekey;

    // Approval gate (default-on, PRD §19). --yolo skips.
    const accepted = opts.yolo ? true : await approve(proposal);
    if (!accepted) {
      return { ...base, accepted: false, message: `${base.message} Proposal rejected at the approval gate — DRAFT.md unchanged.`.trim() };
    }

    await applyProposal(opts, proposal, draftPath, planPath, draftMd);
    return {
      ...base,
      accepted: true,
      message: `${base.message} Applied ${proposal.action} for [@${failing.citekey}]${proposal.replacement_citekey ? ` → [@${proposal.replacement_citekey}]` : ''}; verification hash reset.`.trim(),
    };
  }

  // Exhausted (only reachable under --yolo with all proposals invalid, or a
  // single-attempt invalid proposal). Write RETRY_EXHAUSTED only under --yolo.
  if (opts.yolo) {
    await writeRetryExhausted(verifPath, failing.citekey);
    return { ...base, retryExhausted: true, rejectedReason: lastRejection, message: `${base.message} --yolo retries exhausted (${lastRejection}); RETRY_EXHAUSTED written.`.trim() };
  }
  return { ...base, accepted: false, rejectedReason: lastRejection, message: `${base.message} Proposal rejected (${lastRejection}); DRAFT.md unchanged.`.trim() };
}

export default runRevise;
